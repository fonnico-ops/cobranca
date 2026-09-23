import { gerarBoletoPdf, itfElementos, exigirBoleto, larguraMm } from "./boleto_pdf.mjs";
import { writeFileSync } from "node:fs";
import jsQR from "jsqr";
import { qrMatriz } from "./qr.mjs";

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
// o nome do sacado agora sai dentro da linha "Pagador ...", como no layout do Sankhya —
// entao o teste confere a PROPRIEDADE (escapou) e nao a string isolada de antes.
ok(t3.includes("LOJA \\(MATRIZ\\) \\\\ FILIAL"), "parenteses e barra escapados");
ok(!/\(Pagador[^)\\]*\(MATRIZ/.test(t3), "nenhum parentese cru sobrou dentro da string do PDF");

/* ============================================================ nada pode atropelar nada
   O defeito de 22/09: o codigo do banco era desenhado num x FIXO (77 mm) e a linha
   digitavel, alinhada a direita, chegava a 77,7 mm. Os dois sairam impressos um sobre o
   outro — no numero que o cliente usa para pagar. No codigo as duas chamadas pareciam
   inofensivas; so abrindo o PDF dava para ver.

   Este teste le os operadores de texto do proprio PDF e confere que dois textos na mesma
   linha de base nunca se sobrepoem. Vale para o documento inteiro, nao so para o cabecalho. */
console.log("N) layout: nenhum texto sobrepoe outro");
{
  const MM = 2.834645669;
  // o titulo real que gerou o defeito (Itau, linha de 54 caracteres)
  const pdf = gerarBoletoPdf({
    nufin: 1673273, numnota: 133, valor: 1875, dtvenc: "2026-07-30",
    linha_digitavel: "34191.09008 01987.581442 64138.310004 2 15230000187500",
    codigo_barras: "34192152300001875001090001987581442641383100",
    banco: "Banco Itaú S.A.", codbco: 341, carteira: "109", agencia: "1446", conta: "413831",
    nossonum: "109000198758", cedente: "NITRONPLAST INDUSTRIA E COMERCIO LTDA",
    cedente_cnpj: "54886460000198", sacado: "UTIBRINK", sacado_cnpj: "40155330000170",
  });
  const txt = Buffer.from(pdf).toString("latin1");
  const ops = [...txt.matchAll(/BT (\/F[12]) ([\d.]+) Tf 1 0 0 1 ([-\d.]+) ([-\d.]+) Tm \((.*?)\) Tj ET/g)]
    .map((m) => {
      const s = m[5].replace(/\\([\\()])/g, "$1");
      const tam = Number(m[2]);
      return { negrito: m[1] === "/F2", tam, x: Number(m[3]), y: Number(m[4]), s,
               w: larguraMm(s, tam, m[1] === "/F2") * MM };
    });
  ok(ops.length > 30, `o PDF tem operadores de texto para conferir (${ops.length})`);

  const colisoes = [];
  for (let i = 0; i < ops.length; i++) {
    for (let k = i + 1; k < ops.length; k++) {
      const a = ops[i], b = ops[k];
      // Compara a FAIXA VERTICAL, nao a linha de base: textos de tamanhos diferentes na
      // mesma linha tem bases diferentes (13pt e 11pt ficam a 1,6pt um do outro). A
      // primeira versao deste teste comparava as bases e por isso passou com o codigo
      // defeituoso — um teste que passa pelo motivo errado e pior do que nenhum.
      const alto = (o) => o.tam * 0.7;
      if (!(a.y < b.y + alto(b) && b.y < a.y + alto(a))) continue;
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5) {  // 0.5pt de folga
        colisoes.push(`"${a.s.slice(0, 22)}" x "${b.s.slice(0, 22)}"`);
      }
    }
  }
  ok(colisoes.length === 0, colisoes.length ? "COLISAO: " + colisoes.slice(0, 4).join(" | ") : "nenhum texto sobrepoe outro");

  // e a linha digitavel tem de continuar dentro da margem direita (X+W = 195 mm)
  const dig = ops.filter((o) => o.s.startsWith("34191."));
  ok(dig.length === 2, "a linha digitavel aparece nas duas vias");
  for (const d of dig) {
    ok(d.x >= 15 * MM - 0.5, `linha digitavel nao invade a margem esquerda (x=${(d.x / MM).toFixed(1)}mm)`);
    ok(d.x + d.w <= 195 * MM + 0.5, `linha digitavel nao passa da margem direita (fim=${((d.x + d.w) / MM).toFixed(1)}mm)`);
  }
}

console.log("N+1) larguras da Helvetica batem com o AFM");
{
  const quase = (a, b, m) => ok(Math.abs(a - b) < 0.01, m);
  const MM = 2.834645669;
  // valores do AFM: digito 556, ponto 278, espaco 278 nas duas fontes
  quase(larguraMm("0", 1000, false) * MM, 556, "digito na Helvetica = 556");
  quase(larguraMm("0", 1000, true) * MM, 556, "digito na Helvetica-Bold = 556");
  quase(larguraMm(".", 1000, true) * MM, 278, "ponto = 278");
  quase(larguraMm(" ", 1000, true) * MM, 278, "espaco = 278");
  quase(larguraMm("W", 1000, false) * MM, 944, "W = 944");
  quase(larguraMm("i", 1000, false) * MM, 222, "i minusculo na Helvetica = 222");
  // acento usa a largura da letra base — e o que a Helvetica faz
  quase(larguraMm("ú", 1000, false) * MM, larguraMm("u", 1000, false) * MM, "ú tem a largura de u");
  quase(larguraMm("ç", 1000, false) * MM, larguraMm("c", 1000, false) * MM, "ç tem a largura de c");
  // a media antiga superestimava a linha digitavel em ~8 mm: era dai que vinha a colisao
  const digi = "34191.09008 01987.581442 64138.310004 2 15230000187500";
  const real = larguraMm(digi, 11, true);
  const media = digi.length * 11 * 0.56 / MM;
  ok(real < media - 7, `a media antiga superestimava em ${(media - real).toFixed(1)}mm (real ${real.toFixed(1)}, media ${media.toFixed(1)})`);
}

