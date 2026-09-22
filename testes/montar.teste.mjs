import { linhasTitulos, primeiroNome, nomeGentil, textoVencido, TETO_WPP, TETO_EMAIL } from "./montar_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };

console.log("1) saudacao (o defeito 'Ola, 001!')");
ok(primeiroNome("001 - INTERLAGOS - SP") === "", "recusa '001 - INTERLAGOS - SP'");
ok(primeiroNome("3M do Brasil") === "", "recusa '3M do Brasil'");
ok(primeiroNome("LOJA CENTRAL") === "", "recusa 'LOJA CENTRAL' (palavra de razao social)");
ok(primeiroNome("Comercio de Tintas") === "", "recusa 'Comercio de Tintas'");
ok(primeiroNome("Ana Paula Ribeiro") === "Ana", "aceita 'Ana Paula Ribeiro'");
ok(primeiroNome("João") === "João", "aceita acento");
ok(primeiroNome("  Marcos  Silva ") === "Marcos", "ignora espaco sobrando");
ok(primeiroNome("Ed") === "", "recusa nome de 2 letras (provavel sigla)");
ok(primeiroNome("") === "" && primeiroNome(null) === "", "aceita vazio/nulo");
// producao 22/09, grupo 65542: o card abriu com "Ola, lorrany!" porque o contato esta
// em minuscula no TGFCTT. Caixa mista o cadastro escreveu de proposito e nao se mexe.
ok(primeiroNome("lorrany silva") === "Lorrany", "conserta minuscula do cadastro");
ok(primeiroNome("JOSE CARLOS") === "Jose", "conserta MAIUSCULA do cadastro");
ok(primeiroNome("MÁRCIA") === "Márcia", "conserta maiuscula com acento");
ok(primeiroNome("McCarthy") === "McCarthy", "nao mexe em caixa mista (McCarthy)");
ok(primeiroNome("d'Avila Neto") === "d'Avila", "nao mexe em d'Avila");

console.log("2) teto da lista");
const mk = (n, lojas) => Array.from({length:n}, (_,i)=>({
  codparc: 1000 + (i % lojas), valor: 100 + i, dtvenc: `2026-0${1+(i%9)}-10`, numnota: 5000+i }));
const nomes = Object.fromEntries(Array.from({length:60},(_,i)=>[String(1000+i), `0${i} - LOJA ${i} LTDA`]));

const curto = linhasTitulos(mk(5,1), false, nomes, TETO_WPP);
ok(curto.split("\n").length === 5, "5 titulos => 5 linhas, sem resumo");
ok(!/e mais/.test(curto), "nao inventa 'e mais' quando cabe");

const rede = linhasTitulos(mk(352, 50), true, nomes, TETO_WPP);
const linhasRede = rede.split("\n");
ok(linhasRede.length === TETO_WPP + 1, `352 titulos / 50 lojas => ${TETO_WPP} lojas + 1 resumo (deu ${linhasRede.length})`);
ok(/e mais 38 lojas/.test(rede), "diz quantas lojas ficaram de fora");
// o total tem que continuar fechando
const totalReal = mk(352,50).reduce((a,t)=>a+t.valor,0);
const somaMostrada = [...rede.matchAll(/R\$ ([\d.]+,\d{2})/g)]
  .map(m=>Number(m[1].replace(/\./g,"").replace(",",".")))
  .reduce((a,b)=>a+b,0);
ok(Math.abs(somaMostrada - totalReal) < 0.01, `soma do resumo por loja = total real (${somaMostrada.toFixed(2)} vs ${totalReal.toFixed(2)})`);

const umaLoja = linhasTitulos(mk(40, 1), false, nomes, TETO_WPP);
ok(umaLoja.split("\n").length === TETO_WPP + 1, "40 titulos numa loja => 12 + 1 resumo");
ok(/e mais 28 títulos, somando/.test(umaLoja), "diz quantos titulos e quanto ficou de fora");

console.log("3) a mensagem inteira, do caso que quebrou");
const msg = textoVencido({
  nome: "", titulos: mk(352,50), total: mk(352,50).reduce((a,t)=>a+t.valor,0),
  maiorAtraso: 165, comBoleto: 0, semBoleto: 352, multi: true, nomes,
  remetente: "Nina", teto: TETO_WPP });
const nl = msg.split("\n").length;
ok(nl < 30, `mensagem de WhatsApp com ${nl} linhas (antes: 352+)`);
ok(msg.startsWith("Olá, tudo bem?"), "sem nome, cumprimenta sem inventar");
ok(!/Olá, 001/.test(msg), "nunca mais 'Ola, 001!'");
ok(/2ª via/.test(msg), "sem boleto => oferece a 2a via");
ok(msg.length < 1600, `cabe numa mensagem de WhatsApp (${msg.length} chars)`);

const msgEmail = textoVencido({
  nome: "Ana", titulos: mk(352,50), total: 1, maiorAtraso: 165, comBoleto: 3, semBoleto: 349,
  multi: true, nomes, remetente: "Nina", teto: TETO_EMAIL });
ok(msgEmail.split("\n").length > nl, "versao de e-mail traz mais detalhe que a de WhatsApp");
ok(msgEmail.startsWith("Olá, Ana!"), "cumprimenta pelo nome quando ele existe");
ok(/3 títulos/.test(msgEmail) === false && /349 títulos/.test(msgEmail), "diz quantos ficaram sem boleto");

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f?1:0);
