// boleto_pdf.ts — renderiza a ficha de compensacao em PDF, sem dependencia nenhuma.
//
// POR QUE ESCREVER UM PDF NA MAO. O Sankhya nao guarda o PDF do boleto em lugar nenhum
// (conferido: nem TGFFIN, nem AD_BOLHYAK, nem TGFHBA tem URL ou blob) — ele imprime na
// hora, por relatorio, e o relatorio nao esta exposto na API que esta sessao alcanca.
// O que o ERP TEM e tudo que importa: LINHADIGITAVEL e CODIGOBARRA de 44 digitos, ja
// calculados e registrados no banco. O codigo de barras E o instrumento de pagamento; o
// desenho em volta e forma. Entao o caminho honesto e desenhar a ficha aqui a partir
// desses dois campos, sem inventar nenhum digito.
//
// NADA E CALCULADO. Nem DV, nem fator de vencimento, nem campo livre. Se o ERP nao tem
// a linha digitavel, esta funcao se recusa a emitir — ver exigirBoleto(). Um boleto com
// digito calculado por nos e um boleto que pode cair na conta errada.
//
// O PDF e A4, uma pagina, fontes base-14 (Helvetica) que todo leitor tem — sem embutir
// fonte o arquivo fica em ~4 KB e abre em qualquer aparelho. Texto em WinAnsi, que cobre
// os acentos do portugues.

import { qrMatriz } from "./qr.ts";

const MM = 2.834645669; // 1 mm em pontos PostScript
const A4_W = 595.28;
const A4_H = 841.89;

/* ---------------------------------------------------------------- codigo de barras */

// Interleaved 2 of 5. N = barra/espaco estreito, W = largo.
const ITF: Record<string, string> = {
  "0": "NNWWN", "1": "WNNNW", "2": "NWNNW", "3": "WWNNN", "4": "NNWNW",
  "5": "WNWNN", "6": "NWWNN", "7": "NNNWW", "8": "WNNWN", "9": "NWNWN",
};

/** Sequencia de elementos (barra, espaco, barra, ...) do ITF para os 44 digitos. */
export function itfElementos(digitos: string): ("N" | "W")[] {
  const d = digitos.replace(/\D/g, "");
  if (d.length % 2 !== 0) throw new Error("ITF exige quantidade par de digitos: " + d.length);
  const out: ("N" | "W")[] = ["N", "N", "N", "N"]; // start: barra estreita, espaco estreito, x2
  for (let i = 0; i < d.length; i += 2) {
    const barras = ITF[d[i]];
    const espacos = ITF[d[i + 1]];
    if (!barras || !espacos) throw new Error("digito invalido no codigo de barras");
    for (let k = 0; k < 5; k++) {
      out.push(barras[k] as "N" | "W");
      out.push(espacos[k] as "N" | "W");
    }
  }
  out.push("W", "N", "N"); // stop: barra larga, espaco estreito, barra estreita
  return out;
}

/* --------------------------------------------------------------------- texto / PDF */

// WinAnsiEncoding: os acentos do portugues cabem em Latin-1, entao o byte e o code point.
// O que nao couber vira '?' — melhor um caractere trocado do que um PDF ilegivel.
function latin1(s: string): number[] {
  const out: number[] = [];
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0)!;
    out.push(c <= 0xff ? c : 0x3f);
  }
  return out;
}

function escapaPdf(s: string): string {
  // (, ) e \ tem significado dentro de string literal do PDF
  return String(s ?? "").replace(/([\\()])/g, "\\$1");
}

/* --------------------------------------------------------------- largura do texto
 * As larguras REAIS da Helvetica, do AFM da base-14 (em milesimos de em).
 *
 * Antes isto era estimado por media: `len * tamanho * 0.56`. Para a linha digitavel,
 * que e quase toda digito com alguns pontos e espacos, a media SUPERESTIMA em ~8 mm —
 * e o texto alinhado a direita comecava mais a esquerda do que devia, sentando em cima
 * do codigo do banco. O defeito so apareceu quando alguem ABRIU o PDF: no codigo as
 * duas chamadas parecem inofensivas, uma desenha em 77 mm e a outra "a direita".
 *
 * Digito = 556 nas duas fontes; ponto e espaco = 278. E dai que vinha o erro.
 */
