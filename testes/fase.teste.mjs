// A terceira fase e estreita e silenciosa: se 'futuro' virasse 'a_vencer', o lembrete de
// sexta ("vence na proxima semana") passaria a avisar sobre boleto que vence daqui a um ano,
// e ninguem perceberia — a mensagem sai bem formada, so mentindo a data. Dai este teste.
import { faseDoTitulo } from "./refresh_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };
const J = 7;   // cobranca_config.dias_a_vencer

console.log("1) vencido e o que passou da data");
ok(faseDoTitulo(1, J) === "vencido", "1 dia de atraso");
ok(faseDoTitulo(145, J) === "vencido", "145 dias (o mais antigo da carteira)");

console.log("2) o dia do vencimento ainda da para pagar");
// `dias` = hoje - vencimento, entao 0 e o proprio dia. Cobrar quem pode pagar ate as 17h
// como se estivesse atrasado e o jeito mais rapido de perder a razao numa conversa.
ok(faseDoTitulo(0, J) === "a_vencer", "vence hoje -> a_vencer, nao vencido");

console.log("3) a_vencer e so a janela do lembrete");
for (let d = 1; d <= J; d++) ok(faseDoTitulo(-d, J) === "a_vencer", `vence em ${d} dia(s)`);
ok(faseDoTitulo(-J, J) === "a_vencer", `a borda (${J} dias) e a_vencer`);

console.log("4) futuro comeca UM dia depois da borda");
// a fronteira e o ponto exato onde um erro de <= vs < poe um boleto de daqui a 8 dias no
// lembrete de "proxima semana" — ou tira dele o que deveria estar
ok(faseDoTitulo(-(J + 1), J) === "futuro", `vence em ${J + 1} dias -> futuro`);
ok(faseDoTitulo(-30, J) === "futuro", "vence em 30 dias");
ok(faseDoTitulo(-365, J) === "futuro", "vence em um ano (o caso que motivou tudo)");

console.log("5) a janela vem da config, e mudar ela move a fronteira inteira");
ok(faseDoTitulo(-10, 15) === "a_vencer", "com janela 15, 10 dias e a_vencer");
ok(faseDoTitulo(-20, 15) === "futuro", "com janela 15, 20 dias e futuro");
ok(faseDoTitulo(-1, 0) === "futuro", "com janela 0, nada e a_vencer alem do proprio dia");
ok(faseDoTitulo(0, 0) === "a_vencer", "com janela 0, o dia do vencimento ainda e a_vencer");

console.log("6) o montar so enxerga duas das tres");
// esta e a propriedade que faz 'futuro' ser seguro: o cobranca-montar filtra por fase e
// nunca pede 'futuro', entao o boleto recem-impresso nao entra em cobranca nenhuma
const fasesDoMontar = new Set(["vencido", "a_vencer"]);
ok(!fasesDoMontar.has(faseDoTitulo(-365, J)), "boleto de um ano nao entra em nenhuma rodada do montar");
ok(fasesDoMontar.has(faseDoTitulo(3, J)), "vencido entra");
ok(fasesDoMontar.has(faseDoTitulo(-3, J)), "a vencer entra");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
