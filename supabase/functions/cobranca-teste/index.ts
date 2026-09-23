// cobranca-teste (v2) — manda uma mensagem REAL do motor para um destino SEU, antes de ligar.
//
// POR QUE E UMA FUNCAO SEPARADA, E NAO UM `teste: true` NO cobranca-aprovar
//   Um modo de teste dentro da funcao que dispara para clientes e exatamente o tipo de
//   coisa que um dia sai para cliente sem querer: um parametro esquecido, um copiar-colar
//   de payload, um cron passando o corpo errado. Aqui nao ha como: esta funcao NAO tem
//   caminho que mande para o contato do cliente. Ela EXIGE um destino de override e so
//   manda para ele. Nem o cron nem o painel a chamam.
//
// O QUE ELA USA DE VERDADE
//   O card que o cobranca-montar ja escreveu: a mesma mensagem, o mesmo assunto, o mesmo
//   corpo de e-mail, os mesmos PDFs de boleto. Nada e reescrito para o teste — um teste com
//   texto diferente do de producao nao testa nada.
//   O WhatsApp entra na `fila_envio` como qualquer mensagem da casa, entao o teste tambem
//   prova o trilho: a instancia, a troca de dono, o teto por minuto, o anexo no Zaptos.
//
// O QUE ELA NAO FAZ, DE PROPOSITO
//   - nao mexe no status do card (ele continua 'aguardando' para a aprovacao de verdade);
//   - nao abre conversa em cobranca_conversa (senao a Nina comecaria a cobrar VOCE, e a
//     cadencia de cinco toques passaria a contar um cliente que nao foi cobrado);
//   - nao toca no contato do cliente no CRM, nem empresta dono dele;
//   - nao respeita/gasta o reenvio_min_dias do cliente.
//
// FUNCIONA COM O MOTOR DESLIGADO. E o ponto: serve para conferir ANTES de ligar.
//
// v2: OS TRES TIPOS DE MENSAGEM, e nao so a cobranca de vencido.
//   O motor fala com o cliente de tres jeitos, e ate aqui so um deles dava para conferir
//   antes de ligar — justamente o unico que ja tinha card gravado em cobranca_fila. Os
//   outros dois so existem no instante em que a rotina roda.
//   A saida NAO foi copiar o texto para ca. Foi pedir a PREVIA para quem escreve o texto:
//     a_vencer -> cobranca-montar  { fase:"a_vencer", seco:true }
//     emitido  -> cobranca-emitidos{ dry:true }
//   As duas ja sabiam montar a mensagem sem mandar nada; agora devolvem o card inteiro
//   (assunto, corpo do e-mail, boletos) em vez de um resumo. Assim o que voce recebe no
//   teste e byte a byte o que o cliente receberia — e nao uma segunda versao do texto,
//   que envelheceria sozinha na primeira vez que alguem mexesse na producao.
//   Nenhuma das duas ganhou destino de override: quem manda para fora continua sendo so
//   esta funcao, que sem `email`/`whatsapp` nao faz nada.
//
// POST {
//   tipo?: "vencido" | "a_vencer" | "emitido",   // padrao: vencido (o card da fila)
//   grupo?: 62180,          // codparc da matriz; ou
//   id?: 123,              // id do card em cobranca_fila (so no tipo vencido)
//   fase?: "vencido" | "a_vencer",
//   email?: "voce@...",
//   whatsapp?: "5511999999999",
//   seco?: true            // so mostra o que mandaria
// }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
const digitos = (s: any) => String(s || "").replace(/\D/g, "");
const e164 = (f: any) => { const d = digitos(f); return d ? (d.length <= 11 ? "+55" + d : "+" + d) : ""; };

