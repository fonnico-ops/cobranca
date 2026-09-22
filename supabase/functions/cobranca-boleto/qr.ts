// qr.ts — codificador de QR Code, sem dependencia nenhuma.
//
// POR QUE ESCREVER ISTO EM VEZ DE USAR UMA BIBLIOTECA
//   O que vai dentro deste QR e o payload PIX do titulo: quem recebe, quanto, e a chave.
//   Uma biblioteca de QR e codigo de terceiro rodando sobre a chave de recebimento da
//   empresa, e uma Edge Function nao tem como fixar a versao de um CDN de forma confiavel
//   ao longo do tempo. Sao ~200 linhas de norma publica (ISO/IEC 18004); o resto do projeto
//   ja segue essa regra (o gerador de PDF e o de codigo de barras tambem nao tem dependencia).
//
// O QUE ELE FAZ E NAO FAZ
//   Modo BYTE, nivel de correcao M (15%), versoes 1 a 20 — cobre com folga os 180 bytes do
//   payload PIX da Nitron. NAO gera o payload: quem o produz e o banco, e ele chega pronto
//   em TGFFIN.AD_PIXQRCODE. Este arquivo so o transforma em modulos pretos e brancos.
//
// A norma em quatro passos: dados -> blocos com Reed-Solomon -> matriz -> mascara.

/* ------------------------------------------------------------------ Galois GF(256) */
// A aritmetica do Reed-Solomon vive em GF(256) com o polinomio 0x11D, como manda a norma.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/** O polinomio gerador de grau `grau`, que e (x-a^0)(x-a^1)...(x-a^(grau-1)). */
function gerador(grau: number): Uint8Array {
  let p = new Uint8Array([1]);
  for (let i = 0; i < grau; i++) {
    const novo = new Uint8Array(p.length + 1);
    for (let k = 0; k < p.length; k++) {
      novo[k] ^= p[k];
      novo[k + 1] ^= mul(p[k], EXP[i]);
    }
    p = novo;
  }
  return p;
}

/** Os `n` bytes de correcao de erro de um bloco de dados. */
export function reedSolomon(dados: Uint8Array, n: number): Uint8Array {
  const g = gerador(n);
  const resto = new Uint8Array(n);
  for (const b of dados) {
    const fator = b ^ resto[0];
    resto.copyWithin(0, 1);
    resto[n - 1] = 0;
    if (fator !== 0) for (let i = 0; i < n; i++) resto[i] ^= mul(g[i + 1], fator);
  }
  return resto;
}

/* ------------------------------------------------------- tabelas da norma, nivel M
   Por versao (1..20): [total de bytes, bytes de ECC por bloco, blocos do grupo 1,
   blocos do grupo 2]. No grupo 2 cada bloco tem um byte de dados a mais. */
const TAB_M: Record<number, [number, number, number, number]> = {
  1: [26, 10, 1, 0],    2: [44, 16, 1, 0],    3: [70, 26, 1, 0],    4: [100, 18, 2, 0],
  5: [134, 24, 2, 0],   6: [172, 16, 4, 0],   7: [196, 18, 4, 0],   8: [242, 22, 2, 2],
  9: [292, 22, 3, 2],   10: [346, 26, 4, 1],  11: [404, 30, 1, 4],  12: [466, 22, 6, 2],
  13: [532, 22, 8, 1],  14: [581, 24, 4, 5],  15: [655, 24, 5, 5],  16: [733, 28, 7, 3],
  17: [815, 28, 10, 1], 18: [901, 26, 9, 4],  19: [991, 26, 3, 11], 20: [1085, 26, 3, 13],
};
/** Coordenadas centrais dos padroes de alinhamento, por versao. */
const ALINHA: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54],
  12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
  16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

const capacidadeDados = (v: number) => {
  const [tot, ecc, g1, g2] = TAB_M[v];
  return tot - ecc * (g1 + g2);
};

/** A menor versao que cabe o payload. O QR menor possivel imprime com modulo maior. */
export function menorVersao(bytes: number): number {
  for (let v = 1; v <= 20; v++) {
    // cabecalho: 4 bits de modo + 8 ou 16 bits de tamanho
    const bitsTam = v <= 9 ? 8 : 16;
    if (capacidadeDados(v) * 8 >= 4 + bitsTam + bytes * 8) return v;
  }
  throw new Error(`payload de ${bytes} bytes nao cabe num QR versao 20 nivel M`);
}

