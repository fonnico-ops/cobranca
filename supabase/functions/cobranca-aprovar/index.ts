// cobranca-aprovar (v6) — aprova os cards da fila e dispara. Tudo pelo GHL, pela cobranca.
//
// v6: RODIZIO DE NUMEROS, RITMO PROPRIO E PORTA NO NUMERO DE DESTINO (pedidos de 07/10).
//     - O WhatsApp sai alternando entre os numeros de `cobranca_config.instancias` (Karla e
//       Bianca). Um numero so levou a cobranca ao chao duas vezes, e quem responde passa a cair
//       no WhatsApp de quem tem alcada para prazo e desconto — a Nina nao tem.
//     - A linha nasce `segurado`: o fila-processar nao a ve, e o cobranca-liberar solta uma por
//       numero a cada 2 minutos. O ritmo deixa de depender do `fila_config`, que e
//       compartilhado com as outras campanhas, e fila retida nunca explode na volta de uma queda.
//     - Antes de enfileirar, o numero de destino passa pela porta: regra de forma aqui mesmo
//       (fixo, DDD inexistente, digito repetido) e o veredito de `cobranca_fone`, escrito pelo
//       cobranca-fones. Numero sem WhatsApp e tentativa morta, e tentativa morta acumulada e o
//       que faz a Meta restringir o numero que manda (foi o fim da "Campanhas Nitron" em 27/08).
//
// v5: GRAVA UMA LINHA POR MENSAGEM em `cobranca_entrega`, e guarda o id do e-mail no GHL.
//     Ate a v4 o que sobrava do disparo era o card ("enfileirado") e um resumo dentro de
//     `envios` — o retrato do CLIQUE. Ninguem conseguia perguntar depois "e o e-mail daquele
//     endereco, chegou?": o id da mensagem era descartado com o resto da resposta. Agora cada
//     destino tem linha propria, com id, e o cobranca-entregas a mantem em dia.
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
// v3: abre a CONVERSA (cobranca_conversa). Era um disparo sem depois: quem respondesse
//     "manda a 2a via" falava sozinho, e quem nao respondesse nunca mais era lembrado.
//     A linha gravada aqui e o toque 1 — e o cobranca-atende so responde quem tem linha la.
//
// v4: COM O WHATSAPP CAIDO, A RODADA SEGUE SO POR E-MAIL.
//     Antes, instancia pausada recusava o lote inteiro (409) e a cobranca do dia
//     simplesmente nao acontecia — foi o que aconteceu em 24/09: o numero caiu as 18:24 e
//     nada saiu, nem para quem tinha e-mail no cadastro. Perder o dia inteiro porque um
//     canal caiu e desproporcional: o e-mail nao depende de instancia nenhuma.
//     Agora, com o numero fora do ar:
//       - quem tem e-mail recebe HOJE, por e-mail;
//       - quem so tem WhatsApp fica em 'aguardando', com o motivo escrito, e entra na
//         proxima rodada — nada e enfileirado para sair sozinho quando o numero voltar,
//         que era o jeito de virar avalanche na volta;
//       - o cobranca-vigia avisa a pessoa que o numero caiu, por WhatsApp e por e-mail.
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

// DDDs que existem no Brasil
const DDD = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

/**
 * A regra de forma do numero de destino: o que da para saber de graca, aqui, sem consultar
 * ninguem. Fixo nao tem WhatsApp; DDD inexistente e digito repetido sao cadastro furado. Os
 * tres viram tentativa morta, e tentativa morta acumulada e o que faz a Meta restringir o
 * numero que manda (foi o que tirou a "Campanhas Nitron" do ar em 27/08).
 *
 * A MESMA regra existe no cobranca-fones e no `celularBom` do cobranca-refresh, de proposito:
 * cada Edge Function e um deploy independente, e um import comum obrigaria a redeployar todas
 * juntas. O teste `fone.teste.mjs` compara as tres com os mesmos casos — se divergirem, acusa.
 */
