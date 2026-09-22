// cobranca-aprovar (v1) — aprova os cards da fila e dispara. Tudo pelo GHL, pela Nina.
//
// O QUE ESTA FUNCAO FAZ E NAO FAZ
//   WhatsApp: escreve em fila_envio e para. Quem manda e o fila-processar, que ja carrega o
//             teto por minuto, a pausa por instancia caida, a confirmacao de troca e a
//             pos-checagem de entrega. Abrir um caminho proprio para o GHL significaria
//             reaprender tudo isso no cliente.
//   E-mail:   manda daqui, direto. O caminho da fila monta o corpo com `imagens` viradas em
//             <img>, e um PDF por ali vira imagem quebrada; o POST de e-mail do GHL aceita
//             `attachments`, que e o que o boleto precisa. Sao ~40 linhas proprias, sem
//             nenhuma das sutilezas de instancia que justificam o trilho compartilhado.
//
// POR QUE O BOLETO VAI EM `fila_envio.imagens` NO WHATSAPP
//   O campo se chama `imagens` por historia, mas o que o fila-processar faz com ele e passar
//   como `attachments` no POST do texto — que e exatamente o campo de anexo do GHL. Para o
//   Zaptos um PDF e um anexo como qualquer outro. Renomear a coluna mexeria em funcao de
//   producao sem ganho nenhum.
//
// A NINA SO PEGA O CONTATO EMPRESTADO
//   O numero de saida no WhatsApp e o do `assignedTo` do contato — o campanha-dono ja provou
//   em 26/08 que `fromNumber` o GHL ignora. Entao, para a cobranca sair pela Nina, a Nina
//   precisa ser dona do contato na hora do envio. O dono anterior fica gravado em
//   campanha_dono_emprestado com campanha='cobranca', e o `campanha-dono` com
//   acao:"devolver", campanha:"cobranca" devolve todo mundo. ANOTA ANTES DE TROCAR: se nao
//   der para registrar de quem era, nada e trocado — foi o erro de 26/08 que custou 9 contatos.
//
// POST { ids?: [n], rodada?, fase?, todos?: true, seco?: true, aprovado_por?: "nome" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";
const digitos = (s: any) => String(s || "").replace(/\D/g, "");
const e164 = (f: any) => { const d = digitos(f); return d ? (d.length <= 11 ? "+55" + d : "+" + d) : ""; };

/* --------------------------------------------------- cadastro da empresa no GHL */
// location e token sao POR SUBCONTA e vem do cadastro `empresa`, nunca do fonte: o token da
// Nitron responde 403 na location da Teak, e mandar para a subconta errada cria contato no
// CRM errado. Mesmo carregador do campanha-dono, repetido de proposito — cada Edge Function
// e um deploy independente, e um import comum obrigaria a redeployar todas juntas.
type EmpGhl = { loc: string; tok: string; fidCodparc: string | null };
async function empresaGhl(sb: any, id: string): Promise<EmpGhl> {
  const { data, error } = await sb.from("empresa").select("ghl_location,ghl_token_env,campos").eq("painel_id", id).maybeSingle();
  if (error) throw error;
  const loc = data?.ghl_location ? String(data.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro — envio recusado`);
  const tokEnv = String(data?.ghl_token_env || "GHL_TOKEN");
  const tok = Deno.env.get(tokEnv) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}": o secret ${tokEnv} nao existe nas Edge Functions`);
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
  if (dono) campos.assignedTo = dono;   // nasce com dono: sem isso o numero de saida fica indefinido
  const r = await ghl(g, "POST", "/contacts/upsert", campos);
  const d = await r.json().catch(() => ({}));
  const id = d?.contact?.id ? String(d.contact.id) : null;
  return id ? { id, dono_atual: dono || null, criado: true } : null;
}

