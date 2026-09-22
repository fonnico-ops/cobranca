// cobranca-montar (v9) — monta a fila do dia: quem cobrar, com que texto, com quais boletos.
//
// NAO MANDA NADA. Escreve em cobranca_fila com status 'aguardando' e para. Quem dispara e o
// cobranca-aprovar, depois do OK no painel (ou direto, quando cobranca_config.auto_aprovar
// estiver ligado). A separacao e o pedido do gestor: primeira semana com revisao humana.
//
// UM CARD POR GRUPO, NAO POR CNPJ. Rede com tres lojas vencidas recebe UMA mensagem com o
// detalhe por loja, e nao tres cobrancas no mesmo dia — e assim que o campanhas-cobranca ja
// trata a carteira, e repetir tres vezes e como o cliente para de levar a serio o remetente.
//
// O TEXTO E ESCRITO EM CODIGO, NAO POR IA. A mensagem carrega valor, vencimento e numero de
// NF: um digito trocado manda o cliente pagar o que nao deve, e o time perde a conversa toda
// discutindo o numero em vez do pagamento. O modelo e fixo; a variacao e a fase (vencido x a
// vencer), o tamanho da lista e o que se pode dizer sobre o boleto.
//
// v9: o aviso da semana anterior virou LEMBRETE. Desde que o cobranca-emitidos manda o
//     boleto na emissao, o cliente ja tem o PDF ha semanas quando este aviso chega, e
//     repetir o anexo ensina a ignorar os dois. Ver textoAVencer().
// v8: o rodape leva os fixos para ligacao, o WhatsApp rotulado e o e-mail em linha
//     propria. Ver assinar().
// v7: "Ola, lorrany!" — o cadastro nao tem padrao de caixa. Ver primeiroNome().
// v6: respeita quem pediu para nao receber mais (cobranca_conversa.nao_perturbe).
// v5: o nome da empresa no CORPO vem de cobranca_config.empresa_nome, e e "Nitron". O texto
//     dizia "aqui na Nitronplast" enquanto a assinatura dizia "Nitron" — duas marcas na
//     mesma mensagem. A razao social do rodape continua sendo a juridica, que e outra coisa.
// v4: ASSINATURA EM DADO, IGUAL NOS DOIS CANAIS. Era so "Nina — Nitronplast", o que serve no
//     WhatsApp mas e fraco num e-mail de cobranca: sem razao social e CNPJ, um e-mail pedindo
//     pagamento tem cara de golpe, justo quando o cliente vai pagar. Agora vem de
//     cobranca_config.assinatura e campo vazio NAO e impresso — placeholder de rodape
//     chegando ao cliente seria pior do que rodape nenhum. Ver assinar().
//     Junto, duas correcoes que so apareceram ao RENDERIZAR o e-mail:
//       - "Segue os boletos" -> "Seguem os boletos";
//       - os botoes de boleto vinham DEPOIS da assinatura, entao o cliente lia "Obrigada!",
//         achava que tinha acabado, e o botao de pagar ficava no rodape. Agora o texto leva
//         um marcador na posicao certa (MARCA_BOLETOS).
// v3: a mensagem tem TRES caminhos sobre o boleto, nao dois — anexo, "eu providencio", e
//     "saiu pelo banco". Ver sobreOsBoletos().
// v2: duas correcoes que so a primeira rodada seca com dado de producao revelou.
//   1. TETO NA LISTA. Uma rede de 50 lojas gerou uma mensagem com as 352 duplicatas, uma por
//      linha. Ver linhasTitulos().
//   2. SAUDACAO. A cobranca abria com "Ola, 001!" — o "nome do contato" vinha do cadastro do
//      parceiro e era a razao social "001 - INTERLAGOS - SP". Ver primeiroNome().
//
// POST { fase: "vencido" | "a_vencer", rodada?: "YYYY-MM-DD", limite?: n, seco?: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);

