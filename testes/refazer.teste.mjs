// REFAZER A ANALISE E A CARGA.
//
// Pedido do gestor em 21/10: um botao para "gerar uma nova analise e nova carga, considerando
// que as meninas podem nao ter baixado todos os titulos ainda". O Sankhya so sabe o que o
// financeiro lancou, entao quem opera precisa poder refazer a conta quando os lancamentos
// entrarem — nao apenas no horario do cron.
//
// Este arquivo existe por causa de UMA armadilha, que e a razao de o refazer nao ser
// simplesmente "recusar tudo e montar de novo":
//
//   O cobranca-montar monta a lista de `intocaveis` com enfileirado + aprovado + RECUSADO
//   **da rodada e fase que ele esta montando** (montar/index.ts, "jaSairam"). Se o refazer
//   marcasse os cards de HOJE como recusados, o montar os trataria como intocaveis e a nova
//   carga sairia sem exatamente os clientes que o gestor quis refazer — em silencio, com
//   cara de lote pequeno. O erro nao daria exception nenhuma.
//
// Entao o refazer descarta SO o pendente de rodada ANTERIOR (que tem outra chave e por isso
// nao envenena nada), e deixa a rodada de hoje para o proprio montar, que ja faz upsert nos
// escolhidos e apaga os `aguardando` que nao escolheu.
//
// Os testes abaixo travam esse contrato nas duas pontas: no painel (o que ele descarta) e no
// montar (por que nao pode ser mais do que isso).
import fs from "node:fs";
import { pagina } from "./painel_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

const painel = fs.readFileSync(new URL("../supabase/functions/cobranca-painel/index.ts", import.meta.url), "utf8");
const montar = fs.readFileSync(new URL("../supabase/functions/cobranca-montar/index.ts", import.meta.url), "utf8");

