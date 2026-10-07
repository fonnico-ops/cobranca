// A PORTA NO NUMERO DE DESTINO.
//
// Por que esta suite existe: numero sem WhatsApp e tentativa morta, e tentativa morta
// acumulada e o que faz a Meta restringir quem manda. A casa ja perdeu um numero assim —
// "Campanhas Nitron", RESTRINGIDA em 27/08, sem previsao de volta. A regra que barra fixo e
// cadastro furado e, na pratica, a trava que protege o numero da Karla e o da Bianca.
//
// A regra vive em TRES lugares (cada Edge Function e um deploy independente, nao da para
// importar entre elas): na colheita do Sankhya (`celularBom`, cobranca-refresh), na porta do
// envio (`forma`, cobranca-aprovar) e no validador (`forma`, cobranca-fones). Se as tres
// divergirem, um numero que a colheita aceita pode ser barrado so na hora do envio — ou, pior,
// o contrario. Esta suite compara as tres com os mesmos casos.
import { forma as formaAprovar } from "./aprovar_puro.mjs";
import { forma as formaFones, doAtor } from "./fones_puro.mjs";
import { celularBom } from "./refresh_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

// [entrada, estado esperado, por que importa]
const CASOS = [
  ["11999887766", "OK",   "celular de 11 digitos, 3o digito 9"],
  ["5511999887766", "OK", "com o 55 na frente, como vem do CRM"],
  ["+55 (11) 99988-7766", "OK", "com mascara, como vem do Sankhya"],
  ["011999887766", "OK",  "com o zero da operadora na frente"],
  ["1124132256", "FIXO",  "fixo de 10 digitos — e o numero da propria Karla: nao e destino"],
  ["1131234567", "FIXO",  "fixo de Sao Paulo no campo celular do cadastro"],
  ["11312345678", "FIXO", "11 digitos mas 3o digito 3: fixo com um digito sobrando"],
  ["11999999999", "LIXO", "digito repetido — cadastro preenchido para passar validacao de tela"],
  ["999887766", "LIXO",   "9 digitos: faltou o DDD"],
  ["20999887766", "LIXO", "DDD 20 nao existe no Brasil"],
  ["", "LIXO",            "campo vazio"],
  ["abc", "LIXO",         "texto no campo de telefone"],
];

console.log("1) a regra de forma, caso por caso");
for (const [entrada, esperado, porque] of CASOS) {
  const r = formaAprovar(entrada);
  ok(r.estado === esperado, `${esperado.padEnd(4)} ${JSON.stringify(entrada).padEnd(24)} ${porque}${r.estado === esperado ? "" : ` (veio ${r.estado})`}`);
}

console.log("2) o numero barrado sempre vem com motivo escrito");
for (const [entrada, esperado] of CASOS) {
  if (esperado === "OK") continue;
  const r = formaAprovar(entrada);
  ok(!!r.motivo && r.motivo.length > 10, `${JSON.stringify(entrada)} explica por que foi barrado: ${r.motivo || "(sem motivo)"}`);
}

console.log("3) as tres copias da regra concordam");
for (const [entrada, esperado] of CASOS) {
  const a = formaAprovar(entrada), f = formaFones(entrada);
  ok(a.estado === f.estado && a.e164 === f.e164, `aprovar e fones iguais em ${JSON.stringify(entrada)}`);
  // a colheita do refresh devolve o numero ou null: null tem de bater com "nao e OK"
  const colhido = celularBom(entrada);
  ok((colhido === null) === (esperado !== "OK"), `a colheita do refresh concorda em ${JSON.stringify(entrada)} (${colhido === null ? "recusou" : "aceitou"})`);
}

console.log("4) o numero devolvido ao validador esta em E.164 sem o +");
ok(formaAprovar("(11) 99988-7766").e164 === "5511999887766", "mascara virou 5511999887766");
ok(formaAprovar("5511999887766").e164 === "5511999887766", "com 55 na entrada nao duplica o 55");

console.log("5) a resposta do ator Apify, traduzida");
ok(doAtor(true).estado === "VALIDO", "exists:true -> VALIDO");
ok(doAtor(false).estado === "INVALIDO", "exists:false -> INVALIDO (nao recebe WhatsApp)");
ok(doAtor(undefined).estado === "ARRISCADO", "sem resposta -> ARRISCADO, e ninguem e condenado");
ok(doAtor(null).estado === "ARRISCADO", "null -> ARRISCADO");
ok(!!doAtor(false).motivo, "o INVALIDO vem com motivo para a tela mostrar");

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
