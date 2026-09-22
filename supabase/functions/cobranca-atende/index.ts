// cobranca-atende (v2) — a Nina Financeiro lendo e respondendo.
//
// O motor ate aqui mandava a cobranca e virava as costas. O cliente que respondia "manda a
// 2a via" ou "pago sexta" falava sozinho. Esta funcao le essas respostas e responde.
//
// ===========================================================================
// OS QUATRO LIMITES. Os tres primeiros a gestao pediu; o quarto e o que sustenta os outros.
// ===========================================================================
//
// 1. SO FALA EM CONVERSA QUE O MOTOR ABRIU.
//    A varredura e de conversas nao lidas da location — e esta location tem lead de
//    marketing, cliente reclamando de entrega e representante, tudo junto. O filtro e a
//    tabela cobranca_conversa: contato que nao tem linha la nao e olhado. Um atendimento
//    que respondesse "toda conversa nao lida" responderia lead de marketing pela caixa da
//    cobranca, e ninguem descobriria antes do cliente.
//
// 2. SO O OPERACIONAL.
//    2a via, confirmar valor e vencimento, dizer DE ONDE vem o titulo, receber comprovante,
//    anotar promessa de pagamento. Prazo, parcelamento, desconto, contestacao de valor,
//    juros: repassa. Um desconto combinado por robo e dinheiro que nao volta, e ninguem
//    consegue desdizer depois sem queimar o cliente.
//
// 3. REPASSADA E REPASSADA.
//    Assim que a conversa vai para a Karla ou a Bianca, o robo nao fala mais nela. Nunca.
//    Robo e pessoa escrevendo na mesma conversa e a pior experiencia possivel para quem
//    esta do outro lado — e apaga o trabalho da atendente no meio.
//
// 4. A IA NAO ESCREVE NUMERO. NENHUM.
//    Esta e a regra da casa (o copiloto-repasse ja faz o mesmo com CNPJ) e aqui ela vale
//    em dobro: a conversa carrega valor, vencimento, NF e linha digitavel. Um digito
//    trocado manda o cliente pagar o que nao deve — e a conversa inteira vira discussao
//    sobre o numero em vez de pagamento.
//    Entao o modelo escreve SO prosa, sem algarismo, e pede os numeros por marcador
//    ([[DIVIDA]], [[TOTAL]], [[ORIGEM]], [[BOLETO]]). Quem preenche e o codigo, lendo
//    cobranca_titulo. E o sanear() confere: algarismo na resposta do modelo NAO e enviado.
//
// v2: duas coisas que so o dado de producao mostrou — ver blocoDivida() e blocoOrigem().
//
// POST { dry?: true, limite?: n, contact_id?: "..." }   dry = mostra o que responderia
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";

const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ""); };
const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const limpar = (s: any) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const direcao = (m: any) => (m && (m.direction || (m.meta && m.meta.email && m.meta.email.direction))) || "";

/* ======================================================================= marcadores
   O que o modelo pode pedir. Tudo o mais que ele escrever e prosa. */
const MARCADORES = {
  DIVIDA: /\[\[DIVIDA\]\]/g,
  TOTAL: /\[\[TOTAL\]\]/g,
  BOLETO: /\[\[BOLETO\]\]/g,
  ORIGEM: /\[\[ORIGEM\]\]/g,
  REPASSA: /\[\[REPASSA:([^\]]*)\]\]/i,
  PROMESSA: /\[\[PROMESSA:(\d{4}-\d{2}-\d{2})\]\]/i,
  PAGO: /\[\[PAGO\]\]/i,
  PARAR: /\[\[PARAR\]\]/i,
};

/**
 * A rede de seguranca do limite 4.
 *
 * Devolve o motivo da recusa, ou null se o texto pode ir. Roda DEPOIS de tirar os
 * marcadores de controle e ANTES de preencher os de conteudo — o que sobra e exatamente o
 * que o modelo escreveu por conta propria, e ali nao pode haver algarismo.
 *
 * Nao e paranoia barata: "vence dia 15" com o 15 vindo do modelo e a diferenca entre o
 * cliente pagar no dia certo e pagar com juros por culpa nossa.
 */