export function forma(bruto: any): { estado: "OK" | "FIXO" | "LIXO"; motivo?: string; e164: string } {
  let d = digitos(bruto).replace(/^0+/, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  const cheio = d ? "55" + d : "";
  if (d.length === 10) return { estado: "FIXO", motivo: "telefone fixo (10 digitos): nao tem WhatsApp", e164: cheio };
  if (d.length !== 11) return { estado: "LIXO", motivo: `tem ${d.length} digito(s); celular brasileiro tem 11`, e164: cheio };
  if (!DDD.has(Number(d.slice(0, 2)))) return { estado: "LIXO", motivo: `DDD ${d.slice(0, 2)} nao existe`, e164: cheio };
  if (d[2] !== "9") return { estado: "FIXO", motivo: "o 3o digito nao e 9: nao e celular", e164: cheio };
  if (/^(\d)\1+$/.test(d.slice(2))) return { estado: "LIXO", motivo: "digito repetido: cadastro furado", e164: cheio };
  return { estado: "OK", e164: cheio };
}

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
async function emprestar(sb: any, g: EmpGhl, contactId: string, donoAtual: string | null, donoNovo: string, fone: string): Promise<{ ok: boolean; motivo?: string; trocado: boolean }> {
  if (donoAtual === donoNovo) return { ok: true, trocado: false };
  const { error } = await sb.from("campanha_dono_emprestado").upsert(
    { contact_id: contactId, fone, dono_antes: donoAtual, dono_depois: donoNovo, campanha: "cobranca" },
    { onConflict: "contact_id,campanha", ignoreDuplicates: false },
  );
  // sem registro nao se troca: devolver viraria adivinhacao
  if (error) return { ok: false, trocado: false, motivo: "nao consegui registrar o dono anterior, nada foi trocado: " + (error.message || error) };
  const r = await ghl(g, "PUT", `/contacts/${contactId}`, { assignedTo: donoNovo });
  if (!r.ok) {
    await sb.from("campanha_dono_emprestado").delete().eq("contact_id", contactId).eq("campanha", "cobranca").is("devolvido_em", null);
    return { ok: false, trocado: false, motivo: "PUT assignedTo " + r.status };
  }
  return { ok: true, trocado: true };
}

/* --------------------------------------------------------------- e-mail com anexo */
/* GUARDA O ID DA MENSAGEM. Ate a v4 a resposta do GHL virava 300 caracteres de texto e
   acabava ali: dava para dizer "o CRM aceitou", nunca "chegou" ou "voltou". O id do e-mail e
   a unica chave que o endpoint de status aceita
   (GET /conversations/messages/email/{id} -> emailMessage.status), e sem ele o cobranca-entregas
   nao tem o que perguntar. Os dois ids sao guardados porque a resposta varia: em parte das
   subcontas vem `emailMessageId`, em parte so `messageId`. */
async function mandarEmail(g: EmpGhl, contactId: string, assunto: string, corpo: string, anexos: string[]) {
  const payload: any = { type: "Email", contactId, subject: assunto, html: corpo };
  // so URL http(s): o GHL busca o arquivo de fora, entao caminho relativo nao chegaria.
  const urls = anexos.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u));
  if (urls.length) payload.attachments = urls;
  const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
  const cru = await r.text();
  let d: any = {}; try { d = JSON.parse(cru); } catch { /* resposta nao-JSON: o texto cru ainda vai no motivo */ }
  return {
    ok: r.status >= 200 && r.status < 300, status: r.status, resposta: cru.slice(0, 300), anexos: urls.length,
    emailId: d?.emailMessageId ? String(d.emailMessageId) : null,
    messageId: d?.messageId ? String(d.messageId) : null,
    conversationId: d?.conversationId ? String(d.conversationId) : null,
  };
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

    /* ---- OS NUMEROS QUE ASSINAM A COBRANCA, EM RODIZIO ------------------------------
       Pedido do gestor em 07/10: alternar entre o numero da Karla e o da Bianca. Um numero so
       levou a cobranca ao chao duas vezes — "Campanhas Nitron" RESTRINGIDA pela Meta em 27/08,
       "Nina Financeiro" 12 dias fora depois de 25/09 — e, alem do risco, quem responde a
       cobranca cai no WhatsApp de quem TEM alcada para prazo e desconto, que a Nina nao tem.
       `instancias` manda; sem ela, o campo antigo `instancia` continua valendo.
       A pausada e PULADA, nao substituida: o numero de saida e o do dono do contato no CRM,
       e o rodizio funciona emprestando o contato para a usuaria da vez. */
    const RODIZIO: string[] = Array.isArray(cfg?.instancias) && cfg.instancias.length
      ? cfg.instancias.map(String) : [NOME_INST];
    const { data: instRows } = await sb.from("instancia_ghl")
      .select("instancia,usuario_ghl_id,ativa,pausada_em").in("instancia", RODIZIO).eq("empresa", empId);
    const cadastro: Record<string, any> = {};
    for (const r of (instRows || [])) cadastro[String(r.instancia)] = r;

    const semCadastro = RODIZIO.filter((n) => !cadastro[n]?.usuario_ghl_id);
    if (semCadastro.length === RODIZIO.length) {
      return j({ ok: false, erro: `nenhum numero do rodizio tem usuario_ghl_id no cadastro instancia_ghl: ${RODIZIO.join(", ")}` }, 400);
    }
    // de pe = cadastrada, ativa e nao pausada. A ordem do rodizio e a ordem do cadastro.
    const dePe = RODIZIO.filter((n) => cadastro[n]?.usuario_ghl_id && cadastro[n]?.ativa === true && !cadastro[n]?.pausada_em);
    const caidas = RODIZIO.filter((n) => !dePe.includes(n));
    // nenhum numero de pe = mesma regra de antes: a rodada segue por e-mail, e quem so tem
    // WhatsApp espera a proxima. Enfileirar agora encheria a fila para explodir na volta.
    const wppPausado = dePe.length === 0;
    let vez = 0;   // o rodizio: cada card que vai por WhatsApp pega o proximo numero

    /* ---- A PORTA NO NUMERO DE DESTINO ----------------------------------------------
       Pedido do gestor em 07/10: "validar o numero de WhatsApp de destino para nao cair em
       spam e bloquear o numero na Meta". Mensagem para numero que nao tem WhatsApp e tentativa
       morta, e tentativa morta acumulada e o que faz a Meta restringir quem manda.
       Aqui a consulta e barata: o veredito ja esta em `cobranca_fone`, escrito pelo
       cobranca-fones (regra de forma + ator Apify). Numero NUNCA consultado nao e barrado —
       barrar o desconhecido pararia a cobranca na primeira rodada; o que e barrado e o que tem
       veredito ruim, e a regra de forma (fixo, DDD inexistente, digito repetido) roda aqui
       mesmo, sem depender de consulta nenhuma. */
    const fonesDaRodada = [...new Set(cards.flatMap((c: any) =>
      (Array.isArray(c.contatos) ? c.contatos : []).filter((x: any) => x.canal === "whatsapp" && x.valor).map((x: any) => e164(x.valor).replace(/^\+/, ""))))];
    const veredito: Record<string, any> = {};
    for (let i = 0; i < fonesDaRodada.length; i += 300) {
      const { data } = await sb.from("cobranca_fone").select("fone,estado,motivo").in("fone", fonesDaRodada.slice(i, i + 300));
      for (const r of (data || [])) veredito[String(r.fone)] = r;
    }
    /** Pode mandar WhatsApp para este numero? */
    const portaDoFone = (valor: any): { ok: boolean; motivo?: string } => {
      const f = forma(valor);
      if (f.estado !== "OK") return { ok: false, motivo: f.motivo };
      const v = veredito[f.e164];
      if (v && ["INVALIDO", "FIXO", "LIXO"].includes(String(v.estado))) {
        return { ok: false, motivo: String(v.motivo || "o validador recusou este numero") };
      }
      return { ok: true };
    };

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
      // No WhatsApp a prioridade e a mesma, mas o numero tem de passar na porta: entre dois
      // contatos, vale o primeiro que serve — e um fixo no campo "celular" do Sankhya nao
      // elimina o grupo, so cede a vez ao proximo.
      const candWpp = CANAIS.includes("whatsapp") ? contatos.filter((c) => c.canal === "whatsapp") : [];
      let temWpp: any = null; let recusaFone: string | undefined;
      for (const c of candWpp) {
        const porta = portaDoFone(c.valor);
        if (porta.ok) { temWpp = c; break; }
        if (!recusaFone) recusaFone = `${c.valor}: ${porta.motivo}`;
      }
      // com o numero caido o destino de WhatsApp some do card DESTA rodada, e so dela
      const alvoWpp = wppPausado ? null : temWpp;
      const alvoMail = CANAIS.includes("email") ? contatos.find((c) => c.canal === "email") : null;

      /* So tinha WhatsApp, e o WhatsApp esta fora do ar: o card espera, sem virar erro e sem
         ir para a fila. Na proxima rodada ele e tentado de novo — e se o numero tiver voltado,
         sai normal. E o unico jeito de nao perder o cliente nem acumular envio represado. */
      if (wppPausado && temWpp && !alvoMail) {
        const motivo = `os numeros da cobranca (${RODIZIO.join(", ")}) estao fora do ar e este grupo so tem WhatsApp — nada foi enviado; ele volta na proxima rodada`;
        if (!seco) await sb.from("cobranca_fila").update({ status: "aguardando", motivo }).eq("id", card.id);
        resumo.push({ id: card.id, nome: card.nome, valor: card.valor, resultado: "segurado_wpp" });
        continue;
      }

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
      // nenhum numero do grupo passou na porta: nao e falha de envio, e cadastro. Fica escrito
      // no card para alguem corrigir o telefone no Sankhya, e o grupo segue por e-mail.
      if (candWpp.length && !temWpp && recusaFone) {
        envios.push({ canal: "whatsapp", destino: String(candWpp[0].valor), origem: candWpp[0].origem, ok: false,
          motivo: "numero recusado antes de enviar — " + recusaFone, em: new Date().toISOString() });
      }
      // por onde a conversa vai continuar. O WhatsApp ganha do e-mail quando os dois saem:
      // e onde o cliente responde, e e la que a Nina consegue atender.
      let conversa: { contact_id: string; canal: string; destino: string } | null = null;

      /* ---------- WhatsApp: escolhe o numero da vez, empresta o contato e RETEM ---------- */
      if (alvoWpp) {
        // o rodizio: o proximo numero de pe. `vez` so avanca quando um card de fato vai por
        // WhatsApp — senao um grupo sem numero valido "gastaria" a vez e o rodizio desequilibraria.
        const quem = dePe[vez % dePe.length];
        const donoDaVez = String(cadastro[quem].usuario_ghl_id);
        const ct = await garantirContato(g, "whatsapp", alvoWpp.valor, alvoWpp.nome, card.grupo, FORCAR ? donoDaVez : undefined);
        if (!ct) {
          envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo: "nao consegui achar/criar o contato no CRM", em: new Date().toISOString() });
        } else {
          let pronto = true; let motivo: string | undefined;
          if (FORCAR && !ct.criado) {
            const emp = await emprestar(sb, g, ct.id, ct.dono_atual, donoDaVez, alvoWpp.valor);
            if (!emp.ok) { pronto = false; motivo = emp.motivo; }
          }
          if (!pronto) {
            envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo, em: new Date().toISOString() });
          } else {
            const { data: linha, error: eF } = await sb.from("fila_envio").insert({
              codparc: card.grupo, contact_id: ct.id, canal: "whatsapp",
              fone: alvoWpp.valor, nome: alvoWpp.nome || card.nome,
              mensagem: card.mensagem, instancia: quem,
              campanha: "cobranca_" + card.fase, publico: "cliente", empresa: empId,
              // `imagens` e o campo que o fila-processar repassa como `attachments` do GHL:
              // para o Zaptos, o PDF do boleto e anexo igual a qualquer outro.
              imagens: urls.length ? urls : null,
              /* RETIDA, nao pendente. O fila-processar so olha 'pendente'/'agendado', entao
                 esta linha nao sai sozinha: quem solta e o cobranca-liberar, uma por numero a
                 cada 2 minutos (pedido do gestor em 07/10). Duas consequencias boas:
                 o ritmo nao depende do fila_config, que e compartilhado com as outras
                 campanhas; e uma queda de numero nao vira avalanche na volta — o que ficou
                 retido escoa no mesmo ritmo, e nao de uma vez. */
              status: "segurado",
            }).select("id").maybeSingle();
            if (eF) envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: false, motivo: "fila_envio: " + eF.message, em: new Date().toISOString() });
            else {
              vez++;
              if (linha?.id) filaIds.push(Number(linha.id));
              conversa = { contact_id: ct.id, canal: "whatsapp", destino: alvoWpp.valor };
              envios.push({ canal: "whatsapp", destino: alvoWpp.valor, origem: alvoWpp.origem, ok: true, fila_id: linha?.id ?? null, anexos: urls.length, instancia: quem, em: new Date().toISOString() });
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
          if (r.ok && !conversa) conversa = { contact_id: ct.id, canal: "email", destino: alvoMail.valor };
          envios.push({ canal: "email", destino: alvoMail.valor, origem: alvoMail.origem, ok: r.ok, anexos: r.anexos,
            ghl_email_id: r.emailId, ghl_message_id: r.messageId, conversation_id: r.conversationId,
            motivo: r.ok ? undefined : `GHL ${r.status}: ${r.resposta}`, em: new Date().toISOString() });
        }
      }

      const algumOk = envios.some((e) => e.ok);

      /* ---- ESTE E O TOQUE 1 ---------------------------------------------------------
         A partir daqui a conversa existe: o cobranca-atende so responde contato que tem
         linha aqui (e o filtro que impede a Nina de responder lead de marketing pela caixa
         da cobranca), e o cobranca-seguir conta os toques a partir deste.

         `upsert` e nao `insert`: o mesmo cliente volta em rodadas seguintes, e recomecar a
         contagem a cada rodada daria toque infinito — que e exatamente o que os cinco
         toques existem para impedir. Conversa ja repassada a uma pessoa NAO e reaberta:
         robo escrevendo por cima da atendente apaga o trabalho dela no meio. */
      if (algumOk && conversa) {
        const agora = new Date().toISOString();
        const { data: jaHa } = await sb.from("cobranca_conversa").select("contact_id,toques,status").eq("contact_id", conversa.contact_id).maybeSingle();
        if (jaHa?.status === "repassada") {
          // nada: a conversa e de gente agora
        } else {
          await sb.from("cobranca_conversa").upsert({
            contact_id: conversa.contact_id, grupo: card.grupo, nome: card.nome,
            canal: conversa.canal, destino: conversa.destino, fase: card.fase,
            status: "ativa", nao_perturbe: false,
            toques: Number(jaHa?.toques || 0) + 1, ultimo_toque_em: agora,
            // o proximo toque cai daqui a dois dias uteis; o cobranca-seguir reescreve
            // isso a cada toque com a espera da vez (cobranca_config.toques_espera)
            proximo_toque_em: new Date(Date.now() + 2 * 86400000).toISOString(),
            atualizado: agora,
          }, { onConflict: "contact_id" });
        }
      }

      await sb.from("cobranca_fila").update({
        status: algumOk ? "enfileirado" : "erro",
        motivo: algumOk ? null : (envios.map((e) => `${e.canal}: ${e.motivo}`).join(" | ").slice(0, 300) || "nenhum canal saiu"),
        aprovado_por: aprovadoPor, aprovado_em: new Date().toISOString(),
        fila_ids: filaIds, envios,
      }).eq("id", card.id);

      /* ---- O LIVRO DE ENTREGAS: uma linha por mensagem -------------------------------
         O card diz "aprovado"; o livro diz o que aconteceu com CADA mensagem, por destino.
         Sem ele a tela nao consegue responder "o WhatsApp deste numero saiu?" — e em 25/09
         foi essa a pergunta sem resposta: 59 cards iguais na tela, 28 WhatsApp na rua, 24
         parados pela queda do numero.
         O estado nasce do que sabemos AGORA: WhatsApp escrito na fila nasce `na_fila` (quem o
         move para `saiu` e o cobranca-entregas, lendo o fila_envio), e o e-mail nasce `saiu`
         porque o POST ja foi. `upsert` porque um card reaprovado deve reescrever a propria
         linha em vez de criar uma segunda entrega para o mesmo destino.
         Falhar aqui NAO pode derrubar o disparo: a mensagem ja saiu, e perder o registro dela
         e menos grave do que devolver erro para quem clicou. Por isso so anota. */
      const registro = envios.map((e: any) => ({
        card_id: card.id, rodada: card.rodada, fase: card.fase, grupo: card.grupo, nome: card.nome,
        canal: e.canal, destino: String(e.destino || ""), origem: e.origem ?? null,
        fila_id: e.fila_id ?? null,
        ghl_email_id: e.ghl_email_id ?? null, ghl_message_id: e.ghl_message_id ?? null, conversation_id: e.conversation_id ?? null,
        estado: !e.ok ? "erro" : (e.canal === "email" ? "saiu" : "na_fila"),
        detalhe: e.ok ? null : String(e.motivo || "sem motivo").slice(0, 300),
        anexos: Number(e.anexos || 0),
        criado_em: e.em, saiu_em: (e.ok && e.canal === "email") ? e.em : null,
        confirmado_em: null, checado_em: null,
      })).filter((x: any) => x.destino);
      if (registro.length) {
        const { error: eL } = await sb.from("cobranca_entrega").upsert(registro, { onConflict: "card_id,canal,destino" });
        if (eL) console.error("cobranca_entrega nao registrou o card " + card.id + ": " + detalhar(eL));
      }

      resumo.push({ id: card.id, nome: card.nome, valor: card.valor, resultado: algumOk ? "enfileirado" : "erro", envios });
    }

    const conta = (f: (x: any) => boolean) => resumo.filter(f).length;
    return j({
      ok: true, seco, processados: resumo.length,
      enfileirados: conta((r) => r.resultado === "enfileirado"),
      erros: conta((r) => r.resultado === "erro"),
      sem_contato: conta((r) => r.resultado === "sem_contato"),
      desatualizados: conta((r) => r.resultado === "desatualizado"),
      // com o numero caido isto e o que o painel precisa dizer em voz alta: saiu por e-mail,
      // e tantos ficaram esperando o WhatsApp voltar
      whatsapp_pausado: wppPausado,
      segurados_ate_o_whatsapp_voltar: conta((r) => r.resultado === "segurado_wpp"),
      // retidas, e nao "na fila": elas nao saem sozinhas. Quem solta e o cobranca-liberar, uma
      // por numero a cada `wpp_intervalo_seg` — por isso a resposta diz tambem a previsao.
      whatsapp_retidas: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.canal === "whatsapp" && e.ok).length, 0),
      email_enviado: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.canal === "email" && e.ok).length, 0),
      numeros_recusados_antes_de_enviar: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.canal === "whatsapp" && !e.ok && /recusado antes de enviar/.test(String(e.motivo || ""))).length, 0),
      rodizio: dePe, numeros_fora_do_ar: caidas.length ? caidas : undefined,
      por_numero: dePe.map((n) => ({ instancia: n, mensagens: resumo.reduce((a, r) => a + (r.envios || []).filter((e: any) => e.instancia === n && e.ok).length, 0) })),
      lembrete: "os contatos emprestados voltam com: campanha-dono { acao:'devolver', campanha:'cobranca' }",
      itens: resumo,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
