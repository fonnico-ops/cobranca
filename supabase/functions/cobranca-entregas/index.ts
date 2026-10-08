// cobranca-entregas (v3) — CONFERE, MENSAGEM POR MENSAGEM, O QUE ACONTECEU DEPOIS DO DISPARO.
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
// v3 (08/10): A MARCACAO NO MCP GANHOU FIM. A v2 so gravava `marcado_erro` quando a marcacao
//   falhava e deixava `marcado_em` nulo, entao a linha voltava a cada 10 minutos e rechamava os
//   MESMOS nufins. Com um erro permanente do servico do ERP, a linha 102 (12 nufins) fez 1.881
//   chamadas em 144 rodadas. Nenhuma mensagem foi para cliente nenhum — marcar nao e enviar — e
//   e por isso que ninguem perceberia: o estrago era so no log do MCP. Agora ha teto de
//   tentativas e memoria por nufin (ver `vereditoDaMarcacao` e o bloco 3).
//
// GET/POST { teto?: 120, dias?: 3, seco?: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";

/**
 * O QUE FAZER COM UMA LINHA DEPOIS DE TENTAR MARCA-LA NO MCP.
 *
 * Isto e funcao pura porque o laco que ela governa ja se perdeu uma vez: em 07/10 uma linha
 * com erro permanente do ERP voltou 144 vezes e rechamou os mesmos 12 nufins, 1.881 vezes ao
 * todo. A regra que faltava cabe em tres linhas, e agora o teste a prende:
 *   - deu tudo certo        -> fecha (`marcado_em`), nunca mais volta;
 *   - so faltou tempo       -> nao conta fracasso, volta e continua de onde parou;
 *   - erro, dentro do teto  -> conta a tentativa e volta;
 *   - erro, no teto         -> FECHA mesmo assim, com o motivo escrito. Linha fechada com
 *                              defeito e visivel; linha eterna e so ruido no log do MCP.
 */
export function vereditoDaMarcacao(
  o: { tentativas: number; teto: number; erros: string[]; sobrouTempo: boolean },
): { fecha: boolean; desistiu: boolean; tentativas: number; erro: string | null } {
  if (!o.erros.length) {
    return { fecha: o.sobrouTempo, desistiu: false, tentativas: o.tentativas, erro: null };
  }
  const tentativas = Number(o.tentativas || 0) + 1;
  const desistiu = tentativas >= o.teto;
  return {
    fecha: desistiu, desistiu, tentativas,
    erro: (desistiu ? `desistiu apos ${tentativas} tentativas — ` : `tentativa ${tentativas}/${o.teto} — `) + o.erros.join(" | "),
  };
}

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


/* ---------------------------------------------- o MCP da Nitron (mesmo cliente do montar)
 * Repetido de proposito: cada Edge Function e um deploy independente, e um import comum
 * obrigaria a redeployar as duas juntas. O guia e o mesmo: JSON-RPC em /mcp, Accept com os
 * dois tipos (senao 406), `isError` no result quando a tool recusa, e 429 com Retry-After.
 */
const MCP_URL = "https://mcp-y7bu.onrender.com/mcp";

async function chaveMcp(sb: any): Promise<{ chave: string; header: string; prefixo: string }> {
  const header = Deno.env.get("NITRON_MCP_HEADER") || "Authorization";
  const prefixo = Deno.env.get("NITRON_MCP_PREFIXO") ?? (header === "Authorization" ? "Bearer " : "");
  const doEnv = Deno.env.get("NITRON_MCP_KEY");
  if (doEnv) return { chave: doEnv, header, prefixo };
  const { data } = await sb.from("motor_config").select("valor").eq("chave", "NITRON_MCP_KEY").maybeSingle();
  return { chave: String(data?.valor || ""), header, prefixo };
}