/* ------------------------------------------------------------- empréstimo do dono */
/** Poe o contato com a Nina, anotando antes de quem era. Devolve se conseguiu. */
async function emprestar(sb: any, g: EmpGhl, contactId: string, donoAtual: string | null, nina: string, fone: string): Promise<{ ok: boolean; motivo?: string; trocado: boolean }> {
  if (donoAtual === nina) return { ok: true, trocado: false };
  const { error } = await sb.from("campanha_dono_emprestado").upsert(
    { contact_id: contactId, fone, dono_antes: donoAtual, dono_depois: nina, campanha: "cobranca" },
    { onConflict: "contact_id,campanha", ignoreDuplicates: false },
  );
  // sem registro nao se troca: devolver viraria adivinhacao
  if (error) return { ok: false, trocado: false, motivo: "nao consegui registrar o dono anterior, nada foi trocado: " + (error.message || error) };
  const r = await ghl(g, "PUT", `/contacts/${contactId}`, { assignedTo: nina });
  if (!r.ok) {
    await sb.from("campanha_dono_emprestado").delete().eq("contact_id", contactId).eq("campanha", "cobranca").is("devolvido_em", null);
    return { ok: false, trocado: false, motivo: "PUT assignedTo " + r.status };
  }
  return { ok: true, trocado: true };
}

/* --------------------------------------------------------------- e-mail com anexo */
async function mandarEmail(g: EmpGhl, contactId: string, assunto: string, corpo: string, anexos: string[]) {
  const payload: any = { type: "Email", contactId, subject: assunto, html: corpo };
  // so URL http(s): o GHL busca o arquivo de fora, entao caminho relativo nao chegaria.
  const urls = anexos.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u));
  if (urls.length) payload.attachments = urls;
  const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
  const txt = (await r.text()).slice(0, 300);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, resposta: txt, anexos: urls.length };
}

