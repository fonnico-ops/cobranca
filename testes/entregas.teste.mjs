// O QUE ESTA SUITE TRAVA
//
// A tela de entregas fala com quem esta ao telefone com o cliente. Duas maneiras de ela
// mentir, e as duas ja aconteceram:
//
//   1. DIZER "entregue" SEM NINGUEM TER CONFIRMADO. A v8 do painel escrevia
//      "WhatsApp entregue 13:40" quando o fila_envio dizia 'enviado' — que significa "o CRM
//      aceitou e despachou". Ninguem devolve confirmacao de entrega do WhatsApp; quem diz ao
//      cliente "consta entregue" com base nisso perde a conversa quando ele responde que nao
//      recebeu nada. Aqui isso e proibido: 'enviado' vira `saiu`.
//
//   2. CONGELAR NO ESTADO DO CLIQUE. O livro `cobranca_entrega` e atualizado por cron de 10 em
//      10 minutos. Entre duas rodadas, a linha ATUAL do fila_envio manda — senao, em 25/09, as
//      24 mensagens presas pela queda do numero apareceriam como "na fila" mesmo depois de
//      sairem, e as que falharam apareceriam como se estivessem esperando.
import { doFila, estadoDaEntrega, ESTADO } from "./painel_puro.mjs";
//
//   3. UM RETRY QUE NAO TERMINA. Em 07/10 as 16:20 uma linha comecou a falhar na marcacao do
//      MCP com erro do servico do ERP. Como o codigo so gravava o erro e deixava a linha em
//      aberto, ela voltou a cada 10 minutos e rechamou os MESMOS 12 nufins: 144 rodadas,
//      1.881 chamadas pela mesma divida, ate alguem olhar o log. Nenhum cliente recebeu nada
//      (marcar nao e enviar), e e justamente por isso que ninguem perceberia sozinho. O bloco
//      5 prende as tres regras que faltavam: teto, memoria e fechar com o motivo.
import { doGhl, vereditoDaMarcacao } from "./entregas_puro.mjs";

let falhas = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); falhas++; } };

const AGORA = "2026-09-25T13:40:00.000Z";

console.log("1) o vocabulario do fila_envio, traduzido sem prometer entrega");
ok(doFila("enviado") === "saiu", "'enviado' = saiu (o CRM despachou), nunca 'entregue'");
ok(doFila("erro") === "erro", "'erro' = erro");
ok(doFila("pendente") === "na_fila", "'pendente' = na fila");
ok(doFila("agendado") === "na_fila", "'agendado' = na fila");
ok(doFila("enviando") === "na_fila", "'enviando' (reservada por uma rodada) = na fila, nao 'saiu'");
ok(!Object.keys(ESTADO).includes("lido"), "nao existe estado 'lido' — ninguem nos informa leitura");

console.log("2) a linha da fila ganha do livro (o livro atrasa ate 10 minutos)");
{
  // caso real de 25/09: o livro nasceu 'na_fila' e a mensagem saiu 13:33
  const livro = { canal: "whatsapp", fila_id: 10159, estado: "na_fila", criado_em: AGORA, detalhe: null };
  const r = estadoDaEntrega(livro, { "10159": { status: "enviado", enviado_em: "2026-09-25T16:33:00.000Z" } });
  ok(r.estado === "saiu", "fila diz 'enviado' e o livro diz 'na_fila' -> saiu");
  ok(r.quando === "13:33", `o horario e o do envio, em Sao Paulo (veio ${r.quando})`);
}
{
  // caso real: "instancia desconectada — o GHL aceitou mas o ZaptosWPP nao entregou"
  const livro = { canal: "whatsapp", fila_id: 10143, estado: "na_fila", criado_em: AGORA };
  const r = estadoDaEntrega(livro, { "10143": { status: "erro", enviado_em: AGORA, resultado: "instancia desconectada — o GHL aceitou mas o ZaptosWPP nao entregou: [System]: Nina Financeiro - The instance is disconnected." } });
  ok(r.estado === "erro", "fila diz 'erro' -> erro, mesmo com o livro em 'na_fila'");
  ok(/desconectada/.test(r.nota), "o motivo mostrado e o texto de quem recusou, nao um resumo nosso");
}
{
  const livro = { canal: "whatsapp", fila_id: 10160, estado: "na_fila", criado_em: AGORA };
  const r = estadoDaEntrega(livro, { "10160": { status: "pendente", criado_em: "2026-09-25T16:32:00.000Z" } });
  ok(r.estado === "na_fila" && r.quando === "13:32", "presa na fila mostra desde quando espera");
  ok(/esperando a vez/.test(r.nota), "e diz que esta esperando a vez, nao que falhou");
}
{
  // linha da fila apagada (retencao): o livro e o que sobrou, e nao pode virar erro
  const r = estadoDaEntrega({ canal: "whatsapp", fila_id: 9, estado: "saiu", saiu_em: AGORA }, {});
  ok(r.estado === "saiu", "sem linha na fila, o livro vale");
}

