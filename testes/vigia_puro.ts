// cobranca-vigia (v2) — olha o numero de WhatsApp da cobranca e AVISA uma pessoa quando ele cai.
//
// POR QUE EXISTE. Em 24/09 as 18:24 o ZaptosWPP escreveu, dentro da propria conversa, que a
// "Nina Financeiro" estava desconectada. O trilho compartilhado fez a parte dele: pausou a
// instancia, e a partir dali o cobranca-aprovar passou a recusar lote (409, nada enfileirado)
// e as 10 mensagens que ja estavam na fila ficaram paradas, com zero tentativa. Ou seja: o
// sistema se protegeu sozinho, e ninguem ficou sabendo. O numero passou 14 horas fora do ar e
// a cobranca do dia simplesmente nao aconteceu — sem erro na tela, sem aviso, sem nada.
//
// Um robo que para sozinho e bom. Um robo que para sozinho e nao conta para ninguem vira um
// dia perdido por semana. Esta funcao e so isso: contar.
//
// O QUE ELA FAZ, a cada 10 minutos:
//   1. le o estado da instancia da cobranca em instancia_ghl (pausada_em)
//   2. compara com o que viu da ultima vez (cobranca_config.vigia_estado)
//   3. CAIU   -> manda WhatsApp para o numero de alerta, por OUTRA instancia (a que caiu nao
//                manda nada — seria pedir para o aparelho quebrado avisar que quebrou)
//      VOLTOU -> avisa que voltou e quantas mensagens foram liberadas
//      CONTINUA CAIDA -> lembra a cada N horas, so em horario comercial, para nao sumir do radar
//
// GET/POST ?liberar=1&k=<painel_chave>  tira a pausa depois que o numero voltou no Zaptos, e
//   responde quantas mensagens estao liberadas. O link vai dentro do proprio aviso: quem
//   reconectou o numero e quem sabe que ele voltou, e isso tem de ser um clique, nao um chamado.
//
// O QUE ELA NAO FAZ. Ela nao tira a pausa sozinha. Nao da para saber daqui se o aparelho
// voltou — o que temos e a ausencia de erro, que nao e a mesma coisa. Tirar a pausa no
// chute recomeca o envio no ar e e assim que um numero vira restringido (foi o que aconteceu
// com a "Campanhas Nitron" em 27/08, e ela esta fora ate hoje).


const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const horaSp = () => Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
const qdo = (t: any) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/** Horas que o numero ficou fora, em texto de gente. */
export function ha(desde: any, agora = Date.now()): string {
  const min = Math.max(0, Math.round((agora - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** So incomoda em horario de gente: aviso de madrugada nao e lido e ainda ensina a ignorar. */
export function podeLembrar(hora: number, ultimoEm: any, esperaHoras: number, agora = Date.now()): boolean {
  if (hora < 8 || hora > 20) return false;
  if (!ultimoEm) return true;
  return agora - new Date(ultimoEm).getTime() >= esperaHoras * 3600000;
}

