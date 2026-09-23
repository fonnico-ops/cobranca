// cobranca-emitidos (v1) — o boleto chega quando ele NASCE, nao uma semana antes de vencer.
//
// O PROBLEMA QUE ISTO RESOLVE
//   O motor de cobranca so olha para quem esta vencido ou vence na proxima semana. Entao um
//   boleto emitido hoje, com vencimento em 60 dias, so encontrava o cliente 53 dias depois —
//   em cima do vencimento, quando ele ja fechou a programacao de pagamento do mes. Aqui o
//   boleto sai no fim do dia em que foi registrado.
//
// ISTO NAO E COBRANCA, E ENTREGA.
//   Sem regua, sem cartorio, sem "me responde hoje". O titulo ainda nem venceu: o tom e o de
//   quem esta mandando um documento, nao o de quem esta cobrando. Por isso a funcao e
//   separada e tem a propria chave (cobranca_config.emitidos_ativo) — e por isso ela so
//   pega titulo A VENCER. O que ja venceu e assunto do cobranca-montar, e mandar os dois
//   seria cobrar duas vezes o mesmo titulo no mesmo dia.
//
// COMO ELA SABE O QUE E NOVO
//   Nao por data do ERP. O `AD_HYAKRECSITUACAO` tem os estados do registro mas so 0,8% de
//   preenchimento, e o refresh APAGA e reescreve o cobranca_titulo inteiro todo dia — entao
//   qualquer marca dentro dele se perde. O controle vive fora: `boleto_entregue`, um NUFIN
//   por linha. Manda o que tem boleto_url e nao esta la. Idempotente por construcao.
//
// A PRIMEIRA EXECUCAO E UM BACKFILL
//   Sem isso a estreia mandaria ~1.170 titulos de uma vez. `{"backfill":true}` marca tudo
//   que existe hoje como entregue, SEM mandar nada; a partir dai so sai o que e novo.
//
// POST { dry?: true, backfill?: true, limite?: n }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
const digitos = (s: any) => String(s || "").replace(/\D/g, "");
const e164 = (f: any) => { const d = digitos(f); return d ? (d.length <= 11 ? "+55" + d : "+" + d) : ""; };

const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ""); };

/* ================================================================== o texto
   Escrito em codigo, como todo o resto: aqui vao valor, vencimento, NF e parcela. */
const NAO_E_NOME = new Set(["loja","filial","matriz","centro","deposito","cd","comercio","comercial",
  "industria","distribuidora","casa","mercado","super","supermercado","ltda","me","grupo","rede",
  "unidade","posto","materiais","construcao","home","center"]);
export function primeiroNome(s: any): string {
  const p = String(s || "").trim().split(/\s+/)[0] || "";
  if (!/^\p{L}/u.test(p)) return "";
  const limpo = p.replace(/[^\p{L}]/gu, "");
  if (limpo.length < 3) return "";
  if (NAO_E_NOME.has(limpo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())) return "";
  if (p === p.toLowerCase() || p === p.toUpperCase()) return p[0].toUpperCase() + p.slice(1).toLowerCase();
  return p;
}

/**
 * Uma linha por titulo, com a ORIGEM junto — e aqui ela vale ainda mais do que na cobranca:
 * o cliente esta recebendo um boleto que nao pediu, de uma compra que pode ter sido feita
 * por outra pessoa da empresa dele. "NF 133/1 (parcela 2 de 12)" e o que faz ele reconhecer
 * o documento em vez de achar que e golpe.
 *
 * `t.contrato && ...`: no Clube o NUMNOTA vem com o numero do CONTRATO, nao com uma nota.
 */
export function linhaEmitido(t: any): string {
  const parc = (() => {
    const n = String(t.parcela || "").replace(/^0+/, "");
    const tot = Number(t.parcelas_total) || 0;
    return n && tot > 1 ? ` (parcela ${n} de ${tot})` : "";
  })();
  const de = t.contrato
    ? ` · contrato do Clube nº ${t.contrato}${parc}`
    : (t.numnota ? ` · NF ${t.numnota}${t.serie ? "/" + t.serie : ""}${parc}` : parc);
  return `• ${brl(t.valor)} — venc. ${dataBr(t.dtvenc)}${de}`;
}

