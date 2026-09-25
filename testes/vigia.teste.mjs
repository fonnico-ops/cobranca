// O vigia so tem duas decisoes proprias: quanto tempo faz, e se pode lembrar agora.
// As duas erram calado se estiverem erradas — o aviso simplesmente nao sai, ou sai de
// madrugada. Por isso os limites entram no teste, e nao a redacao da mensagem.
import { ha, podeLembrar } from "./vigia_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };
const AGORA = Date.parse("2026-09-25T12:00:00Z");
const atras = (min) => new Date(AGORA - min * 60000).toISOString();

console.log("1) ha(): tempo em texto de gente");
ok(ha(atras(0), AGORA) === "0 min", "agora mesmo");
ok(ha(atras(45), AGORA) === "45 min", "menos de uma hora fica em minutos");
ok(ha(atras(60), AGORA) === "1h", "uma hora certa nao vira 1h00");
ok(ha(atras(134), AGORA) === "2h14", "duas horas e quatorze");
ok(ha(atras(60 * 14), AGORA) === "14h", "a queda real de 24/09 (14 horas)");
// relogio do servidor atrasado em relacao ao banco nao pode virar tempo negativo
ok(ha(new Date(AGORA + 60000).toISOString(), AGORA) === "0 min", "data no futuro nao vira negativo");

console.log("2) podeLembrar(): so em horario de gente, e so depois da espera");
ok(podeLembrar(9, null, 3, AGORA) === true, "primeira vez, de manha: lembra");
ok(podeLembrar(7, null, 3, AGORA) === false, "7h ainda e cedo demais");
ok(podeLembrar(21, null, 3, AGORA) === false, "21h ja passou da hora");
ok(podeLembrar(8, null, 3, AGORA) === true, "8h e o primeiro horario valido");
ok(podeLembrar(20, null, 3, AGORA) === true, "20h e o ultimo horario valido");
ok(podeLembrar(12, atras(179), 3, AGORA) === false, "faltando 1 min para a espera: cala");
ok(podeLembrar(12, atras(180), 3, AGORA) === true, "espera cumprida no minuto exato: lembra");
ok(podeLembrar(12, atras(60), 1, AGORA) === true, "espera configuravel de 1h");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