type EmpGhl = { loc: string; tok: string };
async function empresaGhl(sb: any, id: string): Promise<EmpGhl> {
  const { data, error } = await sb.from("empresa").select("ghl_location,ghl_token_env").eq("painel_id", id).maybeSingle();
  if (error) throw error;
  const loc = data?.ghl_location ? String(data.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro`);
  const tok = Deno.env.get(String(data?.ghl_token_env || "GHL_TOKEN")) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}"`);
  return { loc, tok };
}
function ghl(g: EmpGhl, method: string, path: string, body?: any, version = "2021-07-28") {
  return fetch(API + path, { method, headers: { Authorization: "Bearer " + g.tok, Version: version, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}
async function buscarUm(g: EmpGhl, q: string): Promise<any> {
  try { const r = await ghl(g, "GET", `/contacts/?locationId=${g.loc}&query=${encodeURIComponent(q)}&limit=1`); if (!r.ok) return null; const d = await r.json(); return (d?.contacts || [])[0] || null; } catch { return null; }
}
/** O contato DO TESTE. Nasce com a Nina como dona: no WhatsApp o numero de saida e o do dono. */
async function contatoDeTeste(g: EmpGhl, canal: string, valor: string, nina: string) {
  const buscas = canal === "email" ? [valor] : [e164(valor), digitos(valor)];
  for (const q of buscas) {
    const c = await buscarUm(g, q);
    if (c?.id) {
      // ja existe (provavelmente e voce mesmo no CRM): so garante a Nina como dona
      if (canal !== "email" && String(c.assignedTo || "") !== nina) {
        await ghl(g, "PUT", `/contacts/${c.id}`, { assignedTo: nina });
      }
      return { id: String(c.id), criado: false };
    }
  }
  const campos: any = { locationId: g.loc, firstName: "TESTE Cobranca" };
  if (canal === "email") campos.email = valor; else { campos.phone = e164(valor); campos.assignedTo = nina; }
  const r = await ghl(g, "POST", "/contacts/upsert", campos);
  const d = await r.json().catch(() => ({}));
  const id = d?.contact?.id ? String(d.contact.id) : null;
  return id ? { id, criado: true } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const seco = b.seco === true;
    const empId = String(b.empresa || "nitron");

    const email = String(b.email || "").trim() || null;
    const wpp = b.whatsapp ? digitos(b.whatsapp) : null;
    // A trava: sem destino de override esta funcao nao faz nada. Nunca ha fallback para o
    // contato do cliente — e o que garante que ela nao possa virar um disparo de verdade.
    if (!email && !wpp) return j({ ok: false, erro: "informe email e/ou whatsapp — esta funcao SO manda para o destino que voce passar, nunca para o cliente" }, 400);
    if (wpp && (wpp.length < 12 || !wpp.startsWith("55"))) {
      return j({ ok: false, erro: `whatsapp "${b.whatsapp}" nao parece um numero brasileiro com DDI: esperado 55 + DDD + numero (ex. 5511964560761)` }, 400);
    }

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    const NOME_INST = String(cfg?.instancia || "Nina Financeiro");

    const tipo = String(b.tipo || "vencido");
    if (!["vencido", "a_vencer", "emitido"].includes(tipo)) {
      return j({ ok: false, erro: `tipo "${tipo}" desconhecido — use vencido, a_vencer ou emitido` }, 400);
    }

    /* ---- o card. De onde ele vem depende do tipo, mas o formato e sempre o mesmo, e o
           resto desta funcao nao precisa saber a diferenca. ---- */
    let card: any;
    let origem: string;

    if (tipo === "vencido") {
      // ja existe gravado: e o mesmo card que o painel mostra para aprovacao
      let q = sb.from("cobranca_fila").select("*");
      if (b.id) q = q.eq("id", Number(b.id));
      else if (b.grupo) q = q.eq("grupo", Number(b.grupo));
      else q = q.order("valor", { ascending: false });
      // com `id` nao filtra fase: o id ja e unico, e filtrar so criaria um 404 confuso
      if (b.fase) q = q.eq("fase", String(b.fase));
      else if (!b.id) q = q.eq("fase", "vencido");
      const { data: cards, error } = await q.order("rodada", { ascending: false }).limit(1);
      if (error) throw error;
      card = (cards || [])[0];
      if (!card) return j({ ok: false, erro: "nenhum card em cobranca_fila com esse filtro — rode o cobranca-montar primeiro" }, 404);
      origem = "cobranca_fila";
    } else {
      /* Nao existe card gravado: a rotina monta a mensagem na hora e manda. Entao pedimos
         a PREVIA a ela mesma — o modo que ja existia para conferir sem disparar. */
      const alvo = tipo === "a_vencer" ? "cobranca-montar" : "cobranca-emitidos";
      const corpo = tipo === "a_vencer" ? { fase: "a_vencer", seco: true } : { dry: true, limite: 40 };
      const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/" + alvo, {
        method: "POST",
        headers: { Authorization: "Bearer " + srvKey(), "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const previa = await r.json().catch(() => ({}));
      if (!previa?.ok) return j({ ok: false, erro: `o ${alvo} nao devolveu previa`, resposta: previa }, 502);

      const lista: any[] = tipo === "a_vencer"
        ? (previa.amostra || [])
        : (previa.itens || []).filter((i: any) => !i.pulou);
      if (!lista.length) {
        return j({ ok: true, nada: tipo === "a_vencer"
          ? "nenhum titulo a vencer na janela de hoje — nao ha mensagem para mostrar"
          : "nenhum boleto novo desde a ultima entrega — nao ha mensagem para mostrar",
          previa }, 200);
      }
      const esc = b.grupo ? lista.find((i: any) => Number(i.grupo) === Number(b.grupo)) : null;
      const it = esc || lista[0];

      card = tipo === "a_vencer"
        ? { id: null, grupo: it.grupo, nome: it.nome, fase: "a_vencer", valor: it.valor,
            n_titulos: it.titulos, mensagem: it.mensagem, assunto: it.assunto,
            corpo_email: it.corpo_email, boletos: it.boletos || [] }
        : { id: null, grupo: Number(it.grupo), nome: it.nome, fase: "emitido", valor: it.valor,
            n_titulos: it.titulos, mensagem: it.texto, assunto: it.assunto,
            corpo_email: it.corpo_email, boletos: (it.urls || []).map((u: string) => ({ url: u })) };
      origem = alvo + (tipo === "a_vencer" ? " (seco)" : " (dry)");
    }

    const boletos: any[] = Array.isArray(card.boletos) ? card.boletos : [];
    const urls = boletos.map((x: any) => String(x.url)).filter((u: string) => /^https?:\/\//i.test(u));

    if (seco) {
      return j({ ok: true, seco: true, tipo, origem,
        card: { id: card.id, grupo: card.grupo, nome: card.nome, fase: card.fase, valor: card.valor, titulos: card.n_titulos },
        destinos: { email, whatsapp: wpp }, boletos_anexos: urls.length, assunto: card.assunto, mensagem_whatsapp: card.mensagem });
    }

    const { data: inst } = await sb.from("instancia_ghl").select("usuario_ghl_id,ativa,pausada_em").eq("instancia", NOME_INST).eq("empresa", empId).maybeSingle();
    if (!inst?.usuario_ghl_id) return j({ ok: false, erro: `instancia "${NOME_INST}" sem usuario_ghl_id em instancia_ghl` }, 400);
    const nina = String(inst.usuario_ghl_id);

    const g = await empresaGhl(sb, empId);
    const feito: any[] = [];

    /* ---- WhatsApp: pelo trilho de verdade, para provar tambem o trilho ---- */
    if (wpp) {
      const ct = await contatoDeTeste(g, "whatsapp", wpp, nina);
      if (!ct) feito.push({ canal: "whatsapp", ok: false, motivo: "nao consegui achar/criar o contato de teste no CRM" });
      else {
        const { data: linha, error: eF } = await sb.from("fila_envio").insert({
          codparc: card.grupo, contact_id: ct.id, canal: "whatsapp",
          fone: wpp, nome: "TESTE Cobranca", mensagem: card.mensagem,
          instancia: NOME_INST, campanha: "cobranca_TESTE", publico: "interno", empresa: empId,
          imagens: urls.length ? urls : null, status: "pendente",
        }).select("id").maybeSingle();
        feito.push(eF
          ? { canal: "whatsapp", ok: false, motivo: "fila_envio: " + eF.message }
          : { canal: "whatsapp", ok: true, fila_id: linha?.id ?? null, destino: wpp, anexos: urls.length,
              obs: "o fila-processar roda de minuto em minuto; deve chegar em menos de 1 min" });
      }
    }

    /* ---- E-mail: daqui, com os PDFs anexos (mesmo caminho do cobranca-aprovar) ---- */
    if (email) {
      const ct = await contatoDeTeste(g, "email", email, nina);
      if (!ct) feito.push({ canal: "email", ok: false, motivo: "nao consegui achar/criar o contato de teste no CRM" });
      else {
        const payload: any = { type: "Email", contactId: ct.id, subject: card.assunto || "Nitron", html: card.corpo_email || card.mensagem };
        if (urls.length) payload.attachments = urls;
        const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
        const txt = (await r.text()).slice(0, 300);
        feito.push({ canal: "email", ok: r.status >= 200 && r.status < 300, status: r.status, destino: email, anexos: urls.length, resposta: txt });
      }
    }

    return j({
      ok: feito.some((f) => f.ok),
      aviso: "TESTE: nada foi enviado ao cliente, o card segue 'aguardando' e nenhuma conversa foi aberta",
      tipo, origem,
      card: { id: card.id, grupo: card.grupo, nome: card.nome, fase: card.fase, valor: card.valor, titulos: card.n_titulos, rodada: card.rodada },
      boletos_anexos: urls.length,
      instancia: NOME_INST,
      envios: feito,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
