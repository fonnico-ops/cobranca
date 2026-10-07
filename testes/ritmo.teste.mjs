// O RITMO DO RODIZIO: uma mensagem por numero a cada 2 minutos, dentro da janela.
//
// Esta suite existe por causa de duas maneiras de o liberador estragar justamente o que ele
// protege:
//   1. SOLTAR CEDO. Se a conta do intervalo errar para menos, os dois numeros passam a mandar
//      mais rapido do que o combinado — e velocidade e um dos sinais que faz a Meta restringir
//      um numero. Foi assim que a casa perdeu a "Campanhas Nitron" em 27/08.
//   2. SOLTAR FORA DE HORA. Cobranca as 3h da manha e o tipo de mensagem que o cliente
//      denuncia, e denuncia tambem restringe o numero. A janela 8h-20h e trava, nao enfeite.
import { naJanela, podeSoltar } from "./liberar_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

console.log("1) a janela de cobranca (8h as 20h, hora de Sao Paulo)");
ok(naJanela(8, 8, 20) === true, "8h abre");
ok(naJanela(19, 8, 20) === true, "19h ainda vale");
ok(naJanela(20, 8, 20) === false, "20h fecha — o limite e exclusivo");
ok(naJanela(7, 8, 20) === false, "7h nao");
ok(naJanela(3, 8, 20) === false, "3h da manha nunca");
ok(naJanela(0, 8, 20) === false, "meia-noite nao");

console.log("2) o intervalo de 2 minutos por numero");
const agora = new Date("2026-10-07T12:00:00.000Z").getTime();
ok(podeSoltar(null, 120, agora) === true, "numero que nunca soltou pode soltar");
ok(podeSoltar("2026-10-07T11:58:00.000Z", 120, agora) === true, "exatamente 2 min depois, pode");
ok(podeSoltar("2026-10-07T11:58:01.000Z", 120, agora) === false, "1 segundo antes dos 2 min, NAO pode");
ok(podeSoltar("2026-10-07T11:59:30.000Z", 120, agora) === false, "30s depois da ultima, nao");
ok(podeSoltar("2026-10-07T11:50:00.000Z", 120, agora) === true, "10 min depois, pode");
ok(podeSoltar("2026-10-07T12:00:00.000Z", 120, agora) === false, "acabou de soltar: nao solta de novo no mesmo tick");

console.log("3) o ritmo resultante nao passa do combinado");
// dois numeros, 120s cada: o teto e 1 mensagem por minuto no conjunto. Esta e a conta que o
// painel mostra antes do clique — se ela mentir, quem aprova 60 grupos se planeja errado.
const porNumero = 120, numeros = 2;
const porMinuto = (60 / porNumero) * numeros;
ok(porMinuto === 1, `${numeros} numeros a cada ${porNumero}s = ${porMinuto} mensagem(ns) por minuto`);
ok(Math.round((60 * porNumero) / numeros / 60) === 60, "60 grupos levam cerca de 60 min com os dois numeros");
ok(Math.round((60 * porNumero) / 1 / 60) === 120, "com um numero fora do ar, os mesmos 60 levam o dobro: 120 min");

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