async function mcpTool(cred: { chave: string; header: string; prefixo: string }, tool: string, args: any): Promise<any> {
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      [cred.header]: cred.prefixo + cred.chave,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
  });
  if (r.status === 429) {
    const espera = Math.min(30, Number(r.headers.get("Retry-After") || 5));
    await new Promise((res) => setTimeout(res, espera * 1000));
    return await mcpTool(cred, tool, args);
  }
  const txt = await r.text();
  if (!r.ok) throw new Error(`MCP ${tool} ${r.status}: ${txt.slice(0, 200)}`);
  const cru = txt.startsWith("data:") ? txt.split(/\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("") : txt;
  let d: any = {};
  try { d = JSON.parse(cru); } catch { throw new Error(`MCP ${tool}: resposta ilegivel: ${txt.slice(0, 200)}`); }
  if (d.error) throw new Error(`MCP ${tool}: ${d.error.message || JSON.stringify(d.error).slice(0, 200)}`);
  if (d?.result?.isError) {
    const txtErro = (d.result.content || []).map((c: any) => c?.text || "").join(" ").slice(0, 200);
    throw new Error(`MCP ${tool}: ${txtErro || "a tool respondeu isError sem texto"}`);
  }
  const conteudo = d?.result?.content;
  const texto = Array.isArray(conteudo) ? conteudo.map((c: any) => c?.text || "").join("") : "";
  if (texto) { try { return JSON.parse(texto); } catch { return { texto }; } }
  return d?.result?.structuredContent ?? d?.result ?? {};
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

    /* ---------------- 3. AVISAR O MCP DE QUE O BOLETO JA FOI ----------------
       A automacao do GHL decide o que mandar pelo `nitron_boleto_pendentes`, que lista o que
       ainda NAO foi enviado para aquele numero. Se a cobranca manda o link e nao marca, o
       mesmo boleto sai de novo por lá: a mesma divida chegando por dois caminhos no mesmo dia
       ensina o cliente a ignorar os dois.
       SO MARCA DEPOIS DE SAIR, nunca no clique — e a regra do guia, e e o que faz sentido:
       titulo marcado sem a mensagem ter saido desaparece das duas filas e ninguem cobra.
       `protocolo` e o id desta linha do livro: o guia diz que chamar duas vezes com o mesmo
       protocolo devolve `jaRegistrado` em vez de duplicar, e e isso que protege um retry. */
    /* O RETRY TEM TETO E TEM MEMORIA — e os dois nasceram de um estrago.
       Em 07/10 as 16:20 a linha 102 (card 684, 12 nufins) comecou a falhar com erro do
       servico do ERP por tras do MCP. A versao anterior so gravava `marcado_erro` e deixava
       `marcado_em` nulo, entao a MESMA linha voltava a cada 10 minutos e rechamava os MESMOS
       12 nufins: 144 rodadas, 1.881 chamadas pela mesma divida, sem nenhum caminho para parar
       — nem quando o erro era permanente, nem quando 11 dos 12 nufins ja tinham sido aceitos.
       Nada disso virou mensagem para cliente (marcar nao e enviar), mas um laco que so para
       quando alguem percebe nao e um laco: e uma bomba-relogio silenciosa.
         `marcado_tentativas` < TETO  -> a linha sai da fila sozinha depois de TETO fracassos,
                                          fechada com o motivo, para a TI achar depois;
         `marcado_nufins`             -> nufin ja aceito nao e rechamado no retry. */
    const TETO_MARCA = 5;
    let marcados = 0, marcaFalhou = 0, marcaDesistiu = 0;
    const paraMarcar = await (async () => {
      if (seco) return [];
      const { data } = await sb.from("cobranca_entrega")
        .select("id,card_id,canal,destino,estado,marcado_tentativas,marcado_nufins")
        .in("estado", ["saiu", "entregue", "aberto"]).is("marcado_em", null)
        .lt("marcado_tentativas", TETO_MARCA)
        .gte("criado_em", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("id").limit(40);
      return data || [];
    })();
    if (paraMarcar.length) {
      const cards = [...new Set(paraMarcar.map((x: any) => Number(x.card_id)))];
      const porCard: Record<string, any> = {};
      const { data: fila } = await sb.from("cobranca_fila").select("id,boleto_links").in("id", cards);
      for (const c of (fila || [])) porCard[String(c.id)] = c;
      const cred = await chaveMcp(sb);

      for (const e of paraMarcar) {
        const links = porCard[String(e.card_id)]?.boleto_links;
        // card que saiu com anexo (sem link) nao tem o que marcar: quem alimenta o
        // `pendentes` e o link. Fica marcado para nao voltar na proxima rodada.
        if (!Array.isArray(links) || !links.length) {
          await sb.from("cobranca_entrega").update({ marcado_em: new Date().toISOString(), marcado_erro: "card sem link: nada a marcar no MCP" }).eq("id", e.id);
          continue;
        }
        if (!cred.chave) { marcaFalhou++; continue; }
        const nufins = [...new Set(links.flatMap((l: any) => Array.isArray(l.nufins) ? l.nufins.map(Number) : []))].filter(Boolean);
        // o que o MCP ja aceitou em rodadas anteriores nao volta para a linha de frente
        const feitos = new Set((Array.isArray(e.marcado_nufins) ? e.marcado_nufins : []).map(Number));
        const faltam = nufins.filter((n: number) => !feitos.has(n));
        const erros: string[] = [];
        let sobrouTempo = true;
        for (const nufin of faltam) {
          // sem tempo para terminar: salva o avanco e volta na proxima rodada SEM contar
          // fracasso — ficar sem minuto nao e o MCP ter recusado nada.
          if (Date.now() - t0 > 55000) { sobrouTempo = false; break; }
          try {
            await mcpTool(cred, "nitron_boleto_marcar_enviado", {
              nufin, destino: String(e.destino || ""),
              canal: e.canal === "email" ? "EMAIL" : "WHATSAPP",
              protocolo: `cobranca-entrega-${e.id}`,
              agente: "cobranca-nitron",
            });
            feitos.add(Number(nufin));
          } catch (err) { erros.push(`${nufin}: ${String(err).slice(0, 80)}`); }
        }
        const v = vereditoDaMarcacao({
          tentativas: Number(e.marcado_tentativas || 0), teto: TETO_MARCA, erros, sobrouTempo,
        });
        if (v.desistiu) marcaDesistiu++;
        else if (erros.length) marcaFalhou++;
        else if (v.fecha) marcados++;
        await sb.from("cobranca_entrega").update({
          marcado_nufins: [...feitos],
          marcado_tentativas: v.tentativas,
          ...(v.fecha ? { marcado_em: new Date().toISOString() } : {}),
          marcado_erro: v.erro,
        }).eq("id", e.id);
      }
    }

    return j({
      ok: true, seco,
      whatsapp: { conferidas: (wpp || []).length, mudaram: wppMudou, iguais: wppIgual, sem_linha_na_fila: wppSemLinha },
      email: { perguntadas: (mails || []).length, entregues, abertos, falhas, sem_novidade: semNovidade, ghl_nao_respondeu: semResposta },
      mcp: { marcados, falharam: marcaFalhou, desistiu: marcaDesistiu, olhadas: paraMarcar.length },
      ms: Date.now() - t0,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
