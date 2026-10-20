// A CADENCIA: em que dia cada fase roda.
//
// Isto e uma linha de configuracao (`DIAS_VENCIDO`, `DIAS_A_VENCER`) e por isso parece nao
// merecer teste. Merece, por tres motivos que ja custaram caro neste projeto:
//
//   1. ERRAR UM DIA NAO DA ERRO. O cron responde `rodou: false, motivo: "fora da janela"` e
//      vai embora. Ninguem e avisado; a cobranca simplesmente nao acontece, e so se descobre
//      quando alguem estranha o silencio — foi assim que uma semana inteira passou sem
//      ninguem aprovar nada, em 15/10.
//   2. AS DUAS LISTAS NAO PODEM SE CRUZAR. Enquanto sexta estava nas duas, o lembrete ganhava
//      e a cobranca daquele dia nao saia. Com 95 dos 234 grupos vencidos tendo TAMBEM titulo
//      a vencer (40%), um dia compartilhado significa cliente recebendo dois toques ou
//      cobranca sumindo em silencio.
//   3. SEGUNDA E PROIBIDA PARA COBRANCA, por uma regra de negocio que nao esta no codigo:
//      na segunda o espelho ainda tem os vencimentos de sabado e domingo que o financeiro
//      nao teve como baixar. Cobrar ali e cobrar quem ja pagou. O teste guarda a regra.
import fs from "node:fs";

const fonte = fs.readFileSync(new URL("../supabase/functions/cobranca-cron/index.ts", import.meta.url), "utf8");
const lista = (nome) => {
  const m = fonte.match(new RegExp(nome + "\\s*=\\s*\\[([^\\]]*)\\]"));
  if (!m) return null;
  return m[1].split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
};

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };
const NOME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const vencido = lista("DIAS_VENCIDO");
const aVencer = lista("DIAS_A_VENCER");

console.log("1) os dias combinados com o gestor (20/10): cobrança terça, quinta e sexta");
ok(!!vencido && !!aVencer, "as duas listas foram encontradas no cobranca-cron");
ok(JSON.stringify(vencido) === JSON.stringify([2, 4, 5]),
   `cobrança em ${(vencido || []).map((d) => NOME[d]).join(", ")}`);
ok(JSON.stringify(aVencer) === JSON.stringify([1]),
   `lembrete em ${(aVencer || []).map((d) => NOME[d]).join(", ")}`);

console.log("2) segunda não cobra — o fim de semana ainda não foi baixado");
ok(!(vencido || []).includes(1), "segunda fora da cobrança");
ok(!(vencido || []).includes(0) && !(vencido || []).includes(6), "e fim de semana também");

console.log("3) as listas não se cruzam — ninguém leva dois toques no mesmo dia");
{
  const cruza = (vencido || []).filter((d) => (aVencer || []).includes(d));
  ok(cruza.length === 0, cruza.length ? "cruzam em " + cruza.map((d) => NOME[d]).join(", ") : "nenhum dia em comum");
}

console.log("4) o texto do lembrete não promete semana que não é a dele");
{
  const montar = fs.readFileSync(new URL("../supabase/functions/cobranca-montar/index.ts", import.meta.url), "utf8");
  // saindo na segunda, a janela de 7 dias cai DENTRO da mesma semana
  ok(!/na próxima semana/.test(montar), "a mensagem não diz mais 'na próxima semana'");
  ok(!/da próxima semana/.test(montar), "nem o assunto do e-mail");
  ok(/nos próximos dias/.test(montar), "e diz 'nos próximos dias', que é verdade em qualquer dia de envio");
}

console.log("5) montar pela tela relê o Sankhya antes — recalcular no dia da geração");
{
  const painel = fs.readFileSync(new URL("../supabase/functions/cobranca-painel/index.ts", import.meta.url), "utf8");
  const bloco = painel.slice(painel.indexOf('b.acao === "montar"'), painel.indexOf('const ids = (Array.isArray(b.ids)'));
  ok(bloco.includes("cobranca-refresh"), "o botão chama o cobranca-refresh");
  ok(bloco.indexOf("cobranca-refresh") < bloco.indexOf("cobranca-montar"), "e chama ANTES do montar");
  ok(/return j\(\{ ok: false/.test(bloco), "refresh que falha interrompe: não monta com número velho");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