export function sanear(texto: string): string | null {
  const t = String(texto || "");
  if (/\d/.test(t)) {
    const achado = (t.match(/\d[\d.,/-]*/g) || []).slice(0, 4).join(", ");
    return `o modelo escreveu numero por conta propria (${achado})`;
  }
  if (/R\$/i.test(t)) return "o modelo escreveu valor (R$)";
  if (!t.replace(/\s+/g, "")) return "resposta vazia";
  if (t.length > 1200) return "resposta longa demais para um WhatsApp de cobranca";
  return null;
}

/* ================================================================== o que ele deve
   Escrito em codigo, a partir do cobranca_titulo. E o unico lugar onde numero nasce. */
export function blocoDivida(titulos: any[], teto = 8): { lista: string; total: number } {
  const ord = titulos.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)));
  const total = ord.reduce((a, t) => a + Number(t.valor), 0);
  // `t.contrato && ...`: no Clube o TGFFIN.NUMNOTA vem preenchido com o NUMERO DO CONTRATO,
  // nao com uma nota fiscal (visto na producao: nufin 1509888, numnota 42, contrato 42).
  // Sem esta guarda a mensagem diria "NF 42" para um titulo que nao tem nota nenhuma — e o
  // cliente iria procurar no sistema dele uma nota que nao existe.
  const linha = (t: any) => `• ${brl(t.valor)} — venc. ${dataBr(t.dtvenc)}${(t.numnota && !t.contrato) ? ` · NF ${t.numnota}` : ""}`;
  if (ord.length <= teto) return { lista: ord.map(linha).join("\n"), total };
  const resto = ord.slice(teto);
  const vr = resto.reduce((a, t) => a + Number(t.valor), 0);
  return {
    lista: ord.slice(0, teto).map(linha).join("\n") + `\n• e mais ${resto.length} título${resto.length > 1 ? "s" : ""}, somando ${brl(vr)}`,
    total,
  };
}

/**
 * DE ONDE VEM CADA TITULO.
 *
 * E a primeira pergunta de quem recebe uma cobranca, e ate aqui a unica resposta possivel
 * era o numero da NF — que nao diz nada a quem esta do outro lado. Quem nao responde isso
 * perde a conversa: o cliente para de discutir pagamento e passa a discutir se deve.
 *
 * Duas formas, porque sao duas origens diferentes no ERP:
 *   venda      NF + serie, parcela X de Y, data de SAIDA da nota
 *   Clube      contrato + parcela X de Y (nao tem nota: o titulo nasce do contrato)
 * Na carteira de cobranca de 22/09: 841 de venda, 211 do Clube, 1 sem origem nenhuma.
 *
 * SAIDA NAO E ENTREGA. O `dt_emissao` e TGFCAB.DTENTSAI — quando a mercadoria saiu daqui.
 * Data de entrega o ERP nao tem para estes titulos (AD_DTENTREGA e AD_STATUSENTREGA com
 * zero preenchidos; agendamento em 2 de 2.465), e escrever "entregue em tal dia" numa
 * cobranca e dar ao cliente o argumento para nao pagar.
 */
export function blocoOrigem(titulos: any[], teto = 6): string {
  const ord = titulos.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)));
  const parcela = (t: any) => {
    const n = String(t.parcela || "").replace(/^0+/, "") || null;
    const tot = Number(t.parcelas_total) || 0;
    if (!n) return "";
    return tot > 1 ? ` (parcela ${n} de ${tot})` : "";
  };
  const linha = (t: any) => {
    const cab = `• ${brl(t.valor)} — venc. ${dataBr(t.dtvenc)}`;
    if (t.contrato) {
      const det = [`contrato do Clube nº ${t.contrato}${parcela(t)}`];
      if (Number(t.contrato_parcelas) > 0 && !parcela(t)) det.push(`${t.contrato_parcelas} parcelas`);
      if (t.contrato_inicio) det.push(`início em ${dataBr(t.contrato_inicio)}`);
      return `${cab}: ${det.join(", ")}`;
    }
    if (t.numnota) {
      const det = [`NF ${t.numnota}${t.serie ? `/${t.serie}` : ""}${parcela(t)}`];
      // O `operacao` (TGFTOP.DESCROPER) fica GUARDADO mas NAO vai para o cliente. Os nomes
      // sao nomenclatura interna do ERP, e na producao ha 15 titulos com "Venda Reemissao de
      // Nota com Problema" e 161 com "Venda Clientes Especiais". Mandar isso numa cobranca
      // troca a conversa sobre pagamento por uma conversa sobre o problema da nota, ou sobre
      // que clientes sao "especiais". Quem precisa do tipo de operacao e a atendente, e ela
      // ve no painel.
      if (t.dt_emissao) det.push(`nota emitida em ${dataBr(t.dt_emissao)}`);
      if (String(t.entrega_status || "").toLowerCase().startsWith("entregue")) det.push("consta entregue");
      return `${cab}: ${det.join(", ")}`;
    }
    return `${cab}${parcela(t)}`;
  };
  if (ord.length <= teto) return ord.map(linha).join("\n");
  const resto = ord.slice(teto);
  return ord.slice(0, teto).map(linha).join("\n") +
    `\n• e mais ${resto.length} título${resto.length > 1 ? "s" : ""}, somando ${brl(resto.reduce((a, t) => a + Number(t.valor), 0))} — posso detalhar se precisar`;
}

