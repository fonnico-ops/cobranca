// cobranca-painel (v10) — a tela de aprovacao, a das entregas, a das conversas e a da saude. HTML montado no servidor, com a chave de
// servico ficando no servidor: as tabelas de cobranca tem RLS ligada e sem policy, entao
// o anon key nao le nada. O navegador so ve o que esta na pagina.
//
// v2: `?aba=conversas` mostra o que a Nina esta conversando. Sem isso ninguem ve um repasse
//     acontecer: a Karla recebe a conversa no CRM e o resto do time nao sabe por que, e
//     promessa de pagamento fica so dentro de uma linha de jsonb. Robo que conversa sem
//     tela de supervisao e robo que ninguem corrige.
//
// v3: `?aba=saude` responde "o que saiu, o que nao saiu, e por que" — que e a pergunta que
//     vem depois de ligar o motor. Sem ela a correcao depende de alguem abrir o SQL.
//
// v4: a tela nao abre mais pela URL da funcao — abre pelo GitHub Pages (`docs/painel.html`).
//     Nao e gosto, e regra da plataforma: o dominio supabase.co nao entrega pagina. Medido:
//     funcao com text/html, Storage com mimetype text/html, application/xhtml+xml e text/xml
//     chegam todos como `text/plain` + `nosniff` (o navegador mostra o codigo-fonte); so
//     image/svg+xml passa, e sem valor aqui porque o gateway ainda manda
//     `content-security-policy: default-src 'none'; sandbox`, que mataria os botoes.
//     A casca no Pages busca este HTML e escreve na pagina. Duas consequencias no codigo:
//       - o POST do botao vai para a URL ABSOLUTA da funcao (ctx.api). Na casca,
//         location.pathname e o caminho do Pages, e postar para la nao dispararia nada.
//       - todo link interno leva a chave (ctx.sufixo): na casca cada `?aba=...` troca a query
//         inteira, e sem isso o primeiro clique cairia no 401.
//     E como o link agora e publico e o repositorio tambem, `cobranca_config.painel_chave`
//     passou a valer: sem `?k=` certo, nem GET nem POST.
//
// v5: o botao postava em `API + location.search`, e no navegador a barra de enderecos da
//     casca NAO tem a chave (a casca a monta por dentro, ou a guarda no proprio navegador).
//     Resultado: o POST saia sem `?k=`, batia no 401 e o "Aprovar e disparar" nao fazia
//     nada. Agora o servidor injeta no HTML a URL COMPLETA do POST — a mesma query que ele
//     acabou de aceitar no GET, chave inclusive — e o navegador nao precisa adivinhar nada.
//
// v6: a tela diz, ANTES do clique, quanto tempo o disparo leva e o que acontece com o
//     numero fora do ar. Eram as duas perguntas que so apareciam depois de aprovar: "por
//     que nao chegou ainda?" (leva ~54s por mensagem, de proposito) e "por que nao saiu
//     nada?" (o numero esta pausado). Com o WhatsApp caido a faixa fica ambar e diz
//     quantos saem por e-mail agora e quantos so tem WhatsApp e ficam para a proxima.
//
// v7: duas perguntas que a tela nao respondia. (1) O QUE ACONTECEU com o que ja foi
//     aprovado: o card congelava em "enfileirado", que e o estado do momento do clique;
//     agora cada envio mostra o estado ATUAL da fila_envio — entregue e a que horas, na
//     fila desde quando, ou o erro. (2) O QUE VEM DEPOIS: a tela terminava nos 60 do teto,
//     sem dizer que ha mais grupos esperando a vez. Agora o rodape traz a previa, com o
//     total e em quantas rodadas a carteira e coberta no ritmo atual.
//
// v9: ENTREGA POR MENSAGEM, e nao por card. Um card sao duas mensagens (WhatsApp e e-mail),
//     com destinos diferentes — e o selo por canal da v8 escondia justo o que interessa: em
//     25/09, 59 cards "enfileirados" iguais na tela enquanto 28 WhatsApp sairam, o numero caiu
//     as 13:56 e 24 mensagens ficaram paradas sem dizer QUAIS. Agora:
//       - cada card lista suas mensagens, com destino, estado e horario;
//       - `?aba=entregas` e o extrato completo: as presas no topo, com quanto tempo esperam;
//       - a palavra mudou. A v8 escrevia "WhatsApp entregue"; ninguem nos devolve confirmacao
//         de entrega do WhatsApp, entao agora e "saiu". `entregue`/`aberto` so no e-mail, e so
//         quando o GHL confirma — o cobranca-entregas pergunta pelo id que o aprovar v5 grava.
//
// v10: a tela do rodizio (07/10). Diz por qual numero cada mensagem saiu (Karla ou Bianca),
//      conta o tempo pelo ritmo da cobranca — 2 min por numero, dividido pelos numeros de pe —
//      avisa quando um dos dois esta fora do ar (a rodada sai no dobro do tempo, nao para),
//      marca a mensagem RETIDA como ritmo e nao como travamento, e conta quantos numeros da
//      rodada ainda nao passaram pela conferencia de WhatsApp. Conserta tambem um erro antigo:
//      o `cobranca_config` era lido sem as colunas de regra (valor_min, atraso, cap), entao a
//      previa do proximo lote usava o teto PADRAO de 40 em vez do configurado — ela dizia
//      "4 rodadas" onde o certo era menos.
//
// GET  ?rodada=YYYY-MM-DD&fase=vencido    -> a tela
// GET  ?aba=entregas&dias=2 | ?aba=entregas&rodada=YYYY-MM-DD
// GET  ?aba=conversas | ?aba=saude&dias=30
// POST { acao:"aprovar"|"recusar", ids:[...] } -> repassa ao cobranca-aprovar
//
// O que a tela mostra de proposito, antes do botao:
//   - a MENSAGEM inteira, como o cliente vai ler. Aprovar sem ler o texto nao e aprovar.
//   - o DESTINO e de onde ele veio (financeiro do Sankhya? cadastro? CRM?). A diferenca
//     entre cobrar o financeiro e cobrar o telefone da recepcao e grande, e so a origem conta.
//   - quantos boletos vao anexos e quantos titulos ficaram SEM boleto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const ORIGEM_ROTULO: Record<string, string> = {
  sankhya_respcobranca: "Resp. cobrança (Sankhya)",
  sankhya_financeiro: "Financeiro (Sankhya)",
  sankhya_contato: "Contato (Sankhya)",
  parceiro_sankhya: "Cadastro do parceiro",
  crm: "CRM",
};
// verde = falamos com quem cuida de pagar; ambar = e o cadastro geral; cinza = so o CRM
const ORIGEM_COR: Record<string, string> = {
  sankhya_respcobranca: "#0a7", sankhya_financeiro: "#0a7",
  sankhya_contato: "#c80", parceiro_sankhya: "#c80", crm: "#888",
};

/* ===================================================== O ESTADO DE CADA MENSAGEM
 *
 * Aprovar nao e entregar, e um card nao e uma mensagem: sao duas (WhatsApp e e-mail), com
 * destinos diferentes e destinos finais diferentes. Ate a v8 a tela dava um selo por canal
 * lido de `cobranca_fila.envios` — o retrato do CLIQUE — e em 25/09 isso escondeu o que
 * importava: 59 cards "enfileirados" iguais na tela, 28 WhatsApp na rua, o numero caiu as
 * 13:56 e 24 mensagens ficaram paradas sem que a tela dissesse QUAIS.
 *
 * Agora a fonte e o livro `cobranca_entrega`: uma linha por mensagem, com destino, horario e
 * estado proprios. Para o WhatsApp o livro e conferido contra a linha ATUAL do fila_envio
 * (que o painel ja carrega): o cron do cobranca-entregas roda de 10 em 10 minutos, e entre
 * duas rodadas dele a tela nao pode mentir.
 *
 * PALAVRA CERTA, DE PROPOSITO: `saiu` nao e `entregue`.
 *   Ninguem nos devolve "chegou no aparelho" do WhatsApp — o campanhas-enviar so consegue
 *   provar o contrario (a linha do ZaptosWPP dizendo que a instancia caiu). Escrever
 *   "entregue" ali, como a v8 fazia, e afirmar o que nao sabemos; quem cobra usa essa tela
 *   para falar com o cliente, e "consta entregue" errado custa a conversa.
 *   `entregue` e `aberto` existem so no e-mail, e so quando o GHL confirma.
 */
export const ESTADO: Record<string, { txt: string; cor: string }> = {
  na_fila:  { txt: "na fila",  cor: "#c60" },
  saiu:     { txt: "saiu",     cor: "#0a7" },
  entregue: { txt: "entregue", cor: "#087" },
  aberto:   { txt: "aberto",   cor: "#06c" },
  erro:     { txt: "erro",     cor: "#c0392b" },
};

/** Traducao do fila_envio para o vocabulario do livro (a mesma do cobranca-entregas). */
export function doFila(status: string): "na_fila" | "saiu" | "erro" {
  if (status === "enviado") return "saiu";
  if (status === "erro") return "erro";
  return "na_fila";   // pendente, agendado, enviando e tambem 'segurado' (retida pelo ritmo)
}

