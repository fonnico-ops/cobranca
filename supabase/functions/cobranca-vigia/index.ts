// cobranca-vigia (v2) — olha o numero de WhatsApp da cobranca e AVISA uma pessoa quando ele cai.
//
// POR QUE EXISTE. Em 24/09 as 18:24 o ZaptosWPP escreveu, dentro da propria conversa, que a
// "Nina Financeiro" estava desconectada. O trilho compartilhado fez a parte dele: pausou a
// instancia, e a partir dali o cobranca-aprovar passou a recusar lote (409, nada enfileirado)
// e as 10 mensagens que ja estavam na fila ficaram paradas, com zero tentativa. Ou seja: o
// sistema se protegeu sozinho, e ninguem ficou sabendo. O numero passou 14 horas fora do ar e
// a cobranca do dia simplesmente nao aconteceu — sem erro na tela, sem aviso, sem nada.
//
// Um robo que para sozinho e bom. Um robo que para sozinho e nao conta para ninguem vira um
// dia perdido por semana. Esta funcao e so isso: contar.
//
// O QUE ELA FAZ, a cada 10 minutos:
//   1. le o estado da instancia da cobranca em instancia_ghl (pausada_em)
//   2. compara com o que viu da ultima vez (cobranca_config.vigia_estado)
//   3. CAIU   -> manda WhatsApp para o numero de alerta, por OUTRA instancia (a que caiu nao
//                manda nada — seria pedir para o aparelho quebrado avisar que quebrou)
//      VOLTOU -> avisa que voltou e quantas mensagens foram liberadas
//      CONTINUA CAIDA -> lembra a cada N horas, so em horario comercial, para nao sumir do radar
//
// GET/POST ?liberar=1&k=<painel_chave>  tira a pausa depois que o numero voltou no Zaptos, e
//   responde quantas mensagens estao liberadas. O link vai dentro do proprio aviso: quem
//   reconectou o numero e quem sabe que ele voltou, e isso tem de ser um clique, nao um chamado.
//
// O QUE ELA NAO FAZ. Ela nao tira a pausa sozinha. Nao da para saber daqui se o aparelho
// voltou — o que temos e a ausencia de erro, que nao e a mesma coisa. Tirar a pausa no
// chute recomeca o envio no ar e e assim que um numero vira restringido (foi o que aconteceu
// com a "Campanhas Nitron" em 27/08, e ela esta fora ate hoje).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const horaSp = () => Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
const qdo = (t: any) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/** Horas que o numero ficou fora, em texto de gente. */
export function ha(desde: any, agora = Date.now()): string {
  const min = Math.max(0, Math.round((agora - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** So incomoda em horario de gente: aviso de madrugada nao e lido e ainda ensina a ignorar. */
export function podeLembrar(hora: number, ultimoEm: any, esperaHoras: number, agora = Date.now()): boolean {
  if (hora < 8 || hora > 20) return false;
  if (!ultimoEm) return true;
  return agora - new Date(ultimoEm).getTime() >= esperaHoras * 3600000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const u = new URL(req.url);

    const { data: cfg } = await sb.from("cobranca_config")
      .select("instancia,alerta_fone,alerta_instancia,alerta_lembrete_horas,vigia_estado,painel_chave")
      .eq("id", 1).maybeSingle();
    const NOME_INST = String(cfg?.instancia || "Nina Financeiro");
    const FONE = String(cfg?.alerta_fone || "").replace(/\D/g, "");
    const ESPERA = Math.max(1, Number(cfg?.alerta_lembrete_horas ?? 3));
    const estadoAnterior = (cfg?.vigia_estado || {}) as any;

    const { data: inst } = await sb.from("instancia_ghl")
      .select("instancia,pausada_em,pausada_motivo,ativa").eq("instancia", NOME_INST).maybeSingle();
    if (!inst) return j({ ok: false, erro: `instancia "${NOME_INST}" nao esta em instancia_ghl` }, 404);

    /* quantas mensagens da cobranca estao presas esperando o numero voltar */
    const { count: presas } = await sb.from("fila_envio").select("id", { count: "exact", head: true })
      .eq("instancia", NOME_INST).eq("status", "pendente");
    const seguradas = Number(presas || 0);

    /* ---------------- liberar: so com a chave do painel, e so quando alguem reconectou ------ */
    if (u.searchParams.get("liberar") === "1") {
      const chave = String(cfg?.painel_chave || "");
      if (chave && u.searchParams.get("k") !== chave) return j({ ok: false, erro: "chave errada" }, 401);
      if (!inst.pausada_em) return j({ ok: true, ja_estava_livre: true, instancia: NOME_INST, seguradas });
      const { error } = await sb.from("instancia_ghl")
        .update({ pausada_em: null, pausada_motivo: null }).eq("instancia", NOME_INST);
      if (error) throw error;
      const solto = await avisar(sb, cfg, NOME_INST, FONE,
        `✅ ${NOME_INST} liberada.\n\n${seguradas} mensagem(ns) da cobrança volta(m) a sair agora, no ritmo normal (cerca de 2 por minuto, não de uma vez).`);
      await sb.from("cobranca_config").update({
        vigia_estado: { estado: "ok", desde: new Date().toISOString(), ultimo_aviso_em: new Date().toISOString() },
      }).eq("id", 1);
      return j({ ok: true, liberada: NOME_INST, liberadas: seguradas, avisado: solto.ok, aviso_falhou: solto.motivo || null });
    }

    /* ---------------- vigia ---------------------------------------------------------------- */
    const agora = new Date().toISOString();
    const estado = inst.pausada_em ? "caida" : "ok";
    // "mudou" tambem vale quando o estado e o mesmo mas o aviso daquela mudanca nunca saiu:
    // sem isso, uma falha no primeiro aviso deixaria a queda inteira sem nenhum alerta.
    const mudou = estadoAnterior.estado !== estado || (estado === "caida" && !estadoAnterior.ultimo_aviso_em);
    const linkLiberar = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cobranca-vigia?liberar=1&k=${encodeURIComponent(String(cfg?.painel_chave || ""))}`;

    let aviso: { ok: boolean; motivo?: string } = { ok: false };
    if (mudou && estado === "caida") {
      aviso = await avisar(sb, cfg, NOME_INST, FONE,
        `⚠️ O WhatsApp da cobrança (${NOME_INST}) caiu às ${qdo(inst.pausada_em)}.\n\n` +
        `A cobrança PAROU de enviar sozinha — nada fica se acumulando às cegas.\n` +
        `${seguradas} mensagem(ns) estão seguradas.\n\n` +
        `Motivo registrado: ${inst.pausada_motivo || "queda detectada no envio"}\n\n` +
        `Quando reconectar o número na Zaptos, abra este link para liberar:\n${linkLiberar}`);
    } else if (mudou && estado === "ok") {
      aviso = await avisar(sb, cfg, NOME_INST, FONE,
        `✅ ${NOME_INST} voltou. ${seguradas} mensagem(ns) da cobrança volta(m) a sair no ritmo normal.`);
    } else if (estado === "caida" && podeLembrar(horaSp(), estadoAnterior.ultimo_aviso_em, ESPERA)) {
      aviso = await avisar(sb, cfg, NOME_INST, FONE,
        `⏳ O WhatsApp da cobrança (${NOME_INST}) continua fora do ar há ${ha(inst.pausada_em)}.\n\n` +
        `${seguradas} mensagem(ns) seguradas, e a cobrança do dia não está saindo.\n\n` +
        `Reconectou? libere aqui:\n${linkLiberar}`);
    }

    await sb.from("cobranca_config").update({
      vigia_estado: {
        estado,
        // `desde` e quando ESTE estado comecou, e nao quando o aviso saiu
        desde: estadoAnterior.estado === estado ? (estadoAnterior.desde || agora) : agora,
        // so marca como avisado quando o aviso ENTROU na fila. Se falhou, o estado anterior
        // fica de pe e a proxima passada tenta de novo — senao uma falha de insercao
        // silenciaria o alerta para sempre.
        ultimo_aviso_em: aviso.ok ? agora : (estadoAnterior.ultimo_aviso_em || null),
      },
    }).eq("id", 1);

    return j({ ok: true, instancia: NOME_INST, estado, mudou, avisado: aviso.ok, aviso_falhou: aviso.motivo || null, seguradas, desde: inst.pausada_em });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});

/**
 * Manda o aviso por OUTRA instancia — a que caiu nao consegue avisar que caiu.
 * Escreve em fila_envio como qualquer envio: quem entrega e o fila-processar, com o mesmo
 * teto por minuto de sempre. `contact_id` vai nulo de proposito: o trilho resolve o contato
 * pelo telefone, e nao ha por que criar contato de CRM para um aviso interno.
 */
async function avisar(sb: any, cfg: any, caiu: string, fone: string, texto: string): Promise<{ ok: boolean; motivo?: string }> {
  if (!fone) return { ok: false, motivo: "cobranca_config.alerta_fone esta vazio" };

  let quem = String(cfg?.alerta_instancia || "");
  if (!quem) {
    // prefere uma instancia da casa (escopo lead/cliente) a usar o numero pessoal de alguem
    const { data } = await sb.from("instancia_ghl").select("instancia,escopo")
      .eq("ativa", true).is("pausada_em", null).neq("instancia", caiu);
    const vivas = data || [];
    quem = (vivas.find((x: any) => x.escopo === "lead") || vivas.find((x: any) => x.escopo === "cliente") || vivas[0])?.instancia || "";
  }
  if (!quem) return { ok: false, motivo: "nenhuma instancia viva para mandar o aviso" };

  // `empresa` e o CODIGO de texto da tabela empresa ('nitron'), com chave estrangeira. A
  // primeira versao mandou o numero 1 e o insert morreu na FK — e, pior, o erro era engolido
  // e a funcao respondia "avisado: false" sem dizer por que. Um vigia que falha calado nao
  // vigia nada: por isso o motivo agora sobe na resposta.
  const { error } = await sb.from("fila_envio").insert({
    canal: "whatsapp", fone, nome: "Alerta da cobranca", mensagem: texto,
    instancia: quem, campanha: "cobranca_alerta", publico: "interno", empresa: "nitron", status: "pendente",
  });
  return error ? { ok: false, motivo: "fila_envio: " + error.message } : { ok: true };
}