const W_HELV: Record<string, number> = {};
const W_BOLD: Record<string, number> = {};
{
  const ascii = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
  const helv = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];
  const bold = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];
  for (let i = 0; i < ascii.length; i++) { W_HELV[ascii[i]] = helv[i]; W_BOLD[ascii[i]] = bold[i]; }
}
/** Largura em mm. Acentuado usa a largura da letra base (e o que a Helvetica faz). */
export function larguraMm(s: string, tamanho: number, negrito = false): number {
  const tab = negrito ? W_BOLD : W_HELV;
  let mil = 0;
  for (const ch of String(s ?? "")) {
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    mil += tab[ch] ?? tab[base] ?? 556;
  }
  return (mil / 1000) * tamanho / MM;
}

type Op = string;

class Pagina {
  ops: Op[] = [];

  /** y medido de CIMA para baixo, em mm — mais natural para descrever um formulario. */
  private py(yMm: number) { return A4_H - yMm * MM; }

  texto(xMm: number, yMm: number, tamanho: number, s: string, negrito = false) {
    if (s === null || s === undefined || s === "") return;
    const fonte = negrito ? "/F2" : "/F1";
    this.ops.push(
      `BT ${fonte} ${tamanho} Tf 1 0 0 1 ${(xMm * MM).toFixed(2)} ${(this.py(yMm) - tamanho * 0.8).toFixed(2)} Tm (${escapaPdf(s)}) Tj ET`,
    );
  }

  /** Texto alinhado a direita de xMm, pela largura REAL da fonte (ver larguraMm). */
  textoDir(xMm: number, yMm: number, tamanho: number, s: string, negrito = false) {
    this.texto(xMm - larguraMm(s, tamanho, negrito), yMm, tamanho, s, negrito);
  }

  retangulo(xMm: number, yMm: number, wMm: number, hMm: number) {
    this.ops.push(
      `${(xMm * MM).toFixed(2)} ${(this.py(yMm + hMm)).toFixed(2)} ${(wMm * MM).toFixed(2)} ${(hMm * MM).toFixed(2)} re f`,
    );
  }

  /* ---- primitivas em PONTOS, y de BAIXO para cima ---------------------------------
     O layout do boleto foi transcrito do template JasperReports que o Sankhya usa, e la
     as coordenadas sao pontos a partir do rodape. Converter cada uma para mm-do-topo na
     mao seria 120 oportunidades de errar um numero; entao aqui o sistema de coordenadas
     e o mesmo do original, e a transcricao fica conferivel linha a linha contra o PDF. */
  pt(xPt: number, yPt: number, tamanho: number, s: string, negrito = false) {
    if (s === null || s === undefined || s === "") return;
    this.ops.push(
      `BT ${negrito ? "/F2" : "/F1"} ${tamanho} Tf 1 0 0 1 ${xPt.toFixed(2)} ${yPt.toFixed(2)} Tm (${escapaPdf(s)}) Tj ET`,
    );
  }
  /** Texto alinhado a direita de xPt, pela largura real da fonte. */
  ptDir(xPt: number, yPt: number, tamanho: number, s: string, negrito = false) {
    this.pt(xPt - larguraMm(s, tamanho, negrito) * MM, yPt, tamanho, s, negrito);
  }
  /** Retangulo preenchido, em pontos. Linha fina = retangulo de 0,5pt de altura. */
  barraPt(xPt: number, yPt: number, wPt: number, hPt: number) {
    this.ops.push(`${xPt.toFixed(2)} ${yPt.toFixed(2)} ${wPt.toFixed(2)} ${hPt.toFixed(2)} re f`);
  }
  hPt(x0: number, x1: number, y: number, esp = 0.5) { this.barraPt(x0, y, x1 - x0, esp); }
  vPt(x: number, y0: number, y1: number, esp = 0.5) { this.barraPt(x, y0, esp, y1 - y0); }
  /** Rotulo pequeno em cima, valor embaixo — o par que se repete em todo campo. */
  campoPt(xPt: number, yPt: number, rotulo: string, valor: string, tam = 8, negrito = false) {
    this.pt(xPt + 2, yPt + 13, 6, rotulo);
    this.pt(xPt + 2, yPt + 3, tam, valor, negrito);
  }

