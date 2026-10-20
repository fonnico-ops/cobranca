// NAO COBRAR QUEM JA PAGOU.
//
// O card e um RETRATO: ele guarda os NUFINs e o valor do dia em que foi montado. Entre montar
// e aprovar o cliente pode ter pago — e pelo painel essa janela nao e de segundos, e de dias.
//
// O guarda contra isso existia e nao funcionava, por dois motivos medidos em 20/10:
//
//   1. Ele comparava os NUFINs com o `cobranca_titulo`, acreditando que o refresh tinha
//      acabado de reescrever esse espelho. Pelo cron e verdade (refresh e aprovar correm em
//      serie). Pelo painel, nao: o espelho era de 19/10 as 17:10 e ninguem conferia a idade.
//      Dos 60 cards a_vencer montados em 16/10, 11 tinham titulo ja pago (R$ 87.168,96).
//      Um guarda que compara com o retrato de ontem nao e um guarda.
//   2. Ele conferia se o NUFIN EXISTIA. Em pagamento parcial o NUFIN fica e so o valor muda,
//      e o card passava com o valor velho.
//
// Estes testes travam os dois. Sao funcoes puras de proposito: a regra "nao cobrar quem pagou"
// nao pode depender de ter banco por perto para ser verificada.
import { espelhoVelho, vereditoDoCard, diaSp } from "./aprovar_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

console.log("1) o dia e o de Sao Paulo, nao o do servidor");
{
  // 21h de SP = 00h UTC do dia seguinte. Se o dia vier de UTC, todo envio noturno acha que o
  // espelho da tarde e "de ontem" e recusa o lote inteiro sem motivo.
  ok(diaSp(new Date("2026-10-21T01:30:00Z")) === "2026-10-20", "01:30 UTC ainda e dia 20 em SP");
  ok(diaSp(new Date("2026-10-20T12:00:00Z")) === "2026-10-20", "meio-dia UTC e dia 20 em SP");
}

console.log("2) espelho que nao e de hoje e espelho velho");
{
  const agora = new Date("2026-10-20T15:59:00Z");           // 12:59 em SP, terca
  const ontem = espelhoVelho({ atualizado: "2026-10-19T20:10:03.965Z", agora });
  ok(ontem.velho === true, "o espelho real de 20/10 (escrito em 19/10 17:10 SP) e recusado");
  ok(ontem.dia_espelho === "2026-10-19" && ontem.dia_hoje === "2026-10-20", "e a resposta diz os dois dias, para o painel poder explicar");

  const hoje = espelhoVelho({ atualizado: "2026-10-20T12:07:00Z", agora });
  ok(hoje.velho === false, "espelho relido hoje as 9h07 passa");

  ok(espelhoVelho({ atualizado: null, agora }).velho === true, "espelho que nunca foi escrito e velho (nao e 'sem problema')");
}

console.log("3) titulo que sumiu do espelho segura o card inteiro");
{
  const abertos = new Map([[101, 1000], [102, 500]]);
  const v = vereditoDoCard({ nufins: [101, 102, 103], valorCard: 1800, abertos });
  ok(v.sai === false, "card com 1 de 3 titulos baixados nao sai");
  ok(v.baixados === 1, "e a resposta diz quantos sumiram");
  ok(/nao estao mais em aberto/.test(v.motivo), "com motivo que um humano entende: " + v.motivo.slice(0, 60) + "...");
  // segura o CARD, nao o titulo: mandar a mensagem sem a linha do pago mudaria o texto que a
  // pessoa aprovou. Quem refaz o texto e o montar.
  ok(!/enviado parcial/i.test(v.motivo), "nada e enviado 'em parte'");
}

console.log("4) pagamento parcial: o NUFIN fica, o valor muda, e o card tambem nao sai");
{
  const abertos = new Map([[201, 300], [202, 500]]);   // 201 era 1000, pagou 700
  const v = vereditoDoCard({ nufins: [201, 202], valorCard: 1500, abertos });
  ok(v.sai === false, "valor divergente segura o card");
  ok(v.baixados === 0, "sem nenhum titulo sumido — era este o buraco");
  ok(/valor mudou/.test(v.motivo) && /1500.00/.test(v.motivo) && /800.00/.test(v.motivo),
     "e o motivo mostra os dois valores: " + v.motivo.slice(0, 70) + "...");
}

console.log("5) card intacto sai");
{
  const abertos = new Map([[301, 1200.5], [302, 99.5]]);
  const v = vereditoDoCard({ nufins: [301, 302], valorCard: 1300, abertos });
  ok(v.sai === true, "soma igual e nenhum titulo sumido: pode enviar");
  ok(v.motivo === null, "e sem motivo nenhum pendurado no card");
}

console.log("6) um centavo de diferenca nao segura a cobranca");
{
  // `valor` e numeric no banco e float aqui: 0.1+0.2 nao e 0.3. Sem tolerancia, o arredondamento
  // viraria "o valor mudou no Sankhya" e a cobranca do dia nao sairia — falso positivo que
  // custa a rodada inteira.
  const abertos = new Map([[401, 0.1], [402, 0.2]]);
  ok(vereditoDoCard({ nufins: [401, 402], valorCard: 0.3, abertos }).sai === true, "0.1 + 0.2 ainda e 0.3 para o guarda");
  const grandes = new Map([[403, 100000.004]]);
  ok(vereditoDoCard({ nufins: [403], valorCard: 100000, abertos: grandes }).sai === true, "e meio centavo em R$ 100 mil tambem passa");
}

console.log("7) e 10 centavos de diferenca SEGURA — a tolerancia nao e um buraco");
{
  const abertos = new Map([[501, 999.9]]);
  ok(vereditoDoCard({ nufins: [501], valorCard: 1000, abertos }).sai === false, "R$ 0,10 de diferenca ja e divergencia");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