/**
 * O estado de AGORA de uma entrega, e a frase curta que a explica.
 *
 * `fila` e o mapa id -> linha do fila_envio. Quando a linha existe ela ganha do livro: e a
 * fonte, e o livro e so a copia que o cron atualiza.
 */
export function estadoDaEntrega(e: any, fila: Record<string, any>): { estado: string; quando: string; nota: string; por?: string } {
  const f = e.canal === "whatsapp" && e.fila_id ? fila[String(e.fila_id)] : null;
  if (f) {
    const estado = doFila(String(f.status || ""));
    const por = f.instancia ? String(f.instancia) : undefined;
    if (estado === "erro") return { estado, quando: hhmm(f.enviado_em), nota: String(f.resultado || f.erro || e.detalhe || "").slice(0, 160), por };
    if (estado === "saiu") return { estado, quando: hhmm(f.enviado_em), nota: "", por };
    // 'segurado' nao e congestionamento: e o ritmo, de proposito. A tela precisa dizer isso,
    // senao quem olha vai concluir que travou e mexer onde nao deve.
    const retida = String(f.status || "") === "segurado";
    return { estado, quando: hhmm(f.criado_em),
      nota: retida ? "retida: sai no ritmo do rodízio (1 a cada 2 min por número)" : "esperando a vez na fila", por };
  }
  const estado = String(e.estado || "na_fila");
  if (estado === "erro") return { estado, quando: hhmm(e.criado_em), nota: String(e.detalhe || "").slice(0, 160) };
  if (estado === "entregue" || estado === "aberto") return { estado, quando: hhmm(e.confirmado_em || e.saiu_em), nota: "" };
  if (estado === "saiu" && e.canal === "email") {
    // e-mail sem id no CRM nunca sera confirmado; dizer isso e melhor do que deixar em branco
    const temId = !!(e.ghl_email_id || e.ghl_message_id);
    return { estado, quando: hhmm(e.saiu_em || e.criado_em), nota: temId ? "sem confirmação do provedor ainda" : "sem confirmação: o CRM não devolveu id da mensagem" };
  }
  return { estado, quando: hhmm(e.saiu_em || e.criado_em), nota: "" };
}

const CANAL_ROTULO: Record<string, string> = { whatsapp: "WhatsApp", email: "E-mail" };

/** As entregas de um card, uma linha por mensagem. */
function entrega(c: any, porCard: Record<string, any[]>, fila: Record<string, any>): string {
  if (c.status === "aguardando") return "";
  const rows = porCard[String(c.id)] || [];
  if (!rows.length) return "";
  const linhas = rows.map((e: any) => {
    const { estado, quando, nota, por } = estadoDaEntrega(e, fila);
    const cor = (ESTADO[estado] || ESTADO.na_fila).cor;
    const txt = (ESTADO[estado] || { txt: estado }).txt;
    return `<div class="ent">
      <span class="selo" style="background:${cor}">${esc(txt)}${quando ? " " + esc(quando) : ""}</span>
      <b>${esc(CANAL_ROTULO[e.canal] || e.canal)}</b> <span class="para">${esc(e.destino)}</span>
      ${por ? `<span class="quem">pelo número da ${esc(por)}</span>` : ""}
      ${nota ? `<span class="quem">${esc(nota)}</span>` : ""}</div>`;
  }).join("");
  return `<div class="entrega">${linhas}</div>`;
}
const hhmm = (t: any) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * O QUE VEM DEPOIS DESTA RODADA.
 *
 * A tela mostrava so os 60 do teto e terminava ali. Quem olha nao tinha como saber que
 * existem mais 139 grupos esperando a vez, nem quanto eles somam — e sem isso o teto vira
 * uma decisao no escuro: nao da para responder "em quantas rodadas eu limpo a carteira?".
 *
 * A lista e uma PREVIA, e a tela diz isso. A selecao definitiva e feita pelo cobranca-montar
 * na hora da proxima rodada, com o espelho recem-lido do Sankhya: quem pagar ate la sai
 * sozinho, e quem vencer no meio entra. Prometer aqui a lista exata seria mentir sobre dado
 * que ainda vai mudar.
 */
function filaDepois(ctx: any): string {
  const p = ctx.proximos;
  if (!p || !p.grupos) return "";
  const linhas = (p.lista || []).map((g: any) =>
    `<tr><td>${esc(g.nome || "grupo " + g.grupo)}</td><td class="num">${g.titulos}</td><td class="num">${brl(g.valor)}</td></tr>`).join("");
  return `<section class="depois">
    <h2>Depois desta rodada: ${p.grupos} grupo(s), ${brl(p.valor)}</h2>
    <p class="nota">Prévia pela dívida, do maior para o menor. A lista definitiva é montada na próxima rodada
      (${esc(p.quando)}) com os títulos relidos do Sankhya — quem pagar até lá sai sozinho, e quem vencer entra.
      No ritmo de hoje (${p.teto} grupos por rodada), a carteira leva cerca de ${p.rodadas} rodada(s).</p>
    ${linhas ? `<table><tr><th>cliente</th><th>títulos</th><th>valor</th></tr>${linhas}</table>` : ""}
    ${p.grupos > (p.lista || []).length ? `<p class="nota">… e mais ${p.grupos - (p.lista || []).length} grupo(s).</p>` : ""}
  </section>`;
}