/**
 * A frase sobre o boleto — que depende de TRES situacoes, nao duas.
 * (mesma divisao do cobranca-montar: anexo / da para providenciar / saiu direto no banco)
 */
export function frasesBoleto(titulos: any[]): { texto: string; urls: string[] } {
  const com = titulos.filter((t) => t.boleto_url);
  const faltam = titulos.filter((t) => !t.boleto_url);
  const noBanco = faltam.filter((t) => t.boleto_geravel === false);
  const providenciaveis = faltam.length - noBanco.length;
  const p: string[] = [];
  if (com.length) p.push(com.length > 1 ? "Seguem os boletos em anexo." : "Segue o boleto em anexo.");
  if (providenciaveis > 0) p.push(providenciaveis === 1
    ? "De um deles eu ainda preciso providenciar a segunda via — assim que sair eu te mando."
    : `De ${providenciaveis === faltam.length && !com.length ? "" : "outros "}títulos eu ainda preciso providenciar a segunda via — assim que sair eu te mando.`);
  if (noBanco.length) p.push(noBanco.length === 1
    ? "Um dos títulos foi emitido direto pelo banco, então a segunda via sai por lá: nosso financeiro te envia."
    : "Alguns títulos foram emitidos direto pelo banco, então a segunda via sai por lá: nosso financeiro te envia.");
  return { texto: p.join(" "), urls: com.map((t) => String(t.boleto_url)) };
}