/* ------------------------------------------------------------------ bits e blocos */
class Bits {
  b: number[] = [];
  push(valor: number, n: number) { for (let i = n - 1; i >= 0; i--) this.b.push((valor >> i) & 1); }
  get bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.b.length / 8));
    this.b.forEach((bit, i) => { if (bit) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

function codificar(texto: string, v: number): Uint8Array {
  const dados = new TextEncoder().encode(texto);
  const cap = capacidadeDados(v);
  const bits = new Bits();
  bits.push(0b0100, 4);                       // modo BYTE
  bits.push(dados.length, v <= 9 ? 8 : 16);
  for (const b of dados) bits.push(b, 8);
  // terminador de ate 4 bits, depois completa o byte
  for (let i = 0; i < 4 && bits.b.length < cap * 8; i++) bits.b.push(0);
  while (bits.b.length % 8) bits.b.push(0);
  const buf = Array.from(bits.bytes);
  // enchimento alternado 0xEC/0x11, como manda a norma
  for (let i = 0; buf.length < cap; i++) buf.push(i % 2 === 0 ? 0xec : 0x11);
  const dadosFinais = new Uint8Array(buf);

  /* ---- divide em blocos, cada um com o seu ECC, e INTERCALA ----------------------
     A intercalacao e o que faz um arranhao no papel atingir um byte de cada bloco em
     vez de destruir um bloco inteiro — e por isso que o QR sobrevive a um borrao. */
  const [, nEcc, g1, g2] = TAB_M[v];
  const tamG1 = Math.floor(cap / (g1 + g2));
  const blocos: Uint8Array[] = [];
  const eccs: Uint8Array[] = [];
  let p = 0;
  for (let i = 0; i < g1 + g2; i++) {
    const tam = i < g1 ? tamG1 : tamG1 + 1;
    const bl = dadosFinais.slice(p, p + tam);
    p += tam;
    blocos.push(bl);
    eccs.push(reedSolomon(bl, nEcc));
  }
  const saida: number[] = [];
  const maxD = Math.max(...blocos.map((b) => b.length));
  for (let i = 0; i < maxD; i++) for (const b of blocos) if (i < b.length) saida.push(b[i]);
  for (let i = 0; i < nEcc; i++) for (const e of eccs) saida.push(e[i]);
  return new Uint8Array(saida);
}

/* --------------------------------------------------------------------- a matriz */
type M = (0 | 1 | null)[][];

function moldura(v: number): { m: M; reservado: boolean[][] } {
  const n = v * 4 + 17;
  const m: M = Array.from({ length: n }, () => Array(n).fill(null));
  const res = Array.from({ length: n }, () => Array(n).fill(false));
  const por = (x: number, y: number, val: 0 | 1) => { m[y][x] = val; res[y][x] = true; };

  // tres olhos + separador
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]] as [number, number][]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx, y = oy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const borda = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const miolo = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      const dentro = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      por(x, y, (dentro && (borda || miolo)) ? 1 : 0);
    }
  }
  // padroes de alinhamento (nao por cima dos olhos)
  const cs = ALINHA[v];
  for (const cy of cs) for (const cx of cs) {
    if ((cx <= 8 && cy <= 8) || (cx >= n - 9 && cy <= 8) || (cx <= 8 && cy >= n - 9)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const anel = Math.max(Math.abs(dx), Math.abs(dy));
      por(cx + dx, cy + dy, anel === 1 ? 0 : 1);
    }
  }
  // temporizadores
  for (let i = 8; i < n - 8; i++) { por(i, 6, i % 2 === 0 ? 1 : 0); por(6, i, i % 2 === 0 ? 1 : 0); }
  por(8, n - 8, 1);  // modulo escuro, sempre

  // area da informacao de formato (preenchida depois)
  for (let i = 0; i < 9; i++) { if (!res[i][8]) res[i][8] = true; if (!res[8][i]) res[8][i] = true; }
  for (let i = 0; i < 8; i++) { res[n - 1 - i][8] = true; res[8][n - 1 - i] = true; }
  // versao >= 7 tem bloco proprio de versao
  if (v >= 7) {
    for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) { res[i][n - 11 + k] = true; res[n - 11 + k][i] = true; }
  }
  return { m, reservado: res };
}

