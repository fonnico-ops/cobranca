// As tres situacoes de boleto na mensagem. A terceira ("emitido direto no banco") nasceu da
// regra que a gestao trouxe em 22/09: conta 113 Grafeno inteira, e conta 112 Safra nos
// titulos negociados entre 06/10/2025 e 23/07/2026, saiam manualmente no banco.
import { sobreOsBoletos, textoVencido, TETO_WPP } from "./montar_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };
const txt = (o) => sobreOsBoletos(o).join(" ");

console.log("1) so anexo (tudo tem boleto no ERP)");
let t = txt({ comBoleto: 3, semBoleto: 0, semGeravel: 0, semNoBanco: 0 });
ok(/em anexo para pagamento/.test(t), "diz que segue em anexo");
ok(!/2ª via/.test(t), "nao oferece 2a via do que ja mandou");
ok(!/banco/.test(t), "nao fala de banco sem motivo");

console.log("2) falta boleto, mas da para gerar");
t = txt({ comBoleto: 2, semBoleto: 1, semGeravel: 1, semNoBanco: 0 });
ok(/Falta 1 título/.test(t), "diz quantos faltam");
ok(/eu providencio a 2ª via/.test(t), "oferece providenciar");
ok(!/direto pelo banco/.test(t), "nao inventa que saiu pelo banco");

t = txt({ comBoleto: 0, semBoleto: 2, semGeravel: 2, semNoBanco: 0 });
ok(/providencio a 2ª via do boleto ou o Pix/.test(t), "sem nenhum anexo, oferece 2a via ou Pix");

console.log("3) o boleto existe, mas saiu direto no banco (Grafeno / Safra manual)");
t = txt({ comBoleto: 0, semBoleto: 1, semGeravel: 0, semNoBanco: 1 });
ok(/emitido direto pelo banco/.test(t), "reconhece que o boleto existe");
ok(/financeiro te manda a 2ª via/.test(t), "encaminha ao financeiro");
ok(!/eu providencio/.test(t), "NAO promete 2a via automatica — o sistema nao consegue");

t = txt({ comBoleto: 0, semBoleto: 4, semGeravel: 0, semNoBanco: 4 });
ok(/4 desses títulos/.test(t), "plural com a contagem certa");
ok(!/eu providencio/.test(t), "no plural tambem nao promete");

console.log("4) os tres juntos no mesmo cliente");
t = txt({ comBoleto: 2, semBoleto: 3, semGeravel: 1, semNoBanco: 2 });
ok(/Seguem em anexo os 2 boletos/.test(t), "anexa o que tem");
ok(/Falta 1 título/.test(t) && /providencio a 2ª via/.test(t), "oferece 2a via do que da para gerar");
ok(/2 desses títulos tiveram o boleto emitido direto pelo banco/.test(t), "separa o que saiu pelo banco");

console.log("5) nenhum boleto e nenhuma contagem (nao deve ficar mudo)");
ok(txt({ comBoleto: 0, semBoleto: 0, semGeravel: 0, semNoBanco: 0 }).length > 20, "sempre diz alguma coisa");

console.log("6) na mensagem inteira");
const msg = textoVencido({
  nome: "Ana", titulos: [{ codparc: 1, valor: 500, dtvenc: "2026-08-10", numnota: 9 }],
  total: 500, maiorAtraso: 43, comBoleto: 0, semBoleto: 1, semGeravel: 0, semNoBanco: 1,
  multi: false, nomes: {}, remetente: "Nina", teto: TETO_WPP });
ok(/emitido direto pelo banco/.test(msg), "a frase certa chega na mensagem final");
ok(!/providencio/.test(msg), "e a promessa errada nao chega");

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
