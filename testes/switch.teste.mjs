// O COMANDO QUE ESCOLHE O NUMERO DE SAIDA: `#switch:<instancia>`.
//
// Regra do gestor (22/10): mensagem automatica que sai pelo numero das meninas leva o comando
// na mensagem, e o proprietario do contato no CRM NAO e mexido.
//
// O QUE ISTO SUBSTITUIU, E POR QUE O TESTE EXISTE. Ate 21/10 o numero de saida era escolhido
// trocando o `assignedTo` do contato (o `emprestar()`), e o envio ficava CONDICIONADO a essa
// troca dar certo: no cobranca-aprovar um `PUT assignedTo` recusado zerava o `pronto` e a
// linha de WhatsApp nunca era escrita na fila — o card saia so por e-mail, sem erro visivel.
// O cobranca-emitidos tinha o mesmo desenho ("motivo: emprestimo do dono"). Foi o que deixou
// o lote sem WhatsApp. Agora nenhum envio depende de uma escrita remota no CRM.
//
// DOIS RISCOS QUE ESTES TESTES GUARDAM:
//   1. O PREFIXO CHEGA AO CLIENTE se o `fila-processar` nao consumir a linha. Por isso ele e
//      a PRIMEIRA linha e vem sozinho: e o formato que o gestor passou, e qualquer mudanca
//      aqui muda o que o cliente pode acabar lendo no topo de uma cobranca.
//   2. AS CINCO COPIAS PODEM DIVERGIR. `comSwitch` e copiado em cada funcao de proposito
//      (cada Edge Function e um deploy independente; um import comum obrigaria a redeployar
//      todas juntas). Copia que diverge em silencio e o pior caso: uma funcao manda pelo
//      numero certo e outra nao, e ninguem percebe ate o numero errado falar com o cliente.
import fs from "node:fs";

import { comSwitch as doAprovar } from "./aprovar_puro.mjs";
import { comSwitch as doAtende } from "./atende_puro.mjs";
import { comSwitch as doSeguir } from "./seguir_puro.mjs";
import { comSwitch as doEmitidos } from "./emitidos_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

const COPIAS = [
  ["cobranca-aprovar", doAprovar],
  ["cobranca-atende", doAtende],
  ["cobranca-seguir", doSeguir],
  ["cobranca-emitidos", doEmitidos],
];

console.log("1) o formato que o gestor passou");
{
  const saida = doAprovar("Karla", "Bom dia! Passando para lembrar do título.");
  ok(saida.startsWith("#switch:Karla\n"), "o comando é a primeira linha, sozinho");
  ok(saida === "#switch:Karla\nBom dia! Passando para lembrar do título.", "e o texto vem logo abaixo, intacto");
  ok(doAprovar("Bianca", "oi").startsWith("#switch:Bianca\n"), "vale para a Bianca também");
  // o nome vai como esta cadastrado: quem resolve o nome e `cobranca_config.instancias`,
  // nao esta funcao. Normalizar aqui seria inventar um nome que o fila-processar nao conhece.
  ok(doAprovar("Nina Financeiro", "oi") === "#switch:Nina Financeiro\noi", "nome com espaço não é mexido");
}

console.log("2) não empilha — card remontado ou reaprovado não ganha dois comandos");
{
  const uma = doAprovar("Karla", "texto");
  ok(doAprovar("Karla", uma) === uma, "aplicar de novo não muda nada");
  ok(doAprovar("Bianca", uma) === uma, "e nem troca o comando que já está lá");
  ok(doAprovar("Karla", "#SWITCH:Bianca\nja tinha") === "#SWITCH:Bianca\nja tinha", "reconhece em maiúscula também");
}

console.log("3) sem instância, nada é escrito na mensagem");
{
  // mensagem com um comando pela metade (ex: `#switch:` sozinho) seria pior do que mensagem
  // sem comando nenhum: o fila-processar nao saberia para onde mandar e o cliente leria o lixo.
  for (const vazio of [null, undefined, "", "   "]) {
    ok(doAprovar(vazio, "texto puro") === "texto puro", `instância ${JSON.stringify(vazio)} → texto intacto`);
  }
}

console.log("4) as quatro cópias concordam, caractere por caractere");
{
  const casos = [
    ["Karla", "Bom dia!"],
    ["Bianca", "linha 1\nlinha 2"],
    ["Nina Financeiro", ""],
    ["", "sem instância"],
    [null, "nulo"],
    ["Karla", "#switch:Bianca\nja comandado"],
    ["  Karla  ", "com espaço em volta do nome"],
  ];
  for (const [inst, msg] of casos) {
    const esperado = doAprovar(inst, msg);
    const divergem = COPIAS.filter(([, fn]) => fn(inst, msg) !== esperado).map(([nome]) => nome);
    ok(divergem.length === 0,
      divergem.length ? `divergem em (${JSON.stringify(inst)}): ${divergem.join(", ")}` : `todas iguais para ${JSON.stringify(inst)}`);
  }
}

console.log("5) ninguém mais troca o dono do contato para enviar");
{
  // o repasse do cobranca-seguir e do cobranca-atende CONTINUA trocando, e deve: ali a
  // conversa passa a ser de uma pessoa de verdade, nao e escolha de numero de saida.
  // só CÓDIGO: os comentários falam de `assignedTo` de propósito, para explicar o que saiu
  // daqui e por quê — apagar a explicação junto com o código é como o motivo se perde.
  const semComentario = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, "")   // blocos /* ... */
    .replace(/^\s*\/\/.*$/gm, "");      // linhas //
  const enviam = ["cobranca-aprovar", "cobranca-emitidos", "cobranca-teste"];
  for (const f of enviam) {
    const codigo = semComentario(fs.readFileSync(new URL(`../supabase/functions/${f}/index.ts`, import.meta.url), "utf8"));
    ok(!/assignedTo/.test(codigo), `${f} não escreve assignedTo em código`);
    ok(!/emprestar\s*\(/.test(codigo), `${f} não tem mais empréstimo de dono`);
    ok(!/dono_atual/.test(codigo), `${f} não carrega mais o dono do contato`);
  }
}

console.log("6) e o envio não depende mais de o CRM aceitar uma escrita");
{
  const apr = fs.readFileSync(new URL("../supabase/functions/cobranca-aprovar/index.ts", import.meta.url), "utf8");
  const emi = fs.readFileSync(new URL("../supabase/functions/cobranca-emitidos/index.ts", import.meta.url), "utf8");
  ok(!/let pronto = true/.test(apr), "o portão `pronto` saiu do cobranca-aprovar");
  ok(!/emprestimo do dono/.test(emi), "e o motivo 'emprestimo do dono' saiu do cobranca-emitidos");
  ok(/mensagem: comSwitch\(quem, card\.mensagem\)/.test(apr), "o aprovar manda o texto já comandado");
  ok(/mensagem: comSwitch\(NOME_INST, texto\)/.test(emi), "o emitidos também");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
