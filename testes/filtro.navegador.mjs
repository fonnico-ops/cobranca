// O FILTRO DA TELA DE APROVACAO, no navegador de verdade.
//
// O pedido do gestor foi "filtrar clientes para poder desflegar o envio". O risco obvio
// desse recurso e o gestor filtrar, desmarcar o que ve, e a mensagem sair assim mesmo para
// quem ficou escondido — ou o contrario, o filtro desmarcar sozinho quem nao deveria.
// Entao o que este teste prende nao e "o filtro filtra": e a RELACAO entre o que a tela
// mostra e o que o POST leva. O POST e interceptado; nada sai para cliente nenhum.
import http from "node:http";
// O Playwright nao e dependencia do projeto: quem nao o tiver recebe o recado e o comando,
// em vez de um ERR_MODULE_NOT_FOUND que parece defeito da tela.
let chromium;
try { ({ chromium } = await import("playwright")); }
catch {
  console.log("pulado: este teste precisa do Chromium.\n  cd testes && npm install --no-save playwright");
  process.exit(0);
}
import { pagina } from "./painel_puro.mjs";

const PORT = 8749;
const ALVO = `http://127.0.0.1:${PORT}/func`;

const card = (id, nome, valor, opts = {}) => ({
  id, grupo: id, nome, n_titulos: 2, valor, maior_atraso: 20, fase: "vencido", status: "aguardando",
  contatos: [
    ...(opts.semWpp ? [] : [{ canal: "whatsapp", valor: opts.fone || "11999887766", origem: "sankhya_financeiro" }]),
    { canal: "email", valor: opts.email || "financeiro@exemplo.com.br", origem: "sankhya_financeiro" },
  ],
  boletos: opts.semBoleto ? [] : [{ nufin: 1, url: "https://x/y.pdf", dtvenc: "2026-10-01", valor }],
  boleto_links: [], codparcs: [id], mensagem: "Olá", rodada: "2026-10-15",
});

const cards = [
  card(1, "AÇUCAREIRA SÃO JOÃO", 25000),                              // acento no nome
  card(2, "PALACE COMERCIO VAREJISTA", 8334, { semBoleto: true }),    // sem como pagar
  card(3, "MERCADO DOIS IRMAOS", 1200, { semWpp: true }),             // só e-mail
  card(4, "DISTRIBUIDORA CIDADE DO ACO", 50000, { fone: "11 98877-6655" }),
];

const html = pagina(cards, {
  rodada: "2026-10-15", fase: "vencido", instancia: "Karla e Bianca", desligado: false,
  sufixo: "&k=CHAVE", wppPausado: false, segPorMsg: 60, porCard: {}, fila: {},
  rodizio: ["Karla", "Bianca"], caidas: [], intervaloSeg: 120, janelaDe: 8, janelaAte: 20,
  semVeredito: 0, deOndeVem: "rodada 2026-10-15", atrasados: 0, diasDoMaisVelho: 0,
  proximos: { grupos: 148, valor: 323159, teto: 60, rodadas: 4, quando: "sexta, 9h", lista: [] }, fase: "vencido",
  api: `${ALVO}?fase=vencido&k=CHAVE`,
});