/* ====================================================================== o prompt */
export function sistema(ctx: { empresa: string; hoje: string }): string {
  return [
    `Voce e a Nina, do financeiro da ${ctx.empresa}. Fala por WhatsApp e e-mail com o cliente sobre titulos em aberto. Hoje e ${ctx.hoje}.`,
    "",
    "COMO ESCREVER",
    "- Portugues do Brasil, tratamento por voce, tom de pessoa do financeiro: cordial, direto, sem formalidade de carta.",
    "- Curto. Duas a quatro frases no WhatsApp.",
    "- Nunca ameace. Protesto, negativacao, juros e multa NAO aparecem na sua boca: se o cliente tocar no assunto, isso e repasse.",
    "- Nunca cite outro cliente, nem o total da carteira, nem nada que nao seja a divida deste cliente.",
    "- Nao invente politica da empresa. Se nao sabe, repassa.",
    "",
    "VOCE NAO ESCREVE ALGARISMO. NENHUM.",
    "Nada de valor, data, numero de NF, boleto, CNPJ ou telefone — nem escrito por extenso com digito.",
    "Quando precisar dizer um numero, use o marcador e o sistema preenche com o dado certo:",
    "  [[DIVIDA]]  a lista dos titulos em aberto, com valor e vencimento de cada um",
    "  [[TOTAL]]   so a soma em aberto",
    "  [[BOLETO]]  manda o(s) boleto(s) em anexo e escreve a frase certa sobre eles",
    "  [[ORIGEM]]  de onde vem cada titulo: nota fiscal e serie, parcela X de Y, data em que a",
    "              nota foi emitida — ou, no Clube, o numero do contrato e a parcela",
    "Escreva o marcador sozinho na linha. Se escrever um algarismo, a mensagem NAO e enviada.",
    "",
    "O QUE VOCE RESOLVE (e resolve sozinha, sem pedir ajuda)",
    "- Mandar segunda via / boleto: use [[BOLETO]].",
    "- Confirmar qual e o valor e o vencimento: use [[DIVIDA]] ou [[TOTAL]].",
    "- DE ONDE VEM A COBRANCA ('que boleto e esse?', 'de qual nota?', 'quantas parcelas?',",
    "  'e do contrato do Clube?'): use [[ORIGEM]]. E a pergunta mais comum — responda voce mesma.",
    "- Receber comprovante de pagamento: agradeca e avise que o financeiro confere. Marque [[PAGO]].",
    "- Cliente diz quando vai pagar: confirme e marque [[PROMESSA:AAAA-MM-DD]] com a data que ele deu (o marcador some do texto; quem escreve a data e o sistema).",
    "- Cliente pede para nao receber mais: aceite sem insistir e marque [[PARAR]].",
    "- Pergunta operacional simples (para quem e o pagamento, se recebeu, se ja baixou): responda.",
    "",
    "SOBRE ENTREGA — LEIA COM CUIDADO",
    "O [[ORIGEM]] diz quando a NOTA FOI EMITIDA, e as vezes que a nota CONSTA ENTREGUE.",
    "Nao existe data de entrega no sistema. Entao voce NUNCA afirma quando algo foi entregue,",
    "nem promete conferir depois. Se o cliente disser que nao recebeu, ou perguntar a data da",
    "entrega, isso e [[REPASSA:entrega]] — nao e assunto do financeiro e nao se chuta.",
    "",
    "O QUE VOCE NAO RESOLVE — comece a resposta com [[REPASSA:motivo curto]]",
    "- Pedir prazo, adiar vencimento, parcelar, pedir desconto, abater, renegociar.",
    "- Contestar o valor, dizer que ja pagou algo que nao consta, falar em devolucao ou nota errada.",
    "- Juros, multa, protesto, negativacao, advogado, processo.",
    "- Pedir para falar com uma pessoa, reclamar do atendimento, ou estar irritado.",
    "- Qualquer coisa fora de titulo e pagamento (pedido novo, entrega, produto, representante).",
    "- Contestar a nota em si: mercadoria que nao chegou, chegou errada, ou nota que ele diz nao reconhecer.",
    "- Voce nao entendeu, ou entendeu e nao tem o que responder dentro do que esta acima.",
    "Quando repassar, escreva UMA frase dizendo que vai passar para uma colega do financeiro que",
    "resolve isso, sem prometer prazo nem condicao nenhuma. Nao diga que e um robo nem peca desculpa por isso.",
    "",
    "Responda APENAS com o texto da mensagem (mais os marcadores). Sem assinatura: o sistema assina.",
  ].join("\n");
}

/* ======================================================================== Claude */
async function modelo(key: string, modeloId: string, sys: string, user: string, maxTokens = 500) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modeloId, max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) return { texto: "", erro: r.status + ": " + (await r.text().catch(() => "")).slice(0, 200) };
    const d = await r.json().catch(() => ({}));
    return { texto: (d?.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text).join(" ").trim(), erro: "" };
  } catch (e) { return { texto: "", erro: String(e).slice(0, 200) }; }
}

/* =========================================================================== GHL */
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

/* ================================================================== o repasse
   A conversa deixa de ser do robo. Tres coisas tem de acontecer juntas, e nesta ordem:
   o CRM mostrar a conversa na fila de quem vai atender, a pessoa saber POR QUE ela chegou,
   e o robo perder a permissao de falar. Se a segunda falhar, a atendente abre uma conversa
   sem contexto — que e como o repasse morre na pratica. */
export function escolherAtendente(lista: any[]): any | null {
  const viva = (lista || []).filter((a) => a.ativo !== false);
  if (!viva.length) return null;
  // peso com memoria: quem ja recebeu mais, em proporcao ao proprio peso, espera.
  // Sem o `recebidos` o sorteio concentra numa so em amostra pequena — e um repasse por dia
  // e amostra pequena. O embaralhar antes so desempata sem viciar na ordem do banco.
  const emb = viva.slice().sort(() => Math.random() - 0.5);
  emb.sort((a, b) => (Number(a.recebidos || 0) / Math.max(1, Number(a.peso || 1))) - (Number(b.recebidos || 0) / Math.max(1, Number(b.peso || 1))));
  return emb[0];
}