function pagina(cards: any[], ctx: any): string {
  const total = cards.reduce((a, c) => a + Number(c.valor || 0), 0);

  /* QUANTO TEMPO ISTO VAI LEVAR, antes de clicar.
     O WhatsApp nao sai de uma vez, e desde 07/10 o ritmo e da COBRANCA e nao do trilho
     compartilhado: cada numero do rodizio solta uma mensagem a cada `wpp_intervalo_seg`
     (120s por pedido do gestor), e sao dois numeros alternando. Entao o tempo por mensagem
     na rodada e o intervalo dividido pelos numeros de pe — com um numero fora do ar, a
     mesma rodada leva o dobro, e a tela precisa dizer isso ANTES do clique.
     O e-mail sai na hora e por isso nao entra na conta. */
  const aguardando = cards.filter((c: any) => c.status === "aguardando");
  const temCanal = (c: any, canal: string) => (Array.isArray(c.contatos) ? c.contatos : []).some((x: any) => x.canal === canal);
  const porWpp = aguardando.filter((c: any) => temCanal(c, "whatsapp")).length;
  const porMail = aguardando.filter((c: any) => temCanal(c, "email")).length;
  // quem NAO tem e-mail e o que fica para tras quando o numero esta fora do ar. Isto e uma
  // contagem propria e nao a diferenca `porWpp - porMail`: os conjuntos se cruzam, e a
  // subtracao dava 0 num caso com 1 grupo so de WhatsApp — o teste local pegou.
  const soWpp = aguardando.filter((c: any) => temCanal(c, "whatsapp") && !temCanal(c, "email")).length;
  const minutos = Math.round((porWpp * Number(ctx.segPorMsg || 54)) / 60);
  // a janela de cobranca (8h-20h) corta o envio: uma rodada de 4h aprovada as 18h termina
  // amanha de manha, e e melhor a pessoa saber disso antes de clicar do que depois.
  const horaAgora = Number(new Date().toLocaleString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).slice(0, 2));
  const sobraHoje = Math.max(0, (Number(ctx.janelaAte ?? 20) - Math.max(horaAgora, Number(ctx.janelaDe ?? 8))) * 60);
  ctx.terminaEm = minutos <= sobraHoje ? "hoje" : `amanhã (a janela de cobrança fecha às ${Number(ctx.janelaAte ?? 20)}h e reabre às ${Number(ctx.janelaDe ?? 8)}h)`;
  const tempo = minutos < 1 ? "menos de 1 min" : (minutos < 90 ? `${minutos} min` : `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`);
  const cartoes = cards.map((c) => {
    const contatos = (Array.isArray(c.contatos) ? c.contatos : []);
    const wpp = contatos.find((x: any) => x.canal === "whatsapp");
    const mail = contatos.find((x: any) => x.canal === "email");
    const boletos = Array.isArray(c.boletos) ? c.boletos : [];
    const destino = (t: any, rotulo: string) => t
      ? `<div class="dest"><b>${rotulo}</b> ${esc(t.valor)}
           <span class="org" style="background:${ORIGEM_COR[t.origem] || "#888"}">${esc(ORIGEM_ROTULO[t.origem] || t.origem)}</span>
           ${t.nome ? `<span class="quem">${esc(t.nome)}${t.funcao ? " · " + esc(t.funcao) : ""}</span>` : ""}</div>`
      : `<div class="dest vazio"><b>${rotulo}</b> sem contato</div>`;
    return `<article class="card" data-id="${c.id}">
      <header>
        <label><input type="checkbox" class="sel" value="${c.id}"${c.status === "aguardando" ? " checked" : " disabled"}></label>
        <div class="tit"><h3>${esc(c.nome || "grupo " + c.grupo)}</h3>
          <div class="meta">${c.n_titulos} título${c.n_titulos > 1 ? "s" : ""}
            ${c.fase === "vencido" ? ` · maior atraso <b>${c.maior_atraso}d</b>` : ""}
            ${(c.codparcs || []).length > 1 ? ` · ${(c.codparcs || []).length} lojas` : ""}</div></div>
        <div class="vlr">${brl(c.valor)}</div>
      </header>
      <div class="anex">
        ${(Array.isArray(c.boleto_links) ? c.boleto_links : []).map((l: any, i: number) =>
          `<a href="${esc(l.url)}" target="_blank" rel="noopener">abrir os boletos${(c.boleto_links || []).length > 1 ? " (" + (i + 1) + ")" : ""}</a>`).join("")}
        ${boletos.length ? `<span class="ok">${boletos.length} boleto${boletos.length > 1 ? "s" : ""} anexo${boletos.length > 1 ? "s" : ""}</span>` : ""}
        ${c.sem_boleto ? `<span class="falta">${c.sem_boleto} título${c.sem_boleto > 1 ? "s" : ""} sem boleto no ERP</span>` : ""}
        ${boletos.slice(0, 6).map((b: any) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">PDF ${esc(String(b.dtvenc).slice(8, 10) + "/" + String(b.dtvenc).slice(5, 7))}</a>`).join("")}
      </div>
      ${destino(wpp, "WhatsApp")}${destino(mail, "E-mail")}
      <pre class="msg">${esc(c.mensagem)}</pre>
      ${entrega(c, ctx.porCard, ctx.fila)}
      ${c.status !== "aguardando" ? `<div class="jasaiu">${esc(c.status)}${c.motivo ? " — " + esc(c.motivo) : ""}</div>` : ""}
    </article>`;
  }).join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cobrança — aprovação</title><style>
:root{--bg:#f6f7f9;--fg:#111;--card:#fff;--bd:#e3e5e9;--mut:#666;--ac:#0b5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e9eaec;--card:#1c1f24;--bd:#2a2e35;--mut:#9aa0a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.barra{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{font:600 14px system-ui;padding:9px 16px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--fg);cursor:pointer}
button.go{background:var(--ac);border-color:var(--ac);color:#fff}button[disabled]{opacity:.5;cursor:not-allowed}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:12px 0}
.card header{display:flex;gap:10px;align-items:flex-start}
.tit{flex:1;min-width:0}h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.meta{color:var(--mut);font-size:12.5px}
.vlr{font:700 17px system-ui;white-space:nowrap}
.anex{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 6px;font-size:12px;align-items:center}
.anex .ok{background:#0a7;color:#fff;padding:2px 8px;border-radius:99px}
.anex .falta{background:#c60;color:#fff;padding:2px 8px;border-radius:99px}
.anex a{color:var(--ac);text-decoration:none;border:1px solid var(--bd);padding:2px 8px;border-radius:99px}
.dest{font-size:13px;margin:3px 0;overflow-wrap:anywhere}.dest b{display:inline-block;min-width:74px;color:var(--mut);font-weight:600}
.dest.vazio{color:var(--mut)}
.org{font-size:11px;color:#fff;padding:1px 7px;border-radius:99px;margin-left:4px;white-space:nowrap}
.quem{color:var(--mut);font-size:12px;margin-left:4px}
.msg{white-space:pre-wrap;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;margin:10px 0 0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.jasaiu{margin-top:8px;font-size:12.5px;color:var(--mut)}
#aviso{padding:10px 12px;border-radius:8px;margin:10px 0;display:none}
.ritmo{font-size:13px;color:var(--mut);background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:8px 11px;margin:0 0 12px}
.entrega{margin-top:10px;border-top:1px solid var(--bd);padding-top:8px}
.ent{display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;font-size:12.5px;margin:3px 0}
.ent b{color:var(--mut);font-weight:600}
.ent .para{overflow-wrap:anywhere}
.selo{font-size:11.5px;color:#fff;padding:2px 9px;border-radius:99px;white-space:nowrap}
.depois{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:18px 0}
.depois h2{font-size:15px;margin:0 0 6px}
.depois .nota{color:var(--mut);font-size:12.5px;margin:6px 0}
.depois table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px}
.depois th,.depois td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--bd);overflow-wrap:anywhere}
.depois th{color:var(--mut);font-weight:600;font-size:12px}
.depois td.num{text-align:right;white-space:nowrap}
.alerta{font-size:13.5px;background:#fff4e5;color:#7a3e00;border:1px solid #f0c78a;border-radius:8px;padding:10px 12px;margin:0 0 12px}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .alerta{background:#3a2a12;color:#f0c78a;border-color:#6b4a1f}}
.vazio-tudo{text-align:center;color:var(--mut);padding:60px 20px}
@media(max-width:560px){.wrap{padding:12px}.card header{flex-wrap:wrap}.vlr{width:100%}}
</style></head><body><div class="wrap">
<h1>Cobrança — ${ctx.fase === "vencido" ? "títulos vencidos" : "a vencer na próxima semana"}</h1>
<div class="sub">rodada ${esc(ctx.rodada)} · ${cards.length} grupo(s) · ${brl(total)} · sai pela <b>${esc(ctx.instancia)}</b>${ctx.desligado ? ' · <b style="color:#c60">motor desligado (cobranca_config.ativo = false)</b>' : ""}</div>
${ctx.wppPausado
  ? `<div class="alerta">Nenhum número da cobrança está de pé${ctx.caidas?.length ? " (" + esc(ctx.caidas.join(", ")) + ")" : ""}.
       Aprovando agora, saem <b>${porMail} por e-mail</b>, na hora.
       ${soWpp > 0 ? `<b>${soWpp} grupo(s) só têm WhatsApp</b> e ficam para a próxima rodada.` : "Nenhum grupo depende só de WhatsApp."}</div>`
  : (porWpp ? `<div class="ritmo"><b>${porWpp}</b> por WhatsApp, alternando entre <b>${esc((ctx.rodizio || []).join(" e "))}</b>
       — uma mensagem por número a cada ${Math.round(Number(ctx.intervaloSeg || 120) / 60)} min, então o envio leva cerca de <b>${tempo}</b>
       e termina ${esc(ctx.terminaEm || "no mesmo dia")}${porMail ? ` · <b>${porMail}</b> por e-mail, que sai na hora` : ""}
       ${ctx.caidas?.length ? `<br><b style="color:#c60">${esc(ctx.caidas.join(", "))} fora do ar</b> — a rodada inteira sai pelo(s) número(s) que sobrou, no dobro do tempo.` : ""}
       ${ctx.semVeredito ? `<br>${ctx.semVeredito} número(s) ainda sem conferência de WhatsApp; a validação roda de 5 em 5 min e o que for fixo ou inexistente vai só por e-mail.` : ""}</div>` : "")}
<div class="barra">
  <button id="todos">Marcar todos</button><button id="nenhum">Desmarcar</button>
  <span style="flex:1"></span>
  <a href="?aba=entregas${ctx.sufixo}" style="font-size:13px;color:var(--ac);text-decoration:none;align-self:center">Entregas &rarr;</a>
  <a href="?aba=conversas${ctx.sufixo}" style="font-size:13px;color:var(--ac);text-decoration:none;align-self:center">Conversas da Nina &rarr;</a>
  <a href="?aba=saude${ctx.sufixo}" style="font-size:13px;color:var(--ac);text-decoration:none;align-self:center">Saúde &rarr;</a>
  <button id="recusar">Recusar</button>
  <button id="aprovar" class="go">Aprovar e disparar</button>
</div>
<div id="aviso"></div>
${cards.length ? cartoes : '<div class="vazio-tudo">Nada aguardando aprovação nesta rodada.<br>Rode o <code>cobranca-montar</code> para montar a fila.</div>'}
${filaDepois(ctx)}
</div><script>
const API=${JSON.stringify(ctx.api)};
const $=(s)=>document.querySelector(s), $$=(s)=>[...document.querySelectorAll(s)];
const sels=()=>$$(".sel:checked:not([disabled])").map(x=>Number(x.value));
function aviso(t,erro){const a=$("#aviso");a.style.display="block";a.textContent=t;
  a.style.background=erro?"#fde8e8":"#e6f6ee";a.style.color=erro?"#8a1c1c":"#0a5c38";}
$("#todos").onclick=()=>$$(".sel:not([disabled])").forEach(x=>x.checked=true);
$("#nenhum").onclick=()=>$$(".sel").forEach(x=>x.checked=false);
async function manda(acao){
  const ids=sels();
  if(!ids.length) return aviso("Nenhum card marcado.",true);
  const verbo = acao==="aprovar" ? "DISPARAR a cobran\\u00e7a de" : "recusar";
  if(!confirm("Confirma "+verbo+" "+ids.length+" grupo(s)?\\n\\nNo aprovar, as mensagens saem de verdade para os clientes.")) return;
  $("#aprovar").disabled=true;$("#recusar").disabled=true;aviso("Processando "+ids.length+"\\u2026");
  try{
    const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao,ids})});
    const d=await r.json();
    if(!d.ok) throw new Error(d.erro||"falhou");
    aviso(acao==="aprovar"
      ? ("Pronto: "+(d.enfileirados||0)+" grupo(s) \\u2014 "+(d.whatsapp_retidas!=null?d.whatsapp_retidas:(d.whatsapp_na_fila||0))+" WhatsApp retidos (saem 1 por n\\u00famero a cada 2 min), "+(d.email_enviado||0)+" e-mail enviado"+(d.erros?", "+d.erros+" com erro":"")+(d.numeros_recusados_antes_de_enviar?", "+d.numeros_recusados_antes_de_enviar+" n\\u00famero(s) recusado(s) na confer\\u00eancia":"")+(d.segurados_ate_o_whatsapp_voltar?", "+d.segurados_ate_o_whatsapp_voltar+" esperando o WhatsApp voltar":"")+". Recarregando\\u2026")
      : ((d.recusados||0)+" recusado(s). Recarregando\\u2026"));
    setTimeout(()=>location.reload(),2200);
  }catch(e){aviso("Erro: "+e.message,true);$("#aprovar").disabled=false;$("#recusar").disabled=false;}
}
$("#aprovar").onclick=()=>manda("aprovar");
$("#recusar").onclick=()=>manda("recusar");
</script></body></html>`;
}

