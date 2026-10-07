// cobranca-entregas (v1) — CONFERE, MENSAGEM POR MENSAGEM, O QUE ACONTECEU DEPOIS DO DISPARO.
//
// O painel sabia responder "o card foi aprovado?". Quem cobra pergunta outra coisa: "a mensagem
// para ESTE numero saiu? o e-mail para ESTE endereco chegou?". Um card sao duas mensagens, com
// destinos e destinos finais diferentes — e em 25/09 isso apareceu do pior jeito: 59 cards
// "enfileirados", 28 WhatsApp sairam, o numero caiu as 13:56 e 24 mensagens ficaram paradas.
// Pela tela, os 59 estavam iguais.
//
// Esta funcao mantem o livro `cobranca_entrega` (uma linha por mensagem) em dia:
//
//   WhatsApp -> le o estado ATUAL da linha no fila_envio (pendente/enviando/enviado/erro). Nao
//               ha nada a perguntar ao GHL: quem manda e o trilho compartilhado e o resultado
//               dele ja esta gravado ali. "enviado" vira `saiu`, e NAO `entregue` — ninguem nos
//               devolve confirmacao de leitura do WhatsApp; o que o campanhas-enviar consegue
//               provar e o contrario (a linha do ZaptosWPP dizendo que a instancia caiu).
//
//   E-mail   -> pergunta ao GHL pelo id da mensagem:
//               GET /conversations/messages/email/{id} -> emailMessage.status
//               'delivered' vira `entregue`, 'opened' vira `aberto`, falha vira `erro` com o
//               texto do GHL. Esse id passou a ser gravado pelo cobranca-aprovar v5; linha
//               antiga sem id fica em `saiu` para sempre — inventar um id seria pior que a
//               lacuna, e a tela diz "sem confirmacao" em vez de fingir entrega.
//
// ORCAMENTO: a funcao tem tempo de execucao limitado e o GHL tem teto de requisicao. Entao o
// e-mail e conferido em lotes (`teto`, padrao 120) e cada linha carrega `checado_em` — quem
// acabou de ser perguntada nao e perguntada de novo no minuto seguinte. O cron roda de 10 em 10
// minutos; uma rodada que nao terminou continua na proxima, na ordem do mais antigo sem check.
//
// GET/POST { teto?: 120, dias?: 3, seco?: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";

/** O estado do WhatsApp, traduzido do fila_envio para o vocabulario do livro. */
export function doFila(status: string): "na_fila" | "saiu" | "erro" {
  if (status === "enviado") return "saiu";      // despachado; entrega nao e confirmada por ninguem
  if (status === "erro") return "erro";
  return "na_fila";                              // pendente, agendado, enviando
}

/** O que o GHL responde sobre um e-mail, traduzido. `null` = ainda nao sabemos nada novo. */
export function doGhl(status: string): { estado: "entregue" | "aberto" | "erro"; detalhe?: string } | null {
  const s = String(status || "").toLowerCase();
  if (s === "opened" || s === "clicked") return { estado: "aberto" };
  if (s === "delivered") return { estado: "entregue" };
  // o GHL usa nomes diferentes para a mesma coisa dependendo do provedor de saida
  if (["failed", "bounced", "rejected", "complained", "unsubscribed", "spam"].includes(s)) {
    return { estado: "erro", detalhe: "o provedor de e-mail devolveu: " + s };
  }
  return null;   // 'pending', 'sent', 'scheduled', vazio: segue em `saiu`
}