const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const ontem = new Date(Date.now() - 6 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const card = (id, rodada) => ({
  id, grupo: id, nome: "CLIENTE " + id, n_titulos: 1, valor: 1000, maior_atraso: 10,
  fase: "vencido", status: "aguardando", rodada,
  contatos: [{ canal: "email", valor: "a@b.c", origem: "sankhya_financeiro" }],
  boletos: [], boleto_links: [], codparcs: [id], mensagem: "Ola",
});

const ctx = (proximos) => ({
  rodada: hoje, fase: "vencido", instancia: "Karla e Bianca", desligado: false, sufixo: "&k=K",
  wppPausado: false, segPorMsg: 60, porCard: {}, fila: {}, rodizio: ["Karla", "Bianca"], caidas: [],
  intervaloSeg: 120, janelaDe: 8, janelaAte: 20, semVeredito: 0, deOndeVem: "rodada " + hoje,
  atrasados: 0, diasDoMaisVelho: 0, proximos, api: "https://x/func?fase=vencido&k=K",
});

console.log("1) o botao de refazer aparece MESMO sem proximo lote");
{
  // e o ponto principal do desenho: "Montar este lote agora" vive dentro da previa do proximo
  // lote e desaparece quando ela esta vazia. Se o refazer morasse no mesmo bloco, o gestor
  // ficaria sem saida justamente quando todo mundo elegivel ja tem card pendente.
  const semProximo = pagina([card(1, ontem)], ctx({ grupos: 0, valor: 0, teto: 60, rodadas: 1, quando: "quinta, 9h", lista: [] }));
  ok(!semProximo.includes('id="montar"'), "sem proximo lote, o botao de montar nao esta na tela");
  ok(semProximo.includes('id="refazer"'), "mas o de refazer esta");

  const comProximo = pagina([card(1, ontem)], ctx({ grupos: 148, valor: 323159, teto: 60, rodadas: 4, quando: "quinta, 9h", lista: [] }));
  ok(comProximo.includes('id="montar"') && comProximo.includes('id="refazer"'), "com proximo lote, os dois aparecem");
}

console.log("2) o botao diz quantos cards vai descartar ANTES do clique");
{
  const html = pagina([card(1, ontem), card(2, ontem), card(3, hoje)], ctx({ grupos: 0, valor: 0, teto: 60, rodadas: 1, quando: "quinta, 9h", lista: [] }));
  ok(/data-velhos="2"/.test(html), "2 de rodada anterior contados (o de hoje nao entra)");
  ok(/descarta 2/.test(html), "e o numero esta no rotulo do botao");
  ok(/2 card\(s\) que ainda esperam aprova/.test(html), "com a explicacao do que sai da tela");

  const sohoje = pagina([card(3, hoje)], ctx({ grupos: 0, valor: 0, teto: 60, rodadas: 1, quando: "quinta, 9h", lista: [] }));
  ok(/data-velhos="0"/.test(sohoje), "so cards de hoje: nada a descartar");
  ok(!/descarta /.test(sohoje), "e o rotulo nao promete descarte nenhum");
  ok(/Não há card de rodada anterior/.test(sohoje), "a tela diz isso em vez de ficar muda");
}

console.log("3) o painel descarta SO rodada anterior — a armadilha dos intocaveis");
{
  const i = painel.indexOf("let descartados = 0;");
  const bloco = painel.slice(i, painel.indexOf("descartados = (limpos", i));
  ok(i > -1 && bloco.length > 100, "o bloco do descarte foi encontrado no cobranca-painel");
  ok(/\.eq\("status", "aguardando"\)/.test(bloco), "mexe so em card 'aguardando' (rascunho)");
  ok(/\.lt\("rodada", hoje\)/.test(bloco), "e so em rodada ANTERIOR a hoje");
  ok(!/\.lte\("rodada"/.test(bloco) && !/\.eq\("rodada", hoje\)/.test(bloco),
     "nunca a rodada de hoje — seria o que envenena os intocaveis do montar");
  ok(/\.eq\("fase", fase\)/.test(bloco), "e so a fase que esta sendo refeita");
}

console.log("4) e o montar confirma POR QUE nao pode ser mais do que isso");
{
  // se alguem um dia tirar o "recusado" daqui, o refazer poderia descartar a rodada de hoje
  // sem efeito colateral — e este teste e que vai mostrar que a regra mudou.
  const j = montar.indexOf("jaSairam");
  const linha = montar.slice(j, j + 400);
  ok(/"enfileirado", "aprovado", "recusado"/.test(linha),
     "o montar trata RECUSADO da mesma rodada+fase como intocavel");
  ok(/\.eq\("rodada", rodada\)/.test(linha), "restrito a rodada que ele esta montando (por isso rodada velha e segura)");
}

console.log("5) reler o Sankhya vem ANTES de descartar");
{
  const i = painel.indexOf('b.acao === "montar" || b.acao === "refazer"');
  const bloco = painel.slice(i, painel.indexOf("const ids = (Array.isArray(b.ids)"));
  const posRefresh = bloco.indexOf("cobranca-refresh");
  const posDescarte = bloco.indexOf('status: "recusado"');
  const posMontar = bloco.indexOf("cobranca-montar");
  ok(posRefresh > -1 && posDescarte > -1 && posMontar > -1, "as tres etapas estao no mesmo bloco");
  ok(posRefresh < posDescarte, "refresh antes do descarte: Sankhya mudo nao destroi a fila pendente");
  ok(posDescarte < posMontar, "e o descarte antes do montar");
  ok(/erro: "nao consegui descartar/.test(bloco), "descarte que falha interrompe, em vez de montar pela metade");
}

console.log("6) montar e refazer dividem o mesmo caminho no cliente");
{
  // duas copias foi o que deixou o botao de montar sem o refresh por uma versao inteira
  ok(/async function montagem\(acao, b\)/.test(painel), "ha uma funcao so");
  ok(/montagem\("montar",/.test(painel) && /montagem\("refazer",/.test(painel), "e os dois botoes a chamam");
  ok(/acao:acao/.test(painel), "o POST leva a acao escolhida");
  const i = painel.indexOf("async function montagem(acao, b)");
  const fn = painel.slice(i, i + 2600);
  ok(!/ids:/.test(fn), "e nao leva ids: refazer nao e uma acao sobre cards selecionados");
  ok(/confirm\(pergunta\)/.test(fn), "com confirmacao antes");
  ok(/descartados/.test(fn), "e o resultado diz quantos foram descartados");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
