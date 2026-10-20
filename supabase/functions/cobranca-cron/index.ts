// cobranca-cron (v3) — a cadencia. Chamado 1x por hora; ele mesmo decide se e a hora.
//
// v2: chamava `cobranca-titulos-refresh`, que e uma COPIA VELHA ainda publicada. O refresh
//     de verdade esta publicado como `cobranca-refresh` (e e ele que os crons do 014 usam).
//     Com o nome errado, toda rodada de seg/qua/sex reescrevia o espelho sem `dt_impressao`
//     e sem a fase `futuro` — ou seja, apagava justamente o que o cobranca-emitidos usa para
//     achar o boleto recem-registrado no banco — e sem `boleto_geravel`, o que faz o cliente
//     da Grafeno ouvir "providencio a 2a via" de um boleto que o banco emitiu. O nome da
//     pasta no repositorio agora e o mesmo da funcao publicada, para o erro nao voltar.
//
// Cadencia escolhida pelo gestor (mudou em 20/10):
//   vencidos   TERCA, QUINTA e SEXTA, de manha
//   a vencer   SEGUNDA de manha
//
// POR QUE SEGUNDA SAIU DA COBRANCA: na segunda o espelho ainda carrega os vencimentos de
// sabado e domingo que o financeiro nao teve como baixar — cobrar ali e cobrar quem pagou
// na sexta ou vai pagar na segunda. Terca o movimento do fim de semana ja entrou.
//
// E POR QUE O LEMBRETE FOI PARA SEGUNDA: ele olha para FRENTE (o que vence nos proximos
// dias), entao o atraso da baixa do fim de semana nao o afeta. Segunda ficou livre, e sexta
// passou a ser dia de cobranca, como o gestor pediu. Antes as duas fases caiam na sexta e o
// a_vencer ganhava; com os dois em dias proprios, ninguem leva dois toques no mesmo dia e o
// lembrete deixou de atropelar a cobranca (hoje 95 dos 234 grupos com titulo vencido TAMBEM
// tem titulo a vencer — a sobreposicao era de 40%, nao um detalhe).
// O texto do lembrete deixou de dizer "na proxima semana": saindo na segunda, a janela de
// 7 dias cai dentro da mesma semana. Agora diz "nos proximos dias", que e verdade sempre.
//
// A ORDEM IMPORTA e por isso o encadeamento e serial:
//   1. cobranca-refresh           o Sankhya manda: quem deve, quanto, e ha quanto tempo
//   2. cobranca-boleto            rende o PDF do que tem linha digitavel
//   3. cobranca-montar            monta os cards com o boleto JA hospedado
//   4. cobranca-aprovar           so quando cobranca_config.auto_aprovar estiver ligado
// Montar antes de renderizar o boleto produziria card sem anexo, dizendo ao cliente que o
// boleto vai junto quando nao vai.
//
// Fuso: America/Sao_Paulo, sempre. O Deno roda em UTC e "sexta de manha" em UTC e quinta a
// noite no Brasil — o aviso da semana sairia um dia antes, toda semana.
//
// GET/POST ?forcar=vencido|a_vencer  ignora o calendario e roda agora (para teste)
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Dia da semana (0=dom) e hora, em Sao Paulo. */
function agoraSp() {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dias[String(p.weekday)] ?? -1, hora: Number(p.hour) };
}

const HORA = 9;                       // 9h de Sao Paulo
const DIAS_VENCIDO = [2, 4, 5];       // ter, qui, sex
const DIAS_A_VENCER = [1];            // seg

async function chamar(nome: string, corpo: unknown) {
  const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/" + nome, {
    method: "POST",
    headers: { Authorization: "Bearer " + srvKey(), "Content-Type": "application/json" },
    body: JSON.stringify(corpo ?? {}),
  });
  const d = await r.json().catch(() => ({ ok: false, erro: "resposta ilegivel" }));
  return { etapa: nome, http: r.status, ...d };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const u = new URL(req.url);
    const forcar = u.searchParams.get("forcar");
    const { dow, hora } = agoraSp();

    let fase: string | null = null;
    if (forcar === "vencido" || forcar === "a_vencer") fase = forcar;
    else if (hora === HORA && DIAS_A_VENCER.includes(dow)) fase = "a_vencer";
    else if (hora === HORA && DIAS_VENCIDO.includes(dow)) fase = "vencido";
    // Desde 20/10 as duas listas sao disjuntas (a_vencer na segunda, vencido ter/qui/sex),
    // entao nenhum dia cai nas duas. A ordem acima vira redundancia de proposito: se alguem
    // reaproveitar um dia nas duas listas, o lembrete continua ganhando e o cliente segue
    // recebendo UM toque por dia.

    if (!fase) return j({ ok: true, rodou: false, motivo: `fora da janela (SP: dow=${dow} hora=${hora}h; vencido ter/qui/sex ${HORA}h, a_vencer seg ${HORA}h)` });

    const passos: any[] = [];
    // 1. o Sankhya e a fonte da verdade; sem ele nao ha o que cobrar
    const refresh = await chamar("cobranca-refresh", {});
    passos.push(refresh);
    if (!refresh.ok) return j({ ok: false, fase, erro: "o refresh do Sankhya falhou — nada foi montado nem disparado", passos }, 502);

    // 2. boletos. Falhar aqui NAO para a rodada: cobranca sem anexo ainda e cobranca, e o
    //    texto ja diz que a 2a via vem a pedido. Parar tudo por causa do PDF seria pior.
    passos.push(await chamar("cobranca-boleto", { limite: 400 }));

    // 3. monta os cards
    const montar = await chamar("cobranca-montar", { fase });
    passos.push(montar);
    if (!montar.ok) return j({ ok: false, fase, erro: "o montar falhou", passos }, 502);

    // 4. dispara, so no modo automatico
    if (montar.auto_aprovar === true) passos.push(await chamar("cobranca-aprovar", { todos: true, fase, aprovado_por: "cron" }));

    return j({
      ok: true, rodou: true, fase, hora_sp: hora, dow,
      auto_aprovar: montar.auto_aprovar === true,
      aguardando_painel: montar.auto_aprovar === true ? 0 : (montar.gravados ?? 0),
      passos,
    });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
