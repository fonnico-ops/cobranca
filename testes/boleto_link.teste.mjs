// O BOLETO VAI POR LINK, NAO POR ANEXO (decisao do gestor em 07/10).
//
// O que pode dar errado aqui, e o que cada bloco trava:
//
//   1. PEDIR O LINK ERRADO. A tool `nitron_boleto_link` casa o CNPJ com as notas: mandar nota
//      de outra loja no mesmo link devolve "Nenhum boleto encontrado" e o cliente recebe uma
//      mensagem com um link que nao abre. Um grupo da cobranca reune lojas da MESMA MATRIZ, com
//      CNPJs diferentes — entao a separacao por documento nao e detalhe, e a regra.
//   2. DIZER "ANEXO" MANDANDO LINK. O texto e a unica coisa que o cliente le. "Segue em anexo"
//      com link no lugar do PDF faz o cliente procurar um arquivo que nao existe e responder
//      "nao veio nada", que e trabalho para a Karla e a Bianca.
//   3. MANDAR OS DOIS. Link e anexo juntos no e-mail dizem a mesma coisa duas vezes e dobram o
//      peso da mensagem — e PDF e a primeira coisa que filtro de spam corporativo remove.
import { lotesDeLink, sobreOsBoletos, textoVencido, html } from "./montar_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

const t = (nufin, numnota, parcela, cnpj) => ({ nufin, numnota, parcela, sacado_cnpj: cnpj, dtvenc: "2026-11-21", valor: 100, codparc: 1 });

console.log("1) um link por CNPJ — grupo de matriz tem mais de um");
{
  const lotes = lotesDeLink([
    t(1, 11626, "1", "07.234.359/0001-72"),
    t(2, 11702, "2", "07.234.359/0001-72"),
    t(3, 11888, "1", "07.234.359/0002-50"),
  ]);
  ok(lotes.length === 2, `duas lojas, dois links (veio ${lotes.length})`);
  ok(lotes.every((l) => /^\d{14}$/.test(l.documento)), "o CNPJ vai so com digitos, como a tool pede");
  const a = lotes.find((l) => l.documento === "07234359000172");
  ok(a.titulos.length === 2, "a loja com dois titulos pede os dois no mesmo link");
  ok(a.nufins.length === 2, "e guarda os nufins para marcar como enviado depois");
}

console.log("2) nota+parcela sem repetir, mas sem perder nufin");
{
  // caso real do guia: a nota e o pedido da empresa 4 que a acompanha sao DOIS boletos com a
  // mesma nota e parcela. O link mostra os dois; o pedido nao pode ir duplicado.
  const lotes = lotesDeLink([t(10, 11626, "1", "07234359000172"), t(11, 11626, "1", "07234359000172")]);
  ok(lotes.length === 1, "um link");
  ok(lotes[0].titulos.length === 1, "o par nota+parcela vai uma vez so");
  ok(lotes[0].nufins.length === 2, "mas os dois nufins ficam guardados (sao dois boletos)");
}

console.log("3) o teto de 20 titulos por link");
{
  const muitos = Array.from({ length: 25 }, (_, i) => t(100 + i, 20000 + i, "1", "07234359000172"));
  const lotes = lotesDeLink(muitos);
  ok(lotes.length === 2, `25 titulos viram 2 links (veio ${lotes.length})`);
  ok(lotes[0].titulos.length === 20, "o primeiro leva 20");
  ok(lotes[1].titulos.length === 5, "o segundo leva 5");
}

console.log("4) titulo sem CNPJ ou sem nota nao vira pedido de link");
{
  ok(lotesDeLink([t(1, 11626, "1", null)]).length === 0, "sem CNPJ, nao pede link (a tool nao acharia nada)");
  ok(lotesDeLink([t(1, null, "1", "07234359000172")]).length === 0, "sem numero de nota, nao pede link");
  ok(lotesDeLink([]).length === 0, "lista vazia nao quebra");
}