/* =================================================================== as conversas */
const STATUS_ROTULO: Record<string, string> = {
  ativa: "em cobrança", promessa: "prometeu pagar", repassada: "com uma atendente", encerrada: "encerrada",
};
const STATUS_COR: Record<string, string> = {
  ativa: "#0a7", promessa: "#06c", repassada: "#c60", encerrada: "#888",
};
const qdo = (t: any) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function paginaConversas(cs: any[], ctx: any): string {
  const linhas = cs.map((c) => {
    const hist = (Array.isArray(c.historico) ? c.historico : []).slice(-6);
    return `<article class="card">
      <header>
        <div class="tit"><h3>${esc(c.nome || "grupo " + c.grupo)}</h3>
          <div class="meta">${esc(c.canal)} ${esc(c.destino || "")} · toque ${c.toques}/${ctx.maxToques}
            · último ${qdo(c.ultimo_toque_em)}${c.proximo_toque_em ? ` · próximo ${qdo(c.proximo_toque_em)}` : " · sem próximo toque"}</div></div>
        <div><span class="org" style="background:${STATUS_COR[c.status] || "#888"}">${esc(STATUS_ROTULO[c.status] || c.status)}</span></div>
      </header>
      ${c.promessa_data ? `<div class="dest"><b>Prometeu</b> pagar até ${esc(String(c.promessa_data).split("-").reverse().join("/"))}</div>` : ""}
      ${c.nao_perturbe ? `<div class="dest" style="color:#c60"><b>Pediu</b> para não receber mais — as rodadas pulam este grupo</div>` : ""}
      ${c.repassada_para ? `<div class="dest"><b>Passou para</b> ${esc(c.repassada_nome || c.repassada_para)} em ${qdo(c.repassada_em)}<br><span class="quem">${esc(c.repassada_motivo || "")}</span></div>` : ""}
      ${hist.length ? `<pre class="msg">${hist.map((h: any) => esc((h.dir === "in" ? "CLIENTE " : "NINA    ") + qdo(h.em) + "  " + String(h.texto || "").replace(/\n+/g, " ⏎ "))).join("\n\n")}</pre>` : ""}
    </article>`;
  }).join("");
  const conta = (st: string) => cs.filter((c) => c.status === st).length;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cobrança — conversas</title><style>
:root{--bg:#f6f7f9;--fg:#111;--card:#fff;--bd:#e3e5e9;--mut:#666;--ac:#0b5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e9eaec;--card:#1c1f24;--bd:#2a2e35;--mut:#9aa0a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:12px 0}
.card header{display:flex;gap:10px;align-items:flex-start}
.tit{flex:1;min-width:0}h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.meta{color:var(--mut);font-size:12.5px}
.org{font-size:11px;color:#fff;padding:2px 8px;border-radius:99px;white-space:nowrap}
.dest{font-size:13px;margin:4px 0;overflow-wrap:anywhere}.dest b{color:var(--mut);font-weight:600}
.quem{color:var(--mut);font-size:12px}
.msg{white-space:pre-wrap;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;margin:10px 0 0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.vazio-tudo{text-align:center;color:var(--mut);padding:60px 20px}
a.volta{color:var(--ac);text-decoration:none;font-size:13px}
</style></head><body><div class="wrap">
<h1>Cobrança — conversas da Nina</h1>
<div class="sub">${cs.length} conversa(s) · ${conta("ativa")} em cobrança · ${conta("promessa")} com promessa · ${conta("repassada")} com atendente · ${conta("encerrada")} encerradas${ctx.atendeDesligado ? ' · <b style="color:#c60">a Nina nao responde (cobranca_config.atende_ativo = false)</b>' : ""}<br>
<a class="volta" href="?fase=vencido${ctx.sufixo}">&larr; voltar para a aprovação</a> · <a class="volta" href="?aba=saude${ctx.sufixo}">saúde &rarr;</a></div>
${cs.length ? linhas : '<div class="vazio-tudo">Nenhuma conversa ainda.<br>Elas nascem quando o <code>cobranca-aprovar</code> dispara o primeiro toque.</div>'}
</div></body></html>`;
}

/* ================================================================== a aba da saude
 * O que esta tela existe para responder, na ordem em que a pergunta aparece:
 *   1. o motor esta ligado?  (tres chaves separadas, e nenhuma liga sozinha)
 *   2. o que saiu, e o que NAO saiu?  (por canal, com a causa de cada falha)
 *   3. quem ficou sem ser cobrado por falta de contato?
 *   4. que titulo deveria ter boleto e nao tem?
 *   5. alguma conversa travou — promessa vencida, repasse sem resposta?
 *
 * DE ONDE VEM A CAUSA DA FALHA. Ela esta em `fila_envio.resultado`, nao em `fila_envio.erro`
 * — a coluna `erro` existe e fica sempre nula, em 840 falhas de 30 dias. Quem for mexer aqui
 * e olhar `erro` vai concluir que o sistema nao registra causa nenhuma, e vai "consertar" o
 * fila-processar (que e compartilhado com todas as campanhas) sem precisar.
 *
 * As causas sao agrupadas por FAMILIA e nao pelo texto cru: "GHL 400: {...traceId:abc}" e
 * "GHL 400: {...traceId:xyz}" sao a mesma falha e tem de contar como uma linha so, senao a
 * tela vira uma lista de 840 itens unicos e ninguem corrige nada.
 */
// O curinga do PostgREST e `*`, nao `%` — com `%` o filtro casa zero linha e a tela mostra
// "nenhuma falha" para sempre, que e o pior jeito de um painel de falhas falhar.
const CAMPANHAS_COBRANCA = "cobranca*";

/**
 * Reduz o texto do resultado a familia de falha — o que se conserta, nao o que se le.
 *
 * AS FAMILIAS VIERAM DOS TEXTOS REAIS, nao de imaginacao: 60 dias de fila_envio, agrupados.
 * A primeira versao disto foi escrita de cabeca e errava as duas maiores — chamava os 615
 * "e-mail invalido" e os 16 "unsubscribed" de "o CRM recusou (4xx)", que e verdade e nao
 * serve para nada, porque os tres se consertam em lugares diferentes. O teste de saude
 * roda com esses textos reais; se o fila-processar mudar a redacao, ele acusa.
 *
 * A ORDEM IMPORTA. As familias especificas vem ANTES do `GHL 4xx` generico — senao o
 * generico engole todas e a tela volta a dizer "o CRM recusou" 700 vezes.
 */
export function familiaDaFalha(texto: string): { chave: string; rotulo: string; conserto: string } {
  const t = String(texto || "").toLowerCase();

  // --- o que se conserta no CADASTRO do cliente
  if (/e-?mail is invalid|email is invalid/.test(t))
    return { chave: "email_invalido", rotulo: "e-mail do contato é inválido", conserto: "corrigir o e-mail no cadastro do Sankhya — o CRM nem tentou enviar" };
  if (/has unsubscribed|unsubscrib/.test(t))
    return { chave: "descadastrado", rotulo: "o e-mail se descadastrou", conserto: "esse endereço clicou em descadastrar; cobrar por WhatsApp ou pedir novo e-mail ao cliente" };
  if (/dnd is active for email|dnd_active_email/.test(t))
    return { chave: "dnd_email", rotulo: "contato com DND de e-mail no CRM", conserto: "alguém marcou não perturbar no CRM — tirar o DND ou cobrar só por WhatsApp" };
  if (/dnd is active|dnd_active/.test(t))
    return { chave: "dnd", rotulo: "contato com DND no CRM", conserto: "tirar o não perturbar no CRM do contato" };
  if (/achar\/criar contato|achar\/criar o contato/.test(t))
    return { chave: "sem_contato_crm", rotulo: "não deu para achar nem criar o contato no CRM", conserto: "conferir telefone e e-mail no cadastro do Sankhya" };

  // --- o que se conserta no CRM ou na Zaptos
  if (/o contato e d[ao] .+ no crm|sairia pelo numero dela/.test(t))
    return { chave: "dono_errado", rotulo: "o contato é de outra pessoa, a mensagem sairia pelo número errado", conserto: "ajustar o proprietário do contato no CRM — quem é dono decide o número de saída" };
  if (/instancia desconectada|instance is disconnected/.test(t))
    return { chave: "wpp_desconectado", rotulo: "o WhatsApp de saída estava desconectado", conserto: "reconectar o número na Zaptos — o CRM aceitou e o aparelho não entregou" };
  if (/fora do cadastro instancia_ghl/.test(t))
    return { chave: "instancia_sem_cadastro", rotulo: "instância fora do cadastro instancia_ghl", conserto: "cadastrar a instância em instancia_ghl, ou trocar o dono do contato" };
  if (/sem instancia|nao roteavel/.test(t))
    return { chave: "sem_instancia", rotulo: "sem instância de WhatsApp para esse dono", conserto: "o dono do contato no CRM não tem número conectado na Zaptos" };
  if (/bind nao aceito/.test(t))
    return { chave: "bind", rotulo: "o CRM não aceitou o vínculo do contato", conserto: "conferir o contato no CRM: costuma ser duplicado ou com telefone em formato estranho" };

  // --- o generico, sempre por ultimo
  if (/ghl 5\d\d|timeout|fetch failed|network|internal server error/.test(t))
    return { chave: "ghl_5xx", rotulo: "o CRM ou a rede falhou na hora", conserto: "costuma passar sozinho na próxima rodada; se insistir, é o CRM" };
  if (/ghl 4\d\d/.test(t))
    return { chave: "ghl_4xx", rotulo: "o CRM recusou o envio (4xx)", conserto: "ler a mensagem do CRM no exemplo abaixo — quase sempre é dado do contato" };
  return { chave: "outro", rotulo: "outro", conserto: "ler o texto do erro no exemplo abaixo" };
}

function paginaSaude(d: any): string {
  const n = (x: any) => Number(x || 0).toLocaleString("pt-BR");
  const chave = (ligado: boolean, nome: string, oque: string) =>
    `<div class="chave ${ligado ? "on" : "off"}"><b>${ligado ? "ligado" : "desligado"}</b> <code>${esc(nome)}</code><span>${esc(oque)}</span></div>`;

  const porCanal = d.envios.map((e: any) => {
    const total = e.enviado + e.erro + e.fila;
    const pct = total ? Math.round((e.enviado * 100) / total) : 0;
    return `<tr><td>${esc(e.canal)}</td><td class="num">${n(e.enviado)}</td>
      <td class="num ${e.erro ? "ruim" : ""}">${n(e.erro)}</td><td class="num">${n(e.fila)}</td>
      <td class="num">${total ? pct + "%" : "—"}</td></tr>`;
  }).join("");

  const falhas = d.falhas.map((f: any) => `<article class="linha">
      <div class="lcab"><span class="cnt">${n(f.n)}</span>
        <div><b>${esc(f.rotulo)}</b><div class="mut">${esc(f.conserto)}</div></div>
        <span class="tag">${esc(f.canais.join(" · "))}</span></div>
      <pre class="msg">${esc(f.exemplo)}</pre>
    </article>`).join("");

  const semContato = d.sem_contato.map((g: any) =>
    `<tr><td>${esc(g.nome || "grupo " + g.grupo)}</td><td class="num">${brl(g.valor)}</td><td>${esc(g.rodada)}</td><td>${esc(g.fase)}</td></tr>`).join("");

  const pendentes = d.boletos_pendentes.map((t: any) =>
    `<tr><td>${esc(t.nufin)}</td><td>${esc(String(t.dtvenc).split("-").reverse().join("/"))}</td><td class="num">${brl(t.valor)}</td><td>${esc(t.conta)}</td><td>${esc(t.porque)}</td></tr>`).join("");

  const semBoleto = d.sem_boleto.map((c: any) =>
    `<tr><td>${esc(c.conta)}</td><td class="num">${n(c.n)}</td><td>${esc(c.nota)}</td></tr>`).join("");

  const travadas = d.travadas.map((c: any) =>
    `<tr><td>${esc(c.nome || "grupo " + c.grupo)}</td><td>${esc(c.porque)}</td><td>${esc(c.quando)}</td></tr>`).join("");

  const bloco = (titulo: string, corpo: string, vazio: string, cabecalho = "") =>
    `<section><h2>${titulo}</h2>${corpo ? `<table>${cabecalho}${corpo}</table>` : `<p class="nada">${vazio}</p>`}</section>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cobrança — saúde</title><style>
:root{--bg:#f6f7f9;--fg:#111;--card:#fff;--bd:#e3e5e9;--mut:#666;--ac:#0b5;--ruim:#c0392b}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e9eaec;--card:#1c1f24;--bd:#2a2e35;--mut:#9aa0a8;--ruim:#ff6b5a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:0 0 8px}
.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
section{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);overflow-wrap:anywhere}
th{color:var(--mut);font-weight:600;font-size:12px}
td.num{text-align:right;white-space:nowrap}td.ruim{color:var(--ruim);font-weight:700}
.nada{color:var(--mut);font-size:13.5px;margin:0}
.chave{display:flex;gap:8px;align-items:baseline;font-size:13.5px;padding:4px 0;flex-wrap:wrap}
.chave b{padding:1px 9px;border-radius:99px;color:#fff;font-size:11.5px}
.chave.on b{background:var(--ac)}.chave.off b{background:#c60}
.chave code{font-size:12.5px;color:var(--mut)}.chave span{color:var(--mut);font-size:12.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font:700 22px system-ui}.kpi span{color:var(--mut);font-size:12.5px}
.linha{border:1px solid var(--bd);border-radius:10px;padding:10px;margin:8px 0}
.lcab{display:flex;gap:10px;align-items:flex-start}
.cnt{font:700 18px system-ui;min-width:42px;text-align:right;color:var(--ruim)}
.lcab>div{flex:1;min-width:0}.mut{color:var(--mut);font-size:12.5px}
.tag{font-size:11px;color:var(--mut);border:1px solid var(--bd);padding:1px 8px;border-radius:99px;white-space:nowrap}
.msg{white-space:pre-wrap;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;margin:8px 0 0;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
a.volta{color:var(--ac);text-decoration:none;font-size:13px}
</style></head><body><div class="wrap">
<h1>Cobrança — saúde</h1>
<div class="sub">últimos ${d.dias} dias · <a class="volta" href="?fase=vencido${d.sufixo}">aprovação</a> · <a class="volta" href="?aba=conversas${d.sufixo}">conversas</a></div>

<section><h2>As três chaves</h2>
${chave(d.cfg.ativo, "ativo", "a rodada diária monta e dispara cobrança")}
${chave(d.cfg.atende, "atende_ativo", "a Nina responde quem escrever de volta")}
${chave(d.cfg.emitidos, "emitidos_ativo", "o boleto sai no dia em que é registrado no banco")}
<p class="nada" style="margin-top:8px">Nenhuma liga as outras. Com as três desligadas o sistema só monta a fila e espera aprovação.</p></section>

<section><h2>Boletos</h2><div class="cards">
<div class="kpi"><b>${n(d.boletos.com_pdf)}</b><span>títulos com PDF pronto</span></div>
<div class="kpi"><b>${n(d.boletos.com_pix)}</b><span>com QR do PIX no PDF</span></div>
<div class="kpi"><b>${n(d.boletos.faltando)}</b><span>têm linha digitável e ainda não têm PDF</span></div>
<div class="kpi"><b>${n(d.boletos.sem_linha)}</b><span>sem linha digitável no ERP</span></div>
</div>
<p class="nada" style="margin-top:10px">O QR do PIX só aparece quando o ERP tem o payload em <code>AD_PIXQRCODE</code>. Sem ele a caixa sai em branco, de propósito: um QR inventado manda o dinheiro para a conta errada.</p></section>

${bloco("Envios", porCanal, "Nenhum envio de cobrança ainda — o motor nunca rodou com <code>ativo = true</code>.",
  "<tr><th>canal</th><th>enviado</th><th>erro</th><th>na fila</th><th>sucesso</th></tr>")}

<section><h2>Falhas, por causa</h2>
${falhas || '<p class="nada">Nenhuma falha no período.</p>'}</section>

${bloco("Têm linha digitável e não viraram PDF", pendentes, "Todo título com linha digitável já tem PDF.",
  "<tr><th>nufin</th><th>vence</th><th>valor</th><th>conta</th><th>por quê</th></tr>")}

${bloco("Títulos sem boleto no ERP", semBoleto, "Todo título da carteira tem boleto.",
  "<tr><th>conta</th><th>títulos</th><th>o que isso quer dizer</th></tr>")}

${bloco("Grupos que ficaram sem contato", semContato, "Todo grupo montado tinha ao menos um canal.",
  "<tr><th>cliente</th><th>valor</th><th>rodada</th><th>fase</th></tr>")}

${bloco("Conversas que pararam", travadas, "Nenhuma conversa travada.",
  "<tr><th>cliente</th><th>o que aconteceu</th><th>desde</th></tr>")}
</div></body></html>`;
}

/* O PostgREST devolve NO MAXIMO 1000 linhas por resposta, e `.limit(5000)` nao levanta esse
   teto — ele so o abaixa. A primeira versao desta tela contava os titulos em memoria com um
   select unico e mostrou "938 boletos prontos" quando a carteira tinha 1167: os 169 que
   faltavam eram silencio, nao erro. Um painel que subnotifica e pior do que painel nenhum,
   porque ninguem desconfia de um numero que apareceu.

   Entao: quantidade vem de COUNT no banco, e lista vem paginada. */

/** Quantas linhas o filtro tem, contadas pelo Postgres — sem trazer nenhuma. */
async function quantas(q: any): Promise<number> {
  const { count, error } = await q;
  if (error) throw error;
  return Number(count || 0);
}

/** Traz todas as linhas do filtro, de 1000 em 1000, com um teto para nao varrer a tabela. */
async function todas(monta: (de: number, ate: number) => any, teto = 6000): Promise<any[]> {
  const saida: any[] = [];
  for (let de = 0; de < teto; de += 1000) {
    const { data, error } = await monta(de, de + 999);
    if (error) throw error;
    const lote = data || [];
    saida.push(...lote);
    if (lote.length < 1000) break;
  }
  return saida;
}

/** Junta o que a aba da saude mostra. Tudo agregado aqui, em TS: o PostgREST nao agrupa. */
async function dadosSaude(sb: any, dias: number) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const tit = () => sb.from("cobranca_titulo");
  const cnt = { count: "exact" as const, head: true };

  const [cfgR, com_pdf, com_pix, faltando, sem_linha] = await Promise.all([
    sb.from("cobranca_config").select("ativo,atende_ativo,emitidos_ativo,boleto_nao_geravel").eq("id", 1).maybeSingle(),
    quantas(tit().select("nufin", cnt).not("linha_digitavel", "is", null).not("boleto_url", "is", null)),
    // o PDF so desenha o QR com payload de verdade (>20 bytes); o PostgREST nao filtra por
    // tamanho, e hoje o menor payload da carteira tem 180 bytes — `nao vazio` basta e nao mente
    quantas(tit().select("nufin", cnt).not("boleto_url", "is", null).not("pix", "is", null).neq("pix", "")),
    quantas(tit().select("nufin", cnt).not("linha_digitavel", "is", null).is("boleto_url", null)),
    quantas(tit().select("nufin", cnt).is("linha_digitavel", null)),
  ]);
  const cfg = cfgR.data || {};
  const boletos = { com_pdf, com_pix, faltando, sem_linha };

  /* As listas sao curtas por natureza — so o que esta fora do lugar entra nelas. */
  const [pend, semLinha, envios, cards, convs] = await Promise.all([
    todas((de, ate) => tit().select("nufin,dtvenc,valor,codigo_barras,conta_desc")
      .not("linha_digitavel", "is", null).is("boleto_url", null).order("dtvenc").range(de, ate), 1000),
    todas((de, ate) => tit().select("codctabcoint,conta_desc,dtneg")
      .is("linha_digitavel", null).range(de, ate), 3000),
    todas((de, ate) => sb.from("fila_envio").select("canal,status,resultado")
      .or(`campanha.like.${CAMPANHAS_COBRANCA},campanha.eq.boleto_emitido`)
      .gte("criado_em", desde).order("criado_em", { ascending: false }).range(de, ate)),
    todas((de, ate) => sb.from("cobranca_fila").select("grupo,nome,valor,rodada,fase,contatos")
      .gte("criado_em", desde).order("valor", { ascending: false }).range(de, ate), 2000),
    todas((de, ate) => sb.from("cobranca_conversa").select("*").range(de, ate), 2000),
  ]);

  /* ---- os que TEM linha digitavel e mesmo assim nao viraram PDF -------------------
     Nao adianta a tela dizer so "faltam 2": o que se corrige e o MOTIVO. Hoje os dois
     casos reais sao titulo com valor zerado no ERP (o codigo de barras ainda carrega o
     valor original, mas o saldo aberto e zero) — e boleto de R$ 0,00 nao se emite. */
  const boletos_pendentes = pend.slice(0, 30).map((t: any) => ({
    nufin: t.nufin, dtvenc: t.dtvenc, valor: t.valor, conta: t.conta_desc || "—",
    porque: !(Number(t.valor) > 0)
      ? "valor zerado no ERP — boleto de R$ 0,00 não se emite"
      : (String(t.codigo_barras || "").replace(/\D/g, "").length !== 44
        ? "código de barras não tem 44 dígitos no ERP"
        : "recusado na geração — ver a resposta do cobranca-boleto"),
  }));

  /* ---- envios por canal ---- */
  const canais = new Map<string, any>();
  for (const e of envios) {
    const c = e.canal || "?";
    if (!canais.has(c)) canais.set(c, { canal: c, enviado: 0, erro: 0, fila: 0 });
    const linha = canais.get(c);
    if (e.status === "enviado") linha.enviado++;
    else if (e.status === "erro") linha.erro++;
    else if (e.status !== "cancelado") linha.fila++;
  }

  /* ---- falhas agrupadas por FAMILIA, nao pelo texto cru (ver o comentario la em cima) ---- */
  const fams = new Map<string, any>();
  for (const e of envios.filter((x: any) => x.status === "erro")) {
    const f = familiaDaFalha(e.resultado || "");
    if (!fams.has(f.chave)) fams.set(f.chave, { ...f, n: 0, canais: new Set<string>(), exemplo: "" });
    const g = fams.get(f.chave);
    g.n++; g.canais.add(e.canal || "?");
    if (!g.exemplo) g.exemplo = String(e.resultado || "").slice(0, 400);
  }
  const falhas = [...fams.values()].sort((a, b) => b.n - a.n)
    .map((g) => ({ ...g, canais: [...g.canais] }));

  /* ---- grupos montados sem nenhum canal: cobranca que nunca teve como sair ---- */
  const sem_contato = cards
    .filter((c: any) => !(Array.isArray(c.contatos) ? c.contatos : []).length)
    .slice(0, 40);

  /* ---- titulo sem boleto: por conta, com o porque que vem da CONFIG e nao de um palpite --- */
  const regras = Array.isArray(cfg.boleto_nao_geravel) ? cfg.boleto_nao_geravel : [];
  const contas = new Map<string, any>();
  for (const t of semLinha) {
    const nome = t.conta_desc || "(sem conta)";
    const regra = regras.find((r: any) =>
      Number(r.conta) === Number(t.codctabcoint) &&
      (!r.dtneg_de || String(t.dtneg || "") >= r.dtneg_de) &&
      (!r.dtneg_ate || String(t.dtneg || "") <= r.dtneg_ate));
    if (!contas.has(nome)) {
      contas.set(nome, {
        conta: nome, n: 0,
        // sem regra que explique, o titulo DEVERIA ter boleto — e e isso que a tela precisa gritar
        nota: regra ? regra.motivo : "sem regra que explique — deveria ter boleto e não tem",
      });
    }
    contas.get(nome).n++;
  }
  const sem_boleto = [...contas.values()].sort((a, b) => b.n - a.n);

  /* ---- conversa travada: promessa vencida, ou repasse que a atendente nao tocou ---- */
  const hoje = hojeSp();
  const travadas = convs.flatMap((c: any) => {
    const saida = [];
    if (c.status === "promessa" && c.promessa_data && String(c.promessa_data) < hoje)
      saida.push({ ...c, porque: "prometeu pagar e a data passou", quando: String(c.promessa_data).split("-").reverse().join("/") });
    if (c.status === "repassada" && c.repassada_em && !c.ultimo_inbound_em)
      saida.push({ ...c, porque: `passou para ${c.repassada_nome || c.repassada_para} e o cliente não falou mais`, quando: qdo(c.repassada_em) });
    if (c.status === "ativa" && c.proximo_toque_em && new Date(c.proximo_toque_em) < new Date(Date.now() - 3 * 864e5))
      saida.push({ ...c, porque: "o próximo toque está atrasado — a rodada não passou por ela", quando: qdo(c.proximo_toque_em) });
    return saida;
  }).slice(0, 40);

  return {
    dias, boletos, falhas, sem_contato, sem_boleto, travadas, boletos_pendentes,
    envios: [...canais.values()].sort((a, b) => (b.enviado + b.erro) - (a.enviado + a.erro)),
    cfg: { ativo: cfg.ativo === true, atende: cfg.atende_ativo === true, emitidos: cfg.emitidos_ativo === true },
  };
}

/**
 * A previa do proximo lote: quem NAO coube nesta rodada.
 *
 * Repete as regras do cobranca-montar de proposito (valor minimo, faixa de atraso, grupo
 * pela matriz, `nao_perturbe` fora) — nao da para importar dali, cada Edge Function e um
 * deploy independente. Se as regras divergirem, esta tela erra para MENOS ou para MAIS na
 * previa, e nunca no que sai: quem decide o envio continua sendo o montar.
 */
async function previaProximos(sb: any, cfg: any, cards: any[], fase: string) {
  const VALOR_MIN = Number(cfg?.valor_min ?? 50);
  const ATRASO_MIN = Number(cfg?.atraso_min ?? 1);
  const ATRASO_MAX = Number(cfg?.atraso_max ?? 180);
  const TETO = Number(cfg?.cap_grupos_run ?? 40);

  const titulos = await todas((de, ate) =>
    sb.from("cobranca_titulo").select("codparc,matriz,valor,dias_atraso,sacado").eq("fase", fase).order("nufin").range(de, ate));

  const { data: silencio } = await sb.from("cobranca_conversa").select("grupo").eq("nao_perturbe", true);
  const mudos = new Set((silencio || []).map((x: any) => String(x.grupo)));
  const nestaRodada = new Set(cards.map((c: any) => String(c.grupo)));

  const grupos = new Map<string, any>();
  for (const t of titulos) {
    if (Number(t.valor) < VALOR_MIN) continue;
    if (fase === "vencido" && !(Number(t.dias_atraso) >= ATRASO_MIN && Number(t.dias_atraso) <= ATRASO_MAX)) continue;
    const g = String(t.matriz || t.codparc);
    if (mudos.has(g) || nestaRodada.has(g)) continue;
    const acc = grupos.get(g) || { grupo: g, nome: t.sacado || null, valor: 0, titulos: 0 };
    acc.valor += Number(t.valor); acc.titulos++;
    if (!acc.nome && t.sacado) acc.nome = t.sacado;
    grupos.set(g, acc);
  }
  const fila = [...grupos.values()].sort((a, b) => b.valor - a.valor);
  const valor = fila.reduce((a, g) => a + g.valor, 0);
  // quantas rodadas para zerar, contando a de hoje
  const rodadas = Math.max(1, Math.ceil((fila.length + cards.length) / Math.max(1, TETO)));
  return {
    grupos: fila.length, valor, teto: TETO, rodadas,
    quando: fase === "vencido" ? "segunda, quarta ou sexta, 9h" : "sexta, 9h",
    lista: fila.slice(0, 15),
  };
}

/* ================================================================= a aba das entregas
 *
 * A pergunta que ela responde e no singular: "esta mensagem, para este numero, saiu?".
 * Uma linha por mensagem, a mais recente em cima, com o horario e o motivo quando falhou.
 *
 * Duas coisas que ela faz de proposito:
 *   1. SEPARA O QUE ESTA PRESO. Mensagem em `na fila` ha horas nao e igual a mensagem que
 *      acabou de entrar: e sinal de numero fora do ar, e e a primeira coisa que quem cobra
 *      precisa ver. Por isso ela sobe para o topo, com quanto tempo faz.
 *   2. NAO CHAMA `saiu` DE `entregue`. A coluna diz o que o sistema sabe, e a nota de rodape
 *      explica a diferenca — sem isso a tela viraria promessa de entrega que ninguem nos deu.
 */
async function dadosEntregas(sb: any, opts: { dias: number; rodada: string | null }) {
  const base = () => {
    let q = sb.from("cobranca_entrega").select("*");
    if (opts.rodada) q = q.eq("rodada", opts.rodada);
    else q = q.gte("criado_em", new Date(Date.now() - opts.dias * 864e5).toISOString());
    return q;
  };
  const rows = await todas((de, ate) => base().order("criado_em", { ascending: false }).range(de, ate), 3000);

  // o estado do WhatsApp vem da linha da fila, sempre — o livro pode estar a 10 minutos atras
  const ids = [...new Set(rows.filter((r: any) => r.canal === "whatsapp" && r.fila_id).map((r: any) => Number(r.fila_id)))];
  const fila: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("fila_envio").select("id,status,enviado_em,criado_em,resultado,erro,instancia").in("id", ids.slice(i, i + 500));
    for (const f of (data || [])) fila[String(f.id)] = f;
  }

  const itens = rows.map((r: any) => ({ ...r, agora: estadoDaEntrega(r, fila) }));
  const conta = (canal: string, estado: string) => itens.filter((x: any) => x.canal === canal && x.agora.estado === estado).length;
  const resumo = ["whatsapp", "email"].map((canal) => ({
    canal, total: itens.filter((x: any) => x.canal === canal).length,
    na_fila: conta(canal, "na_fila"), saiu: conta(canal, "saiu"),
    entregue: conta(canal, "entregue"), aberto: conta(canal, "aberto"), erro: conta(canal, "erro"),
  }));
  const presas = itens.filter((x: any) => x.agora.estado === "na_fila")
    .sort((a: any, b: any) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime());
  const checado = rows.map((r: any) => r.checado_em).filter(Boolean).sort().at(-1) || null;
  return { itens, resumo, presas, checado, rodada: opts.rodada, dias: opts.dias };
}

function paginaEntregas(d: any, ctx: any): string {
  const linha = (e: any) => {
    const { estado, quando, nota } = e.agora;
    const cor = (ESTADO[estado] || ESTADO.na_fila).cor;
    return `<tr>
      <td class="num">${esc(qdo(e.criado_em))}</td>
      <td>${esc(e.nome || "grupo " + e.grupo)}</td>
      <td>${esc(CANAL_ROTULO[e.canal] || e.canal)}${e.agora.por ? ' <span class="mut">' + esc(e.agora.por) + "</span>" : ""}</td>
      <td>${esc(e.destino)}</td>
      <td><span class="selo" style="background:${cor}">${esc((ESTADO[estado] || { txt: estado }).txt)}${quando ? " " + esc(quando) : ""}</span></td>
      <td class="mut">${esc(nota || "")}</td></tr>`;
  };
  const tabela = (lista: any[]) => `<table><tr><th>aprovada</th><th>cliente</th><th>canal</th><th>destino</th><th>estado</th><th>o que se sabe</th></tr>
    ${lista.map(linha).join("")}</table>`;
  const kpi = (r: any) => `<div class="kpi"><b>${r.total}</b><span>${esc(CANAL_ROTULO[r.canal] || r.canal)}</span>
    <span class="mut">${[r.aberto ? r.aberto + " aberto" : "", r.entregue ? r.entregue + " entregue" : "", r.saiu ? r.saiu + " saiu" : "",
      r.na_fila ? r.na_fila + " na fila" : "", r.erro ? r.erro + " com erro" : ""].filter(Boolean).join(" · ") || "nenhuma mensagem"}</span></div>`;
  const faz = (t: any) => {
    const h = Math.floor((Date.now() - new Date(t).getTime()) / 3600000);
    const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    return h >= 1 ? `${h}h` : `${Math.max(1, m)} min`;
  };

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cobrança — entregas</title><style>
:root{--bg:#f6f7f9;--fg:#111;--card:#fff;--bd:#e3e5e9;--mut:#666;--ac:#0b5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e9eaec;--card:#1c1f24;--bd:#2a2e35;--mut:#9aa0a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:0 0 8px}
.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
section{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--bd);overflow-wrap:anywhere;vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px}
td.num{white-space:nowrap}
.mut{color:var(--mut);font-size:12.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.kpi{background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font:700 22px system-ui}.kpi span{display:block;color:var(--mut);font-size:12.5px}
.selo{font-size:11.5px;color:#fff;padding:2px 9px;border-radius:99px;white-space:nowrap;display:inline-block}
.alerta{font-size:13.5px;background:#fff4e5;color:#7a3e00;border:1px solid #f0c78a;border-radius:8px;padding:10px 12px;margin:0 0 12px}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .alerta{background:#3a2a12;color:#f0c78a;border-color:#6b4a1f}}
a.volta{color:var(--ac);text-decoration:none;font-size:13px}
.nada{color:var(--mut);font-size:13.5px;margin:0}
</style></head><body><div class="wrap">
<h1>Cobrança — entregas, uma por mensagem</h1>
<div class="sub">${d.rodada ? "rodada " + esc(d.rodada) : "últimos " + d.dias + " dia(s)"} · ${d.itens.length} mensagem(ns)
  · conferido pela última vez ${d.checado ? esc(qdo(d.checado)) : "nunca — o <code>cobranca-entregas</code> ainda não rodou"}<br>
<a class="volta" href="?fase=vencido${ctx.sufixo}">&larr; aprovação</a> ·
<a class="volta" href="?aba=entregas&dias=7${ctx.sufixo}">7 dias</a> ·
<a class="volta" href="?aba=entregas&dias=30${ctx.sufixo}">30 dias</a> ·
<a class="volta" href="?aba=conversas${ctx.sufixo}">conversas</a> ·
<a class="volta" href="?aba=saude${ctx.sufixo}">saúde</a></div>

${ctx.wppPausado ? `<div class="alerta">O WhatsApp da cobrança está fora do ar desde ${esc(ctx.pausadaDesde)} —
  as mensagens em <b>na fila</b> só saem quando ele voltar. O e-mail não depende dele e continua saindo.</div>` : ""}

<section><h2>Como está</h2><div class="cards">${d.resumo.map(kpi).join("")}</div>
<p class="nada" style="margin-top:10px"><b>saiu</b> = o CRM despachou a mensagem. Não é confirmação de entrega:
  no WhatsApp ninguém nos devolve “chegou no aparelho”. <b>entregue</b> e <b>aberto</b> existem só no e-mail,
  e só quando o provedor confirma.</p></section>

${d.presas.length ? `<section><h2>Presas na fila agora (${d.presas.length})</h2>
${tabela(d.presas.slice(0, 60))}
<p class="nada" style="margin-top:8px">A mais antiga espera há ${esc(faz(d.presas[0].criado_em))}.
  O WhatsApp sai espaçado de propósito; espera de horas quer dizer número fora do ar.</p></section>` : ""}

<section><h2>Todas as mensagens</h2>
${d.itens.length ? tabela(d.itens.slice(0, 400)) : '<p class="nada">Nenhuma mensagem no período.</p>'}
${d.itens.length > 400 ? `<p class="nada" style="margin-top:8px">… e mais ${d.itens.length - 400}. Filtre por rodada para ver o resto.</p>` : ""}</section>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const u = new URL(req.url);
    const rodada = (u.searchParams.get("rodada") || hojeSp()).slice(0, 10);
    const fase = u.searchParams.get("fase") || "vencido";

    const { data: cfg } = await sb.from("cobranca_config")
      .select("ativo,instancia,instancias,wpp_intervalo_seg,janela_hora_de,janela_hora_ate,atende_ativo,toques_max,painel_chave,valor_min,atraso_min,atraso_max,cap_grupos_run").eq("id", 1).maybeSingle();

    // A tela mostra nome, CNPJ e divida de cliente, e o botao dispara mensagem de verdade.
    // Enquanto `painel_chave` estiver vazia a porta fica aberta (era assim antes); com chave
    // cadastrada, sem `?k=` certo nao passa nem o GET nem o POST.
    const chave = String(cfg?.painel_chave || "");
    if (chave && u.searchParams.get("k") !== chave) {
      return new Response("Link sem a chave de acesso do painel. Peca o link certo a quem cuida da cobranca.",
        { status: 401, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
    }
    // O `k` viaja em TODO link interno: na casca do Pages cada `?aba=...` troca a query inteira,
    // e sem isso o primeiro clique cairia no 401.
    const sufixo = chave ? "&k=" + encodeURIComponent(chave) : "";

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => Number(x)).filter(Boolean);
      if (!ids.length) return j({ ok: false, erro: "sem ids" }, 400);
      const corpo = b.acao === "recusar"
        ? { recusar: ids, aprovado_por: "painel", motivo: "recusado no painel" }
        : { ids, aprovado_por: "painel" };
      const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/cobranca-aprovar", {
        method: "POST",
        headers: { Authorization: "Bearer " + srvKey(), "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      return j(await r.json().catch(() => ({ ok: false, erro: "resposta ilegivel do cobranca-aprovar" })), r.status);
    }

    if (u.searchParams.get("aba") === "saude") {
      const dias = Math.max(1, Math.min(365, Number(u.searchParams.get("dias")) || 30));
      return new Response(paginaSaude({ ...await dadosSaude(sb, dias), sufixo }), {
        headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (u.searchParams.get("aba") === "entregas") {
      const dias = Math.max(1, Math.min(365, Number(u.searchParams.get("dias")) || 2));
      const soRodada = u.searchParams.get("rodada");
      const { data: inst } = await sb.from("instancia_ghl").select("pausada_em").eq("instancia", cfg?.instancia || "Nina").maybeSingle();
      const d = await dadosEntregas(sb, { dias, rodada: soRodada ? soRodada.slice(0, 10) : null });
      return new Response(paginaEntregas(d, {
        sufixo, wppPausado: !!inst?.pausada_em,
        pausadaDesde: inst?.pausada_em ? qdo(inst.pausada_em) : "",
      }), { headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    if (u.searchParams.get("aba") === "conversas") {
      // ordem por status e nao por data: o que precisa de olho humano (repassada, promessa)
      // sobe, e a lista de quem so esta na cadencia desce.
      const { data: cs, error: eC } = await sb.from("cobranca_conversa").select("*").order("atualizado", { ascending: false }).limit(300);
      if (eC) throw eC;
      const peso: Record<string, number> = { repassada: 0, promessa: 1, ativa: 2, encerrada: 3 };
      const ordenadas = (cs || []).slice().sort((a: any, b: any) => (peso[a.status] ?? 9) - (peso[b.status] ?? 9));
      return new Response(paginaConversas(ordenadas, { maxToques: Number(cfg?.toques_max || 5), atendeDesligado: cfg?.atende_ativo !== true, sufixo }), {
        headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const { data: cards, error } = await sb.from("cobranca_fila").select("*")
      .eq("rodada", rodada).eq("fase", fase).order("valor", { ascending: false }).limit(300);
    if (error) throw error;

    /* O estado dos numeros e o ritmo, para a tela dizer quanto tempo o disparo leva e o que
       acontece com um numero fora do ar — as duas perguntas que so apareciam DEPOIS do clique.
       Desde 07/10 sao DOIS numeros em rodizio (Karla e Bianca) e o ritmo e da cobranca, nao do
       fila_config: `wpp_intervalo_seg` por numero, dividido pelos numeros de pe. */
    const rodizio: string[] = Array.isArray(cfg?.instancias) && cfg.instancias.length
      ? cfg.instancias.map(String) : [String(cfg?.instancia || "Nina")];
    const { data: instRows } = await sb.from("instancia_ghl").select("instancia,ativa,pausada_em").in("instancia", rodizio);
    const dePe = rodizio.filter((n) => (instRows || []).some((r: any) => r.instancia === n && r.ativa === true && !r.pausada_em));
    const caidas = rodizio.filter((n) => !dePe.includes(n));

    /* ---- o que ACONTECEU com CADA mensagem do que ja foi aprovado ---------------------
       Duas leituras, e as duas precisam existir:
         `cobranca_entrega` da a lista de mensagens (uma por destino, com o id do e-mail no
         CRM e o que o provedor confirmou);
         `fila_envio` da o estado de AGORA do WhatsApp — o livro e atualizado por cron de 10
         em 10 minutos, e entre duas rodadas a tela nao pode congelar no estado antigo.
       Card antigo, de antes do livro, cai no plano B: as mensagens sao remontadas a partir de
       `envios`, que e o retrato do clique. Melhor um retrato velho do que uma tela em branco. */
    const cardIds = (cards || []).map((c: any) => Number(c.id));
    const doLivro: any[] = [];
    for (let i = 0; i < cardIds.length; i += 300) {
      const { data } = await sb.from("cobranca_entrega").select("*").in("card_id", cardIds.slice(i, i + 300));
      doLivro.push(...(data || []));
    }
    const porCard: Record<string, any[]> = {};
    for (const e of doLivro) (porCard[String(e.card_id)] = porCard[String(e.card_id)] || []).push(e);
    for (const c of (cards || [])) {
      if (porCard[String(c.id)] || c.status === "aguardando") continue;
      const envios: any[] = Array.isArray(c.envios) ? c.envios : [];
      if (!envios.length) continue;
      porCard[String(c.id)] = envios.filter((e: any) => e.destino).map((e: any) => ({
        card_id: c.id, canal: e.canal, destino: e.destino, fila_id: e.fila_id ?? null,
        estado: !e.ok ? "erro" : (e.canal === "email" ? "saiu" : "na_fila"),
        detalhe: e.ok ? null : e.motivo, criado_em: e.em, saiu_em: e.canal === "email" && e.ok ? e.em : null,
      }));
    }

    const ids = doLivro.filter((e: any) => e.canal === "whatsapp" && e.fila_id).map((e: any) => Number(e.fila_id))
      .concat((cards || []).flatMap((c: any) => Array.isArray(c.fila_ids) ? c.fila_ids.map(Number) : []))
      .filter(Boolean);
    const fila: Record<string, any> = {};
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await sb.from("fila_envio").select("id,status,enviado_em,criado_em,resultado,erro,instancia").in("id", ids.slice(i, i + 500));
      for (const f of (data || [])) fila[String(f.id)] = f;
    }

    /* ---- o que vem DEPOIS desta rodada (previa) ---------------------------------------
       Mesmas regras do montar: valor minimo, faixa de atraso, agrupado pela matriz, sem
       quem pediu para nao receber. Nao repete quem ja esta nesta rodada. E previa, e a tela
       diz isso: a selecao real acontece no proximo montar, com o Sankhya relido. */
    const proximos = await previaProximos(sb, cfg, cards || [], fase);
    const intervaloSeg = Math.max(30, Number(cfg?.wpp_intervalo_seg ?? 120));
    // com dois numeros alternando, o tempo por mensagem DA RODADA e o intervalo dividido pelos
    // numeros de pe. Nenhum de pe: a conta nao importa, a faixa ambar assume a tela.
    const segPorMsg = Math.round(intervaloSeg / Math.max(1, dePe.length));

    /* Quantos numeros desta rodada ainda nao foram conferidos. A tela diz isso porque o
       cobranca-aprovar barra numero com veredito ruim: sem a conferencia, o grupo pode cair
       para e-mail na hora do clique, e quem aprova merece saber antes. */
    const fonesDaRodada = [...new Set((cards || []).flatMap((c: any) =>
      (Array.isArray(c.contatos) ? c.contatos : []).filter((x: any) => x.canal === "whatsapp" && x.valor)
        .map((x: any) => { const d = String(x.valor).replace(/\D/g, "").replace(/^0+/, ""); return d.startsWith("55") && d.length > 11 ? d : "55" + d; })))];
    let comVeredito = 0;
    for (let i = 0; i < fonesDaRodada.length; i += 300) {
      const { count } = await sb.from("cobranca_fone").select("fone", { count: "exact", head: true })
        .in("fone", fonesDaRodada.slice(i, i + 300)).neq("estado", "RODANDO");
      comVeredito += Number(count || 0);
    }

    return new Response(pagina(cards || [], {
      rodada, fase, instancia: dePe.join(" e ") || rodizio.join(" e "), desligado: cfg?.ativo !== true, sufixo,
      wppPausado: dePe.length === 0, segPorMsg, porCard, fila, proximos,
      rodizio: dePe, caidas, intervaloSeg,
      janelaDe: Number(cfg?.janela_hora_de ?? 8), janelaAte: Number(cfg?.janela_hora_ate ?? 20),
      semVeredito: Math.max(0, fonesDaRodada.length - comVeredito),
      // com a query inteira: e por ela que a chave chega ao POST
      api: Deno.env.get("SUPABASE_URL")! + "/functions/v1/cobranca-painel" + u.search,
    }), {
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
