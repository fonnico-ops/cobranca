// A entrega do boleto na EMISSAO — nao e cobranca, e entrega. O que estes testes travam
// e a diferenca: nada de regua, nada de atraso, e o cliente tem de reconhecer o documento.
import { textoEmitidos, linhaEmitido, primeiroNome, assinar, html } from "./emitidos_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };

const ASSIN = { linha: "Nina — Financeiro Nitron", razao_social: "NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA",
  cnpj: "54.886.460/0001-98", telefones: ["(11) 2413-2244", "(11) 2413-2246"],
  telefone: "(11) 96456-0761", email: "cobranca@nitron.com.br" };

console.log("1) a linha de cada titulo faz o cliente RECONHECER o documento");
const venda = { valor: 1875, dtvenc: "2026-07-30", numnota: 133, serie: "1", parcela: "02", parcelas_total: 12 };
const l = linhaEmitido(venda);
ok(/R\$ 1\.875,00/.test(l) && /30\/07\/2026/.test(l), "valor e vencimento");
ok(/NF 133\/1/.test(l), "nota e série");
ok(/parcela 2 de 12/.test(l), "parcela X de Y, sem o zero à esquerda");
// producao: no Clube o NUMNOTA vem com o numero do CONTRATO, nao com uma nota fiscal
const clube = linhaEmitido({ valor: 1100, dtvenc: "2026-09-25", numnota: 42, contrato: 42, parcela: "11", parcelas_total: 12 });
ok(/contrato do Clube nº 42/.test(clube) && /parcela 11 de 12/.test(clube), "Clube: contrato e parcela");
ok(!/NF/.test(clube), "Clube não ganha 'NF' (o NUMNOTA ali é o contrato)");
const seco = linhaEmitido({ valor: 80, dtvenc: "2026-08-10" });
ok(!/NF|contrato|parcela/.test(seco), "sem origem, só valor e vencimento — não inventa");

console.log("2) o texto NÃO é cobrança");
const t = textoEmitidos({ nome: "Lorrany", titulos: [venda, { ...venda, dtvenc: "2026-08-30", parcela: "03" }],
  total: 3750, empresa: "Nitron", assinatura: ASSIN });
for (const proibido of ["cartório", "negativa", "extrajudicial", "atraso", "vencido", "em aberto", "cobrança", "protesto"]) {
  ok(!new RegExp(proibido, "i").test(t), `não fala em "${proibido}"`);
}
ok(/registrados no banco/.test(t), "explica POR QUE está chegando agora");
ok(/não chegarem em cima do vencimento/.test(t), "diz o motivo da rotina, que é o pedido do gestor");
ok(/Não precisa fazer nada agora/.test(t), "deixa claro que não é uma cobrança");
ok(/Olá, Lorrany!/.test(t), "cumprimenta pelo nome");
ok(/R\$ 3\.750,00/.test(t), "total confere");
ok(/Os PDFs seguem em anexo/.test(t), "plural com 2 títulos");

const um = textoEmitidos({ nome: "", titulos: [venda], total: 1875, empresa: "Nitron", assinatura: ASSIN });
ok(/Saiu o boleto da sua compra/.test(um) && /O PDF segue em anexo/.test(um), "singular com 1 título");
ok(/^Olá, tudo bem\?/.test(um), "sem nome, cumprimenta sem inventar um");

console.log("3) a assinatura é a mesma da cobrança");
ok(/\(11\) 2413-2244 · \(11\) 2413-2246 · WhatsApp \(11\) 96456-0761/.test(t), "fixos primeiro, WhatsApp rotulado");
ok(t.trim().split("\n").pop() === "cobranca@nitron.com.br", "e-mail na última linha");
ok(assinar("Obrigada!", {}) === "Obrigada!\nNitron", "config vazia não inventa CNPJ");

console.log("4) saudação: o cadastro não tem padrão de caixa");
ok(primeiroNome("lorrany silva") === "Lorrany", "conserta minúscula");
ok(primeiroNome("JOSE") === "Jose", "conserta MAIÚSCULA");
ok(primeiroNome("McCarthy") === "McCarthy", "não mexe em caixa mista");
ok(primeiroNome("001 - INTERLAGOS") === "", "recusa razão social");

console.log("5) o e-mail escapa HTML e leva os botões");
const h = html("linha <b>a</b> & *forte*", [{ url: "https://x/a.pdf", dtvenc: "2026-07-30", valor: 1875 }]);
ok(/&lt;b&gt;/.test(h), "tag do cliente é escapada, não interpretada");
ok(/&amp;/.test(h), "& escapado");
ok(/<strong>forte<\/strong>/.test(h), "*forte* vira negrito");
ok(/Boleto venc\. 30\/07\/2026/.test(h), "botão com a data");
ok(!/<p style="margin:18px/.test(html("oi", [])), "sem boleto não sobra bloco de botões vazio");

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
