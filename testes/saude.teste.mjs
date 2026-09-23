// A aba da saude so serve se a CAUSA estiver certa. Um painel que diz "o CRM recusou" 700
// vezes nao conserta nada; o que conserta e "o e-mail do contato esta invalido no cadastro".
//
// Por isso este teste nao usa texto inventado: sao os textos que o fila-processar REALMENTE
// gravou em 60 dias, com a contagem de cada um. A primeira versao do classificador foi
// escrita de cabeca e errava as duas maiores familias (615 e-mails invalidos e 30 contatos
// que o CRM nao achou, os dois caindo no balde generico). Foi este teste que mostrou.
import { familiaDaFalha } from "./painel_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

// [texto real, quantas vezes apareceu em 60 dias, familia esperada]
const REAIS = [
  [`GHL 400: {"statusCode":400,"error":"Bad Request","message":"Unable to send e-mail, contact's e-mail is invalid","canonicalCode":"CONVERSATIONS_MSG_INVALID_EMAIL"}`, 615, "email_invalido"],
  [`GHL 400: {"statusCode":400,"error":"Bad Request","message":"Cannot send message as DND is active for Email.","canonicalCode":"CONVERSATIONS_MSG_DND_ACTIVE_EMAIL"}`, 115, "dnd_email"],
  ["nao foi possivel achar/criar contato no CRM", 30, "sem_contato_crm"],
  ["o contato e da Isadora no CRM, entao o WhatsApp sairia pelo numero dela e nao pelo da Juliete — texto nao enviado. Ajuste o proprietario no CRM ou mande pela Nina.", 8, "dono_errado"],
  ["o contato e da Nina no CRM, entao o WhatsApp sairia pelo numero dela e nao pelo da Juliete — texto nao enviado. Ajuste o proprietario no CRM ou mande pela Nina.", 7, "dono_errado"],
  ["sem instancia (Zaptos nao roteavel)", 6, "sem_instancia"],
  ["instancia desconectada — o GHL aceitou mas o ZaptosWPP nao entregou: [System]: Nina - The instance is disconnected.", 7, "wpp_desconectado"],
  ["bind nao aceito — texto nao enviado", 4, "bind"],
  [`GHL 400: {"statusCode":400,"error":"Bad Request","message":"Cannot send email as pinguim.utilidades@gmail.com has unsubscribed","canonicalCode":"CONVERSATIONS_MSG_UNSUBSCRIBED"}`, 16, "descadastrado"],
  [`GHL 500: {"statusCode":500,"message":"Internal server error"}`, 3, "ghl_5xx"],
  ["instancia 'Beatriz' fora do cadastro instancia_ghl", 2, "instancia_sem_cadastro"],
];

console.log("1) cada texto real cai na familia que se conserta");
for (const [txt, n, esperado] of REAIS) {
  const f = familiaDaFalha(txt);
  ok(f.chave === esperado, `${String(n).padStart(3)}x  ${esperado}${f.chave === esperado ? "" : `  (veio ${f.chave})`}  — ${txt.slice(0, 54)}`);
}

console.log("2) nenhuma falha real sobra no balde 'outro'");
const sobrou = REAIS.filter(([t]) => familiaDaFalha(t).chave === "outro");
ok(sobrou.length === 0, sobrou.length ? `${sobrou.length} texto(s) sem familia` : "os 11 textos reais tem familia propria");

console.log("3) o generico nao engole o especifico");
// este e o defeito que o teste existe para travar: `ghl 4xx` antes dos especificos
const especificos = REAIS.filter(([t]) => /^GHL 4/.test(t));
ok(especificos.length === 3, `${especificos.length} textos sao GHL 4xx e mesmo assim tem familia propria`);
for (const [t, , esperado] of especificos) {
  ok(familiaDaFalha(t).chave !== "ghl_4xx", `"${esperado}" nao virou ghl_4xx`);
}
// e um 4xx que NAO e de nenhuma familia conhecida ainda cai no generico, de proposito
ok(familiaDaFalha(`GHL 400: {"message":"algo novo que ainda nao vimos"}`).chave === "ghl_4xx",
   "4xx desconhecido ainda cai no generico (o balde tem que existir)");

console.log("4) toda familia diz O QUE FAZER, nao so o que houve");
const vistas = new Set();
for (const [t] of REAIS) {
  const f = familiaDaFalha(t);
  if (vistas.has(f.chave)) continue;
  vistas.add(f.chave);
  ok(f.conserto && f.conserto.length > 25 && f.rotulo && f.rotulo.length > 8,
     `${f.chave}: "${f.conserto.slice(0, 60)}…"`);
}

console.log("5) entrada vazia ou nula nao quebra a tela");
for (const v of ["", null, undefined, 0, {}]) {
  const f = familiaDaFalha(v);
  ok(f && f.chave === "outro", `${JSON.stringify(v)} -> outro`);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