  /**
   * O QR do PIX. Cada modulo vira um quadradinho; a borda silenciosa fica por conta de
   * quem chama (o layout do Sankhya reserva 95x95pt e o QR ocupa o miolo).
   */
  qrPt(xPt: number, yPt: number, ladoPt: number, matriz: boolean[][]) {
    const n = matriz.length;
    const u = ladoPt / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!matriz[y][x]) continue;
        // +0.15 de sobreposicao: sem isso o antialiasing do leitor deixa uma fresta clara
        // entre modulos vizinhos e alguns celulares perdem a leitura.
        this.barraPt(xPt + x * u, yPt + ladoPt - (y + 1) * u, u + 0.15, u + 0.15);
      }
    }
  }

  /** Codigo de barras em PONTOS, no lugar e no tamanho que o layout do Sankhya reserva. */
  barrasPt(xPt: number, yPt: number, digitos: string, larguraPt: number, alturaPt: number) {
    const els = itfElementos(digitos);
    const unidades = els.reduce((a, e) => a + (e === "W" ? 3 : 1), 0);
    const u = larguraPt / unidades;
    let x = xPt;
    els.forEach((e, i) => {
      const w = (e === "W" ? 3 : 1) * u;
      if (i % 2 === 0) this.barraPt(x, yPt, w, alturaPt);   // indice par = barra
      x += w;
    });
  }

  /** Linha de corte entre as duas vias, em pontos. */
  tracejadoPt(xPt: number, yPt: number, wPt: number) {
    const traco = 6, vao = 4;
    for (let x = xPt; x < xPt + wPt; x += traco + vao) {
      this.barraPt(x, yPt, Math.min(traco, xPt + wPt - x), 0.5);
    }
  }

  linhaH(xMm: number, yMm: number, wMm: number, espMm = 0.2) { this.retangulo(xMm, yMm, wMm, espMm); }
  linhaV(xMm: number, yMm: number, hMm: number, espMm = 0.2) { this.retangulo(xMm, yMm, espMm, hMm); }

  /** Rotulo pequeno + valor, o par que se repete em todo campo do boleto. */
  campo(xMm: number, yMm: number, rotulo: string, valor: string, tamanho = 8, negrito = false) {
    this.texto(xMm + 0.8, yMm + 0.4, 5, rotulo);
    this.texto(xMm + 0.8, yMm + 3.4, tamanho, valor, negrito);
  }

  /**
   * Linha de corte entre as duas vias. Desenhada, nao escrita: a tesoura (U+2702) nao
   * existe em Latin-1 e saia como uma fileira de '?' — o defeito apareceu no texto que
   * o pdf.js extraiu do arquivo, nao na inspecao do codigo.
   */
  tracejado(xMm: number, yMm: number, wMm: number) {
    const traco = 2, vao = 1.6;
    for (let x = xMm; x < xMm + wMm; x += traco + vao) {
      this.retangulo(x, yMm, Math.min(traco, xMm + wMm - x), 0.2);
    }
  }

  /** Codigo de barras padrao FEBRABAN: 103 mm de largura, 13 mm de altura. */
  barras(xMm: number, yMm: number, digitos: string, larguraMm = 103, alturaMm = 13) {
    const els = itfElementos(digitos);
    const unidades = els.reduce((a, e) => a + (e === "W" ? 3 : 1), 0);
    const u = larguraMm / unidades; // ~0,254 mm, o estreito da especificacao
    let x = xMm;
    els.forEach((e, i) => {
      const w = (e === "W" ? 3 : 1) * u;
      if (i % 2 === 0) this.retangulo(x, yMm, w, alturaMm); // indice par = barra
      x += w;
    });
  }
}

