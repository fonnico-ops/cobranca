// cobranca-vigia (v4) — olha OS numeros de WhatsApp da cobranca e AVISA uma pessoa quando um cai.
//
// POR QUE EXISTE. Em 24/09 as 18:24 o ZaptosWPP escreveu, dentro da propria conversa, que a
// "Nina Financeiro" estava desconectada. O trilho compartilhado fez a parte dele: pausou a
// instancia, e a partir dali o cobranca-aprovar passou a recusar lote (409, nada enfileirado)
// e as 10 mensagens que ja estavam na fila ficaram paradas, com zero tentativa. Ou seja: o
// sistema se protegeu sozinho, e ninguem ficou sabendo. O numero passou 14 horas fora do ar e
// a cobranca do dia simplesmente nao aconteceu — sem erro na tela, sem aviso, sem nada.
//
// E ACONTECEU DE NOVO, PIOR: o mesmo numero caiu em 25/09 as 10:56 e ficou 12 DIAS fora. O
// aviso chegou a ser escrito, mas ficou preso na propria fila (o trilho foi desligado em
// 06/10), e 145 mensagens de cobranca envelheceram esperando — 17 delas RESPOSTAS a clientes
// que tinham escrito. Dai duas mudancas nesta versao e no resto do motor: o aviso tambem sai
// por e-mail (que nao depende de instancia nenhuma) e a cobranca passou a ter DOIS numeros.
//
// v4: UM VIGIA POR NUMERO. Desde 07/10 a cobranca alterna entre os numeros da Karla e da
//     Bianca (`cobranca_config.instancias`). Vigiar so um deixaria o outro cair em silencio —
//     que e exatamente o defeito que esta funcao existe para nao ter. Agora cada numero tem
//     estado proprio em `vigia_estado.numeros`, e o aviso diz o que muda na pratica:
//     com um numero de pe a cobranca CONTINUA, no dobro do tempo; com nenhum, ela para.
//
// O QUE ELA FAZ, a cada 10 minutos, para cada numero do rodizio:
//   1. le o estado em instancia_ghl (pausada_em)
//   2. compara com o que viu da ultima vez (cobranca_config.vigia_estado)
//   3. CAIU   -> manda WhatsApp para o numero de alerta, por OUTRA instancia (a que caiu nao
//                manda nada — seria pedir para o aparelho quebrado avisar que quebrou) e e-mail
//      VOLTOU -> avisa que voltou e quantas mensagens estao retidas
//      CONTINUA CAIDA -> lembra a cada N horas, so em horario comercial
//
// GET/POST ?liberar=1&k=<painel_chave>[&instancia=Karla]  tira a pausa depois que o numero
//   voltou no Zaptos. Sem `instancia`, libera todos os pausados do rodizio. O link vai dentro
//   do proprio aviso: quem reconectou e quem sabe que voltou, e isso tem de ser um clique.
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

