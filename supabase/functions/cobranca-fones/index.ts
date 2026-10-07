// cobranca-fones (v1) — A PORTA NO NUMERO DE DESTINO, ANTES DE ENFILEIRAR.
//
// PEDIDO DO GESTOR (07/10): "antes de enviar temos que validar o numero de WhatsApp de destino
// para nao cair em spam e bloquear o numero na Meta."
//
// POR QUE ISSO PROTEGE O NUMERO
//   Mandar para quem nao tem WhatsApp e um dos sinais que a Meta le como spam: a mensagem nao
//   tem para onde ir, o aparelho nao confirma nada, e a conta que mandou acumula tentativa
//   morta. Dois numeros da casa ja pagaram esse preco — "Campanhas Nitron" foi RESTRINGIDA em
//   27/08 (nao foi queda de sessao: o numero foi limitado) e ficou fora sem previsao.
//   A carteira do Sankhya esta cheia de fixo e de cadastro furado, entao a porta importa.
//
// DUAS CAMADAS, NESTA ORDEM — a de graca primeiro
//   1. FORMA (aqui, instantaneo, sem custo): 11 digitos, DDD que existe, 3o digito 9, sem
//      digito repetido. Fixo e lixo morrem aqui e nem chegam ao validador pago.
//   2. EXISTENCIA (ator Apify `devscrapper~whatsapp-number-validator`, campo `exists`): o mesmo
//      que o motor-validar ja usa para prospeccao. Corrida de ator nao cabe no tempo de uma
//      Edge Function, entao e assincrono: uma passada COMECA a corrida, a seguinte LE o
//      resultado. O cron de 5 minutos faz as duas coisas em cada passada.
//
// O VEREDITO VALE 60 DIAS, por numero, em `cobranca_fone`. Sem isso a mesma carteira seria
// reconsultada a cada rodada — 139 grupos por rodada, tres rodadas por semana.
//
// QUEM USA: o cobranca-aprovar nao enfileira WhatsApp para numero com estado INVALIDO, FIXO ou
// LIXO — o grupo sai so por e-mail, com o motivo escrito no card. Numero nunca consultado NAO
// e barrado: barrar o desconhecido pararia a cobranca inteira na primeira rodada. O painel
// mostra quantos estao sem veredito.
//
// GET/POST { teto?: 40, seco?: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const ATOR = "devscrapper~whatsapp-number-validator";
const APIFY = "https://api.apify.com/v2";

// DDDs que existem no Brasil. Numero com DDD inexistente e cadastro digitado errado — e
// mandar para ele e tentativa morta, que e o que conta contra o numero que manda.
const DDD = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

/**
 * A regra de forma. Devolve o estado e o numero em E.164 sem o "+", que e o que o ator aceita.
 * Mesma regra do `celularBom` do cobranca-refresh, repetida de proposito: a de la filtra na
 * colheita do Sankhya, e esta e a porta do envio. Se so uma existisse, um contato vindo do CRM
 * (que nao passa pela colheita) entraria sem conferencia.
 */