/* ---------------------------------------------------------------------- formatacao */

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBr = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
};

const doc = (d: string) => {
  const x = String(d || "").replace(/\D/g, "");
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return x;
};

/** Corta sem cortar palavra no meio, para nao estourar a caixa do campo. */
const corta = (s: string, n: number) => {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
};

/* --------------------------------------------------------------------------- dados */

export type Titulo = {
  nufin: number | string;
  numnota?: number | string | null;
  dtvenc: string;                 // ISO
  valor: number;
  nossonum?: string | null;
  banco?: string | null;
  codbco?: number | string | null;
  carteira?: string | null;
  agencia?: string | null;
  conta?: string | null;
  linha_digitavel?: string | null;
  codigo_barras?: string | null;
  cedente?: string | null;
  cedente_cnpj?: string | null;
  sacado?: string | null;
  sacado_cnpj?: string | null;
  // o layout do Sankhya imprime endereco do cedente e do sacado, a parcela e o PIX
  cedente_endereco?: string | null;
  sacado_endereco?: string | null;
  parcela?: string | null;
  dtneg?: string | null;
  pix?: string | null;
};

/**
 * O portao. Emitir boleto com dado faltando ou remendado e pior do que nao emitir:
 * o cliente paga num codigo que nao existe e a conciliacao nunca fecha.
 */
export function exigirBoleto(t: Titulo): string | null {
  const barras = String(t.codigo_barras || "").replace(/\D/g, "");
  if (!String(t.linha_digitavel || "").trim()) return "titulo sem linha digitavel no ERP";
  if (barras.length !== 44) return `codigo de barras com ${barras.length} digitos (esperado 44)`;
  if (!(Number(t.valor) > 0)) return "valor do titulo nao positivo";
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(t.dtvenc || ""))) return "vencimento invalido";
  return null;
}

/* ------------------------------------------------------------------------- desenho
 * O LAYOUT E O DO SANKHYA, transcrito do template JasperReports que ja vai para o cliente
 * (boleto_template, iText 2.1.7-snk). As coordenadas abaixo sao as do proprio PDF do ERP —
 * em pontos, y a partir do rodape — extraidas do arquivo, nao estimadas de olho. Assim o
 * cliente recebe da Nina um documento igual ao que o financeiro imprime no ERP, e nao um
 * "parecido": num boleto, "parecido" e o que faz o cliente ligar perguntando se e golpe.
 *
 * A pagina tem duas vias:
 *   RECIBO DO PAGADOR      y 618..812
 *   FICHA DE COMPENSACAO   y 264..481, mais a area do PIX (126..233) e o codigo de barras
 *
 * O QR DO PIX ocupa 95x95pt em x=460 y=132 — a mesma caixa que o Sankhya reserva (img4).
 */

/** Uma faixa horizontal de campos separados por linhas verticais. */
function faixa(p: Pagina, y: number, alt: number, x0: number, x1: number, divisorias: number[]) {
  p.hPt(x0, x1, y + alt);
  for (const x of divisorias) p.vPt(x, y, y + alt);
}

function cabecalhoVia(p: Pagina, t: Titulo, yTopo: number, banco: string, codBanco: string) {
  // BANCO | 341-7 | linha digitavel — com as barras verticais do original
  p.pt(136.9, yTopo, 10, corta(banco, 26), true);
  p.pt(236.4, yTopo + 0.2, 10, "|");
  p.pt(241.2, yTopo, 10, codBanco ? `${codBanco}-${dvBanco(t)}` : "", true);
  p.pt(269.0, yTopo + 0.2, 10, "|");
  const dig = String(t.linha_digitavel || "").replace(/\s+/g, " ").trim();
  // a linha digitavel encolhe ate caber entre a barra e a margem direita (563pt)
  let tam = 8;
  while (tam > 6 && 287 + larguraMm(dig, tam, false) * MM > 563) tam -= 0.25;
  p.pt(287, yTopo - 0.9, tam, dig);
}