const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}` : String(iso || ""); };
/**
 * O primeiro nome de uma PESSOA — ou nada.
 *
 * A rodada seca de 22/09 abriu uma cobranca com "Olá, 001!". O contato tinha vindo do
 * cadastro do parceiro (nível 40 da escada), onde o "nome do contato" e a propria razao
 * social: "001 - INTERLAGOS - SP". Pegar a primeira palavra dali da "001".
 *
 * Entao aqui so passa o que se parece com nome de gente: comeca com letra, tem ao menos
 * tres letras, e nao e uma palavra que so aparece em razao social. Quando nao passa, quem
 * chama cai para o nome da empresa — e, se nem ele servir, para um cumprimento sem nome,
 * que e melhor do que um nome errado.
 */
const NAO_E_NOME = new Set([
  "loja", "filial", "matriz", "centro", "deposito", "cd", "comercio", "comercial",
  "industria", "distribuidora", "casa", "mercado", "super", "supermercado", "ltda", "me",
  "grupo", "rede", "unidade", "posto", "materiais", "construcao", "home", "center",
]);
function primeiroNome(s: any): string {
  const p = String(s || "").trim().split(/\s+/)[0] || "";
  if (!/^\p{L}/u.test(p)) return "";                       // "001", "3M", "-"
  const limpo = p.replace(/[^\p{L}]/gu, "");
  if (limpo.length < 3) return "";
  const chave = limpo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (NAO_E_NOME.has(chave)) return "";
  // O cadastro nao tem padrao de caixa: o card de 22/09 do grupo 65542 abriu com
  // "Ola, lorrany!" porque o contato esta em minuscula no TGFCTT. Entao normaliza —
  // mas SO quando a palavra e toda minuscula ou toda maiuscula ("JOAO" -> "Joao").
  // Nome em caixa mista o cadastro escreveu de proposito: "McCarthy" e "d'Avila" nao
  // se mexe, porque corrigir o que ja estava certo e o erro mais facil de cometer aqui.
  if (p === p.toLowerCase() || p === p.toUpperCase()) {
    return p[0].toUpperCase() + p.slice(1).toLowerCase();
  }
  return p;
}
/** Razao social em algo que da para cumprimentar: "COMERCIAL XYZ LTDA" -> "Comercial Xyz". */
function nomeGentil(s: any): string {
  const bruto = String(s || "").trim().replace(/\s+(LTDA|ME|EPP|EIRELI|S\/?A|S\.A\.?|SA)\b.*$/i, "").trim();
  if (!bruto) return "";
  // "001 - INTERLAGOS - SP": o codigo de loja na frente nao serve para cumprimentar.
  // Tirado aqui e nao na origem porque na LISTA por loja ele ajuda a identificar a unidade.
  return bruto.split(/\s+/).map((p) => p.length <= 2 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}
const diaSemana = () => new Date().toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });   // YYYY-MM-DD

/* ------------------------------------------------------------------- mensagens */
// Quatro regras que valem para os dois textos:
//   1. Nunca citar outro cliente, nem o total da carteira.
//   2. Nunca ameacar no primeiro toque; protesto e negativacao nao aparecem aqui.
//   3. Sempre dar uma saida (falar com o financeiro, parcelar) — cobranca sem saida vira briga.
//   4. Sempre dizer o que esta anexo, e sempre dizer quando NAO esta.

/**
 * A lista de titulos, com TETO.
 *
 * Sem teto isto nao e teoria: a primeira rodada seca de 22/09 montou, para uma rede de
 * 50 lojas, uma mensagem com as 352 duplicatas em aberto, uma por linha. Ninguem le isso
 * no WhatsApp — e uma parede de texto que faz o cliente fechar a conversa em vez de pagar.
 *
 * Acima do teto a lista MUDA DE FORMA em vez de ser cortada no meio: quando o vencido esta
 * espalhado por varias lojas, o resumo passa a ser POR LOJA (que e a primeira pergunta que
 * o financeiro de uma rede faz); quando e uma loja so, mostra os mais antigos e diz quantos
 * ficaram de fora, com o valor. Em nenhum dos casos o total deixa de bater: o "Total em
 * aberto" continua sendo a soma de TUDO, e a mensagem diz o que nao coube.
 */
function linhasTitulos(titulos: any[], comNomeLoja: boolean, nomes: Record<string, string>, teto: number): string {
  const linha = (t: any) => {
    const loja = comNomeLoja ? ` · ${nomeGentil(nomes[String(t.codparc)] || "")}` : "";
    const nf = t.numnota ? ` · NF ${t.numnota}` : "";
    return `• ${brl(t.valor)} — venc. ${dataBr(t.dtvenc)}${nf}${loja}`;
  };
  if (titulos.length <= teto) return titulos.map(linha).join("\n");

  const lojas = new Set(titulos.map((t) => String(t.codparc)));
  if (comNomeLoja && lojas.size > 1) {
    // resumo por loja: valor, quantidade e o vencimento mais antigo de cada uma
    const por: Record<string, { valor: number; n: number; venc: string }> = {};
    for (const t of titulos) {
      const k = String(t.codparc);
      const acc = por[k] || (por[k] = { valor: 0, n: 0, venc: String(t.dtvenc) });
      acc.valor += Number(t.valor); acc.n++;
      if (String(t.dtvenc) < acc.venc) acc.venc = String(t.dtvenc);
    }
    const ordenadas = Object.entries(por).sort((a, b) => b[1].valor - a[1].valor);
    const mostra = ordenadas.slice(0, teto);
    const resto = ordenadas.slice(teto);
    const out = mostra.map(([k, v]) =>
      `• ${nomeGentil(nomes[k] || ("loja " + k))}: ${brl(v.valor)} (${v.n} tít., mais antigo venc. ${dataBr(v.venc)})`).join("\n");
    if (!resto.length) return out;
    const vr = resto.reduce((a, [, v]) => a + v.valor, 0);
    const nr = resto.reduce((a, [, v]) => a + v.n, 0);
    return out + `\n• e mais ${resto.length} lojas: ${brl(vr)} (${nr} tít.)`;
  }

  const mostra = titulos.slice(0, teto);
  const resto = titulos.slice(teto);
  const vr = resto.reduce((a, t) => a + Number(t.valor), 0);
  return mostra.map(linha).join("\n") +
    `\n• e mais ${resto.length} título${resto.length > 1 ? "s" : ""}, somando ${brl(vr)}`;
}

/** Quantos itens cabem numa mensagem legivel. O e-mail aguenta mais que o WhatsApp. */
const TETO_WPP = 12;
const TETO_EMAIL = 40;

/**
 * Onde os botoes de boleto entram no e-mail.
 *
 * Eles vinham grudados no fim do corpo, DEPOIS da assinatura — visto na renderizacao do
 * e-mail em 22/09. Assinatura no meio da mensagem faz o leitor achar que acabou e parar de
 * ler; o botao de pagar ficava no rodape, abaixo do "Obrigada!". Agora o texto carrega um
 * marcador na posicao certa: o e-mail troca pelos botoes, o WhatsApp apaga a linha (la o
 * anexo e o proprio arquivo, nao um link).
 */
const MARCA_BOLETOS = "[[BOLETOS]]";
/** Onde o rodape de identificacao comeca. O e-mail o separa; o WhatsApp so apaga a marca. */
const MARCA_RODAPE = "[[RODAPE]]";

/**
 * A assinatura, igual nos dois canais (decisao do gestor em 22/09).
 *
 * Duas partes: a linha de quem assina e o rodape que identifica a empresa. O rodape existe
 * porque cobranca por e-mail sem razao social e CNPJ tem cara de golpe — justo quando se
 * esta pedindo para o cliente pagar. No WhatsApp ele tambem vai: a decisao foi manter as
 * duas pontas iguais.
 *
 * CAMPO VAZIO NAO APARECE. Se telefone ou e-mail estiverem em branco na config, a linha nao
 * e impressa. Nunca deixar placeholder ali: "(xx) xxxx-xxxx" chegando ao cliente e pior do
 * que rodape nenhum.
 */
function assinar(despedida: string, a: any): string {
  const linha = String(a?.linha || "").trim() || "Nitron";
  // Os fixos primeiro, o WhatsApp rotulado, e o e-mail em linha propria. O cliente que
  // quer LIGAR precisa achar o numero de ligacao sem ter de adivinhar qual dos tres e
  // celular — e um rodape de tres contatos amontoados numa linha so nao se le no celular.
  const fixos = (Array.isArray(a?.telefones) ? a.telefones : []).map((x: any) => String(x || "").trim()).filter(Boolean);
  const cel = String(a?.telefone || "").trim();
  const fones = [...fixos, cel ? "WhatsApp " + cel : ""].filter(Boolean).join(" · ");
  const rodape = [
    String(a?.razao_social || "").trim(),
    a?.cnpj ? "CNPJ " + String(a.cnpj).trim() : "",
    fones,
    String(a?.email || "").trim(),
  ].filter(Boolean);
  const out = [despedida, linha];
  if (rodape.length) out.push(MARCA_RODAPE + "", ...rodape);
  return out.join("\n");
}

/**
 * O que dizer sobre o boleto. Tres situacoes, nao duas.
 *
 * A terceira so apareceu quando a gestao explicou, em 22/09, por que alguns titulos estao
 * sem boleto no Sankhya: o boleto FOI emitido, direto no banco, fora do ERP (a conta 113 do
 * Grafeno inteira, e os primeiros do Safra na conta 112). O cliente ja tem esse boleto.
 *
 * Isso muda o que se promete. Dizer "eu providencio a 2a via" para esses seria prometer o
 * que o sistema nao consegue fazer — e gerar um boleto novo criaria um segundo codigo de
 * barras para a mesma divida. Entao a mensagem reconhece que o boleto existe e encaminha
 * para quem consegue tira-lo no banco, em vez de prometer automatico.
 */
function sobreOsBoletos(ctx: any): string[] {
  const { comBoleto, semBoleto } = ctx;
  // Quem chama daqui sempre passa os dois, mas se vierem ausentes a mensagem NAO pode perder
  // a frase do boleto em silencio — foi o que aconteceu com os testes anteriores a esta
  // divisao. Na duvida, trata o que falta como "da para providenciar", que e o comportamento
  // anterior a ela; o caminho do banco so aparece quando alguem afirma que e o caso.
  const semNoBanco = Number(ctx.semNoBanco) || 0;
  const semGeravel = ctx.semGeravel === undefined
    ? Math.max(0, (Number(semBoleto) || 0) - semNoBanco)
    : (Number(ctx.semGeravel) || 0);
  const out: string[] = [];

  if (comBoleto) {
    out.push(semBoleto
      ? (comBoleto === 1 ? "Segue em anexo o boleto que tenho aqui." : `Seguem em anexo os ${comBoleto} boletos que tenho aqui.`)
      : (comBoleto === 1 ? "Segue o boleto em anexo para pagamento." : "Seguem os boletos em anexo para pagamento."));
  }

  if (semGeravel) {
    out.push(comBoleto
      ? `${semGeravel === 1 ? "Falta 1 título" : `Faltam ${semGeravel} títulos`} — me avise e eu providencio a 2ª via.`
      : "Se quiser, eu providencio a 2ª via do boleto ou o Pix — só responder aqui.");
  }

  if (semNoBanco) {
    // "foi emitido pelo banco" e verdade e e o que o cliente precisa saber para achar o
    // boleto que ja tem. Nao promete 2a via automatica: essa passa pelo financeiro.
    out.push(semNoBanco === 1
      ? "Um dos títulos teve o boleto emitido direto pelo banco, então ele não sai por aqui — se não encontrar, me avise que o financeiro te manda a 2ª via."
      : `${semNoBanco} desses títulos tiveram o boleto emitido direto pelo banco, então não saem por aqui — se não encontrar, me avise que o financeiro te manda as 2ª vias.`);
  }

  if (!out.length) out.push("Se precisar do boleto ou do Pix, é só me pedir aqui.");
  return out;
}

function textoVencido(ctx: any): string {
  const { nome, titulos, total, maiorAtraso, multi, nomes, teto, empresa } = ctx;
  const saud = `Olá, ${nome ? nome + "!" : "tudo bem?"}`;
  const abertura = maiorAtraso <= 7
    ? `Passando para lembrar de ${titulos.length === 1 ? "um título que venceu" : "alguns títulos que venceram"} há poucos dias aqui na ${empresa}.`
    : `Estou entrando em contato sobre ${titulos.length === 1 ? "um título em aberto" : "títulos em aberto"} aqui na ${empresa}.`;
  const partes = [
    saud, "",
    abertura, "",
    linhasTitulos(titulos, multi, nomes, teto), "",
    `Total em aberto: *${brl(total)}*`,
  ];
  if (multi) partes.push(`(títulos de ${new Set(titulos.map((t: any) => t.codparc)).size} lojas do grupo, reunidos numa mensagem só)`);
  partes.push("");
  partes.push(...sobreOsBoletos(ctx));
  partes.push(MARCA_BOLETOS);
  partes.push("", "Se já tiver pago, por favor me mande o comprovante que eu dou baixa. E se precisar de prazo ou de parcelar, me diga que eu levo ao financeiro.", "", assinar("Obrigada!", ctx.assinatura));
  return partes.filter((p) => p !== null && p !== undefined).join("\n");
}

/**
 * O aviso da semana anterior e LEMBRETE, nao reenvio.
 *
 * Desde que o cobranca-emitidos passou a mandar o boleto no dia em que ele e registrado no
 * banco, o cliente ja tem o PDF ha semanas quando esta mensagem chega. Repetir os anexos
 * aqui ensina o cliente a ignorar os dois: ele passa a achar que toda mensagem nossa e a
 * mesma coisa, e para de abrir. Entao aqui so lembra a data, e a 2a via fica a pedido.
 *
 * `jaTem` diz quantos daqueles titulos JA foram entregues na emissao. Quando algum nao
 * foi — boleto que saiu depois, cliente novo, falha de envio no dia — esse vai anexo, com
 * a frase certa. O cliente que nao recebeu nada nao pode ficar sem o documento so porque a
 * mensagem virou lembrete.
 */
function textoAVencer(ctx: any): string {
  const { nome, titulos, total, multi, nomes, teto, empresa } = ctx;
  const n = titulos.length;
  const faltam = Math.max(0, n - (Number(ctx.jaTem) || 0));
  const partes = [
    `Olá, ${nome ? nome + "!" : "tudo bem?"}`, "",
    `Passando para lembrar ${n === 1 ? "do título que vence" : "dos títulos que vencem"} na próxima semana aqui na ${empresa}:`, "",
    linhasTitulos(titulos, multi, nomes, teto), "",
    `Total: *${brl(total)}*`, "",
  ];
  if (faltam === 0) {
    // ele ja tem tudo: nao reenvia, so lembra que tem
    partes.push(n === 1
      ? "O boleto eu já te mandei quando ele foi emitido — está aqui na nossa conversa. Se não achar, me avisa que eu reenvio."
      : "Os boletos eu já te mandei quando foram emitidos — estão aqui na nossa conversa. Se não achar algum, me avisa que eu reenvio.");
  } else if (faltam === n) {
    partes.push(...sobreOsBoletos(ctx));
    partes.push(MARCA_BOLETOS);
  } else {
    partes.push(faltam === 1
      ? "Um desses boletos ainda não tinha ido para você — segue em anexo. Os outros eu já te mandei na emissão."
      : `${faltam} desses boletos ainda não tinham ido para você — seguem em anexo. Os outros eu já te mandei na emissão.`);
    partes.push(MARCA_BOLETOS);
  }
  partes.push("", assinar("Qualquer coisa, estou por aqui.", ctx.assinatura));
  return partes.join("\n");
}

/** O e-mail leva o mesmo conteudo, com o link do boleto alem do anexo. */
function html(texto: string, boletos: any[]): string {
  // o rodape da assinatura vai em corpo menor e cinza, separado por um filete \u2014 no e-mail
  // ele e identificacao, nao mensagem, e com o mesmo peso do texto competiria com a cobranca
  const [acima, abaixo] = (() => {
    const i = texto.indexOf(MARCA_RODAPE);
    return i < 0 ? [texto, ""] : [texto.slice(0, i), texto.slice(i + MARCA_RODAPE.length)];
  })();
  const esc = (t: string) => t
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  const corpo = esc(acima);
  const rodapeHtml = abaixo.trim()
    ? '<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e3e5e9;font:12px/1.55 system-ui,sans-serif;color:#777">'
      + esc(abaixo.replace(/^\n+/, "")) + "</div>"
    : "";
  // O link vai ALEM do anexo, nao no lugar dele. Anexo de PDF e a primeira coisa que filtro
  // de spam corporativo remove, e o cliente ficaria com um e-mail falando de um boleto que
  // nao esta la. Com o link, a cobranca continua de pe mesmo se o anexo nao passar.
  const links = boletos.length
    ? '<p style="margin:18px 0 0">' + boletos.map((b: any) =>
        `<a href="${b.url}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 14px;background:#0b5;color:#fff;text-decoration:none;border-radius:6px;font:600 13px system-ui,sans-serif">Boleto venc. ${dataBr(b.dtvenc)} — ${brl(b.valor)}</a>`
      ).join("") + '</p><p style="margin:8px 0 0;font:12px system-ui,sans-serif;color:#666">Os boletos também seguem anexos a este e-mail.</p>'
    : "";
  // o marcador vira os botoes; se nao houver boleto, some sem deixar linha vazia
  const miolo = corpo.includes(MARCA_BOLETOS)
    ? corpo.replace(MARCA_BOLETOS + "<br>", links).replace(MARCA_BOLETOS, links)
    : corpo + links;
  return `<div style="font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:620px">${miolo}${rodapeHtml}</div>`;
}

/* ----------------------------------------------------------------------- main */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = await req.json().catch(() => ({}));
    const fase = String(b.fase || "vencido");
    if (fase !== "vencido" && fase !== "a_vencer") return j({ ok: false, erro: "fase deve ser 'vencido' ou 'a_vencer'" }, 400);
    const seco = b.seco === true;
    const rodada = String(b.rodada || hojeSp()).slice(0, 10);

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.ativo && !seco) return j({ ok: false, erro: "cobranca_config.ativo = false — o motor esta desligado", desligado: true }, 409);
    const VALOR_MIN = Number(cfg?.valor_min ?? 50);
    const ATRASO_MIN = Number(cfg?.atraso_min ?? 1);
    const ATRASO_MAX = Number(cfg?.atraso_max ?? 180);
    const CAP = Math.max(1, Math.min(500, Number(b.limite) || Number(cfg?.cap_grupos_run) || 40));
    const REENVIO = Math.max(0, Number(cfg?.reenvio_min_dias ?? 5));
    const REMETENTE = String(cfg?.remetente || "Nina");
    const ASSINATURA = (cfg?.assinatura && typeof cfg.assinatura === "object") ? cfg.assinatura : {};
    // a marca no corpo; a razao social do rodape e outra coisa, e mora em ASSINATURA
    const EMPRESA_NOME = String(cfg?.empresa_nome || "").trim() || "Nitron";

    /* ---- titulos da fase ---- */
    const titulos: any[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from("cobranca_titulo").select("*").eq("fase", fase).order("nufin").range(de, de + 999);
      if (error) throw error;
      titulos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const elegiveis = titulos.filter((t) =>
      Number(t.valor) >= VALOR_MIN &&
      (fase === "vencido" ? (t.dias_atraso >= ATRASO_MIN && t.dias_atraso <= ATRASO_MAX) : true));

    /* ---- agrupa por matriz ---- */
    const grupos: Record<string, any[]> = {};
    for (const t of elegiveis) { const g = String(t.matriz || t.codparc); (grupos[g] = grupos[g] || []).push(t); }

    /* ---- quem pediu para parar NAO entra, nunca ----------------------------------
       O cobranca-atende marca nao_perturbe quando o cliente pede para nao receber mais.
       Se a rodada de segunda ignorasse isso, o cliente que pediu na sexta seria cobrado de
       novo tres dias depois — e o caminho mais curto para o numero ser denunciado. Perder
       o numero custa a carteira inteira, nao um cliente. */
    const { data: silencio } = await sb.from("cobranca_conversa").select("grupo").eq("nao_perturbe", true);
    const naoPerturbe = new Set((silencio || []).map((x: any) => String(x.grupo)));

    /* ---- o que o cliente JA TEM -------------------------------------------------
       Só importa no aviso da semana anterior, que virou lembrete: ver textoAVencer().
       No vencido nao se consulta — la o boleto vai junto de qualquer jeito, porque a
       mensagem existe para ele pagar agora, nao para ele lembrar de uma data. */
    const jaEntregue = new Set<number>();
    if (fase === "a_vencer") {
      const nufins = elegiveis.map((t) => Number(t.nufin));
      for (let i = 0; i < nufins.length; i += 500) {
        const { data } = await sb.from("boleto_entregue").select("nufin").in("nufin", nufins.slice(i, i + 500));
        for (const x of (data || [])) jaEntregue.add(Number(x.nufin));
      }
    }

    /* ---- quem ja foi cobrado ha pouco nao entra de novo ---- */
    const corte = new Date(Date.now() - REENVIO * 86400000).toISOString().slice(0, 10);
    const { data: recentes } = await sb.from("cobranca_fila")
      .select("grupo,rodada,fase").in("status", ["enfileirado", "aprovado"]).gte("rodada", corte);
    const cobradoRecente = new Set((recentes || []).filter((r: any) => r.rodada !== rodada || r.fase === fase).map((r: any) => String(r.grupo)));

    /* ---- contatos, por parceiro, ja na ordem de prioridade ---- */
    const parcs = [...new Set(elegiveis.map((t) => t.codparc))];
    const porParc: Record<string, any[]> = {};
    for (let i = 0; i < parcs.length; i += 300) {
      const { data } = await sb.from("cobranca_contato").select("*").in("codparc", parcs.slice(i, i + 300)).order("prioridade");
      for (const c of (data || [])) (porParc[String(c.codparc)] = porParc[String(c.codparc)] || []).push(c);
    }
    const nomes: Record<string, string> = {};
    for (const t of elegiveis) if (t.sacado) nomes[String(t.codparc)] = t.sacado;

    /* ---- monta um card por grupo ---- */
    const cards: any[] = [];
    const pulados: Record<string, number> = {};
    const pula = (m: string) => { pulados[m] = (pulados[m] || 0) + 1; };

    for (const [g, ts] of Object.entries(grupos)) {
      if (naoPerturbe.has(g)) { pula("cliente pediu para nao receber mais"); continue; }
      if (cobradoRecente.has(g)) { pula(`cobrado nos ultimos ${REENVIO} dias`); continue; }
      const ordenados = ts.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)));
      const total = ordenados.reduce((a, t) => a + Number(t.valor), 0);
      const maiorAtraso = Math.max(...ordenados.map((t) => Number(t.dias_atraso) || 0));
      const codparcs = [...new Set(ordenados.map((t) => t.codparc))];
      const boletos = ordenados.filter((t) => t.boleto_url).map((t) => ({ nufin: t.nufin, url: t.boleto_url, dtvenc: t.dtvenc, valor: Number(t.valor) }));
      const semBoleto = ordenados.length - boletos.length;
      // dos que estao sem boleto: quantos dao para providenciar e quantos ja existem no banco
      const faltantes = ordenados.filter((t) => !t.boleto_url);
      const semNoBanco = faltantes.filter((t) => t.boleto_geravel === false).length;
      const semGeravel = faltantes.length - semNoBanco;

      // contatos do grupo: comeca pela ancora (a matriz, ou quem deve mais) e desce
      const ancora = codparcs.find((c) => String(c) === g) ?? codparcs[0];
      const ordemParc = [ancora, ...codparcs.filter((c) => c !== ancora)];
      const contatos: any[] = [];
      const visto = new Set<string>();
      for (const cp of ordemParc) {
        for (const c of (porParc[String(cp)] || [])) {
          const k = c.canal + "|" + c.valor;
          if (visto.has(k)) continue;
          visto.add(k);
          contatos.push({ canal: c.canal, valor: c.valor, nome: c.nome, funcao: c.funcao, origem: c.origem, prioridade: c.prioridade });
        }
      }
      contatos.sort((a, b) => a.prioridade - b.prioridade);

      const nomeEmpresa = nomeGentil(nomes[String(ancora)] || "");
      const nomePessoa = primeiroNome(contatos[0]?.nome || "");
      // a empresa so serve de cumprimento se o nome dela comecar por letra: "001 - Interlagos"
      // viraria "Ola, 001 - Interlagos!" — pior do que nao chamar pelo nome.
      const saudacao = nomePessoa || (/^\p{L}/u.test(nomeEmpresa) ? nomeEmpresa : "");
      const base = {
        nome: saudacao, titulos: ordenados, total, maiorAtraso,
        comBoleto: boletos.length, semBoleto, semGeravel, semNoBanco,
        multi: codparcs.length > 1, nomes, remetente: REMETENTE, assinatura: ASSINATURA,
        empresa: EMPRESA_NOME,
        jaTem: ordenados.filter((t) => jaEntregue.has(Number(t.nufin))).length,
      };
      const escreve = (teto: number) => fase === "vencido"
        ? textoVencido({ ...base, teto })
        : textoAVencer({ ...base, teto });
      // WhatsApp: sem link (o anexo e o proprio arquivo) e sem a marca do rodape
      const mensagem = escreve(TETO_WPP).replace("\n" + MARCA_BOLETOS, "").replace(MARCA_RODAPE, "");
      const textoEmail = escreve(TETO_EMAIL);  // e-mail: cabe mais detalhe
      const assunto = fase === "vencido"
        ? `${EMPRESA_NOME} — título${ordenados.length > 1 ? "s" : ""} em aberto (${brl(total)})`
        : `${EMPRESA_NOME} — vencimento${ordenados.length > 1 ? "s" : ""} da próxima semana (${brl(total)})`;

      // No lembrete o anexo e so do que o cliente ainda NAO tem. No vencido vai tudo.
      const boletosDoCard = fase === "a_vencer"
        ? boletos.filter((x: any) => !jaEntregue.has(Number(x.nufin)))
        : boletos;

      cards.push({
        rodada, fase, grupo: Number(g), nome: nomes[String(ancora)] || null,
        codparcs, nufins: ordenados.map((t) => t.nufin),
        n_titulos: ordenados.length, valor: Math.round(total * 100) / 100, maior_atraso: maiorAtraso,
        boletos: boletosDoCard, sem_boleto: semBoleto, sem_boleto_no_banco: semNoBanco,
        contatos, origem_contato: contatos[0]?.origem || null,
        mensagem, assunto, corpo_email: html(textoEmail, boletosDoCard),
        status: contatos.length ? "aguardando" : "sem_contato",
        motivo: contatos.length ? null : "nenhum contato utilizavel: nem no financeiro do Sankhya, nem no cadastro do parceiro, nem no CRM",
      });
    }

    // maior divida primeiro: se o teto cortar, corta o que menos importa
    cards.sort((a, b) => b.valor - a.valor);
    const escolhidos = cards.slice(0, CAP);

    if (seco) {
      return j({
        ok: true, seco: true, fase, rodada,
        grupos_elegiveis: cards.length, entrariam: escolhidos.length,
        valor: Math.round(escolhidos.reduce((a, c) => a + c.valor, 0)),
        sem_contato: escolhidos.filter((c) => c.status === "sem_contato").length,
        pulados,
        amostra: escolhidos.slice(0, 3).map((c) => ({ grupo: c.grupo, nome: c.nome, valor: c.valor, titulos: c.n_titulos, boletos: c.boletos.length, sem_boleto: c.sem_boleto, contatos: c.contatos.slice(0, 3), mensagem: c.mensagem })),
      });
    }

    // upsert pela chave (rodada, fase, grupo): rodar duas vezes no mesmo dia REESCREVE o card
    // em vez de criar um segundo. Mas nunca reescreve o que ja saiu.
    const { data: jaSairam } = await sb.from("cobranca_fila").select("grupo").eq("rodada", rodada).eq("fase", fase).in("status", ["enfileirado", "aprovado", "recusado"]);
    const intocaveis = new Set((jaSairam || []).map((x: any) => String(x.grupo)));
    const gravar = escolhidos.filter((c) => !intocaveis.has(String(c.grupo)));

    let gravados = 0;
    for (let i = 0; i < gravar.length; i += 100) {
      const { error } = await sb.from("cobranca_fila").upsert(gravar.slice(i, i + 100), { onConflict: "rodada,fase,grupo" });
      if (error) throw error;
      gravados += gravar.slice(i, i + 100).length;
    }

    return j({
      ok: true, fase, rodada, gravados,
      preservados: escolhidos.length - gravar.length,
      grupos_elegiveis: cards.length, teto: CAP,
      valor: Math.round(gravar.reduce((a, c) => a + c.valor, 0)),
      com_boleto: gravar.filter((c) => c.boletos.length).length,
      sem_boleto_algum: gravar.filter((c) => c.sem_boleto > 0).length,
      com_boleto_so_no_banco: gravar.filter((c) => c.sem_boleto_no_banco > 0).length,
      sem_contato: gravar.filter((c) => c.status === "sem_contato").length,
      pulados,
      auto_aprovar: cfg?.auto_aprovar === true,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