export function textoEmitidos(ctx: { nome: string; titulos: any[]; total: number; empresa: string; assinatura: any }): string {
  const n = ctx.titulos.length;
  const ord = ctx.titulos.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)));
  const partes = [
    `Olá, ${ctx.nome ? ctx.nome + "!" : "tudo bem?"}`, "",
    n === 1
      ? `Saiu o boleto da sua compra aqui na ${ctx.empresa}. Estou mandando agora, assim que ele foi registrado no banco — para não chegar em cima do vencimento.`
      : `Saíram ${n} boletos das suas compras aqui na ${ctx.empresa}. Estou mandando agora, assim que foram registrados no banco — para não chegarem em cima do vencimento.`,
    "",
    ord.map(linhaEmitido).join("\n"), "",
    `Total: *${brl(ctx.total)}*`, "",
    n === 1 ? "O PDF segue em anexo." : "Os PDFs seguem em anexo.",
    "",
    "Não precisa fazer nada agora — é só guardar para a data. Se precisar de outra via, ou tiver dúvida sobre a nota, é só responder aqui.",
    "",
    assinar("Obrigada!", ctx.assinatura),
  ];
  return partes.join("\n");
}

/** Mesmo rodape da cobranca: fixos para ligacao, WhatsApp rotulado, e-mail em linha propria. */
export function assinar(despedida: string, a: any): string {
  const linha = String(a?.linha || "").trim() || "Nitron";
  const fixos = (Array.isArray(a?.telefones) ? a.telefones : []).map((x: any) => String(x || "").trim()).filter(Boolean);
  const cel = String(a?.telefone || "").trim();
  const rodape = [
    String(a?.razao_social || "").trim(),
    a?.cnpj ? "CNPJ " + String(a.cnpj).trim() : "",
    [...fixos, cel ? "WhatsApp " + cel : ""].filter(Boolean).join(" · "),
    String(a?.email || "").trim(),
  ].filter(Boolean);
  return [despedida, linha, ...(rodape.length ? ["", ...rodape] : [])].join("\n");
}

export function html(texto: string, boletos: any[]): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  const links = boletos.length
    ? '<p style="margin:18px 0 0">' + boletos.map((b: any) =>
        `<a href="${b.url}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 14px;background:#0b5;color:#fff;text-decoration:none;border-radius:6px;font:600 13px system-ui,sans-serif">Boleto venc. ${dataBr(b.dtvenc)} — ${brl(b.valor)}</a>`
      ).join("") + "</p>"
    : "";
  return `<div style="font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:620px">${esc(texto)}${links}</div>`;
}

