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
// o texto mudou no v9 (virou lembrete), mas o que este teste trava — a marca no corpo —
// continua igual: "aqui na Nitron", nunca "Nitronplast".
ok(t.includes("aqui na Nitron:"), "a vencer também");
ok(!/Nitronplast/.test(t), "e nem no lembrete sobra 'Nitronplast'");

console.log("2) a razão social do rodapé NÃO muda junto");
t = wpp(textoVencido(base));
ok(t.includes("NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA"), "o nome jurídico continua completo");
ok(t.includes("Nina — Financeiro Nitron"), "e a assinatura segue a marca");

console.log("3) a marca é configurável, não presa no código");
t = wpp(textoVencido({ ...base, empresa: "Teak Brazil" }));
ok(t.includes("aqui na Teak Brazil."), "outra empresa sai no corpo");
ok(!/Nitron\./.test(t), "sem vazamento da marca anterior");


console.log("4) o aviso da semana anterior virou LEMBRETE (pedido de 22/09)");
{
  const base = { nome: "Ana", nomes: {}, multi: false, teto: TETO_WPP, empresa: "Nitron",
    assinatura: { linha: "Nina — Financeiro Nitron" },
    comBoleto: 2, semBoleto: 0, semGeravel: 0, semNoBanco: 0, total: 3750,
    titulos: [{ codparc: 1, valor: 1875, dtvenc: "2026-10-05", numnota: 77 },
              { codparc: 1, valor: 1875, dtvenc: "2026-10-06", numnota: 77 }] };

  // ja recebeu os dois na emissao: lembra, NAO reenvia
  const lembra = textoAVencer({ ...base, jaTem: 2 });
  ok(/Passando para lembrar/.test(lembra), "abre como lembrete");
  ok(/j\u00e1 te mandei quando foram emitidos/.test(lembra), "diz que o boleto já foi na emissão");
  ok(!/Seguem os boletos em anexo/.test(lembra), "não promete anexo que não vai");
  ok(/me avisa que eu reenvio/.test(lembra), "mas deixa a 2ª via a um pedido de distância");
  ok(!lembra.includes(MARCA_BOLETOS), "sem marcador de boleto: não há botão para colocar");

  // nunca recebeu: volta a mandar, com a frase de sempre
  const manda = textoAVencer({ ...base, jaTem: 0 });
  ok(/em anexo/.test(manda) && manda.includes(MARCA_BOLETOS), "quem não recebeu nada continua recebendo");
  ok(!/já te mandei/.test(manda), "e não afirma um envio que não houve");

  // recebeu um dos dois: manda só o que falta, e diz isso
  const meio = textoAVencer({ ...base, jaTem: 1 });
  ok(/Um desses boletos ainda n\u00e3o tinha ido/.test(meio), "diz quantos faltavam");
  ok(/Os outros eu j\u00e1 te mandei na emiss\u00e3o/.test(meio), "e que os outros já foram");
  ok(meio.includes(MARCA_BOLETOS), "o que falta vai anexo");

  // o lembrete NAO pode virar cobranca: o titulo ainda nem venceu
  for (const proibido of ["atraso", "vencido", "em aberto", "cartório", "negativa"]) {
    ok(!new RegExp(proibido, "i").test(lembra), `lembrete não fala em "${proibido}"`);
  }
  // singular
  const so1 = textoAVencer({ ...base, jaTem: 1, comBoleto: 1, total: 1875, titulos: [base.titulos[0]] });
  ok(/do t\u00edtulo que vence/.test(so1) && /O boleto eu j\u00e1 te mandei/.test(so1), "singular certo");
}

console.log(f ? `\n${f} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(f ? 1 : 0);
