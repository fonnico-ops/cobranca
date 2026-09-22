// O nome da empresa no corpo vem da config. Antes o texto dizia "Nitronplast" e a assinatura
// "Nitron" — duas marcas na mesma mensagem. A razao social do rodape e outra coisa.
import { textoVencido, textoAVencer, TETO_WPP, MARCA_BOLETOS, MARCA_RODAPE } from "./montar_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };
const wpp = (t) => t.replace("\n" + MARCA_BOLETOS, "").replace(MARCA_RODAPE, "");

const ASSIN = { linha: "Nina — Financeiro Nitron", razao_social: "NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA",
  cnpj: "54.886.460/0001-98", telefone: "(11) 96456-0761", email: "cobranca@nitron.com.br" };
const base = { nome: "Ana", titulos: [{ codparc: 1, valor: 500, dtvenc: "2026-08-10", numnota: 9 }],
  total: 500, maiorAtraso: 43, comBoleto: 1, semBoleto: 0, semGeravel: 0, semNoBanco: 0,
  multi: false, nomes: {}, remetente: "Nina", assinatura: ASSIN, empresa: "Nitron", teto: TETO_WPP };

console.log("1) a marca no corpo");
let t = wpp(textoVencido(base));
ok(t.includes("aqui na Nitron."), "vencido: 'aqui na Nitron.'");
ok(!/aqui na Nitronplast/.test(t), "não sobrou 'Nitronplast' no corpo");
t = wpp(textoVencido({ ...base, maiorAtraso: 4 }));
ok(t.includes("há poucos dias aqui na Nitron."), "recém-vencido também");
t = wpp(textoAVencer(base));
ok(t.includes("aqui na Nitron —"), "a vencer também");

console.log("2) a razão social do rodapé NÃO muda junto");
t = wpp(textoVencido(base));
ok(t.includes("NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA"), "o nome jurídico continua completo");
ok(t.includes("Nina — Financeiro Nitron"), "e a assinatura segue a marca");

console.log("3) a marca é configurável, não presa no código");
t = wpp(textoVencido({ ...base, empresa: "Teak Brazil" }));
ok(t.includes("aqui na Teak Brazil."), "outra empresa sai no corpo");
ok(!/Nitron\./.test(t), "sem vazamento da marca anterior");

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