/** RECIBO DO PAGADOR — a via que o cliente guarda. Sem codigo de barras, como no original. */
function viaRecibo(p: Pagina, t: Titulo, banco: string, codBanco: string) {
  p.pt(467.6, 812.4, 8, "RECIBO DO PAGADOR", true);
  cabecalhoVia(p, t, 800.5, banco, codBanco);
  p.hPt(36, 562, 794);

  // faixa 1: beneficiario / CNPJ / sacador avalista / vencimento
  p.pt(39, 785.6, 6, "Beneficiário");
  p.pt(299, 785.6, 6, "CNPJ/CPF");
  p.pt(401, 785.6, 6, "Sacador Avalista");
  p.pt(490, 786.5, 6, "Vencimento");
  p.pt(39, 773.6, 8, corta(t.cedente || "", 46));
  p.pt(299, 773.6, 8, doc(t.cedente_cnpj || ""));
  p.ptDir(560, 774.6, 8, dataBr(t.dtvenc), true);
  p.vPt(400, 771, 793); p.vPt(490, 771, 793);
  p.hPt(36, 562, 770);

  // faixa 2: endereco do beneficiario
  p.pt(39, 762.6, 6, "Endereço Beneficiário/Sacador Avalista");
  p.pt(39, 750.6, 8, corta(t.cedente_endereco || "", 92));
  p.hPt(37, 563, 746);

  // faixa 3: nosso numero / carteira / especie / quantidade / valor / agencia-codigo
  p.pt(39, 738.5, 6, "Nosso Número");
  p.pt(146, 737.6, 6, "Carteira");
  p.pt(201, 737.6, 6, "Espécie");
  p.pt(245, 736.6, 6, "Quantidade");
  p.pt(339, 737.6, 6, "Valor");
  p.pt(435, 738.5, 6, "Agência/Código Beneficiário");
  p.pt(78, 727.6, 8, nossoNumero(t));
  p.pt(163, 727.6, 8, String(t.carteira || ""));
  p.pt(213, 726.6, 8, "DM");
  p.pt(510, 725.6, 8, agenciaConta(t));
  faixa(p, 723, 23, 37, 563, [144, 196, 242, 334, 432]);

  // faixa 4: datas, numero do documento, aceite, valor
  p.pt(37, 713.6, 6, "Data do Documento");
  p.pt(145, 714.6, 6, "Número do Documento");
  p.pt(243, 714.6, 6, "Espécie Doc.");
  p.pt(338, 714.6, 6, "Aceite");
  p.pt(370, 714.6, 6, "Data Processamento");
  p.pt(466, 713.6, 6, "Valor do Documento");
  p.pt(37, 703.6, 8, dataBr(t.dtneg || t.dtvenc));
  p.pt(147, 704.6, 8, numeroDocumento(t));
  p.pt(344, 704.6, 8, "N");
  p.pt(368, 702.6, 8, dataBr(hoje()));
  p.ptDir(560, 702.6, 8, brl(Number(t.valor)), true);
  faixa(p, 700, 22, 37, 563, [144, 242, 334, 364, 460]);

  // autenticacao mecanica
  p.vPt(378, 677, 693); p.hPt(378, 565, 692);
  p.pt(448, 682.6, 6, "Autenticação Mecânica");
  p.hPt(36, 562, 618);
}