/* ============================================================ o QR sai LEGIVEL do PDF
   O teste do qr.teste.mjs prova que o codificador acerta a matriz. Isto aqui prova a
   outra metade, que e onde um erro passaria sem ninguem ver: que os retangulos que o
   PDF realmente desenha, no lugar e no tamanho que o layout do Sankhya reserva, ainda
   formam um QR que um leitor independente decodifica. Entre a matriz e o papel estao a
   troca de eixo (o PDF conta o y de baixo para cima), a escala de 95pt e a sobreposicao
   de 0,15pt em cada modulo — qualquer um dos tres estraga a leitura em silencio.

   O leitor aqui e o jsQR, o mesmo algoritmo da camera do cliente. Nao ha reimplementacao
   minha no caminho: o teste le o byte do PDF e pergunta ao jsQR o que ele ve. */
console.log("N+2) o QR do PIX volta legivel do PDF gerado");
{
  const PIX = "00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/0d2df1cd-cadf-41d3-96f8-4479ac6d19be5204000053039865802BR5911NITRONPLAST6009GUARULHOS62070503***6304E4A1";
  // a caixa que o layout do Sankhya reserva para o QR (img4 do Jasper): 95x95pt em 460,132
  const CX = 460, CY = 132, LADO = 95;

  /** Le os `x y w h re f` do stream e devolve so os que caem dentro da caixa do QR. */
  function retangulosDoQr(pdf) {
    const txt = Buffer.from(pdf).toString("latin1");
    // A folga e generosa de proposito (40pt): o teste de vazamento abaixo so tem valor se
    // um modulo fora do lugar CHEGAR aqui em vez de ser filtrado fora. Modulo tem ~2,1pt;
    // o que passa de 20 e regua do formulario ou barra do codigo de barras, nao modulo.
    return [...txt.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re f/g)]
      .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }))
      .filter((r) => r.w < 20 && r.h < 20 &&
                     r.x >= CX - 40 && r.y >= CY - 40 &&
                     r.x + r.w <= CX + LADO + 40 && r.y + r.h <= CY + LADO + 40);
  }

  /** Pinta os retangulos numa imagem RGBA, virando o eixo y como faz a impressora. */
  function rasteriza(rets, esc = 8, borda = 32) {
    const lado = Math.round(LADO * esc) + borda * 2;
    const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
    for (const r of rets) {
      const x0 = Math.round((r.x - CX) * esc) + borda;
      const x1 = Math.round((r.x + r.w - CX) * esc) + borda;
      // y do PDF cresce para cima; y da imagem cresce para baixo
      const y0 = Math.round((CY + LADO - (r.y + r.h)) * esc) + borda;
      const y1 = Math.round((CY + LADO - r.y) * esc) + borda;
      for (let y = Math.max(0, y0); y < Math.min(lado, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(lado, x1); x++) {
          const p = (y * lado + x) * 4;
          data[p] = 0; data[p + 1] = 0; data[p + 2] = 0;
        }
      }
    }
    return { data, lado };
  }

  const comPix = gerarBoletoPdf({ ...bom, pix: PIX });
  const rets = retangulosDoQr(comPix);
  const escuros = qrMatriz(PIX).flat().filter(Boolean).length;
  ok(rets.length === escuros,
     `o PDF desenha um retangulo por modulo escuro da matriz (${rets.length} de ${escuros})`);
  const { data, lado } = rasteriza(rets);
  const lido = jsQR(data, lado, lado);
  ok(!!lido, "o jsQR encontra um QR na caixa reservada pelo Sankhya");
  ok(lido && lido.data === PIX,
     lido ? (lido.data === PIX ? `payload de ${PIX.length} bytes volta identico do PDF`
                              : `VOLTOU DIFERENTE: ${lido.data.slice(0, 40)}...`)
          : "nada para comparar");

  // o QR nao pode escapar da caixa: se vazar, cobre o codigo de barras ou o valor cobrado
  const fora = rets.filter((r) => r.x < CX - 0.01 || r.y < CY - 0.01 ||
                                  r.x + r.w > CX + LADO + 0.2 || r.y + r.h > CY + LADO + 0.2);
  ok(fora.length === 0, `nenhum modulo passa dos 95x95pt da caixa (${fora.length} fora)`);

  // ... e sem payload a caixa fica VAZIA. Um QR inventado paga a conta errada; um QR
  // "de exemplo" e pior, porque parece valido. A caixa e a moldura continuam desenhadas.
  const semPix = gerarBoletoPdf({ ...bom, pix: "" });
  ok(retangulosDoQr(semPix).length === 0, "sem payload, nenhum modulo e desenhado");
  const tSem = Buffer.from(semPix).toString("latin1");
  ok(!tSem.includes("PIX Copia e Cola"), "sem payload, nem o rotulo do PIX aparece");
  ok(/33\.00 126\.00 530\.00 0\.50 re f/.test(tSem) || tSem.includes("126.00"),
     "a moldura da area do PIX continua desenhada, como no original");

  // payload curto demais para ser um PIX de verdade tambem nao vira QR
  ok(retangulosDoQr(gerarBoletoPdf({ ...bom, pix: "00020126" })).length === 0,
     "payload curto demais nao vira QR");

  writeFileSync("boleto_novo.pdf", comPix);
  writeFileSync("boleto_sem_pix.pdf", semPix);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