console.log("5) o texto fala de link, e nao de anexo");
{
  const comLink = sobreOsBoletos({ comBoleto: 3, semBoleto: 0, links: [{ url: "https://mcp-y7bu.onrender.com/b/Xk3", expiraEm: "2026-12-22T02:59:59.000Z" }] });
  const texto = comLink.join(" ");
  ok(/mcp-y7bu/.test(texto), "o link aparece no texto");
  ok(!/anexo/i.test(texto), "e a palavra 'anexo' NAO aparece");
  ok(/c(ó|o)digo de barras/i.test(texto) && /Pix/i.test(texto), "diz o que se faz no link: PDF, codigo de barras, Pix");
  ok(/22\/12\/2026/.test(texto), "diz ate quando o link vale");
}
{
  const semLink = sobreOsBoletos({ comBoleto: 3, semBoleto: 0 });
  ok(/anexo/i.test(semLink.join(" ")), "sem link, o texto antigo (anexo) continua valendo");
}

console.log("6) a mensagem inteira, com link");
{
  const msg = textoVencido({
    nome: "Maria", titulos: [t(1, 11626, "1", "07234359000172")], total: 100, maiorAtraso: 10,
    multi: false, nomes: {}, teto: 12, empresa: "Nitron", comBoleto: 1, semBoleto: 0,
    links: [{ url: "https://mcp-y7bu.onrender.com/b/Xk3", expiraEm: "2026-12-22T02:59:59.000Z" }],
    assinatura: { linha: "Nina" },
  });
  ok(msg.includes("https://mcp-y7bu.onrender.com/b/Xk3"), "o link esta na mensagem");
  ok(!/em anexo/i.test(msg), "nada de 'em anexo'");
  ok(msg.includes("comprovante"), "o resto da mensagem continua de pe");
}

console.log("7) o e-mail leva botao de link e nenhum anexo");
{
  const corpo = html("Olá\n[[BOLETOS]]\nabraço", [], [{ url: "https://mcp-y7bu.onrender.com/b/Xk3", expiraEm: "2026-12-22T02:59:59.000Z" }]);
  ok(/Abrir os boletos/.test(corpo), "o botao do link aparece");
  ok(!/seguem anexos/i.test(corpo), "e o e-mail nao promete anexo que nao existe");
  ok(!/\[\[BOLETOS\]\]/.test(corpo), "o marcador foi substituido");
}
{
  const corpo = html("Olá\n[[BOLETOS]]\nabraço", [{ url: "https://x/y.pdf", dtvenc: "2026-11-21", valor: 100 }]);
  ok(/Boleto venc\. 21\/11/.test(corpo), "sem link, os botoes de PDF continuam");
  ok(/seguem anexos/i.test(corpo), "e a frase do anexo volta");
}


console.log("8) titulo que o ERP nao pode emitir fica FORA do link");
{
  // A conta 113 (Grafeno, inteira) e os primeiros do Safra (112) tem boleto feito DIRETO no
  // banco: pedir 2a via ali cria um segundo codigo de barras para a mesma divida. Medido em
  // 07/10, em homologacao: para um titulo da Grafeno o MCP devolveu link com vencimento 09/10
  // enquanto o espelho do ERP diz 05/10 — pode nao ser a mesma cobranca. Entao esses ficam de
  // fora enquanto o TI nao confirmar que a pagina so reimprime o que esta registrado.
  const grafeno = { ...t(1, 136659, "1", "12356100005799"), boleto_geravel: false };
  const normal = t(2, 11626, "1", "12356100005799");
  ok(lotesDeLink([grafeno]).length === 0, "titulo da Grafeno (boleto_geravel false) nao vira pedido de link");
  const lotes = lotesDeLink([grafeno, normal]);
  ok(lotes.length === 1 && lotes[0].titulos.length === 1, "no card misto, so o titulo emitivel entra no link");
  ok(lotes[0].titulos[0].num_nota === 11626, "e e o emitivel, nao o do banco");
  ok(!lotes[0].nufins.includes(1), "o nufin do titulo do banco nao e marcado como enviado");
  ok(lotesDeLink([{ ...normal, boleto_geravel: true }]).length === 1, "boleto_geravel true entra normal");
  ok(lotesDeLink([{ ...normal, boleto_geravel: null }]).length === 1, "boleto_geravel nulo (nao avaliado) entra: so `false` barra");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