/** FICHA DE COMPENSACAO — a via do banco, com codigo de barras e PIX. */
function viaCompensacao(p: Pagina, t: Titulo, banco: string, codBanco: string, qr: boolean[][] | null) {
  cabecalhoVia(p, t, 481.5, banco, codBanco);
  p.hPt(34, 563, 476);

  p.pt(38, 465.6, 6, "Local do Pagamento");
  p.pt(38, 451.7, 8, "EM QUALQUER BANCO OU CORRESP. NÃO BANCÁRIO MESMO APÓS O VENCIMENTO");
  p.pt(466, 467.5, 6, "Vencimento");
  p.ptDir(560, 452.6, 8, dataBr(t.dtvenc), true);
  p.vPt(464, 264, 476);
  p.hPt(34, 563, 434);

  p.pt(38, 425.6, 6, "Beneficiário");
  p.pt(343, 426.6, 6, "CNPJ/CPF");
  p.pt(467, 428.5, 6, "Agência/Código");
  p.pt(38, 414.6, 8, corta(t.cedente || "", 52));
  p.pt(343, 414.6, 8, doc(t.cedente_cnpj || ""));
  p.pt(498, 415.6, 8, agenciaConta(t));
  p.hPt(33, 562, 410);

  p.pt(36, 401.6, 6, "Data do Documento");
  p.pt(142, 401.6, 6, "Número do Documento");
  p.pt(252, 400.6, 6, "Esp.Doc.");
  p.pt(345, 400.6, 6, "Aceite");
  p.pt(377, 400.6, 6, "Data Processamento");
  p.pt(467, 402.5, 6, "Nosso Número");
  p.pt(36, 391.6, 8, dataBr(t.dtneg || t.dtvenc));
  p.pt(144, 391.6, 8, numeroDocumento(t));
  p.pt(287, 391.6, 8, "DM");
  p.pt(354, 391.6, 8, "N");
  p.pt(378, 391.6, 8, dataBr(hoje()));
  p.pt(498, 390.6, 8, nossoNumero(t));
  faixa(p, 386, 24, 33, 562, [136, 252, 342, 372]);

  p.pt(36, 376.6, 6, "Uso do Banco");
  p.pt(143, 376.6, 6, "Carteira");
  p.pt(200, 376.6, 6, "Espécie");
  p.pt(256, 377.6, 6, "Quantidade");
  p.pt(378, 377.6, 6, "Valor");
  p.pt(467, 379.5, 6, "(=) Valor do Documento");
  p.pt(158, 365.6, 8, String(t.carteira || ""));
  p.pt(221, 365.6, 8, "R$");
  p.ptDir(560, 366.6, 8, brl(Number(t.valor)), true);
  faixa(p, 360, 26, 33, 562, [136, 198, 252, 372]);

  // instrucoes + a coluna de abatimento/mora/acrescimos
  p.pt(38, 349.6, 6, "Instruções de responsabilidade do BENEFICIÁRIO. Qualquer dúvida sobre este boleto, responda a mensagem que o trouxe.");
  p.pt(467, 354.5, 6, "(-) Desconto/Abatimento");
  p.hPt(465, 563, 336);
  p.pt(467, 329.5, 6, "(+) Mora/Multa");
  p.hPt(465, 563, 316);
  p.pt(467, 307.5, 6, "(+) Outros Acréscimos");
  p.hPt(465, 563, 290);
  p.pt(467, 281.5, 6, "(=) Valor Cobrado");
  p.pt(38, 289.6, 8, "COBRANÇA ESCRITURAL");
  p.hPt(33, 562, 264);

  // pagador
  p.pt(36, 258.4, 6, `Pagador  ${corta(t.sacado || "", 58)}   ${doc(t.sacado_cnpj || "")}`);
  if (t.sacado_endereco) p.pt(36, 251.4, 6, corta(t.sacado_endereco, 92));
  p.pt(36, 237.5, 6, "Sacador/Avalista");

  /* ---- a area do PIX ------------------------------------------------------------
     A caixa e sempre desenhada, como no original. O QR so aparece quando o ERP tem o
     payload em TGFFIN.AD_PIXQRCODE — que hoje e o caso em 104 dos 1.355 titulos. Sem
     payload a caixa fica VAZIA, por decisao da gestao: um QR inventado manda o dinheiro
     para a conta errada, e um QR "de exemplo" e pior ainda porque parece valido. */
  p.hPt(33, 563, 233); p.hPt(33, 563, 126);
  p.vPt(33, 126, 233); p.vPt(563, 126, 233);
  if (qr) {
    p.pt(43, 219.6, 8, "PIX Copia e Cola", true);
    const pix = String(t.pix || "");
    // o payload em duas linhas, como no original — o cliente copia daqui quando o QR falha
    p.pt(41, 199.6, 7, pix.slice(0, 88));
    p.pt(41, 190.3, 7, pix.slice(88, 176));
    if (pix.length > 176) p.pt(41, 181.0, 7, pix.slice(176));
    p.qrPt(460, 132, 95, qr);
  }

  // codigo de barras: 523x36pt em x=36 y=61, o mesmo lugar do original
  p.barrasPt(36, 61, String(t.codigo_barras || "").replace(/\D/g, ""), 523, 36);
  p.pt(365.9, 110.6, 8, "Autenticação Mecânica / FICHA DE COMPENSAÇÃO");
}

