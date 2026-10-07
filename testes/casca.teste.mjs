// A CASCA DO PAINEL — o arquivo que o navegador abre (docs/painel.html).
//
// POR QUE ISTO E UM TESTE, e nao "basta olhar o arquivo": este arquivo quebrou DUAS VEZES em
// 07/10, do mesmo jeito, e nos dois casos o sintoma na mao do gestor foi o mesmo — "o botao
// aprovar nao esta funcionando" — porque a tela aparece e o JS nao roda.
//
//   1. o fechamento do comentario de HTML desapareceu numa edicao, junto com a abertura do
//      corpo e a tag de abertura do bloco de codigo: o navegador engoliu tudo como comentario;
//   2. o conserto trouxe o bug de volta ao CITAR o fechamento do comentario dentro da prosa —
//      comentario de HTML nao tem escape, entao o comentario fechou ali e a prosa seguinte
//      virou codigo ("script is not defined" no console).
//
// Comentario de HTML nao da erro em lugar nenhum: nao quebra build, nao falha deploy, nao
// aparece em log. Some em silencio no navegador de quem precisa clicar. Por isso a conferencia
// mora aqui, e roda junto com as outras.
import fs from "node:fs";

const arq = new URL("../docs/painel.html", import.meta.url);
const html = fs.readFileSync(arq, "utf8");

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

console.log("1) o comentario abre e fecha uma vez, e nada depois dele");
{
  const abre = (html.match(/<!--/g) || []).length;
  const fecha = (html.match(/-->/g) || []).length;
  ok(abre === fecha, `${abre} abertura(s) e ${fecha} fechamento(s) de comentario`);
  // o fechamento NAO pode aparecer antes do fim da prosa: se aparecer no meio, o navegador
  // fecha o comentario ali e o resto vira HTML/JS
  const i = html.indexOf("<!--");
  const j = html.indexOf("-->", i);
  const dentro = html.slice(i, j);
  ok(!dentro.includes("<script"), "a prosa do comentario nao cita a tag de abertura do codigo");
  ok(!dentro.includes("</script"), "nem a de fechamento");
  ok((dentro.match(/-->/g) || []).length === 0, "nem o fechamento do proprio comentario");
}

console.log("2) o codigo esta FORA de qualquer comentario");
{
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, "");
  ok(/<script>/.test(semComentario), "a tag de abertura do codigo sobrevive a remocao dos comentarios");
  ok(/<\/script>/.test(semComentario), "e a de fechamento tambem");
  ok(semComentario.includes("document.write"), "o document.write esta no codigo que roda");
  ok(semComentario.includes("cobranca-painel"), "o endereco da funcao esta no codigo que roda");
}

console.log("3) o basico da pagina");
{
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, "");
  ok(/<body/.test(semComentario), "tem <body>");
  ok(/id="caixa"/.test(semComentario), "tem a caixa de carregamento (#caixa), onde o erro aparece");
  ok(semComentario.includes("getElementById(\"caixa\")"), "e o tratamento de erro escreve nela");
}

console.log("4) sem variavel global — a tela da producao declara `const API` no mesmo global");
{
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, "");
  const corpo = semComentario.slice(semComentario.indexOf("<script>"));
  ok(/\(function \(\) \{/.test(corpo), "o codigo roda dentro de uma funcao anonima");
  ok(!/^\s*(var|let|const)\s+API\b/m.test(corpo), "e nao declara nenhum `API` global");
}

console.log("5) a chave nao esta no arquivo (o repositorio e publico)");
{
  // a chave de hoje tem 28 caracteres de letras e numeros; o que nao pode e um literal assim
  // colado num campo de chave. `painel_k` (o nome da gaveta no navegador) pode aparecer.
  ok(!/painel_chave\s*=\s*["'][a-z0-9]{12,}/i.test(html), "nenhuma chave literal no arquivo");
  ok(html.includes('q.get("k")'), "a chave vem do link, como deve");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
