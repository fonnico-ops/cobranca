// cobranca-liberar (v1) — O RITMO DA COBRANCA, UMA MENSAGEM POR NUMERO A CADA 2 MINUTOS.
//
// PEDIDO DO GESTOR (07/10): "alternar o envio dos boletos pelos numeros da Karla e da Bianca,
// enviar cada mensagem no intervalo de 2 minutos de cada numero."
//
// POR QUE ISTO NAO E UM AJUSTE NO fila_config
//   O `fila_config.wpp_intervalo_seg` vale para TODAS as campanhas que usam o trilho
//   compartilhado — representantes, reativacao, comunicado. Por 2 minutos por mensagem na
//   cobranca, todas elas andariam a 2 minutos tambem. Entao a cobranca ganha ritmo proprio:
//
//     o cobranca-aprovar escreve a linha com status 'segurado', que o fila-processar IGNORA
//     (ele so olha 'pendente' e 'agendado'). Esta funcao e a torneira: a cada minuto ela
//     pergunta, por numero, "ja deu 2 minutos?" e solta UMA — virando o status para
//     'pendente'. Dai o trilho compartilhado faz o resto, com todas as travas dele.
//
// O EFEITO COLATERAL QUE VALE MAIS QUE O PEDIDO
//   Fila retida nao explode na volta. Em 25/09 o numero caiu e 145 mensagens ficaram
//   'pendente' — prontas para sair todas de uma vez quando o numero voltasse, que e exatamente
//   o que o gestor pediu para evitar no audio de 24/09 ("nao ficar uma fila"). Com 'segurado' a
//   volta e no ritmo: uma a cada 2 minutos, por numero.
//
// A JANELA DE HORARIO existe pelo mesmo motivo do rodizio: cobranca as 3h da manha e o tipo de
// mensagem que faz o cliente denunciar o numero, e numero denunciado e numero restringido.
// Fora de `janela_hora_de`..`janela_hora_ate` (hora de Sao Paulo) nada e liberado — e nada e
// perdido, porque as linhas continuam seguradas.
//
// NUMERO PAUSADO: as linhas dele FICAM seguradas. Nao sao erro (nao foi recusa de ninguem) e
// nao sao passadas para o outro numero: quem decide o numero de saida e o dono do contato no
// CRM, e trocar o dono daqui seria escrever no CRM dentro da torneira. Quem avisa a queda e o
// cobranca-vigia; quando o numero volta, a fila retida escoa no ritmo.
//
// GET/POST {}  ->  { liberadas: [{instancia, fila_id}], retidas, pausadas, fora_da_janela }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);

/** A hora de Sao Paulo, que e a unica que importa para falar com cliente brasileiro. */
export function horaSp(agora = new Date()): number {
  return Number(agora.toLocaleString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).slice(0, 2));
}

/** Esta na janela em que se pode cobrar? Janela invertida (ex.: 20..8) nao existe aqui. */
export function naJanela(hora: number, de: number, ate: number): boolean {
  return hora >= de && hora < ate;
}