async function tokenGhl(sb: any, empId: string) {
  const { data } = await sb.from("empresa").select("ghl_location,ghl_token_env").eq("painel_id", empId).maybeSingle();
  const tokEnv = String(data?.ghl_token_env || "GHL_TOKEN");
  const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN") || "";
  return tok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const u = new URL(req.url);
    const teto = Math.max(1, Math.min(400, Number(b.teto ?? u.searchParams.get("teto") ?? 120)));
    const dias = Math.max(1, Math.min(60, Number(b.dias ?? u.searchParams.get("dias") ?? 3)));
    const seco = b.seco === true || u.searchParams.get("seco") === "1";
    const t0 = Date.now();

    /* ---------------- WhatsApp: o fila_envio e a verdade ---------------- */
    // So o que ainda pode mudar: 'na_fila' (esperando) e 'saiu' (para pegar erro tardio da
    // pos-checagem). Linha ja em 'erro' nao volta atras sozinha.
    const { data: wpp, error: eW } = await sb.from("cobranca_entrega")
      .select("id,fila_id,estado,detalhe,saiu_em")
      .eq("canal", "whatsapp").in("estado", ["na_fila", "saiu"]).not("fila_id", "is", null)
      .gte("criado_em", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("id").limit(2000);
    if (eW) throw eW;

    const ids = [...new Set((wpp || []).map((x: any) => Number(x.fila_id)))];
    const linha: Record<string, any> = {};
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await sb.from("fila_envio").select("id,status,enviado_em,resultado,erro").in("id", ids.slice(i, i + 500));
      for (const f of (data || [])) linha[String(f.id)] = f;
    }

    let wppMudou = 0, wppIgual = 0, wppSemLinha = 0;
    for (const e of (wpp || [])) {
      const f = linha[String(e.fila_id)];
      if (!f) { wppSemLinha++; continue; }   // linha da fila apagada: o livro guarda o que sabia
      const estado = doFila(String(f.status || ""));
      const detalhe = estado === "erro" ? String(f.resultado || f.erro || "erro sem texto").slice(0, 300) : null;
      const saiuEm = f.enviado_em || null;
      if (estado === e.estado && (detalhe || null) === (e.detalhe || null) && (saiuEm || null) === (e.saiu_em || null)) { wppIgual++; continue; }
      if (!seco) {
        const { error } = await sb.from("cobranca_entrega")
          .update({ estado, detalhe, saiu_em: saiuEm, checado_em: new Date().toISOString() }).eq("id", e.id);
        if (error) throw error;
      }
      wppMudou++;
    }

    /* `checado_em` em TODAS as que foram olhadas, numa tacada.
       Sem isto, uma rodada em que nada mudou (o caso comum) nao deixava marca nenhuma, e o
       painel escrevia "conferido pela ultima vez: nunca" com o cron rodando de 10 em 10
       minutos — pior do que nao mostrar nada, porque faz duvidar do dado que esta certo.
       Um UPDATE por lote de 500, e nao um por linha: a marca e a mesma para todas. */
    if (!seco && (wpp || []).length) {
      const vistas = (wpp || []).map((x: any) => Number(x.id));
      const agora = new Date().toISOString();
      for (let i = 0; i < vistas.length; i += 500) {
        await sb.from("cobranca_entrega").update({ checado_em: agora }).in("id", vistas.slice(i, i + 500));
      }
    }

    /* ---------------- E-mail: quem sabe e o GHL ---------------- */
    // Ordem: quem nunca foi conferido primeiro, depois o check mais antigo. `entregue` continua
    // na roda porque ainda pode virar `aberto`; passados `dias` o assunto morre — e-mail que nao
    // foi entregue em tres dias nao vai ser.
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const { data: mails, error: eM } = await sb.from("cobranca_entrega")
      .select("id,ghl_email_id,ghl_message_id,estado")
      .eq("canal", "email").in("estado", ["saiu", "entregue"]).gte("criado_em", desde)
      .or("ghl_email_id.not.is.null,ghl_message_id.not.is.null")
      .order("checado_em", { ascending: true, nullsFirst: true }).limit(teto);
    if (eM) throw eM;

    let entregues = 0, abertos = 0, falhas = 0, semNovidade = 0, semResposta = 0;
    const tok = (mails || []).length ? await tokenGhl(sb, String(b.empresa || "nitron")) : "";
    if ((mails || []).length && !tok) return j({ ok: false, erro: "sem token do GHL nas Edge Functions — o e-mail nao pode ser conferido" }, 500);

    for (const m of (mails || [])) {
      if (Date.now() - t0 > 40000) break;   // sobra tempo para responder; o resto vai na proxima
      const id = String(m.ghl_email_id || m.ghl_message_id || "");
      if (!id) continue;
      let st = "";
      try {
        const r = await fetch(`${API}/conversations/messages/email/${encodeURIComponent(id)}`, {
          headers: { Authorization: "Bearer " + tok, Version: "2021-04-15", Accept: "application/json" },
        });
        if (r.ok) { const d = await r.json().catch(() => ({})); st = String(d?.emailMessage?.status || ""); }
      } catch { /* rede: tenta de novo na proxima rodada */ }

      const novo = doGhl(st);
      const patch: any = { checado_em: new Date().toISOString() };
      if (!st) semResposta++;
      else if (!novo || novo.estado === m.estado) semNovidade++;
      else {
        patch.estado = novo.estado;
        if (novo.detalhe) patch.detalhe = novo.detalhe;
        if (novo.estado !== "erro") patch.confirmado_em = new Date().toISOString();
        if (novo.estado === "entregue") entregues++;
        if (novo.estado === "aberto") abertos++;
        if (novo.estado === "erro") falhas++;
      }
      if (!seco) { const { error } = await sb.from("cobranca_entrega").update(patch).eq("id", m.id); if (error) throw error; }
    }

    return j({
      ok: true, seco,
      whatsapp: { conferidas: (wpp || []).length, mudaram: wppMudou, iguais: wppIgual, sem_linha_na_fila: wppSemLinha },
      email: { perguntadas: (mails || []).length, entregues, abertos, falhas, sem_novidade: semNovidade, ghl_nao_respondeu: semResposta },
      ms: Date.now() - t0,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
