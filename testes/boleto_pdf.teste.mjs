import { gerarBoletoPdf, itfElementos, exigirBoleto } from "./boleto_pdf.mjs";
import { writeFileSync } from "node:fs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

/* ---- 1. ITF: decodifica de volta os 44 digitos a partir dos elementos desenhados ---- */
const TAB = { "NNWWN":"0","WNNNW":"1","NWNNW":"2","WWNNN":"3","NNWNW":"4",
              "WNWNN":"5","NWWNN":"6","NNNWW":"7","WNNWN":"8","NWNWN":"9" };
function decodifica(els) {
  const a = els.slice(0, 4).join(""), z = els.slice(-3).join("");
  if (a !== "NNNN") throw new Error("start errado: " + a);
  if (z !== "WNN") throw new Error("stop errado: " + z);
  const meio = els.slice(4, -3);
  if (meio.length % 10) throw new Error("meio nao multiplo de 10");
  let saida = "";
  for (let i = 0; i < meio.length; i += 10) {
    let barras = "", espacos = "";
    for (let k = 0; k < 10; k += 2) { barras += meio[i+k]; espacos += meio[i+k+1]; }
    const d1 = TAB[barras], d2 = TAB[espacos];
    if (!d1 || !d2) throw new Error("padrao desconhecido " + barras + "/" + espacos);
    saida += d1 + d2;
  }
  return saida;
}
console.log("1) codigo de barras ITF");
for (const b of [
  "34191157600002517241090004391521446413831000",
  "42298157600000794057288000018001780000025692",
  "00000000000000000000000000000000000000000000",
  "99999999999999999999999999999999999999999999",
]) {
  const els = itfElementos(b);
  ok(decodifica(els) === b, `round-trip ${b.slice(0,8)}… (${els.length} elementos)`);
}
const unidades = itfElementos("3".repeat(44)).reduce((a,e)=>a+(e==="W"?3:1),0);
ok(unidades === 405, `405 unidades => estreito = 103/405 = ${(103/unidades).toFixed(4)} mm (FEBRABAN: 0,254)`);
try { itfElementos("123"); ok(false, "recusa quantidade impar"); } catch { ok(true, "recusa quantidade impar de digitos"); }

/* ---- 2. o portao: exigirBoleto ---- */
console.log("2) portao exigirBoleto");
const bom = {
  nufin: 1873835, numnota: 136299, dtvenc: "2026-09-21", valor: 2517.24,
  nossonum: "109000439152", banco: "Banco Itaú S.A.", codbco: 341, carteira: "109",
  agencia: "1446", conta: "413831",
  linha_digitavel: "34191.09008  04391.521442  64138.310004  1 15760000251724",
  codigo_barras: "34191157600002517241090004391521446413831000",
  cedente: "NITRONPLAST INDUSTRIA E COMERCIO LTDA", cedente_cnpj: "54886460000198",
  sacado: "CLIENTE EXEMPLO COMÉRCIO DE UTILIDADES LTDA", sacado_cnpj: "12345678000195",
};
ok(exigirBoleto(bom) === null, "aceita titulo completo");
ok(exigirBoleto({ ...bom, linha_digitavel: null }) !== null, "recusa sem linha digitavel");
ok(exigirBoleto({ ...bom, codigo_barras: "341911576" }) !== null, "recusa barras com 9 digitos");
ok(exigirBoleto({ ...bom, valor: 0 }) !== null, "recusa valor zero");
ok(exigirBoleto({ ...bom, dtvenc: "21/09/2026" }) !== null, "recusa vencimento fora do ISO");

/* ---- 3. estrutura do PDF: xref tem que apontar para o byte certo ---- */
console.log("3) estrutura do PDF");
const pdf = gerarBoletoPdf(bom);
writeFileSync("boleto.pdf", pdf);
const txt = Buffer.from(pdf).toString("latin1");
ok(txt.startsWith("%PDF-1.4"), "cabecalho %PDF-1.4");
ok(txt.trimEnd().endsWith("%%EOF"), "termina em %%EOF");
const sx = /startxref\s+(\d+)/.exec(txt);
ok(!!sx, "tem startxref");
ok(txt.slice(Number(sx[1]), Number(sx[1]) + 4) === "xref", "startxref aponta exatamente para 'xref'");
const tabela = [...txt.slice(Number(sx[1])).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
ok(tabela.length === 6, `xref lista os 6 objetos (achou ${tabela.length})`);
let offsetsOk = 0;
tabela.forEach((off, i) => { if (txt.slice(off).startsWith(`${i+1} 0 obj`)) offsetsOk++; });
ok(offsetsOk === 6, `todos os 6 offsets caem no inicio do objeto certo (${offsetsOk}/6)`);
const len = Number(/\/Length (\d+)/.exec(txt)[1]);
const st = txt.indexOf("stream\n") + 7;
ok(txt.slice(st, st + len).length === len && txt.slice(st + len).startsWith("\nendstream"), "/Length bate com o stream real");
ok(pdf.length > 3000 && pdf.length < 60000, `tamanho razoavel: ${pdf.length} bytes`);
ok(txt.includes("(NITRONPLAST INDUSTRIA E COMERCIO LTDA)"), "cedente no conteudo");
ok(/re f/.test(txt), "desenha retangulos (barras e linhas)");
const nBarras = (txt.match(/ re f/g) || []).length;
ok(nBarras > 144, `${nBarras} retangulos = 114 barras ITF + linhas + tracejado`);
ok(!Buffer.from(pdf).includes(Buffer.from('? ? ? ?')), 'nenhuma fileira de ? (a tesoura virou tracejado desenhado)');

/* ---- 4. acento: byte latin1, nao UTF-8 ---- */
console.log("4) acentuacao");
const comAcento = gerarBoletoPdf({ ...bom, sacado: "AÇÃO & UTILIDADES LTDA — SÃO JOÃO" });
const t2 = Buffer.from(comAcento).toString("latin1");
ok(t2.includes("AÇÃO & UTILIDADES"), "acentos gravados como byte latin1 unico");
ok(!Buffer.from(comAcento).includes(Buffer.from([0xc3, 0x83])), "nao vazou sequencia UTF-8 no stream");

/* ---- 5. escape de parenteses, que quebraria a string do PDF ---- */
console.log("5) escape");
const t3 = Buffer.from(gerarBoletoPdf({ ...bom, sacado: "LOJA (MATRIZ) \\ FILIAL" })).toString("latin1");
ok(t3.includes("(LOJA \\(MATRIZ\\) \\\\ FILIAL)"), "parenteses e barra escapados");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