const hoje = () => new Date().toISOString().slice(0, 10);
/** "109/00044258-6" — carteira, nosso numero e o DV que o ERP ja calculou. */
function nossoNumero(t: Titulo): string {
  const nn = String(t.nossonum || "").replace(/\D/g, "");
  if (!nn) return "—";
  // o formato do Itau: 3 da carteira + 8 do nosso numero + 1 de DV
  if (nn.length >= 12) return `${nn.slice(0, 3)}/${nn.slice(3, 11)}-${nn.slice(11)}`;
  return String(t.nossonum || "");
}
const agenciaConta = (t: Titulo) => [t.agencia, t.conta].filter(Boolean).join("/") || "—";
const numeroDocumento = (t: Titulo) => t.numnota
  ? `${t.numnota}${t.parcela ? " - " + String(t.parcela).replace(/^0+/, "") : ""}`
  : String(t.nufin);

/** O DV do codigo do banco vive no 4o digito do codigo de barras — nao e calculado aqui. */
function dvBanco(t: Titulo): string {
  const b = String(t.codigo_barras || "").replace(/\D/g, "");
  return b.length === 44 ? b[3] : "";
}

/* ----------------------------------------------------------------------- montar PDF */

function objeto(n: number, corpo: string) { return `${n} 0 obj\n${corpo}\nendobj\n`; }

export function gerarBoletoPdf(t: Titulo): Uint8Array {
  const erro = exigirBoleto(t);
  if (erro) throw new Error("boleto nao emitido: " + erro);

  const p = new Pagina();
  const banco = String(t.banco || "").trim() || `Banco ${t.codbco ?? ""}`.trim();
  const codBanco = String(t.codbco ?? "").replace(/\D/g, "");

  /* O QR so existe se o ERP tiver o payload. Sem ele a area do PIX fica vazia — decisao
     da gestao, e a unica defensavel: um QR inventado manda dinheiro para a conta errada.
     Se o payload vier corrompido, o boleto sai SEM o PIX em vez de nao sair: o codigo de
     barras continua valendo, e um boleto sem PIX ainda se paga. */
  let qr: boolean[][] | null = null;
  const pix = String(t.pix || "").trim();
  if (pix.length > 20) {
    try { qr = qrMatriz(pix); } catch { qr = null; }
  }

  viaRecibo(p, t, banco, codBanco);
  p.tracejadoPt(33, 500, 530);
  viaCompensacao(p, t, banco, codBanco, qr);

  const conteudo = p.ops.join("\n");
  const bytesConteudo = latin1(conteudo);

  const objs: string[] = [
    objeto(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    objeto(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    objeto(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
        `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    ),
    objeto(4, `<< /Length ${bytesConteudo.length} >>\nstream\n${conteudo}\nendstream`),
    objeto(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    objeto(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
  ];

  // xref exige o offset EM BYTES de cada objeto. Como o conteudo e latin1, contar
  // caracteres daria o numero errado em qualquer acento — dai o latin1() por pedaco.
  let corpo: number[] = latin1("%PDF-1.4\n");
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(corpo.length);
    corpo = corpo.concat(latin1(o));
  }
  const inicioXref = corpo.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  corpo = corpo.concat(latin1(xref));

  return new Uint8Array(corpo);
}
