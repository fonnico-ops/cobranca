// A assinatura vai igual nos dois canais (decisao do gestor em 22/09). O que estes testes
// travam e o risco concreto: placeholder de rodape chegando ao cliente numa cobranca.
import { assinar, textoVencido, html, TETO_WPP, TETO_EMAIL, MARCA_BOLETOS, MARCA_RODAPE } from "./montar_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };
const wpp = (t) => t.replace("\n" + MARCA_BOLETOS, "").replace(MARCA_RODAPE, "");

const CHEIA = { linha: "Nina — Financeiro Nitron", razao_social: "NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA",
  cnpj: "54.886.460/0001-98", telefone: "(11) 96456-0761", email: "cobranca@nitron.com.br" };

console.log("1) assinatura completa");
let a = assinar("Obrigada!", CHEIA).replace(MARCA_RODAPE, "");
ok(a.startsWith("Obrigada!\nNina — Financeiro Nitron"), "despedida e quem assina, nessa ordem");
ok(a.includes("NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA"), "razão social");
ok(a.includes("CNPJ 54.886.460/0001-98"), "CNPJ com o rótulo");
// 22/09: o e-mail saiu da linha dos telefones e ganhou a sua. Com tres contatos (dois
// fixos e o WhatsApp) a linha unica nao se lia no celular.
ok(a.includes("WhatsApp (11) 96456-0761"), "o celular vai rotulado como WhatsApp");
ok(a.split("\n").pop() === "cobranca@nitron.com.br", "o e-mail fica sozinho na ultima linha");

console.log("2) campo vazio NÃO vira placeholder (o risco real)");
a = assinar("Obrigada!", { ...CHEIA, telefone: "", email: "" }).replace(MARCA_RODAPE, "");
ok(!/\(xx\)|xxxx|@empresa|preencher|TODO/i.test(a), "nenhum placeholder no texto");
ok(a.includes("CNPJ"), "o que está preenchido continua saindo");
ok(!/·\s*$/m.test(a), "não sobra separador solto de campo vazio");
a = assinar("Obrigada!", { ...CHEIA, telefone: "", }).replace(MARCA_RODAPE, "");
ok(a.includes("cobranca@nitron.com.br") && !a.includes(" · cobranca"), "só e-mail: sem o · na frente");

console.log("3) config vazia não quebra e não mente");
a = assinar("Obrigada!", {}).replace(MARCA_RODAPE, "");
ok(a === "Obrigada!\nNitron", "sem config, assina o mínimo e não inventa CNPJ");
a = assinar("Obrigada!", null).replace(MARCA_RODAPE, "");
ok(a === "Obrigada!\nNitron", "config nula também");

console.log("4) o mesmo rodapé nos dois canais");
const ctx = { nome: "Ana", titulos: [{ codparc: 1, valor: 500, dtvenc: "2026-08-10", numnota: 9 }],
  total: 500, maiorAtraso: 43, comBoleto: 1, semBoleto: 0, semGeravel: 0, semNoBanco: 0,
  multi: false, nomes: {}, remetente: "Nina", assinatura: CHEIA };
const zap = wpp(textoVencido({ ...ctx, teto: TETO_WPP }));
const mail = html(textoVencido({ ...ctx, teto: TETO_EMAIL }), []);
for (const campo of ["Nina — Financeiro Nitron", "NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA", "CNPJ 54.886.460/0001-98", "cobranca@nitron.com.br"]) {
  ok(zap.includes(campo) && mail.includes(campo), `"${campo.slice(0, 28)}…" nos dois canais`);
}
ok(!zap.includes(MARCA_RODAPE) && !zap.includes(MARCA_BOLETOS), "WhatsApp sai sem marcador nenhum");
ok(!mail.includes(MARCA_RODAPE) && !mail.includes(MARCA_BOLETOS), "e-mail sai sem marcador nenhum");

console.log("5) no e-mail o rodapé é identificação, não mensagem");
ok(/border-top/.test(mail), "separado por um filete");
ok(/font:12px[^\"]*color:#777/.test(mail), "corpo menor e cinza, para não competir com a cobrança");
const posAssin = mail.indexOf("Financeiro Nitron");
const posRodape = mail.indexOf("NITRONPLAST IND");
ok(posAssin > 0 && posRodape > posAssin, "o rodapé vem depois de quem assina");

console.log("6) telefones fixos para ligacao (pedido de 22/09)");
{
  const a = { linha: "Nina — Financeiro Nitron", razao_social: "NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA",
    cnpj: "54.886.460/0001-98", telefones: ["(11) 2413-2244", "(11) 2413-2246"],
    telefone: "(11) 96456-0761", email: "cobranca@nitron.com.br" };
  const r = assinar("Obrigada!", a);
  ok(r.includes("(11) 2413-2244") && r.includes("(11) 2413-2246"), "os dois fixos aparecem");
  ok(/\(11\) 2413-2244 · \(11\) 2413-2246 · WhatsApp \(11\) 96456-0761/.test(r), "fixos primeiro, WhatsApp rotulado");
  ok(r.split("\n").pop() === "cobranca@nitron.com.br", "o e-mail fica em linha propria, no fim");
  // sem os fixos o rodape antigo continua valendo
  const semFixo = assinar("Obrigada!", { ...a, telefones: undefined });
  ok(/WhatsApp \(11\) 96456-0761/.test(semFixo) && !/·\s*·/.test(semFixo), "sem fixos nao sobra separador solto");
  const soFixo = assinar("Obrigada!", { ...a, telefone: "" });
  ok(!/WhatsApp/.test(soFixo) && /2413-2244/.test(soFixo), "sem celular nao imprime o rotulo WhatsApp");
}

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