/* =========================================================================== GHL */
type EmpGhl = { loc: string; tok: string; fidCodparc: string | null };
async function empresaGhl(sb: any, id: string): Promise<EmpGhl> {
  const { data, error } = await sb.from("empresa").select("ghl_location,ghl_token_env,campos").eq("painel_id", id).maybeSingle();
  if (error) throw error;
  const loc = data?.ghl_location ? String(data.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro`);
  const tok = Deno.env.get(String(data?.ghl_token_env || "GHL_TOKEN")) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}"`);
  const fid = data?.campos && typeof data.campos === "object" && data.campos.codparc ? String(data.campos.codparc) : null;
  return { loc, tok, fidCodparc: fid };
}
function ghl(g: EmpGhl, method: string, path: string, body?: any, version = "2021-07-28") {
  return fetch(API + path, { method, headers: { Authorization: "Bearer " + g.tok, Version: version, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
async function buscarUm(g: EmpGhl, q: string): Promise<any> {
  try { const r = await ghl(g, "GET", `/contacts/?locationId=${g.loc}&query=${encodeURIComponent(q)}&limit=1`); if (!r.ok) return null; const d = await r.json(); return (d?.contacts || [])[0] || null; } catch { return null; }
}
async function garantirContato(g: EmpGhl, canal: string, valor: string, nome: string | null, codparc: number, dono?: string) {
  const buscas = canal === "email" ? [valor] : [e164(valor), digitos(valor)];
  for (const q of buscas) { const c = await buscarUm(g, q); if (c?.id) return { id: String(c.id), dono_atual: String(c.assignedTo || "") || null, criado: false }; }
  const campos: any = { locationId: g.loc, firstName: nome || (canal === "email" ? valor : "Contato " + e164(valor)) };
  if (canal === "email") campos.email = valor; else campos.phone = e164(valor);
  if (g.fidCodparc && codparc) campos.customFields = [{ id: g.fidCodparc, value: String(codparc) }];
  if (dono) campos.assignedTo = dono;
  const r = await ghl(g, "POST", "/contacts/upsert", campos);
  const d = await r.json().catch(() => ({}));
  const id = d?.contact?.id ? String(d.contact.id) : null;
  return id ? { id, dono_atual: dono || null, criado: true } : null;
}
/** Igual ao cobranca-aprovar: anota de quem era ANTES de trocar, senao nao troca. */
async function emprestar(sb: any, g: EmpGhl, contactId: string, donoAtual: string | null, nina: string, fone: string) {
  if (donoAtual === nina) return { ok: true };
  const { error } = await sb.from("campanha_dono_emprestado").upsert(
    { contact_id: contactId, fone, dono_antes: donoAtual, dono_depois: nina, campanha: "cobranca" },
    { onConflict: "contact_id,campanha", ignoreDuplicates: false });
  if (error) return { ok: false, motivo: "nao consegui registrar o dono anterior, nada foi trocado" };
  const r = await ghl(g, "PUT", `/contacts/${contactId}`, { assignedTo: nina });
  if (!r.ok) {
    await sb.from("campanha_dono_emprestado").delete().eq("contact_id", contactId).eq("campanha", "cobranca").is("devolvido_em", null);
    return { ok: false, motivo: "PUT assignedTo " + r.status };
  }
  return { ok: true };
}

/* ===================================================================== o corpo */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const u = new URL(req.url);
    const dry = b.dry === true || u.searchParams.get("dry") === "1";
    const backfill = b.backfill === true;
    const empId = String(b.empresa || "nitron");

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.emitidos_ativo && !dry && !backfill) {
      return j({ ok: false, erro: "cobranca_config.emitidos_ativo = false — a entrega de boleto na emissao esta desligada", desligado: true }, 409);
    }
    const CAP = Math.max(1, Math.min(300, Number(b.limite) || Number(cfg?.emitidos_cap) || 60));
    const CANAIS: string[] = (cfg?.canais?.length ? cfg.canais : ["whatsapp", "email"]).map(String);
    const EMPRESA = String(cfg?.empresa_nome || "Nitron");
    const ASSIN = cfg?.assinatura || {};
    const NOME_INST = String(cfg?.instancia || "Nina Financeiro");
    const FORCAR = cfg?.forcar_instancia !== false;

    /* ---- o que tem boleto e ainda nao foi entregue ---------------------------------
       `fase = 'a_vencer'`: o que ja venceu e do cobranca-montar. Mandar dos dois lados
       faria o cliente receber duas mensagens sobre o mesmo titulo no mesmo dia, uma
       cobrando e outra so entregando — e a segunda desmontaria a primeira. */
    const { data: comBoleto, error: eT } = await sb.from("cobranca_titulo").select("*")
      .not("boleto_url", "is", null).eq("fase", "a_vencer").limit(3000);
    if (eT) throw eT;

    const { data: jaEntregues } = await sb.from("boleto_entregue").select("nufin").limit(20000);
    const entregue = new Set((jaEntregues || []).map((x: any) => Number(x.nufin)));
    const novos = (comBoleto || []).filter((t: any) => !entregue.has(Number(t.nufin)));

    if (backfill) {
      // marca sem mandar: e a virada da rotina, para a estreia nao despejar a carteira toda
      if (dry) return j({ ok: true, dry: true, backfill: true, marcaria: novos.length });
      for (let i = 0; i < novos.length; i += 500) {
        const { error } = await sb.from("boleto_entregue").upsert(
          novos.slice(i, i + 500).map((t: any) => ({ nufin: t.nufin, grupo: t.matriz || t.codparc, canal: "backfill", backfill: true })),
          { onConflict: "nufin" });
        if (error) throw error;
      }
      return j({ ok: true, backfill: true, marcados: novos.length, aviso: "nada foi enviado; a partir de agora so sai boleto novo" });
    }

    if (!novos.length) return j({ ok: true, nada: "nenhum boleto novo para entregar", entregues: 0 });

    /* ---- agrupa por matriz: um cliente, uma mensagem ---- */
    const grupos: Record<string, any[]> = {};
    for (const t of novos) { const g = String(t.matriz || t.codparc); (grupos[g] = grupos[g] || []).push(t); }

    // quem pediu para nao receber mais nao recebe nem boleto: foi um pedido explicito,
    // e "mas isto e um documento, nao cobranca" e a desculpa que faz o cliente denunciar
    // o numero. A 2a via continua disponivel — e so ele pedir.
    const { data: silencio } = await sb.from("cobranca_conversa").select("grupo").eq("nao_perturbe", true);
    const naoPerturbe = new Set((silencio || []).map((x: any) => String(x.grupo)));

    const parcs = [...new Set(novos.map((t: any) => t.codparc))];
    const porParc: Record<string, any[]> = {};
    for (let i = 0; i < parcs.length; i += 300) {
      const { data } = await sb.from("cobranca_contato").select("*").in("codparc", parcs.slice(i, i + 300)).order("prioridade");
      for (const c of (data || [])) (porParc[String(c.codparc)] = porParc[String(c.codparc)] || []).push(c);
    }

    const { data: inst } = await sb.from("instancia_ghl").select("usuario_ghl_id,ativa,pausada_em").eq("instancia", NOME_INST).eq("empresa", empId).maybeSingle();
    if (!inst?.usuario_ghl_id) return j({ ok: false, erro: `instancia "${NOME_INST}" sem usuario_ghl_id em instancia_ghl` }, 400);
    if (inst.pausada_em && !dry) return j({ ok: false, erro: `instancia "${NOME_INST}" pausada desde ${inst.pausada_em} — nada foi enviado`, pausada: true }, 409);
    const nina = String(inst.usuario_ghl_id);
    const g = dry ? null as any : await empresaGhl(sb, empId);

    const itens: any[] = [];
    let entregues = 0, pulados = 0;

    for (const [grupo, ts] of Object.entries(grupos).slice(0, CAP)) {
      if (naoPerturbe.has(grupo)) { pulados++; itens.push({ grupo, pulou: "cliente pediu para nao receber mais" }); continue; }
      const ord = ts.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)));
      const total = ord.reduce((a, t) => a + Number(t.valor), 0);
      const urls = ord.map((t: any) => String(t.boleto_url)).filter((x: string) => /^https?:\/\//i.test(x)).slice(0, 10);

      const codparcs = [...new Set(ord.map((t: any) => t.codparc))];
      const ancora = codparcs.find((c) => String(c) === grupo) ?? codparcs[0];
      const contatos: any[] = [];
      const visto = new Set<string>();
      for (const cp of [ancora, ...codparcs.filter((c) => c !== ancora)]) {
        for (const c of (porParc[String(cp)] || [])) {
          const k = c.canal + "|" + c.valor;
          if (visto.has(k)) continue;
          visto.add(k); contatos.push(c);
        }
      }
      contatos.sort((a, b) => a.prioridade - b.prioridade);
      const alvoWpp = CANAIS.includes("whatsapp") ? contatos.find((c) => c.canal === "whatsapp") : null;
      const alvoMail = CANAIS.includes("email") ? contatos.find((c) => c.canal === "email") : null;
      if (!alvoWpp && !alvoMail) { pulados++; itens.push({ grupo, nome: ord[0]?.sacado, pulou: "sem contato" }); continue; }

      const nome = primeiroNome(alvoWpp?.nome || alvoMail?.nome || "");
      const texto = textoEmitidos({ nome, titulos: ord, total, empresa: EMPRESA, assinatura: ASSIN });

      if (dry) {
        // o item do dry leva o e-mail montado e as URLs, e nao so o texto: e dele que o
        // cobranca-teste manda para um destino de teste, com o MESMO conteudo que iria
        // para o cliente. Remontar por fora seria testar outra coisa.
        itens.push({ grupo, nome: ord[0]?.sacado, titulos: ord.length, valor: total, anexos: urls.length,
          whatsapp: alvoWpp?.valor ?? null, email: alvoMail?.valor ?? null, texto,
          assunto: `${EMPRESA} — boleto${ord.length > 1 ? "s" : ""} da sua compra (${brl(total)})`,
          corpo_email: html(texto, ord.map((t: any) => ({ url: t.boleto_url, dtvenc: t.dtvenc, valor: t.valor })).filter((x: any) => x.url)),
          urls });
        entregues++;
        continue;
      }

      const envios: any[] = [];
      let contatoConversa: { id: string; canal: string; destino: string } | null = null;

      if (alvoWpp) {
        const ct = await garantirContato(g, "whatsapp", alvoWpp.valor, alvoWpp.nome, Number(grupo), FORCAR ? nina : undefined);
        if (!ct) envios.push({ canal: "whatsapp", ok: false, motivo: "contato" });
        else {
          let pronto = true;
          if (FORCAR && !ct.criado) { const emp = await emprestar(sb, g, ct.id, ct.dono_atual, nina, alvoWpp.valor); pronto = emp.ok; }
          if (!pronto) envios.push({ canal: "whatsapp", ok: false, motivo: "emprestimo do dono" });
          else {
            const { data: linha, error: eF } = await sb.from("fila_envio").insert({
              codparc: Number(grupo), contact_id: ct.id, canal: "whatsapp",
              fone: alvoWpp.valor, nome: alvoWpp.nome || ord[0]?.sacado, mensagem: texto,
              instancia: NOME_INST, campanha: "boleto_emitido", publico: "cliente", empresa: empId,
              imagens: urls.length ? urls : null, status: "pendente",
            }).select("id").maybeSingle();
            if (eF) envios.push({ canal: "whatsapp", ok: false, motivo: eF.message });
            else { contatoConversa = { id: ct.id, canal: "whatsapp", destino: alvoWpp.valor }; envios.push({ canal: "whatsapp", ok: true, fila_id: linha?.id ?? null, destino: alvoWpp.valor }); }
          }
        }
      }

      if (alvoMail) {
        const ct = await garantirContato(g, "email", alvoMail.valor, alvoMail.nome, Number(grupo));
        if (!ct) envios.push({ canal: "email", ok: false, motivo: "contato" });
        else {
          const payload: any = {
            type: "Email", contactId: ct.id,
            subject: `${EMPRESA} — boleto${ord.length > 1 ? "s" : ""} da sua compra (${brl(total)})`,
            html: html(texto, ord.map((t: any) => ({ url: t.boleto_url, dtvenc: t.dtvenc, valor: t.valor })).filter((x: any) => x.url)),
          };
          if (urls.length) payload.attachments = urls;
          const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
          const ok = r.status >= 200 && r.status < 300;
          if (ok && !contatoConversa) contatoConversa = { id: ct.id, canal: "email", destino: alvoMail.valor };
          envios.push({ canal: "email", ok, status: r.status, destino: alvoMail.valor });
        }
      }

      const algumOk = envios.some((e) => e.ok);
      if (algumOk) {
        // marca SO o que saiu: se nada saiu, o proximo dia tenta de novo em vez de o
        // cliente nunca receber o boleto por causa de um 500 do GHL.
        for (let i = 0; i < ord.length; i += 500) {
          await sb.from("boleto_entregue").upsert(
            ord.slice(i, i + 500).map((t: any) => ({
              nufin: t.nufin, grupo: Number(grupo),
              canal: envios.filter((e) => e.ok).map((e) => e.canal).join("+"),
              destino: contatoConversa?.destino ?? null,
              fila_id: envios.find((e) => e.canal === "whatsapp" && e.ok)?.fila_id ?? null,
            })), { onConflict: "nufin" });
        }

        /* ---- a conversa nasce, mas SEM cadencia ---------------------------------
           `proximo_toque_em` fica nulo de proposito: o cobranca-seguir so pega quem tem
           data de toque vencida, entao ninguem passa a ser cobrado por ter recebido um
           boleto que nem venceu. Mas a linha existe, e e ela que autoriza a Nina a
           RESPONDER se o cliente perguntar "que boleto e esse?" — sem ela, a pergunta
           cairia no vazio, que e o pior desfecho possivel logo depois de mandar um PDF.
           Quando o titulo vencer, o cobranca-aprovar reaproveita esta linha e comeca a
           contar os toques a partir do 1. Conversa ja repassada nao e reaberta. */
        if (contatoConversa) {
          const agora = new Date().toISOString();
          const { data: jaHa } = await sb.from("cobranca_conversa").select("status").eq("contact_id", contatoConversa.id).maybeSingle();
          if (jaHa?.status !== "repassada") {
            await sb.from("cobranca_conversa").upsert({
              contact_id: contatoConversa.id, grupo: Number(grupo), nome: ord[0]?.sacado || null,
              canal: contatoConversa.canal, destino: contatoConversa.destino, fase: "a_vencer",
              status: "ativa", nao_perturbe: false, proximo_toque_em: null, atualizado: agora,
            }, { onConflict: "contact_id" });
          }
        }
        entregues++;
      }
      itens.push({ grupo, nome: ord[0]?.sacado, titulos: ord.length, valor: total, anexos: urls.length, envios });
    }

    return j({
      ok: true, dry,
      boletos_novos: novos.length, grupos: Object.keys(grupos).length, teto: CAP,
      entregues, pulados,
      restaram: Math.max(0, Object.keys(grupos).length - CAP),
      instancia: NOME_INST, itens,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
