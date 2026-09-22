// O teste que importa num codificador de QR e IDA E VOLTA: o que a Nina codifica tem de
// voltar identico num leitor independente. Aqui o leitor e o jsQR, que e o mesmo algoritmo
// que a camera do celular do cliente usa — nao uma reimplementacao minha do meu proprio erro.
import { qrMatriz, menorVersao, reedSolomon } from "./qr.mjs";
import jsQR from "jsqr";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };

/** Rasteriza a matriz com borda silenciosa e escala, no formato que o jsQR espera. */
function paraImagem(matriz, escala = 4, borda = 4) {
  const n = matriz.length;
  const lado = (n + borda * 2) * escala;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!matriz[y][x]) continue;
    for (let dy = 0; dy < escala; dy++) for (let dx = 0; dx < escala; dx++) {
      const px = ((y + borda) * escala + dy) * lado + ((x + borda) * escala + dx);
      data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0;
    }
  }
  return { data, lado };
}
const voltaIgual = (txt) => {
  const m = qrMatriz(txt);
  const { data, lado } = paraImagem(m);
  const lido = jsQR(data, lado, lado);
  return lido && lido.data === txt;
};

console.log("1) ida e volta com o payload PIX REAL do boleto da Nitron");
// o payload que veio no boleto do Sankhya (titulo 10694-3), 180 bytes
const PIX = "00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/0d2df1cd-cadf-41d3-96f8-4479ac6d19be5204000053039865802BR5911NITRONPLAST6009GUARULHOS62070503***6304E4A1";
ok(voltaIgual(PIX), `payload PIX de ${PIX.length} bytes volta identico`);

console.log("2) ida e volta em tamanhos variados");
for (const t of ["A", "teste", "0".repeat(50), "x".repeat(120), "y".repeat(200), "z".repeat(400)]) {
  ok(voltaIgual(t), `${t.length} byte(s)`);
}
ok(voltaIgual("acentuação e cedilha ção — UTF-8"), "acento sobrevive (o PIX e ASCII, mas o modo BYTE nao e)");

console.log("3) a versao escolhida e a MENOR que cabe");
ok(menorVersao(10) === 1, "10 bytes cabem na versao 1");
ok(menorVersao(200) > menorVersao(100), "mais bytes, versao maior");
ok(qrMatriz(PIX).length === menorVersao(180) * 4 + 17, "o lado da matriz e 4v+17");
let erro = null;
try { menorVersao(3000); } catch (e) { erro = String(e); }
ok(/nao cabe/.test(erro || ""), "payload grande demais falha ALTO, em vez de gerar um QR truncado");

console.log("4) a estrutura fixa da norma");
const m = qrMatriz(PIX), n = m.length;
// os tres olhos: anel escuro 7x7 com miolo 3x3
for (const [ox, oy, nome] of [[0, 0, "superior esquerdo"], [n - 7, 0, "superior direito"], [0, n - 7, "inferior esquerdo"]]) {
  ok(m[oy][ox] && m[oy][ox + 6] && m[oy + 6][ox] && m[oy + 6][ox + 6], `olho ${nome}: cantos escuros`);
  ok(!m[oy + 1][ox + 1] && m[oy + 3][ox + 3], `olho ${nome}: anel claro e miolo escuro`);
}
// temporizador: alterna a partir da coluna/linha 6
let alterna = true;
for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0)) alterna = false;
ok(alterna, "temporizador horizontal alterna certo");
ok(m[n - 8][8] === true, "modulo escuro fixo em (8, n-8)");

console.log("5) Reed-Solomon: o QR sobrevive a um borrao");
// O nivel M corrige ~15% dos CODEWORDS, nao dos modulos — e essa diferenca importa.
// A primeira versao deste teste apagava modulos ESPALHADOS: cada um estraga um codeword
// diferente, entao 121 modulos soltos arruinam mais codewords do que o nivel M recupera,
// e o teste falhava com o codificador correto. O que a intercalacao de blocos realmente
// compra e a resistencia ao dano CONTIGUO — o borrao, a dobra, o dedo sujo no papel —
// porque ele atinge poucos codewords de cada bloco. E esse o caso que vale testar.
{
  const m2 = qrMatriz(PIX).map((l) => l.slice());
  const n = m2.length;
  const lado0 = Math.floor(n / 2) - 3;
  let sujos = 0;
  for (let y = lado0; y < lado0 + 6; y++) for (let x = lado0; x < lado0 + 6; x++) { m2[y][x] = false; sujos++; }
  const { data, lado } = paraImagem(m2);
  const lido = jsQR(data, lado, lado);
  ok(lido && lido.data === PIX, `le igual com um borrao contiguo de ${sujos} modulos no meio`);
}
// e o ECC em si, contra um vetor conhecido da norma
{
  const d = new Uint8Array([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
  const e = reedSolomon(d, 10);
  ok(e.length === 10, "gera os 10 bytes de ECC pedidos");
  ok(Array.from(e).join(",") === "196,35,39,119,235,215,231,226,93,23", "ECC bate com o vetor da norma ISO/IEC 18004");
}

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