console.log("3) o e-mail so vira 'entregue' quando o provedor confirma");
{
  const r = estadoDaEntrega({ canal: "email", estado: "saiu", saiu_em: AGORA, ghl_email_id: "abc" }, {});
  ok(r.estado === "saiu", "POST aceito, sem confirmacao: saiu");
  ok(/sem confirmação do provedor/.test(r.nota), "e a tela diz que ainda nao ha confirmacao");
}
{
  const r = estadoDaEntrega({ canal: "email", estado: "saiu", saiu_em: AGORA }, {});
  ok(/não devolveu id/.test(r.nota), "e-mail antigo sem id: a tela diz por que nunca vai confirmar");
}
{
  const r = estadoDaEntrega({ canal: "email", estado: "entregue", confirmado_em: AGORA }, {});
  ok(r.estado === "entregue" && r.quando === "10:40", "'delivered' do GHL -> entregue, na hora da confirmacao");
}
{
  const r = estadoDaEntrega({ canal: "email", estado: "erro", detalhe: "o provedor de e-mail devolveu: bounced", criado_em: AGORA }, {});
  ok(r.estado === "erro" && /bounced/.test(r.nota), "e-mail que voltou aparece como erro, com a palavra do provedor");
}

console.log("4) o que o GHL responde sobre um e-mail");
ok(doGhl("delivered").estado === "entregue", "delivered -> entregue");
ok(doGhl("opened").estado === "aberto", "opened -> aberto");
ok(doGhl("clicked").estado === "aberto", "clicked -> aberto (clicou, logo abriu)");
ok(doGhl("bounced").estado === "erro", "bounced -> erro");
ok(doGhl("failed").estado === "erro", "failed -> erro");
ok(doGhl("unsubscribed").estado === "erro", "unsubscribed -> erro (o endereco nao recebe mais)");
ok(doGhl("pending") === null, "pending nao muda nada — continua 'saiu'");
ok(doGhl("sent") === null, "'sent' do GHL NAO e entrega: nao mexe no estado");
ok(doGhl("") === null, "resposta vazia nao inventa estado");
ok(doGhl("DELIVERED").estado === "entregue", "maiuscula do GHL nao engana o classificador");

console.log("5) a marcacao no MCP termina — sempre");
const TETO = 5;
const v = (tentativas, erros, sobrouTempo = true) => vereditoDaMarcacao({ tentativas, teto: TETO, erros, sobrouTempo });
{
  const r = v(0, []);
  ok(r.fecha && !r.desistiu && r.erro === null, "marcou tudo: fecha a linha e nao volta mais");
}
{
  const r = v(0, [], false);
  ok(!r.fecha && r.tentativas === 0 && r.erro === null,
     "faltou tempo: volta na proxima rodada e NAO queima tentativa (ficar sem minuto nao e recusa do MCP)");
}
{
  const r = v(0, ["1960805: Erro no servico NitronBoletoSP"]);
  ok(!r.fecha && r.tentativas === 1 && /tentativa 1\/5/.test(r.erro), "primeiro erro: conta a tentativa e volta");
}
{
  const r = v(3, ["1960805: Erro no servico NitronBoletoSP"]);
  ok(!r.fecha && r.tentativas === 4, "quarta tentativa ainda volta");
}
{
  const r = v(4, ["1960805: Erro no servico NitronBoletoSP"]);
  ok(r.fecha && r.desistiu, "no teto a linha FECHA — e isto que impede as 1.881 chamadas");
  ok(/desistiu apos 5 tentativas/.test(r.erro), "e fecha com o motivo escrito, nao em silencio");
  ok(/NitronBoletoSP/.test(r.erro), "guardando o erro do MCP, para a TI achar depois");
}
{
  // a prova do laco: simula as rodadas do cron com um erro que nunca passa
  let tentativas = 0, rodadas = 0, chamadas = 0;
  const NUFINS = 12;
  while (rodadas < 500) {
    const r = v(tentativas, Array.from({ length: NUFINS }, (_, i) => `${i}: erro`));
    chamadas += NUFINS; tentativas = r.tentativas; rodadas++;
    if (r.fecha) break;
  }
  ok(rodadas === TETO, `erro permanente para em ${TETO} rodadas (antes: ilimitadas)`);
  ok(chamadas === TETO * NUFINS, `o MCP leva ${TETO * NUFINS} chamadas no pior caso, nao 1.881`);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