/** O que a queda DESTE numero significa para a cobranca, dado quantos sobraram de pe. */
export function consequencia(dePe: number, total: number): string {
  if (dePe === 0) return "A cobrança PAROU de enviar por WhatsApp — nenhum número de pé. O e-mail continua saindo.";
  if (total <= 1) return "A cobrança PAROU de enviar por WhatsApp. O e-mail continua saindo.";
  return `A cobrança CONTINUA pelo${dePe > 1 ? "s" : ""} ${dePe} número${dePe > 1 ? "s" : ""} que sobrou${dePe > 1 ? "ram" : ""}, no dobro do tempo por rodada.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const u = new URL(req.url);

    const { data: cfg } = await sb.from("cobranca_config")
      .select("instancia,instancias,alerta_fone,alerta_email,alerta_instancia,alerta_lembrete_horas,vigia_estado,painel_chave")
      .eq("id", 1).maybeSingle();
    const RODIZIO: string[] = Array.isArray(cfg?.instancias) && cfg.instancias.length
      ? cfg.instancias.map(String) : [String(cfg?.instancia || "Nina Financeiro")];
    const FONE = String(cfg?.alerta_fone || "").replace(/\D/g, "");
    const MAIL = String(cfg?.alerta_email || "").trim();
    const ESPERA = Math.max(1, Number(cfg?.alerta_lembrete_horas ?? 3));
    const anterior = ((cfg?.vigia_estado || {}) as any).numeros || {};

    const { data: insts } = await sb.from("instancia_ghl")
      .select("instancia,pausada_em,pausada_motivo,ativa").in("instancia", RODIZIO);
    const cadastro: Record<string, any> = {};
    for (const r of (insts || [])) cadastro[String(r.instancia)] = r;
    const faltando = RODIZIO.filter((n) => !cadastro[n]);
    if (faltando.length === RODIZIO.length) {
      return j({ ok: false, erro: `nenhum numero do rodizio esta em instancia_ghl: ${RODIZIO.join(", ")}` }, 404);
    }

    /* quantas mensagens da cobranca estao RETIDAS por numero. 'segurado' e o estado novo (o
       ritmo proprio da cobranca); 'pendente' entra tambem porque linha solta e ainda nao
       enviada tambem espera o numero. */
    const retidasDe = async (inst: string) => {
      const { count } = await sb.from("fila_envio").select("id", { count: "exact", head: true })
        .eq("instancia", inst).in("status", ["segurado", "pendente"]).like("campanha", "cobranca%");
      return Number(count || 0);
    };

    const linkLiberar = (inst: string) =>
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/cobranca-vigia?liberar=1&instancia=${encodeURIComponent(inst)}&k=${encodeURIComponent(String(cfg?.painel_chave || ""))}`;

    /* ---------------- liberar: so com a chave do painel, e so quando alguem reconectou ------ */
    if (u.searchParams.get("liberar") === "1") {
      const chave = String(cfg?.painel_chave || "");
      if (chave && u.searchParams.get("k") !== chave) return j({ ok: false, erro: "chave errada" }, 401);
      const pedida = u.searchParams.get("instancia");
      const alvos = (pedida ? [pedida] : RODIZIO).filter((n) => cadastro[n]?.pausada_em);
      if (!alvos.length) return j({ ok: true, ja_estava_livre: true, rodizio: RODIZIO });
      const soltas: any[] = [];
      for (const inst of alvos) {
        const retidas = await retidasDe(inst);
        const { error } = await sb.from("instancia_ghl")
          .update({ pausada_em: null, pausada_motivo: null }).eq("instancia", inst);
        if (error) throw error;
        const aviso = await avisar(sb, cfg, inst, FONE, MAIL, `Cobranca: ${inst} liberada`,
          `✅ ${inst} liberada.\n\n${retidas} mensagem(ns) da cobrança volta(m) a sair agora, no ritmo do rodízio (uma a cada 2 minutos por número, não de uma vez).`);
        soltas.push({ instancia: inst, retidas, avisado: aviso.ok, aviso_falhou: aviso.motivo || null });
        anterior[inst] = { estado: "ok", desde: new Date().toISOString(), ultimo_aviso_em: new Date().toISOString() };
      }
      await sb.from("cobranca_config").update({ vigia_estado: { numeros: anterior } }).eq("id", 1);
      return j({ ok: true, liberadas: soltas });
    }

    /* ---------------- vigia, numero por numero ------------------------------------------- */
    const agora = new Date().toISOString();
    const dePe = RODIZIO.filter((n) => cadastro[n]?.ativa === true && !cadastro[n]?.pausada_em).length;
    const saida: any[] = [];

    for (const inst of RODIZIO) {
      const row = cadastro[inst];
      if (!row) { saida.push({ instancia: inst, erro: "nao esta em instancia_ghl" }); continue; }
      const estado = row.pausada_em ? "caida" : "ok";
      const ant = anterior[inst] || {};
      // "mudou" tambem vale quando o estado e o mesmo mas o aviso daquela mudanca nunca saiu:
      // sem isso, uma falha no primeiro aviso deixaria a queda inteira sem nenhum alerta.
      const mudou = ant.estado !== estado || (estado === "caida" && !ant.ultimo_aviso_em);
      const retidas = await retidasDe(inst);
      let aviso: any = { ok: false };

      if (mudou && estado === "caida") {
        aviso = await avisar(sb, cfg, inst, FONE, MAIL, `Cobranca: o numero ${inst} caiu`,
          `⚠️ O WhatsApp da cobrança no número da ${inst} caiu às ${qdo(row.pausada_em)}.\n\n` +
          `${consequencia(dePe, RODIZIO.length)}\n` +
          `${retidas} mensagem(ns) deste número estão retidas — nada se acumula às cegas e nada sai de uma vez na volta.\n\n` +
          `Motivo registrado: ${row.pausada_motivo || "queda detectada no envio"}\n\n` +
          `Quando reconectar na Zaptos, abra este link para liberar:\n${linkLiberar(inst)}`);
      } else if (mudou && estado === "ok") {
        aviso = await avisar(sb, cfg, inst, FONE, MAIL, `Cobranca: ${inst} voltou`,
          `✅ O número da ${inst} voltou. ${retidas} mensagem(ns) retida(s) sai(em) no ritmo do rodízio.`);
      } else if (estado === "caida" && podeLembrar(horaSp(), ant.ultimo_aviso_em, ESPERA)) {
        aviso = await avisar(sb, cfg, inst, FONE, MAIL, `Cobranca: ${inst} ainda fora do ar`,
          `⏳ O número da ${inst} continua fora do ar há ${ha(row.pausada_em)}.\n\n` +
          `${consequencia(dePe, RODIZIO.length)}\n${retidas} mensagem(ns) retida(s).\n\n` +
          `Reconectou? libere aqui:\n${linkLiberar(inst)}`);
      }

      anterior[inst] = {
        estado,
        // `desde` e quando ESTE estado comecou, e nao quando o aviso saiu
        desde: ant.estado === estado ? (ant.desde || agora) : agora,
        // so marca como avisado quando o aviso ENTROU na fila. Se falhou, o estado anterior
        // fica de pe e a proxima passada tenta de novo — senao uma falha de insercao
        // silenciaria o alerta para sempre.
        ultimo_aviso_em: aviso.ok ? agora : (ant.ultimo_aviso_em || null),
      };
      saida.push({ instancia: inst, estado, mudou, retidas, avisado: aviso.ok, canais: { whatsapp: aviso.wpp || null, email: aviso.email || null }, aviso_falhou: aviso.motivo || null, desde: row.pausada_em });
    }

    await sb.from("cobranca_config").update({ vigia_estado: { numeros: anterior } }).eq("id", 1);

    return j({ ok: true, rodizio: RODIZIO, de_pe: dePe, numeros: saida,
      cobranca_por_whatsapp: dePe > 0 ? "saindo" : "parada (so e-mail)" });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});