let ultimoPost = null;
const srv = http.createServer((req, res) => {
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => b += d);
    return req.on("end", () => {
      ultimoPost = JSON.parse(b);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (ultimoPost.acao === "montar") {
        return res.end('{"ok":true,"montagem":{"ok":true,"gravados":60,"com_link":52}}');
      }
      if (ultimoPost.acao === "refazer") {
        return res.end('{"ok":true,"refez":true,"descartados":4,"montagem":{"ok":true,"gravados":57,"com_link":50}}');
      }
      res.end('{"ok":true,"enfileirados":1,"whatsapp_retidas":1,"email_enviado":1}');
    });
  }
  res.writeHead(200, { "Content-Type": "text/html" }); res.end(html);
});
await new Promise((r) => srv.listen(PORT, r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
const erros = [];
page.on("pageerror", (e) => erros.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
page.on("dialog", (d) => d.accept());
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };
const visiveis = () => page.$$eval(".card", (cs) => cs.filter((c) => c.style.display !== "none").map((c) => c.dataset.id));
const marcados = () => page.$$eval(".sel", (s) => s.filter((x) => x.checked).map((x) => x.value));
const placar = () => page.locator("#placar").innerText();

console.log("1) a tela abre com tudo marcado e o placar diz a verdade");
ok((await marcados()).length === 4, "os 4 cards comecam marcados");
ok(/4 de 4/.test(await placar()), "placar: 4 de 4");
ok(/84\.534,00/.test(await placar()), "placar soma o valor certo (R$ 84.534,00)");

console.log("2) busca por nome, com e sem acento");
await page.fill("#busca", "acucareira");
ok((await visiveis()).join() === "1", "digitar 'acucareira' sem acento acha 'AÇUCAREIRA SÃO JOÃO'");
ok((await marcados()).length === 4, "filtrar NAO desmarca ninguem");
ok(/4 de 4/.test(await placar()), "o placar continua contando os 4 marcados");
ok(/3 marcado\(s\) escondido\(s\)/.test(await placar()), "e avisa que 3 marcados estao escondidos");

console.log("3) busca por telefone, com e sem formatacao");
await page.fill("#busca", "11988776655");
ok((await visiveis()).join() === "4", "numero sem formatacao acha o card digitado com hifen");

console.log("4) desmarcar age so no que esta visivel — o pedido do gestor");
await page.fill("#busca", "palace");
ok((await visiveis()).join() === "2", "so o PALACE na tela");
ok((await page.locator("#nenhum").textContent()) === "Desmarcar visíveis", "o botao avisa que age no visivel");
await page.click("#nenhum");
ok((await marcados()).sort().join() === "1,3,4", "desmarcou SO o PALACE; os escondidos seguem marcados");
ok(/3 de 4/.test(await placar()), "placar: 3 de 4");

console.log("5) o atalho dos que nao tem como pagar");
await page.fill("#busca", "");
await page.click('[data-chip="sem"]');
ok((await visiveis()).join() === "2", "o atalho acha o card sem boleto nem link");
await page.click('[data-chip="sem"]');
ok((await visiveis()).length === 4, "clicar de novo desliga o atalho");

console.log("6) o atalho de quem so tem e-mail");
await page.click('[data-chip="wpp"]');
ok((await visiveis()).join() === "3", "acha o MERCADO DOIS IRMAOS, que nao tem WhatsApp");
await page.click('[data-chip=""]');
ok((await visiveis()).length === 4, "'mostrar todos' limpa");

console.log("7) o que o POST leva e o que o placar prometeu");
await page.click("#aprovar");
await page.waitForTimeout(600);
ok(!!ultimoPost, "o POST saiu (o botao continua vivo com o filtro no meio)");
ok(ultimoPost && ultimoPost.acao === "aprovar", "acao=aprovar");
ok(ultimoPost && ultimoPost.ids.sort().join() === "1,3,4",
   "o POST leva exatamente os 3 marcados — o PALACE desmarcado atras do filtro NAO foi junto");

console.log("8) montar o proximo lote: prepara, nao dispara");
ok(await page.locator("#montar").isVisible(), "o botao de montar aparece no bloco do proximo lote");
ok(/n.o envia nada/i.test(await page.locator(".montar .nota").innerText()), "a nota diz, em palavras, que nao envia nada");
ultimoPost = null;
await page.click("#montar");
await page.waitForTimeout(700);
ok(!!ultimoPost && ultimoPost.acao === "montar", "o POST pede montagem");
ok(!!ultimoPost && ultimoPost.fase === "vencido", "e leva a fase da aba");
ok(!!ultimoPost && !("ids" in ultimoPost), "o POST de montar NAO leva ids — nao e disparo");
ok(/60 grupo\(s\) montados/.test(await page.locator("#aviso").innerText()), "o aviso confirma o que foi montado");

console.log("9) refazer: rele, descarta o pendente velho e remonta \u2014 sem disparar");
ok(await page.locator("#refazer").isVisible(), "o botao de refazer aparece");
ok(/4 card\(s\) que ainda esperam aprova/.test(await page.locator(".refazer").innerText()),
   "e a tela diz quantos cards de rodada anterior serao descartados (os 4 do fixture)");
ok(/n.o envia nada/i.test(await page.locator(".refazer").innerText()), "com a promessa de que nada e enviado");
ultimoPost = null;
await page.click("#refazer");
await page.waitForTimeout(700);
ok(!!ultimoPost && ultimoPost.acao === "refazer", "o POST pede refazer");
ok(!!ultimoPost && ultimoPost.fase === "vencido", "e leva a fase da aba");
ok(!!ultimoPost && !("ids" in ultimoPost), "sem ids: refazer nao age sobre cards marcados");
{
  const t = await page.locator("#aviso").innerText();
  ok(/57 grupo\(s\) montados/.test(t), "o aviso conta o que foi montado");
  ok(/4 card\(s\) de rodada anterior descartado/.test(t), "e quantos foram descartados");
}

console.log("10) nenhum erro de script");
ok(erros.length === 0, erros.length ? "erros: " + erros.join(" | ") : "console limpo");

await browser.close(); srv.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