/** Ja deu o intervalo deste numero? Sem liberacao anterior, pode. */
export function podeSoltar(ultimo: string | null, intervaloSeg: number, agora = Date.now()): boolean {
  if (!ultimo) return true;
  return agora - new Date(ultimo).getTime() >= intervaloSeg * 1000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const seco = b.seco === true;

    const { data: cfg } = await sb.from("cobranca_config")
      .select("ativo,instancia,instancias,wpp_intervalo_seg,janela_hora_de,janela_hora_ate").eq("id", 1).maybeSingle();

    const rodizio: string[] = Array.isArray(cfg?.instancias) && cfg.instancias.length
      ? cfg.instancias.map(String)
      : [String(cfg?.instancia || "Nina Financeiro")];
    const intervalo = Math.max(30, Number(cfg?.wpp_intervalo_seg ?? 120));
    const de = Number(cfg?.janela_hora_de ?? 8);
    const ate = Number(cfg?.janela_hora_ate ?? 20);

    // quantas estao esperando, para a resposta (e para o painel) dizerem o tamanho da espera
    const { count: retidas } = await sb.from("fila_envio").select("id", { count: "exact", head: true })
      .eq("status", "segurado").like("campanha", "cobranca%");

    const hora = horaSp();
    if (!naJanela(hora, de, ate)) {
      return j({ ok: true, fora_da_janela: true, hora_sp: hora, janela: [de, ate], retidas: retidas || 0,
        nota: "fora da janela de cobranca; as linhas seguem seguradas e saem quando a janela abrir" });
    }

    const { data: insts } = await sb.from("instancia_ghl").select("instancia,ativa,pausada_em").in("instancia", rodizio);
    const estado: Record<string, any> = {};
    for (const i of (insts || [])) estado[String(i.instancia)] = i;

    const liberadas: any[] = [];
    const pausadas: string[] = [];
    const semVez: string[] = [];
    const semFila: string[] = [];

    for (const inst of rodizio) {
      const e = estado[inst];
      if (!e || e.ativa !== true) { pausadas.push(inst + " (fora do cadastro ou inativa)"); continue; }
      if (e.pausada_em) { pausadas.push(inst); continue; }

      const { data: ult } = await sb.from("cobranca_liberacao").select("liberado_em")
        .eq("instancia", inst).order("liberado_em", { ascending: false }).limit(1).maybeSingle();
      if (!podeSoltar(ult?.liberado_em || null, intervalo)) { semVez.push(inst); continue; }

      /* RESPOSTA PASSA NA FRENTE DE COBRANCA.
         Quem escreveu esta esperando resposta; quem esta sendo cobrado nao esta esperando
         nada. Numa fila por ordem de chegada, uma resposta atras de 60 cobrancas sairia duas
         horas depois — e duas horas depois ela ja nao responde a pergunta que foi feita.
         Dentro de cada grupo, a mais antiga primeiro. */
      let linha: any = null;
      for (const filtro of ["cobranca_resposta", null] as (string | null)[]) {
        let q = sb.from("fila_envio").select("id")
          .eq("status", "segurado").eq("instancia", inst);
        q = filtro ? q.eq("campanha", filtro) : q.like("campanha", "cobranca%");
        const { data } = await q.order("id", { ascending: true }).limit(1).maybeSingle();
        if (data?.id) { linha = data; break; }
      }
      if (!linha?.id) { semFila.push(inst); continue; }

      if (seco) { liberadas.push({ instancia: inst, fila_id: linha.id, seco: true }); continue; }

      // o `eq('status','segurado')` e a trava contra duas rodadas sobrepostas soltarem a mesma
      const { data: presa, error: eU } = await sb.from("fila_envio")
        .update({ status: "pendente" }).eq("id", linha.id).eq("status", "segurado").select("id");
      if (eU) throw eU;
      if (!presa || !presa.length) { semFila.push(inst + " (outra rodada pegou primeiro)"); continue; }

      const { error: eL } = await sb.from("cobranca_liberacao").insert({ instancia: inst, fila_id: linha.id });
      // se o livro falhar, o relogio deste numero zera e ele soltaria outra no minuto seguinte:
      // melhor devolver a linha para 'segurado' do que furar o ritmo que protege o numero.
      if (eL) {
        await sb.from("fila_envio").update({ status: "segurado" }).eq("id", linha.id).eq("status", "pendente");
        throw new Error("cobranca_liberacao nao registrou, a linha voltou a ser segurada: " + detalhar(eL));
      }
      liberadas.push({ instancia: inst, fila_id: linha.id });
    }

    return j({
      ok: true, hora_sp: hora, intervalo_seg: intervalo, rodizio,
      liberadas, retidas: Math.max(0, (retidas || 0) - liberadas.length),
      numeros_pausados: pausadas.length ? pausadas : undefined,
      ainda_no_intervalo: semVez.length ? semVez : undefined,
      sem_fila: semFila.length ? semFila : undefined,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
