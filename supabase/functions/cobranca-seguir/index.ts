// cobranca-seguir (v2) — a insistencia, e o ponto em que ela para.
//
// O cobranca-montar/aprovar da UM toque e acaba. Quem nao responde ao primeiro toque nunca
// mais e lembrado — e quem nao responde ao primeiro toque e exatamente quem se queria cobrar.
// Esta funcao e a cadencia: toca de novo enquanto ninguem responde, e no fim entrega a uma
// pessoa em vez de continuar batendo.
//
// CINCO TOQUES, DEPOIS REPASSA (decisao da gestao).
//   O toque 1 e a cobranca do cobranca-aprovar, que ja nasce gravada em cobranca_conversa.
//   Os toques 2 a 5 saem daqui, com espera crescente (cobranca_config.toques_espera).
//   Vencido o quinto, a conversa vai para a Karla ou a Bianca. NAO existe toque 6: o robo
//   que insiste para sempre nao cobra, so treina o cliente a ignorar o numero.
//
// O TEXTO E DE CODIGO, NAO DE IA.
//   Mesma razao do cobranca-montar: aqui vai valor, vencimento e NF. Um digito trocado manda
//   o cliente pagar o que nao deve. Quem improvisa e o cobranca-atende, e la o modelo nao
//   pode escrever algarismo nenhum.
//
// DUAS COISAS QUE ESTA FUNCAO NAO FAZ, DE PROPOSITO:
//   - nao toca conversa 'repassada': dela a pessoa cuida, e robo escrevendo por cima da
//     atendente apaga o trabalho dela no meio;
//   - nao toca quem pediu para parar (nao_perturbe), nem quem ja pagou.
//
// v2: DO 3o TOQUE EM DIANTE O TOM ENDURECE (decisao da gestao em 22/09). A severidade vem
//     dos DIAS DE ATRASO reais, nao do numero do toque, e cada passo da regua e anunciado
//     com a data exata. Ver blocoRegua() — e as tres regras que a mantem honesta.
//
// POST { dry?: true, limite?: n, ignorar_janela?: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(" · ") || String(e);
const API = "https://services.leadconnectorhq.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0 Safari/537.36";

