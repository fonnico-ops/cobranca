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

  /** Texto alinhado a direita de xMm. Largura estimada por metrica media da Helvetica. */
  textoDir(xMm: number, yMm: number, tamanho: number, s: string, negrito = false) {
    const larguraPt = String(s ?? "").length * tamanho * (negrito ? 0.56 : 0.5);
    this.texto(xMm - larguraPt / MM, yMm, tamanho, s, negrito);
  }

  retangulo(xMm: number, yMm: number, wMm: number, hMm: number) {
    this.ops.push(
      `${(xMm * MM).toFixed(2)} ${(this.py(yMm + hMm)).toFixed(2)} ${(wMm * MM).toFixed(2)} ${(hMm * MM).toFixed(2)} re f`,
    );
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

/* ------------------------------------------------------------------------- desenho */

function desenhaFicha(p: Pagina, t: Titulo, topo: number, viaRecibo: boolean) {
  const X = 15;            // margem esquerda, mm
  const W = 180;           // largura util
  const COL = X + W - 42;  // coluna da direita (valores)
  const banco = String(t.banco || "").trim() || `Banco ${t.codbco ?? ""}`.trim();
  const codBanco = String(t.codbco ?? "").replace(/\D/g, "");
  let y = topo;

  // --- cabecalho: banco, codigo, linha digitavel
  p.texto(X, y, 13, corta(banco, 34), true);
  p.texto(X + 62, y, 13, codBanco ? `${codBanco}-${dvBanco(t)}` : "", true);
  p.textoDir(X + W, y, 11, String(t.linha_digitavel || "").replace(/\s+/g, " ").trim(), true);
  y += 6;
  p.linhaH(X, y, W, 0.5);
  y += 0.5;

  p.texto(X + 0.8, y + 0.4, 5, viaRecibo ? "Recibo do Sacado" : "Ficha de Compensacao");
  p.textoDir(X + W - 0.8, y + 0.4, 5, `Titulo ${t.nufin}${t.numnota ? ` · NF ${t.numnota}` : ""}`);
  y += 4;

  // --- linha 1: cedente / agencia-codigo
  const h = 8;
  p.linhaH(X, y, W);
  p.campo(X, y, "Cedente", corta(t.cedente || "", 58));
  p.linhaV(COL, y, h);
  p.campo(COL, y, "Agencia/Codigo cedente", [t.agencia, t.conta].filter(Boolean).join(" / "));
  y += h;

  // --- linha 2: vencimento / valor
  p.linhaH(X, y, W);
  p.campo(X, y, "Data do documento", dataBr(t.dtvenc));
  p.linhaV(X + 45, y, h);
  p.campo(X + 45, y, "Nosso numero", String(t.nossonum || "—"));
  p.linhaV(X + 95, y, h);
  p.campo(X + 95, y, "Carteira", String(t.carteira || "—"));
  p.linhaV(COL, y, h);
  p.texto(COL + 0.8, y + 0.4, 5, "Vencimento");
  p.textoDir(X + W - 0.8, y + 3.4, 9, dataBr(t.dtvenc), true);
  y += h;

  // --- linha 3: valor do documento
  p.linhaH(X, y, W);
  p.campo(X, y, "Especie", "R$");
  p.linhaV(X + 45, y, h);
  p.campo(X + 45, y, "Aceite", "N");
  p.linhaV(X + 95, y, h);
  p.campo(X + 95, y, "Documento", String(t.numnota || t.nufin));
  p.linhaV(COL, y, h);
  p.texto(COL + 0.8, y + 0.4, 5, "(=) Valor do documento");
  p.textoDir(X + W - 0.8, y + 3.4, 10, brl(Number(t.valor)), true);
  y += h;

  // --- instrucoes
  const hi = 20;
  p.linhaH(X, y, W);
  p.texto(X + 0.8, y + 0.4, 5, "Instrucoes (texto de responsabilidade do cedente)");
  p.texto(X + 0.8, y + 4.6, 7.5, "Pagavel em qualquer banco ou aplicativo, pelo codigo de barras ou pela linha digitavel.");
  p.texto(X + 0.8, y + 8.2, 7.5, "Apos o vencimento, consulte o valor atualizado antes de pagar.");
  p.texto(X + 0.8, y + 11.8, 7.5, "Duvidas sobre este titulo: responda a mensagem que trouxe este boleto.");
  p.texto(X + 0.8, y + 16.4, 6.5, "Segunda via emitida automaticamente a partir do registro do titulo no ERP. Nenhum digito foi recalculado.");
  p.linhaV(COL, y, hi);
  y += hi;

  // --- sacado
  const hs = 11;
  p.linhaH(X, y, W);
  p.texto(X + 0.8, y + 0.4, 5, "Sacado");
  p.texto(X + 0.8, y + 4.0, 8, corta(t.sacado || "", 70));
  if (t.sacado_cnpj) p.texto(X + 0.8, y + 7.8, 7, "CNPJ/CPF " + doc(t.sacado_cnpj));
  y += hs;
  p.linhaH(X, y, W, 0.5);
  y += 3;

  if (!viaRecibo) {
    // --- codigo de barras: so na ficha de compensacao, como manda a especificacao
    p.barras(X, y, String(t.codigo_barras || "").replace(/\D/g, ""));
    y += 13 + 3;
    p.texto(X, y, 6, String(t.codigo_barras || "").replace(/\D/g, ""));
    y += 4;
  }
  return y;
}

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
  let y = 18;
  y = desenhaFicha(p, t, y, true);   // recibo do sacado
  y += 6;
  p.tracejado(15, y - 3, 180);
  desenhaFicha(p, t, y + 2, false);  // ficha de compensacao, com o codigo de barras

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