/* ----------------------------------------------------------------------- main */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = await req.json().catch(() => ({}));
    const seco = b.seco === true;
    const aprovadoPor = String(b.aprovado_por || "painel").slice(0, 60);
    const empId = String(b.empresa || "nitron");

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.ativo && !seco) return j({ ok: false, erro: "cobranca_config.ativo = false — o motor esta desligado", desligado: true }, 409);
    const CANAIS: string[] = (cfg?.canais?.length ? cfg.canais : ["whatsapp", "email"]).map(String);
    const NOME_INST = String(cfg?.instancia || "Nina");
    const FORCAR = cfg?.forcar_instancia !== false;

    // recusar: marca e sai, sem tocar no CRM
    if (Array.isArray(b.recusar) && b.recusar.length) {
      const { error } = await sb.from("cobranca_fila").update({ status: "recusado", motivo: String(b.motivo || "recusado no painel").slice(0, 300), aprovado_por: aprovadoPor, aprovado_em: new Date().toISOString() })
        .in("id", b.recusar.map((x: any) => Number(x))).eq("status", "aguardando");
      if (error) throw error;
      return j({ ok: true, recusados: b.recusar.length });
    }

    /* ---- que cards processar ---- */
    let q = sb.from("cobranca_fila").select("*").eq("status", "aguardando");
    if (Array.isArray(b.ids) && b.ids.length) q = q.in("id", b.ids.map((x: any) => Number(x)));
    else if (b.todos !== true) return j({ ok: false, erro: "informe ids:[...] ou todos:true" }, 400);
    if (b.rodada) q = q.eq("rodada", String(b.rodada).slice(0, 10));
    if (b.fase) q = q.eq("fase", String(b.fase));
    const { data: cards, error } = await q.order("valor", { ascending: false }).limit(200);
    if (error) throw error;
    if (!cards?.length) return j({ ok: true, nada: "nenhum card aguardando com esse filtro", processados: 0 });

    /* ---- a instancia que assina a cobranca ---- */
    const { data: inst } = await sb.from("instancia_ghl").select("instancia,usuario_ghl_id,ativa,pausada_em").eq("instancia", NOME_INST).eq("empresa", empId).maybeSingle();
    if (!inst?.usuario_ghl_id) return j({ ok: false, erro: `instancia "${NOME_INST}" sem usuario_ghl_id no cadastro instancia_ghl` }, 400);
    if (inst.ativa !== true) return j({ ok: false, erro: `instancia "${NOME_INST}" esta inativa no cadastro` }, 409);
    // pausada = caiu. Enfileirar agora deixaria a cobranca parada na fila ate ela voltar; o
    // card fica aguardando e a proxima rodada tenta de novo, que e menos confuso.
    if (inst.pausada_em) return j({ ok: false, erro: `instancia "${NOME_INST}" esta pausada desde ${inst.pausada_em} (queda) — nada foi enfileirado`, pausada: true }, 409);
    const nina = String(inst.usuario_ghl_id);

    const g = await empresaGhl(sb, empId);
    const resumo: any[] = [];

    /* ---- O CARD E UM RETRATO, E RETRATO ENVELHECE ----------------------------------
       Entre o montar e o aprovar o cliente pode ter pago. No cron os dois passos correm
       seguidos e a janela e de segundos, mas o painel nao: um card de sexta aprovado na
       segunda cobraria quem ja quitou — e cobrar quem pagou custa mais do que nao cobrar.
       Entao, antes de mandar, os NUFINs do card sao conferidos contra o cobranca_titulo,
       que o refresh acabou de reescrever a partir do Sankhya. Sumiu algum, o card nao sai:
       ele volta para 'aguardando' com o motivo, e um novo `cobranca-montar` o reescreve
       com a divida certa. Recalcular o texto aqui seria pior — a pessoa aprovou UM texto,
       e trocar o texto depois do OK e aprovar por ela. */
    const todosNufins = [...new Set(cards.flatMap((c: any) => (Array.isArray(c.nufins) ? c.nufins : []).map(Number)).filter(Boolean))];
    const aindaAberto = new Set<number>();
    for (let i = 0; i < todosNufins.length; i += 500) {
      const { data } = await sb.from("cobranca_titulo").select("nufin").in("nufin", todosNufins.slice(i, i + 500));
      for (const t of (data || [])) aindaAberto.add(Number(t.nufin));
    }

    for (const card of cards) {
      const nufins = (Array.isArray(card.nufins) ? card.nufins : []).map(Number).filter(Boolean);
      const baixados = nufins.filter((n: number) => !aindaAberto.has(n));
      if (baixados.length) {
        const motivo = `${baixados.length} de ${nufins.length} titulo(s) nao estao mais em aberto no Sankhya (pagos, baixados ou renegociados) \u2014 nada foi enviado. Rode o cobranca-montar para refazer o card com a divida atual.`;
        if (!seco) await sb.from("cobranca_fila").update({ status: "aguardando", motivo }).eq("id", card.id);
        resumo.push({ id: card.id, nome: card.nome, resultado: "desatualizado", baixados: baixados.length, de: nufins.length });
        continue;
      }
      const contatos: any[] = Array.isArray(card.contatos) ? card.contatos : [];
      const boletos: any[] = Array.isArray(card.boletos) ? card.boletos : [];
      const urls = boletos.map((x: any) => String(x.url)).filter(Boolean);

      // UM destino por canal, o de melhor prioridade. Mandar para todos os e-mails do
      // cadastro transforma uma cobranca em quatro, e o cliente responde a uma so.
      const alvoWpp = CANAIS.includes("whatsapp") ? contatos.find((c) => c.canal === "whatsapp") : null;
      const alvoMail = CANAIS.includes("email") ? contatos.find((c) => c.canal === "email") : null;

      if (!alvoWpp && !alvoMail) {
        if (!seco) await sb.from("cobranca_fila").update({ status: "sem_contato", motivo: "nenhum contato nos canais ligados em cobranca_config.canais" }).eq("id", card.id);
        resumo.push({ id: card.id, nome: card.nome, resultado: "sem_contato" });
        continue;
      }

      if (seco) {
        resumo.push({ id: card.id, nome: card.nome, valor: card.valor, boletos: urls.length,
          whatsapp: alvoWpp ? { destino: alvoWpp.valor, origem: alvoWpp.origem } : null,
          email: alvoMail ? { destino: alvoMail.valor, origem: alvoMail.origem } : null });
        continue;
      }

      const envios: any[] = [];
      const filaIds: number[] = [];

      /* ---------- WhatsApp: empresta o contato e enfileira ---------- */
      if (alvoWpp) {
        const ct = await garantirContato(g, "whatsapp", alvoWpp.valor, alvoWpp.nome, card.grupo, FORCAR ? nina : undefined);
        if (!ct) {
          envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo: "nao consegui achar/criar o contato no CRM", em: new Date().toISOString() });
        } else {
          let pronto = true; let motivo: string | undefined;
          if (FORCAR && !ct.criado) {
            const emp = await emprestar(sb, g, ct.id, ct.dono_atual, nina, alvoWpp.valor);
            if (!emp.ok) { pronto = false; motivo = emp.motivo; }
          }
          if (!pronto) {
            envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo, em: new Date().toISOString() });
          } else {
            const { data: linha, error: eF } = await sb.from("fila_envio").insert({
              codparc: card.grupo, contact_id: ct.id, canal: "whatsapp",
              fone: alvoWpp.valor, nome: alvoWpp.nome || card.nome,
              mensagem: card.mensagem, instancia: NOME_INST,
              campanha: "cobranca_" + card.fase, publico: "cliente", empresa: empId,
              // `imagens` e o campo que o fila-processar repassa como `attachments` do GHL:
              // para o Zaptos, o PDF do boleto e anexo igual a qualquer outro.
              imagens: urls.length ? urls : null,
              status: "pendente",
            }).select("id").maybeSingle();
            if (eF) envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo: "fila_envio: " + eF.message, em: new Date().toISOString() });
            else {
              if (linha?.id) filaIds.push(Number(linha.id));
              envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: true, fila_id: linha?.id ?? null, anexos: urls.length, em: new Date().toISOString() });
            }
          }
        }
      }

      /* ---------- E-mail: sai daqui, com o PDF anexo ---------- */
      if (alvoMail) {
        // no e-mail o dono nao importa: o remetente e a location, nao o usuario. Entao aqui
        // nao se toca no assignedTo — mexer nele sem precisar foi o erro que a v33 registra.
        const ct = await garantirContato(g, "email", alvoMail.valor, alvoMail.nome, card.grupo);
        if (!ct) {
          envios.push({ canal: "email", destino: alvoMail.valor, origem: alvoMail.origem, ok: false, motivo: "nao consegui achar/criar o contato no CRM", em: new Date().toISOString() });
        } else {
          const r = await mandarEmail(g, ct.id, card.assunto || "Nitronplast", card.corpo_email || card.mensagem, urls);
          envios.push({ canal: "email", destino: alvoMail.valor, origem: alvoMail.origem, ok: r.ok, anexos: r.anexos, motivo: r.ok ? undefined : `GHL ${r.status}: ${r.resposta}`, em: new Date().toISOString() });
        }
      }

      const algumOk = envios.some((e) => e.ok);
      await sb.from("cobranca_fila").update({
        status: algumOk ? "enfileirado" : "erro",
        motivo: algumOk ? null : (envios.map((e) => `${e.canal}: ${e.motivo}`).join(" | ").slice(0, 300) || "nenhum canal saiu"),
        aprovado_por: aprovadoPor, aprovado_em: new Date().toISOString(),
        fila_ids: filaIds, envios,
      }).eq("id", card.id);

      resumo.push({ id: card.id, nome: card.nome, valor: card.valor, resultado: algumOk ? "enfileirado" : "erro", envios });
    }

    const conta = (f: (x: any) => boolean) => resumo.filter(f).length;
    return j({
      ok: true, seco, processados: resumo.length,
      enfileirados: conta((r) => r.resultado === "enfileirado"),
      erros: conta((r) => r.resultado === "erro"),
      sem_contato: conta((r) => r.resultado === "sem_contato"),
      desatualizados: conta((r) => r.resultado === "desatualizado"),
      whatsapp_na_fila: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.canal === "whatsapp" && e.ok).length, 0),
      email_enviado: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.canal === "email" && e.ok).length, 0),
      instancia: NOME_INST,
      lembrete: "os contatos emprestados voltam com: campanha-dono { acao:'devolver', campanha:'cobranca' }",
      itens: resumo,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