async function repassar(sb: any, g: EmpGhl, conversa: any, motivo: string, resumo: string) {
  const { data: atendentes } = await sb.from("cobranca_atendente").select("*").eq("ativo", true);
  const a = escolherAtendente(atendentes || []);
  if (!a) return { ok: false, motivo: "nenhuma atendente ativa em cobranca_atendente — a conversa ficou com o robo" };

  // 1. a conversa muda de dono no CRM: e assim que ela aparece na fila dela
  const r = await ghl(g, "PUT", `/contacts/${conversa.contact_id}`, { assignedTo: a.usuario_ghl_id });
  if (!r.ok) return { ok: false, motivo: `PUT assignedTo ${r.status} — nada foi repassado` };

  // O contato estava EMPRESTADO a Nina (campanha_dono_emprestado, campanha='cobranca').
  // Atualizar `dono_depois` mantem o campanha-dono capaz de devolver ao dono original la na
  // frente: sem isto o devolver veria dono_depois=Nina, acharia que alguem mexeu por fora e
  // deixaria o contato com a atendente para sempre.
  await sb.from("campanha_dono_emprestado")
    .update({ dono_depois: a.usuario_ghl_id })
    .eq("contact_id", conversa.contact_id).eq("campanha", "cobranca").is("devolvido_em", null);

  // 2. o porque, onde ela vai olhar. Nota e nao tarefa: a nota fica no contato, junto da
  //    conversa; tarefa vira lista paralela que ninguem abre.
  const nota = [
    `Cobrança passada pela Nina Financeiro.`,
    `Motivo: ${motivo}`,
    resumo,
  ].filter(Boolean).join("\n");
  await ghl(g, "POST", `/contacts/${conversa.contact_id}/notes`, { userId: a.usuario_ghl_id, body: nota.slice(0, 5000) }).catch(() => null);

  // 3. o robo cala
  await sb.from("cobranca_conversa").update({
    status: "repassada", repassada_para: a.usuario_ghl_id, repassada_nome: a.nome,
    repassada_em: new Date().toISOString(), repassada_motivo: motivo.slice(0, 300),
    proximo_toque_em: null, atualizado: new Date().toISOString(),
  }).eq("contact_id", conversa.contact_id);

  await sb.from("cobranca_atendente").update({
    recebidos: Number(a.recebidos || 0) + 1, ultimo_recebido_em: new Date().toISOString(),
  }).eq("usuario_ghl_id", a.usuario_ghl_id);

  return { ok: true, atendente: a.nome, usuario_ghl_id: a.usuario_ghl_id };
}