export function forma(bruto: any): { estado: "OK" | "FIXO" | "LIXO"; motivo?: string; e164: string } {
  let d = String(bruto || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  const e164 = d ? "55" + d : "";
  if (d.length === 10) return { estado: "FIXO", motivo: "telefone fixo (10 digitos): nao tem WhatsApp", e164 };
  if (d.length !== 11) return { estado: "LIXO", motivo: `tem ${d.length} digito(s); celular brasileiro tem 11`, e164 };
  if (!DDD.has(Number(d.slice(0, 2)))) return { estado: "LIXO", motivo: `DDD ${d.slice(0, 2)} nao existe`, e164 };
  if (d[2] !== "9") return { estado: "FIXO", motivo: "o 3o digito nao e 9: nao e celular", e164 };
  if (/^(\d)\1+$/.test(d.slice(2))) return { estado: "LIXO", motivo: "digito repetido: cadastro furado", e164 };
  return { estado: "OK", e164 };
}

/** O que o ator respondeu, traduzido. `exists` e o campo do dataset. */
export function doAtor(existe: any): { estado: "VALIDO" | "INVALIDO" | "ARRISCADO"; motivo?: string } {
  if (existe === true) return { estado: "VALIDO" };
  if (existe === false) return { estado: "INVALIDO", motivo: "o validador diz que este numero nao tem WhatsApp" };
  return { estado: "ARRISCADO", motivo: "o validador nao soube responder — nao foi condenado" };
}

async function token(sb: any): Promise<string> {
  const doEnv = Deno.env.get("APIFY_TOKEN");
  if (doEnv) return doEnv;
  const { data } = await sb.from("motor_config").select("valor").eq("chave", "APIFY_TOKEN").maybeSingle();
  return String(data?.valor || "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const u = new URL(req.url);
    const teto = Math.max(1, Math.min(80, Number(b.teto ?? u.searchParams.get("teto") ?? 40)));
    const seco = b.seco === true || u.searchParams.get("seco") === "1";
    const tok = await token(sb);

    /* ---------- 1. LER as corridas que ficaram da passada anterior ---------- */
    const { data: rodando } = await sb.from("cobranca_fone").select("fone,run_id").eq("estado", "RODANDO").not("run_id", "is", null);
    const corridas = [...new Set((rodando || []).map((x: any) => String(x.run_id)))];
    let lidas = 0, validos = 0, invalidos = 0, arriscados = 0, aindaRodando = 0;

    for (const run of corridas) {
      if (!tok) break;
      let st = "";
      try {
        const r = await fetch(`${APIFY}/actor-runs/${encodeURIComponent(run)}?token=${encodeURIComponent(tok)}`);
        const d = await r.json().catch(() => ({}));
        st = String(d?.data?.status || "");
      } catch { /* rede: fica RODANDO e a proxima passada tenta de novo */ }
      if (st === "RUNNING" || st === "READY" || !st) { aindaRodando++; continue; }

      const meus = (rodando || []).filter((x: any) => String(x.run_id) === run);
      if (st !== "SUCCEEDED") {
        // corrida morreu: ninguem e condenado por isso
        if (!seco) {
          await sb.from("cobranca_fone").upsert(meus.map((x: any) => ({
            fone: x.fone, estado: "ARRISCADO", existe: null,
            motivo: "a corrida do validador terminou em " + st + " — numero nao foi condenado",
            run_id: null, checado_em: new Date().toISOString(),
          })), { onConflict: "fone" });
        }
        arriscados += meus.length;
        continue;
      }

      let itens: any[] = [];
      try {
        const r = await fetch(`${APIFY}/actor-runs/${encodeURIComponent(run)}/dataset/items?token=${encodeURIComponent(tok)}`);
        itens = await r.json().catch(() => []);
      } catch { aindaRodando++; continue; }

      const porFone: Record<string, any> = {};
      for (const it of (Array.isArray(itens) ? itens : [])) {
        const f = String(it?.phone || "").replace(/\D/g, "");
        if (f) porFone[f] = it?.exists;
      }
      const linhas = meus.map((x: any) => {
        const v = doAtor(porFone[String(x.fone)]);
        if (v.estado === "VALIDO") validos++; else if (v.estado === "INVALIDO") invalidos++; else arriscados++;
        return { fone: x.fone, estado: v.estado, existe: porFone[String(x.fone)] ?? null, motivo: v.motivo ?? null, run_id: null, checado_em: new Date().toISOString() };
      });
      if (!seco && linhas.length) {
        const { error } = await sb.from("cobranca_fone").upsert(linhas, { onConflict: "fone" });
        if (error) throw error;
      }
      lidas += linhas.length;
    }

    /* ---------- 2. QUEM AINDA PRECISA DE VEREDITO ---------- */
    // os numeros de WhatsApp dos cards que esperam aprovacao: e a rodada que vai sair
    const { data: cards } = await sb.from("cobranca_fila").select("contatos").eq("status", "aguardando").limit(1000);
    const candidatos = new Map<string, { estado: string; motivo?: string }>();
    for (const c of (cards || [])) {
      for (const ct of (Array.isArray(c.contatos) ? c.contatos : [])) {
        if (ct?.canal !== "whatsapp" || !ct?.valor) continue;
        const f = forma(ct.valor);
        if (!f.e164) continue;
        if (!candidatos.has(f.e164)) candidatos.set(f.e164, { estado: f.estado, motivo: f.motivo });
      }
    }

    // o que a forma ja condena nao vai ao ator — e de graca e e definitivo
    const porForma = [...candidatos.entries()].filter(([, v]) => v.estado !== "OK");
    if (!seco && porForma.length) {
      const { error } = await sb.from("cobranca_fone").upsert(porForma.map(([fone, v]) => ({
        fone, estado: v.estado, existe: false, motivo: v.motivo ?? null, run_id: null, checado_em: new Date().toISOString(),
      })), { onConflict: "fone" });
      if (error) throw error;
    }

    // dos que passam na forma, os que nunca foram vistos ou cujo veredito venceu (60 dias)
    const bons = [...candidatos.entries()].filter(([, v]) => v.estado === "OK").map(([f]) => f);
    const sabidos = new Set<string>();
    const vencido = new Date(Date.now() - 60 * 864e5).toISOString();
    for (let i = 0; i < bons.length; i += 300) {
      const { data } = await sb.from("cobranca_fone").select("fone,checado_em,estado").in("fone", bons.slice(i, i + 300));
      for (const r of (data || [])) {
        if (r.estado === "RODANDO") { sabidos.add(String(r.fone)); continue; }   // ja esta na fila do ator
        if (String(r.checado_em) > vencido) sabidos.add(String(r.fone));
      }
    }
    const aPerguntar = bons.filter((f) => !sabidos.has(f)).slice(0, teto);

    /* ---------- 3. COMECAR a corrida do ator ---------- */
    let runNovo: string | null = null;
    if (aPerguntar.length && !seco) {
      if (!tok) return j({ ok: false, erro: "sem APIFY_TOKEN (nem no ambiente, nem em motor_config) — nao da para validar numero" }, 500);
      const r = await fetch(`${APIFY}/acts/${ATOR}/runs?token=${encodeURIComponent(tok)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumbers: aPerguntar }),
      });
      const d = await r.json().catch(() => ({}));
      runNovo = d?.data?.id ? String(d.data.id) : null;
      if (!runNovo) return j({ ok: false, erro: `o Apify nao devolveu id de corrida (status ${r.status})`, resposta: JSON.stringify(d).slice(0, 300) }, 502);
      const { error } = await sb.from("cobranca_fone").upsert(aPerguntar.map((fone) => ({
        fone, estado: "RODANDO", existe: null, motivo: null, run_id: runNovo, checado_em: new Date().toISOString(),
      })), { onConflict: "fone" });
      if (error) throw error;
    }

    return j({
      ok: true, seco,
      lidas: { total: lidas, validos, invalidos, arriscados, corridas_ainda_rodando: aindaRodando },
      condenados_pela_forma: porForma.length,
      perguntando_agora: aPerguntar.length, run_id: runNovo,
      candidatos_na_rodada: candidatos.size,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