const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}` : String(iso || ""); };
const dataBrLonga = (iso: any) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ""); };
const primeiroNome = (s: any) => { const p = String(s || "").trim().split(/\s+/)[0] || ""; return /^\p{L}{3,}$/u.test(p.replace(/[^\p{L}]/gu, "")) ? p : ""; };

/** Dia da semana e hora em Sao Paulo. O Deno roda em UTC, e "9h de sexta" em UTC e quinta. */
export function agoraSp(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dias[String(p.weekday)] ?? -1, hora: Number(p.hour) };
}

/**
 * Quando cai o proximo toque: `dias` corridos a frente, as 12:00 UTC (~9h em SP), e nunca
 * num sabado ou domingo. Cobranca que chega no sabado nao e lida — e queima um toque de um
 * orcamento de cinco.
 */
export function proximoToqueEm(dias: number, base = new Date()): Date {
  const d = new Date(base.getTime() + Math.max(1, dias) * 86400000);
  d.setUTCHours(12, 0, 0, 0);
  while ([0, 6].includes(new Date(d).getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/* ==================================================================== a regua
 * Os passos da cobranca por DIAS DE ATRASO, vindos de cobranca_config.regua_cobranca:
 *   10 dias  negativacao nos orgaos de protecao ao credito
 *   15 dias  protesto em cartorio
 *   25 dias  notificacao extrajudicial
 *
 * DUAS REGRAS QUE NAO SAO ESTILO, SAO O QUE MANTEM O AVISO VALENDO:
 *
 * 1. A mensagem anuncia o que VAI acontecer, com a data. Nunca afirma que um passo ja
 *    foi executado — este motor nao negativa, nao protesta e nao notifica ninguem; quem
 *    faz isso e o financeiro. Escrever "seu titulo foi negativado" quando ninguem
 *    negativou e mentir para o cliente, e ele descobre em um telefonema.
 *
 * 2. A data sai do VENCIMENTO do titulo mais antigo + os dias do passo, calculada aqui.
 *    Prazo redondo ("em breve", "nos proximos dias") nao cobra ninguem: e a data no
 *    calendario que faz a pessoa pagar.
 *
 * E a terceira, que e da gestao e nao do codigo: so pode estar na regua o que a empresa
 * faz de verdade. Anunciar um passo e nao executa-lo ensina a carteira inteira a ignorar
 * o aviso — e ai nenhuma mensagem funciona mais.
 */
export function blocoRegua(maisAntigoVenc: string, atraso: number, regua: any[]): string {
  const passos = (Array.isArray(regua) ? regua : [])
    .map((r) => ({ dias: Number(r?.dias) || 0, passo: String(r?.passo || "").trim() }))
    .filter((r) => r.dias > 0 && r.passo)
    .sort((a, b) => a.dias - b.dias);
  if (!passos.length || !maisAntigoVenc) return "";

  const emData = (dias: number) => {
    const d = new Date(maisAntigoVenc + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + dias);
    return dataBrLonga(d.toISOString().slice(0, 10));
  };
  const lista = passos.map((r) => `• ${r.dias} dias de atraso — ${r.passo}`).join("\n");
  const proximo = passos.find((r) => r.dias > atraso);

  return [
    "Como funciona a cobrança aqui:",
    lista,
    proximo
      ? `O próximo passo é ${proximo.passo}, em ${emData(proximo.dias)}.`
      : "Todos os prazos acima já venceram neste título.",
  ].join("\n\n");
}

/* ===================================================================== os textos
   Tres regras herdadas do cobranca-montar, que valem igual aqui:
   nunca ameacar SEM base, nunca citar outro cliente, e sempre deixar uma saida — cobranca
   sem saida vira briga, e briga nao paga titulo. Do 3o toque em diante a regua entra, e ai
   o que endurece e a CLAREZA sobre o que vai acontecer e quando, nao o tom agressivo. */
export function textoToque(n: number, ctx: {
  nome: string; total: number; titulos: any[]; temBoleto: boolean; empresa: string; maxToques: number;
  atraso?: number; regua?: any[];
}): string {
  const ola = ctx.nome ? `Olá, ${ctx.nome}!` : "Olá!";
  const plural = ctx.titulos.length > 1;
  const maisAntigo = ctx.titulos.slice().sort((a, b) => String(a.dtvenc).localeCompare(String(b.dtvenc)))[0];
  const resumo = plural
    ? `São ${ctx.titulos.length} títulos em aberto, somando ${brl(ctx.total)} — o mais antigo venceu em ${dataBr(maisAntigo?.dtvenc)}.`
    : `É um título de ${brl(ctx.total)}, vencido em ${dataBr(maisAntigo?.dtvenc)}.`;
  const boleto = ctx.temBoleto
    ? (plural ? "Os boletos seguem em anexo." : "O boleto segue em anexo.")
    : "Se precisar da segunda via, é só me pedir que eu providencio.";

  /* ---- do 3o toque em diante o tom endurece, mas SO com divida vencida -------------
     A regua fala em negativacao, cartorio e notificacao extrajudicial. Num aviso de
     vencimento futuro, ou num titulo que ainda nao venceu, isso nao faz sentido nenhum
     e destroi a relacao com um cliente que nao deve nada ainda. Sem regua configurada,
     ou sem atraso, cai no texto cordial de sempre. */
  const atraso = Number(ctx.atraso) || 0;
  const regua = atraso > 0 ? blocoRegua(String(maisAntigo?.dtvenc || ""), atraso, ctx.regua || []) : "";
  const duro = n >= 3 && !!regua;

  if (duro) {
    const haDias = `Este ${plural ? "grupo de títulos está" : "título está"} vencido há ${atraso} dias e eu não tive nenhum retorno seu.`;
    const corpo = n === 3
      ? [`${ola} É a terceira vez que eu procuro você sobre isto.`, haDias, resumo, boleto, regua,
         "Ainda dá para resolver comigo, e é o que eu prefiro. Me responde hoje?"]
      : n === 4
      ? [`${ola} Preciso mesmo de uma posição sua.`, haDias, resumo, boleto, regua,
         "Se houver algo a acertar antes do pagamento — nota, valor, prazo — me diga agora que eu levo para a equipe. Depois dos prazos acima já não fica comigo."]
      : [`${ola} Este é o meu último contato sobre este título.`, haDias, resumo, boleto, regua,
         "Sem retorno hoje, eu encaminho o caso para a nossa equipe de cobrança dar seguimento. Se você me responder ou pagar hoje, eu seguro o encaminhamento."];
    return corpo.filter(Boolean).join("\n\n");
  }

  const corpo = n <= 2
    ? [`${ola} Voltando aqui no título que te mandei semana passada.`, resumo, boleto,
       "Se já foi pago, me manda o comprovante que eu dou baixa. Se ainda não, consegue me dizer quando fica programado?"]
    : n === 3
    ? [`${ola} Continuo sem retorno sobre o pagamento.`, resumo, boleto,
       "Me dá um retorno, por favor — mesmo que seja para dizer que ainda não dá. Assim eu sei o que combinar com o financeiro daqui."]
    : n === 4
    ? [`${ola} Segue em aberto e eu ainda não consegui falar com você.`, resumo, boleto,
       "Se houver qualquer coisa que precise ser resolvida antes do pagamento (nota, valor, prazo), me diz que eu levo para a equipe."]
    : [`${ola} Última vez que eu te procuro por aqui.`, resumo, boleto,
       `Sem retorno, eu passo a conversa para uma colega do financeiro dar sequência — prefiro resolver com você antes disso. Me responde?`];

  return corpo.filter(Boolean).join("\n\n");
}

/** Depois de uma promessa que venceu. Tom diferente: ele se comprometeu, nao sumiu. */
export function textoPromessa(ctx: { nome: string; total: number; data: string; temBoleto: boolean }): string {
  const ola = ctx.nome ? `Olá, ${ctx.nome}!` : "Olá!";
  return [
    `${ola} Você tinha comentado que o pagamento sairia até ${dataBrLonga(ctx.data)}.`,
    `Consta ${brl(ctx.total)} ainda em aberto aqui.`,
    ctx.temBoleto ? "Reenvio o boleto em anexo para facilitar." : "",
    "Se já pagou, me manda o comprovante que eu resolvo. Se escorregou a data, me fala a nova que eu anoto.",
  ].filter(Boolean).join("\n\n");
}

/* =========================================================================== GHL */
type EmpGhl = { loc: string; tok: string };
async function empresaGhl(sb: any, id: string): Promise<EmpGhl> {
  const { data, error } = await sb.from("empresa").select("ghl_location,ghl_token_env").eq("painel_id", id).maybeSingle();
  if (error) throw error;
  const loc = data?.ghl_location ? String(data.ghl_location) : "";
  if (!loc) throw new Error(`empresa "${id}" sem ghl_location no cadastro`);
  const tok = Deno.env.get(String(data?.ghl_token_env || "GHL_TOKEN")) || Deno.env.get("GHL_TOKEN") || "";
  if (!tok) throw new Error(`sem token do GHL para "${id}"`);
  return { loc, tok };
}
function ghl(g: EmpGhl, method: string, path: string, body?: any, version = "2021-07-28") {
  return fetch(API + path, { method, headers: { Authorization: "Bearer " + g.tok, Version: version, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA }, body: body ? JSON.stringify(body) : undefined });
}

/* ================================================================== o repasse
   Copia proposital do cobranca-atende: cada Edge Function e um deploy independente, e um
   modulo comum obrigaria a redeployar as duas juntas — que e como uma delas fica velha sem
   ninguem notar. O que NAO pode divergir esta coberto por teste nos dois lados. */
export function escolherAtendente(lista: any[]): any | null {
  const viva = (lista || []).filter((a) => a.ativo !== false);
  if (!viva.length) return null;
  const emb = viva.slice().sort(() => Math.random() - 0.5);
  emb.sort((a, b) => (Number(a.recebidos || 0) / Math.max(1, Number(a.peso || 1))) - (Number(b.recebidos || 0) / Math.max(1, Number(b.peso || 1))));
  return emb[0];
}

async function repassar(sb: any, g: EmpGhl, conversa: any, motivo: string, resumo: string) {
  const { data: atendentes } = await sb.from("cobranca_atendente").select("*").eq("ativo", true);
  const a = escolherAtendente(atendentes || []);
  if (!a) return { ok: false, motivo: "nenhuma atendente ativa em cobranca_atendente" };
  const r = await ghl(g, "PUT", `/contacts/${conversa.contact_id}`, { assignedTo: a.usuario_ghl_id });
  if (!r.ok) return { ok: false, motivo: `PUT assignedTo ${r.status} — nada foi repassado` };
  await sb.from("campanha_dono_emprestado").update({ dono_depois: a.usuario_ghl_id })
    .eq("contact_id", conversa.contact_id).eq("campanha", "cobranca").is("devolvido_em", null);
  await ghl(g, "POST", `/contacts/${conversa.contact_id}/notes`, { userId: a.usuario_ghl_id, body: [`Cobrança passada pela Nina Financeiro.`, `Motivo: ${motivo}`, resumo].filter(Boolean).join("\n").slice(0, 5000) }).catch(() => null);
  await sb.from("cobranca_conversa").update({
    status: "repassada", repassada_para: a.usuario_ghl_id, repassada_nome: a.nome,
    repassada_em: new Date().toISOString(), repassada_motivo: motivo.slice(0, 300),
    proximo_toque_em: null, atualizado: new Date().toISOString(),
  }).eq("contact_id", conversa.contact_id);
  await sb.from("cobranca_atendente").update({ recebidos: Number(a.recebidos || 0) + 1, ultimo_recebido_em: new Date().toISOString() }).eq("usuario_ghl_id", a.usuario_ghl_id);
  return { ok: true, atendente: a.nome, usuario_ghl_id: a.usuario_ghl_id };
}

/* ===================================================================== o corpo */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const u = new URL(req.url);
    const dry = b.dry === true || u.searchParams.get("dry") === "1";
    const LIMITE = Math.min(Number(b.limite || 40), 200);
    const empId = String(b.empresa || "nitron");

    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.ativo && !dry) return j({ ok: false, erro: "cobranca_config.ativo = false — o motor esta desligado", desligado: true }, 409);
    const MAX = Math.max(1, Number(cfg?.toques_max || 5));
    const ESPERA: number[] = Array.isArray(cfg?.toques_espera) && cfg.toques_espera.length ? cfg.toques_espera.map(Number) : [2, 3, 4, 7, 7];
    const EMPRESA = String(cfg?.empresa_nome || "Nitron");
    const NOME_INST = String(cfg?.instancia || "Nina Financeiro");
    // A regua so entra se a gestao ligou o aviso. Desligar aqui devolve o tom cordial
    // sem deploy — o que importa no dia em que a empresa parar de protestar.
    const REGUA = cfg?.protesto_aviso === false ? [] : (Array.isArray(cfg?.regua_cobranca) ? cfg.regua_cobranca : []);

    // Horario comercial, dia util. O `proximo_toque_em` ja e gravado num dia util as 12:00Z,
    // mas uma promessa marcada para um sabado, ou um deploy atrasado, cairia fora disso —
    // e cobranca as 23h de domingo e o tipo de coisa que faz o cliente bloquear o numero.
    const { dow, hora } = agoraSp();
    const naJanela = dow >= 1 && dow <= 5 && hora >= 9 && hora < 18;
    if (!naJanela && b.ignorar_janela !== true && !dry) {
      return j({ ok: true, rodou: false, motivo: `fora da janela (SP: dow=${dow} hora=${hora}h; toque so seg-sex, 9h-18h)` });
    }

    const { data: filas, error } = await sb.from("cobranca_conversa").select("*")
      .in("status", ["ativa", "promessa"]).eq("nao_perturbe", false)
      .lte("proximo_toque_em", new Date().toISOString())
      .order("proximo_toque_em").limit(LIMITE);
    if (error) throw error;
    if (!filas?.length) return j({ ok: true, rodou: true, nada: "nenhuma conversa vencida para tocar", tocadas: 0 });

    const g = await empresaGhl(sb, empId);
    const itens: any[] = [];
    let tocadas = 0, repasses = 0, encerradas = 0;

    for (const c of filas) {
      /* ---- o retrato envelhece: confere a divida ANTES de cobrar ----------------
         Mesmo motivo do cobranca-aprovar. Aqui e pior: entre o toque 1 e o toque 5 passam
         duas semanas, e cobrar quem ja pagou custa mais caro do que nao cobrar. */
      const { data: titulos } = await sb.from("cobranca_titulo").select("*")
        .or(`matriz.eq.${c.grupo},codparc.eq.${c.grupo}`).limit(400);
      const abertos = titulos || [];
      if (!abertos.length) {
        if (!dry) await sb.from("cobranca_conversa").update({ status: "encerrada", proximo_toque_em: null, atualizado: new Date().toISOString() }).eq("contact_id", c.contact_id);
        encerradas++;
        itens.push({ nome: c.nome, resultado: "encerrada", motivo: "nao ha mais titulo em aberto no Sankhya" });
        continue;
      }
      const total = abertos.reduce((a: number, t: any) => a + Number(t.valor), 0);
      const anexos = abertos.filter((t: any) => t.boleto_url).map((t: any) => String(t.boleto_url)).slice(0, 10);

      /* ---- acabaram os toques: vira gente ---- */
      if (Number(c.toques || 0) >= MAX) {
        if (dry) { itens.push({ nome: c.nome, resultado: "repassaria", toques: c.toques }); repasses++; continue; }
        const rp = await repassar(sb, g, c, `${MAX} toques sem retorno do cliente`,
          `Em aberto agora: ${brl(total)} em ${abertos.length} título(s). Último toque em ${c.ultimo_toque_em || "?"}.`);
        if (rp.ok) repasses++;
        itens.push({ nome: c.nome, resultado: "repassada", toques: c.toques, repasse: rp });
        continue;
      }

      const n = Number(c.toques || 0) + 1;
      const texto = c.status === "promessa" && c.promessa_data
        ? textoPromessa({ nome: primeiroNome(c.nome), total, data: String(c.promessa_data), temBoleto: anexos.length > 0 })
        : textoToque(n, { nome: primeiroNome(c.nome), total, titulos: abertos, temBoleto: anexos.length > 0,
            empresa: EMPRESA, maxToques: MAX,
            atraso: Math.max(0, ...abertos.map((t: any) => Number(t.dias_atraso) || 0)),
            regua: REGUA });

      if (dry) { itens.push({ nome: c.nome, resultado: "tocaria", toque: n, canal: c.canal, anexos: anexos.length, texto }); tocadas++; continue; }

      let envio: any;
      if (c.canal === "email") {
        const payload: any = { type: "Email", contactId: c.contact_id, subject: `${EMPRESA} — título em aberto (${brl(total)})`, html: texto.replace(/\n/g, "<br>") };
        if (anexos.length) payload.attachments = anexos;
        const r = await ghl(g, "POST", "/conversations/messages", payload, "2021-04-15");
        envio = { canal: "email", ok: r.ok, status: r.status };
      } else {
        const { data: linha, error: eF } = await sb.from("fila_envio").insert({
          codparc: c.grupo, contact_id: c.contact_id, canal: "whatsapp",
          fone: c.destino, nome: c.nome, mensagem: texto,
          instancia: NOME_INST, campanha: "cobranca_toque" + n, publico: "cliente", empresa: empId,
          imagens: anexos.length ? anexos : null, status: "pendente",
        }).select("id").maybeSingle();
        envio = { canal: "whatsapp", ok: !eF, fila_id: linha?.id ?? null, erro: eF?.message };
      }

      // Toque que nao saiu NAO conta: senao uma instancia caida por dois dias consome o
      // orcamento de cinco toques sem o cliente ter recebido nada, e ele e repassado a uma
      // atendente que vai perguntar por que ninguem o procurou.
      if (!envio.ok) { itens.push({ nome: c.nome, resultado: "erro", toque: n, envio }); continue; }

      const agora = new Date().toISOString();
      const espera = ESPERA[Math.min(n - 1, ESPERA.length - 1)] || 7;
      await sb.from("cobranca_conversa").update({
        status: "ativa", toques: n, ultimo_toque_em: agora,
        proximo_toque_em: proximoToqueEm(espera).toISOString(),
        promessa_data: c.status === "promessa" ? null : c.promessa_data,
        historico: [...(Array.isArray(c.historico) ? c.historico : []), { em: agora, dir: "out", texto: texto.slice(0, 1000), meta: { toque: n, anexos: anexos.length } }].slice(-40),
        atualizado: agora,
      }).eq("contact_id", c.contact_id);

      tocadas++;
      itens.push({ nome: c.nome, resultado: "tocada", toque: n, canal: c.canal, anexos: anexos.length, proximo_em: proximoToqueEm(espera).toISOString() });
    }

    return j({ ok: true, rodou: true, dry, vencidas: filas.length, tocadas, repasses, encerradas, itens });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