/**
 * Manda o aviso por OUTRA instancia — a que caiu nao consegue avisar que caiu.
 * Escreve em fila_envio como qualquer envio: quem entrega e o fila-processar, com o mesmo
 * teto por minuto de sempre. `contact_id` vai nulo de proposito: o trilho resolve o contato
 * pelo telefone, e nao ha por que criar contato de CRM para um aviso interno.
 */
async function avisar(
  sb: any, cfg: any, caiu: string, fone: string, email: string, assunto: string, texto: string,
): Promise<{ ok: boolean; motivo?: string; wpp?: string; email?: string }> {
  const notas: string[] = [];
  let wpp = "nao enfileirado", mail = "nao enfileirado";

  // UM INSERT POR CANAL, e nao um lote com os dois. O PostgREST exige que todas as linhas de
  // um lote tenham EXATAMENTE as mesmas chaves, e a linha de WhatsApp (fone, mensagem,
  // instancia) nao tem as do e-mail (email, assunto, corpo): mandados juntos, o lote inteiro
  // e recusado e o aviso nao sai por canal nenhum — que e o contrario do que este codigo existe
  // para garantir. Separados, um canal cair nao leva o outro junto.
  const grava = async (linha: any): Promise<string> => {
    // `empresa` e o CODIGO de texto da tabela empresa ('nitron'), com chave estrangeira. A
    // primeira versao mandou o numero 1, o insert morreu na FK e o erro era engolido: a funcao
    // respondia "avisado: false" sem dizer por que. Um vigia que falha calado nao vigia nada.
    const { error } = await sb.from("fila_envio").insert({
      ...linha, campanha: "cobranca_alerta", publico: "interno", empresa: "nitron", status: "pendente",
      nome: "Alerta da cobranca",
    });
    return error ? "erro: " + error.message : "na fila";
  };

  /* ---- WhatsApp: por OUTRA instancia, que a que caiu nao avisa que caiu ---- */
  if (!fone) notas.push("alerta_fone vazio");
  else {
    let quem = String(cfg?.alerta_instancia || "");
    if (!quem) {
      // prefere uma instancia da casa (escopo lead/cliente) a usar o numero pessoal de alguem
      const { data } = await sb.from("instancia_ghl").select("instancia,escopo")
        .eq("ativa", true).is("pausada_em", null).neq("instancia", caiu);
      const vivas = data || [];
      quem = (vivas.find((x: any) => x.escopo === "lead") || vivas.find((x: any) => x.escopo === "cliente") || vivas[0])?.instancia || "";
    }
    if (!quem) notas.push("sem instancia viva para o WhatsApp");
    else wpp = await grava({ canal: "whatsapp", fone, mensagem: texto, instancia: quem });
  }

  /* ---- e-mail: sem dono e sem instancia, e por isso o canal que sobrevive a queda ---- */
  if (!email) notas.push("alerta_email vazio");
  else mail = await grava({ canal: "email", email, assunto, corpo: texto.replace(/\n/g, "<br>") });

  const algum = wpp === "na fila" || mail === "na fila";
  return { ok: algum, motivo: notas.length ? notas.join("; ") : undefined, wpp, email: mail };
}