/** Zig-zag de baixo para cima, duas colunas por vez, pulando a coluna 6 (temporizador). */
function preencher(m: M, res: boolean[][], dados: Uint8Array) {
  const n = m.length;
  let bit = 0, subindo = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const y = subindo ? n - 1 - i : i;
      for (const x of [col, col - 1]) {
        if (res[y][x]) continue;
        const b = bit < dados.length * 8 ? (dados[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
        m[y][x] = b as 0 | 1;
        bit++;
      }
    }
    subindo = !subindo;
  }
}

const MASCARAS = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_x: number, y: number) => y % 2 === 0,
  (x: number, _y: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Penalidade da norma. Menor e melhor: e o que escolhe a mascara. */
function penalidade(m: M): number {
  const n = m.length;
  let p = 0;
  const linhas: number[][] = [];
  for (let y = 0; y < n; y++) linhas.push(m[y].map((v) => v ?? 0));
  const cols: number[][] = [];
  for (let x = 0; x < n; x++) cols.push(linhas.map((l) => l[x]));

  // 1: cinco ou mais iguais em sequencia
  for (const grupo of [linhas, cols]) for (const l of grupo) {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (l[i] === l[i - 1]) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) p += 3 + (run - 5);
  }
  // 2: blocos 2x2 da mesma cor
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = linhas[y][x];
    if (a === linhas[y][x + 1] && a === linhas[y + 1][x] && a === linhas[y + 1][x + 1]) p += 3;
  }
  // 3: o padrao 1011101 com quatro claros de um lado — o que imita um olho
  const alvo = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const alvo2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (const grupo of [linhas, cols]) for (const l of grupo) {
    for (let i = 0; i + 11 <= n; i++) {
      const j = l.slice(i, i + 11);
      if (alvo.every((v, k) => v === j[k]) || alvo2.every((v, k) => v === j[k])) p += 40;
    }
  }
  // 4: desequilibrio entre claro e escuro
  const escuros = linhas.flat().reduce((a, b) => a + b, 0);
  p += Math.floor(Math.abs((escuros * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** 15 bits de formato: nivel M + mascara, com BCH e o XOR da norma. */
function bitsFormato(mascara: number): number {
  let v = (0b00 << 3) | mascara;   // 00 = nivel M
  let d = v << 10;
  for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= 0b10100110111 << i;
  return ((v << 10) | d) ^ 0b101010000010010;
}

/** 18 bits de versao (so para versao >= 7), com o BCH da norma. */
function bitsVersao(v: number): number {
  let d = v << 12;
  for (let i = 5; i >= 0; i--) if ((d >> (i + 12)) & 1) d ^= 0b1111100100101 << i;
  return (v << 12) | d;
}

/**
 * Devolve a matriz do QR: `true` = modulo escuro.
 * A borda silenciosa (quiet zone) NAO vem aqui — quem desenha e que deixa a margem.
 */
export function qrMatriz(texto: string): boolean[][] {
  const v = menorVersao(new TextEncoder().encode(texto).length);
  const dados = codificar(texto, v);
  const n = v * 4 + 17;

  let melhor: M | null = null, melhorP = Infinity, melhorMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const { m, reservado } = moldura(v);
    preencher(m, reservado, dados);
    const f = MASCARAS[mask];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      // a mascara so vale na area de dados; olhos, temporizador e formato ficam de fora
      if (!reservado[y][x] && f(x, y)) m[y][x] = (m[y][x] ? 0 : 1) as 0 | 1;
    }
    const fmt = bitsFormato(mask);
    for (let i = 0; i < 15; i++) {
      const b = ((fmt >> i) & 1) as 0 | 1;
      // copia 1, ao redor do olho superior esquerdo
      if (i < 6) m[i][8] = b;
      else if (i === 6) m[7][8] = b;
      else if (i === 7) m[8][8] = b;
      else if (i === 8) m[8][7] = b;
      else m[8][14 - i] = b;
      // copia 2, dividida entre os outros dois olhos
      if (i < 8) m[8][n - 1 - i] = b;
      else m[n - 15 + i][8] = b;
    }
    if (v >= 7) {
      const bv = bitsVersao(v);
      for (let i = 0; i < 18; i++) {
        const b = ((bv >> i) & 1) as 0 | 1;
        m[Math.floor(i / 3)][n - 11 + (i % 3)] = b;
        m[n - 11 + (i % 3)][Math.floor(i / 3)] = b;
      }
    }
    const p = penalidade(m);
    if (p < melhorP) { melhorP = p; melhor = m; melhorMask = mask; }
  }
  return (melhor as M).map((l) => l.map((c) => c === 1));
}