/* ===================================================================== o corpo */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const u = new URL(req.url);
    const dry = b.dry === true || u.searchParams.get("dry") === "1";
    const LIMITE = Math.min(Number(b.limite || 20), 50);
    const empId = String(b.empresa || "nitron");

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.atende_ativo && !dry) return j({ ok: false, erro: "cobranca_config.atende_ativo = false — a Nina nao responde ainda", desligado: true }, 409);
    const EMPRESA = String(cfg?.empresa_nome || "Nitron");
    const MODELO = String(cfg?.ia_modelo || "claude-sonnet-5");
    const ASSIN = cfg?.assinatura || {};
    const NOME_INST = String(cfg?.instancia || "Nina Financeiro");

    const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!AKEY) return j({ ok: false, erro: "sem ANTHROPIC_API_KEY nas Edge Functions" }, 500);

    const g = await empresaGhl(sb, empId);

    /* ---- as conversas que sao nossas. Este SELECT e o limite 1. ---- */
    let q = sb.from("cobranca_conversa").select("*").in("status", ["ativa", "promessa"]);
    if (b.contact_id) q = q.eq("contact_id", String(b.contact_id));
    const { data: minhas, error: eM } = await q.limit(500);
    if (eM) throw eM;
    if (!minhas?.length) return j({ ok: true, nada: "nenhuma conversa de cobranca aberta", atendidas: 0 });
    const porContato = new Map<string, any>(minhas.map((c: any) => [String(c.contact_id), c]));

    /* ---- o que chegou. Uma busca de nao lidas e o cruzamento com as nossas. ---- */
    let candidatos: any[] = [];
    if (b.contact_id) {
      const r = await ghl(g, "GET", `/conversations/search?locationId=${g.loc}&contactId=${b.contact_id}&limit=5`, undefined, "2021-04-15");
      candidatos = ((await r.json().catch(() => ({})))?.conversations || []);
    } else {
      const r = await ghl(g, "GET", `/conversations/search?locationId=${g.loc}&status=unread&limit=100&sortBy=last_message_date&sort=desc`, undefined, "2021-04-15");
      const todas = ((await r.json().catch(() => ({})))?.conversations || []);
      candidatos = todas.filter((c: any) => porContato.has(String(c.contactId)));
    }

    const itens: any[] = [];
    let atendidas = 0, repasses = 0;

    for (const cv of candidatos) {
      if (atendidas >= LIMITE) break;
      const conversa = porContato.get(String(cv.contactId));
      if (!conversa) continue;

      /* ---- a ultima coisa que o cliente disse ---- */
      const rm = await ghl(g, "GET", `/conversations/${cv.id}/messages?limit=20`, undefined, "2021-04-15");
      const mj = await rm.json().catch(() => ({}));
      const msgs = ((mj?.messages?.messages) || []).slice()
        .sort((a: any, b: any) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());
      const entradas = msgs.filter((m: any) => direcao(m) === "inbound");
      const ultima = entradas[entradas.length - 1];
      if (!ultima) { itens.push({ nome: conversa.nome, pulou: "sem mensagem do cliente" }); continue; }
      if (conversa.ultimo_inbound_id && String(conversa.ultimo_inbound_id) === String(ultima.id)) {
        itens.push({ nome: conversa.nome, pulou: "ja respondida" }); continue;
      }
      const dito = limpar(ultima.body);
      if (!dito) { itens.push({ nome: conversa.nome, pulou: "mensagem vazia (midia?)" }); continue; }
      const porEmail = String(ultima.messageType || "").includes("EMAIL");

      /* ---- a divida, do Sankhya, agora. O card de sexta nao serve na segunda. ---- */
      const { data: titulos } = await sb.from("cobranca_titulo").select("*")
        .or(`matriz.eq.${conversa.grupo},codparc.eq.${conversa.grupo}`).limit(400);
      const abertos = titulos || [];
      const { lista, total } = blocoDivida(abertos);
      const boleto = frasesBoleto(abertos);

      // pagou tudo no meio do caminho: nao se responde cobranca a quem nao deve mais
      if (!abertos.length) {
        if (!dry) await sb.from("cobranca_conversa").update({ status: "encerrada", proximo_toque_em: null, atualizado: new Date().toISOString() }).eq("contact_id", conversa.contact_id);
        itens.push({ nome: conversa.nome, pulou: "nao ha mais titulo em aberto para este grupo — conversa encerrada" });
        continue;
      }

      /* ---- o historico que o modelo le ---- */
      const hist = msgs.map((m: any) => (direcao(m) === "inbound" ? "CLIENTE: " : "NINA: ") + limpar(m.body).slice(0, 400))
        .filter((s: string) => s.length > 10).slice(-10).join("\n");
      const contexto = [
        `EMPRESA CLIENTE: ${conversa.nome || "(sem nome)"}`,
        `TITULOS EM ABERTO: ${abertos.length}. O mais atrasado tem ${Math.max(0, ...abertos.map((t: any) => Number(t.dias_atraso) || 0))} dias de atraso.`,
        `BOLETO EM ANEXO DISPONIVEL: ${boleto.urls.length ? "sim" : "nao"}.`,
        // o que [[ORIGEM]] vai conseguir dizer — sem isto ela oferece detalhe que nao existe
        `ORIGEM DISPONIVEL: ${abertos.some((t: any) => t.numnota && !t.contrato) ? "nota fiscal" : ""}${abertos.some((t: any) => t.contrato) ? " contrato do Clube" : ""}${!abertos.some((t: any) => t.numnota || t.contrato) ? "nenhuma (so valor e vencimento)" : ""}.`,
        conversa.promessa_data ? `ESTE CLIENTE JA PROMETEU PAGAR (a data esta com o sistema; nao a escreva).` : "",
        "",
        "CONVERSA (mais recente embaixo):",
        hist || "(primeira resposta dele)",
        "",
        "CLIENTE ACABOU DE DIZER: " + dito.slice(0, 1500),
        "",
        `Escreva a proxima mensagem da Nina (${porEmail ? "e-mail" : "WhatsApp"}).`,
      ].filter(Boolean).join("\n");

      const sys = sistema({ empresa: EMPRESA, hoje: dataBr(hojeSp()) });

      /* ---- gera, confere, e se preciso tenta UMA vez com a regra repetida ---- */
      let bruto = "", recusa: string | null = null, tentativas = 0;
      for (let tent = 0; tent < 2; tent++) {
        tentativas = tent + 1;
        const extra = tent === 0 ? "" : "\n\nATENCAO: a tentativa anterior foi RECUSADA por conter algarismo. Reescreva sem nenhum digito, usando [[DIVIDA]], [[TOTAL]], [[ORIGEM]] ou [[BOLETO]].";
        const r = await modelo(AKEY, MODELO, sys, contexto + extra, porEmail ? 700 : 450);
        if (!r.texto) { recusa = "o modelo nao respondeu: " + r.erro; continue; }
        bruto = r.texto;
        // tira os marcadores de CONTROLE antes de conferir: o que sobra e prosa do modelo
        const soProsa = bruto
          .replace(MARCADORES.REPASSA, "").replace(MARCADORES.PROMESSA, "")
          .replace(MARCADORES.PAGO, "").replace(MARCADORES.PARAR, "")
          .replace(MARCADORES.DIVIDA, "").replace(MARCADORES.TOTAL, "")
          .replace(MARCADORES.BOLETO, "").replace(MARCADORES.ORIGEM, "");
        recusa = sanear(soProsa);
        if (!recusa) break;
      }

      /* ---- o que o modelo pediu ---- */
      const mRep = bruto.match(MARCADORES.REPASSA);
      const mProm = bruto.match(MARCADORES.PROMESSA);
      const pediuPago = MARCADORES.PAGO.test(bruto);
      const pediuParar = MARCADORES.PARAR.test(bruto);

      // resposta invalida duas vezes seguidas nao vira mensagem improvisada: vira gente.
      // Mandar um texto com numero que o modelo inventou e pior do que a Karla ler a conversa.
      if (recusa) {
        if (dry) { itens.push({ nome: conversa.nome, dito: dito.slice(0, 120), recusado: recusa, repassaria: true }); continue; }
        const rp = await repassar(sb, g, conversa, "resposta automatica recusada: " + recusa,
          `Última mensagem do cliente: "${dito.slice(0, 400)}"`);
        repasses += rp.ok ? 1 : 0;
        itens.push({ nome: conversa.nome, recusado: recusa, repasse: rp });
        continue;
      }

      let texto = bruto
        .replace(MARCADORES.REPASSA, "").replace(MARCADORES.PROMESSA, "")
        .replace(MARCADORES.PAGO, "").replace(MARCADORES.PARAR, "").trim();

      // os numeros entram AQUI, vindos do banco
      let anexos: string[] = [];
      // includes() e nao MARCADORES.BOLETO.test(): esse regex e /g, e .test() num regex
      // global avanca lastIndex — a segunda chamada devolveria false com o marcador ali.
      if (texto.includes("[[BOLETO]]")) { anexos = boleto.urls; texto = texto.replace(MARCADORES.BOLETO, boleto.texto); }
      texto = texto.replace(MARCADORES.DIVIDA, lista)
                   .replace(MARCADORES.ORIGEM, blocoOrigem(abertos))
                   .replace(MARCADORES.TOTAL, brl(total));
      if (mProm) texto += `\n\nAnotei: pagamento até ${dataBr(mProm[1])}.`;
      texto = texto.replace(/\n{3,}/g, "\n\n").trim();

      if (porEmail) {
        const rod = [ASSIN?.linha, ASSIN?.razao_social, ASSIN?.cnpj ? "CNPJ " + ASSIN.cnpj : "", [ASSIN?.telefone, ASSIN?.email].filter(Boolean).join(" · ")].filter(Boolean);
        if (rod.length) texto += "\n\n" + rod.join("\n");
      }

      if (dry) {
        itens.push({ nome: conversa.nome, dito: dito.slice(0, 160), canal: porEmail ? "email" : "whatsapp", resposta: texto, anexos: anexos.length, repassa: mRep ? mRep[1] : null, promessa: mProm ? mProm[1] : null, pago: pediuPago, parar: pediuParar, tentativas });
        atendidas++;
        continue;
      }

      /* ---- manda ---- */
      let envio: any;
      if (porEmail) {
        const payload: any = { type: "Email", contactId: conversa.contact_id, subject: `Re: ${EMPRESA} — financeiro`, html: texto.replace(/\n/g, "<br>") };
        const urls = anexos.filter((x) => /^https?:\/\//i.test(x));
        if (urls.length) payload.attachments = urls;
        const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
        envio = { canal: "email", ok: r.ok, status: r.status };
      } else {
        // WhatsApp entra na fila, como toda mensagem da casa: o fila-processar carrega o teto
        // por minuto, a pausa por instancia caida e a pos-checagem de entrega. Roda de minuto
        // em minuto, entao a resposta sai em menos de um minuto — barato pelo que protege.
        const { data: linha, error: eF } = await sb.from("fila_envio").insert({
          codparc: conversa.grupo, contact_id: conversa.contact_id, canal: "whatsapp",
          fone: conversa.destino, nome: conversa.nome, mensagem: texto,
          instancia: NOME_INST, campanha: "cobranca_resposta", publico: "cliente", empresa: empId,
          imagens: anexos.length ? anexos : null, status: "pendente",
        }).select("id").maybeSingle();
        envio = { canal: "whatsapp", ok: !eF, fila_id: linha?.id ?? null, erro: eF?.message };
      }

      /* ---- o estado da conversa depois desta troca ---- */
      const agora = new Date().toISOString();
      const historico = [...(Array.isArray(conversa.historico) ? conversa.historico : []),
        { em: ultima.dateAdded || agora, dir: "in", texto: dito.slice(0, 1000) },
        { em: agora, dir: "out", texto: texto.slice(0, 1000), meta: { anexos: anexos.length, tentativas } }].slice(-40);

      const patch: any = {
        conversation_id: String(cv.id), respondeu: true,
        ultimo_inbound_id: String(ultima.id), ultimo_inbound_em: ultima.dateAdded || agora,
        historico, atualizado: agora,
      };
      if (pediuParar) { patch.status = "encerrada"; patch.nao_perturbe = true; patch.proximo_toque_em = null; }
      else if (pediuPago) { patch.status = "encerrada"; patch.proximo_toque_em = null; }
      else if (mProm) {
        // promessa: o robo cala ate o dia SEGUINTE ao prometido. Tocar antes da data e
        // desconfiar na cara do cliente que acabou de se comprometer.
        patch.status = "promessa"; patch.promessa_data = mProm[1];
        patch.proximo_toque_em = new Date(new Date(mProm[1] + "T12:00:00Z").getTime() + 86400000).toISOString();
      } else {
        // respondeu e continua devendo: proximo toque so daqui a uma semana. Quem esta
        // conversando nao precisa ser cutucado na cadencia de quem sumiu.
        patch.status = "ativa";
        patch.proximo_toque_em = new Date(Date.now() + 7 * 86400000).toISOString();
      }
      await sb.from("cobranca_conversa").update(patch).eq("contact_id", conversa.contact_id);

      let rp: any = null;
      if (mRep) {
        rp = await repassar(sb, g, { ...conversa, historico }, (mRep[1] || "").trim().slice(0, 120) || "fora do que a Nina resolve",
          `Última mensagem do cliente: "${dito.slice(0, 400)}"\nNina respondeu: "${texto.slice(0, 300)}"`);
        if (rp.ok) repasses++;
      }

      atendidas++;
      itens.push({ nome: conversa.nome, dito: dito.slice(0, 120), canal: porEmail ? "email" : "whatsapp", envio, anexos: anexos.length, promessa: mProm ? mProm[1] : null, pago: pediuPago, parar: pediuParar, repasse: rp });
    }

    return j({ ok: true, dry, candidatos: candidatos.length, atendidas, repasses, itens });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
