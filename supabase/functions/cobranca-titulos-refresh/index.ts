// cobranca-titulos-refresh (v1) — espelha do Sankhya os titulos abertos que interessam a
// cobranca (vencidos + a vencer na janela) e resolve PARA QUEM mandar cada um.
//
// Duas escritas, duas tabelas:
//   cobranca_titulo   — 1 linha por NUFIN, com os dados do boleto quando o ERP os tem.
//   cobranca_contato  — 1 linha por (parceiro, canal, valor), com a ORIGEM e a PRIORIDADE.
//
// A prioridade e a regra do pedido, em dado e nao em codigo espalhado: "enviar nos
// contatos de cobranca do Sankhya, caso nao tenha mandar no que tem".
//   10 TGFCTT marcado RESPCOBRANCA='S' ou RECEBEBOLETOEMAIL='S'   (34 e 50 contatos no ERP)
//   20 TGFCTT com AD_DPTOCONTATO = Financeiro                      (~1.200 contatos)
//   30 outro TGFCTT ativo (Compras, Fiscal, Expedicao)
//   40 o cadastro do parceiro: TGFPAR.EMAIL / TELEFONE / AD_TELEFONE
//   50 o CRM (ghl_contato), ultimo recurso
// Medido na producao em 22/09: dos 1.078 inadimplentes, so 111 (10%) tem contato do
// financeiro com telefone ou e-mail, e 253 (23%) tem qualquer contato em TGFCTT. Sem os
// niveis 40/50 a cobranca alcancaria um decimo da carteira — por isso o fallback nao e
// enfeite, e o caminho normal.
//
// NAO ESCREVE NADA NO ERP. Leitura pura via DbExplorerSP.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const detalhar = (e: any) => { if (!e) return "erro sem detalhe"; if (typeof e === "string") return e; return [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") || String(e); };

/* ------------------------------------------------------------------ Sankhya */
async function login(base: string, u: string, p: string) {
  const r = await fetch(`${base}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serviceName: "MobileLoginSP.login", requestBody: { NOMUSU: { $: u }, INTERNO: { $: p }, KEEPCONNECTED: { $: "true" } } }),
  });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  const s = d?.responseBody?.jsessionid?.$ ?? d?.responseBody?.jsessionid ?? "";
  return { jsession: String(s || ""), cookie: s ? `JSESSIONID=${s}` : "" };
}
async function query(base: string, sess: any, sql: string) {
  let url = `${base}/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`;
  if (sess.jsession) url += `&mgeSession=${encodeURIComponent(sess.jsession)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sess.cookie }, body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }) });
  const d = JSON.parse(new TextDecoder("iso-8859-1").decode(await r.arrayBuffer()));
  if (String(d?.status) !== "1") throw new Error("Sankhya: " + String(d?.statusMessage).slice(0, 200));
  return (d?.responseBody?.rows ?? []) as any[][];
}

/* ------------------------------------------------------------------- helpers */
const S = (x: any) => { const s = String(x ?? "").trim(); return s || null; };
const N = (x: any) => Number(x) || 0;
const digitos = (x: any) => String(x ?? "").replace(/\D/g, "");

/**
 * Celular brasileiro com DDD: 11 digitos e o nono e 9. O campanhas-enviar recusa numero
 * de 10 digitos ("telefone fixo (sem WhatsApp)"), entao filtrar aqui evita encher a
 * fila_envio de linhas que nascem condenadas.
 */
function celularBom(v: any): string | null {
  let d = digitos(v).replace(/^0+/, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length !== 11) return null;
  if (d[2] !== "9") return null;
  if (/^(\d)\1+$/.test(d)) return null;       // 99999999999 e cadastro-lixo
  return d;
}
const emailBom = (v: any): string | null => {
  const e = String(v ?? "").trim().toLowerCase();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/.test(e)) return null;
  if (/^(nao|sem|n\/a|none)@/.test(e)) return null;
  return e;
};
/** O ERP guarda varios e-mails num campo so, separados por ; ou , — todos valem. */
const emails = (v: any): string[] => String(v ?? "").split(/[;,\s]+/).map(emailBom).filter(Boolean) as string[];

const dataIso = (x: any) => {
  const s = String(x ?? "").trim();
  let m = /^(\d{2})(\d{2})(\d{4})/.exec(s);                  // 21092026 (formato do DbExplorer)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return s.slice(0, 10);
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

/* ------------------------------------------------------------------------ SQL */
const SQL_TITULOS = (emp: string, tipos: string, dias: number, atrasoMax: number, off: number) => `
SELECT NUFIN, CODPARC, MATRIZ, CODEMP, NUMNOTA, DTVENC, DIAS, VLR, NOSSONUM, CODBCO, NOMEBCO,
       CARTEIRA, CODAGE, CODCTABCO, LINHADIG, CODBARRA, PIXQR, CEDENTE, CEDCNPJ, SACADO, SACCNPJ,
       CODTIPTIT, DESCTIPTIT, DTNEG, CODCTABCOINT, CONTADESC
FROM (
  SELECT f.NUFIN NUFIN, f.CODPARC CODPARC, NVL(p.CODPARCMATRIZ,0) MATRIZ, f.CODEMP CODEMP,
         f.NUMNOTA NUMNOTA, TO_CHAR(f.DTVENC,'YYYY-MM-DD') DTVENC,
         TRUNC(SYSDATE) - TRUNC(f.DTVENC) DIAS, f.VLRDESDOB VLR,
         f.NOSSONUM NOSSONUM, f.CODBCO CODBCO, b.NOMEBCO NOMEBCO,
         c.CARTEIRA CARTEIRA, c.CODAGE CODAGE, c.CODCTABCO CODCTABCO,
         f.LINHADIGITAVEL LINHADIG, f.CODIGOBARRA CODBARRA, f.AD_PIXQRCODE PIXQR,
         e.RAZAOSOCIAL CEDENTE, e.CGC CEDCNPJ, p.NOMEPARC SACADO, p.CGC_CPF SACCNPJ,
         f.CODTIPTIT CODTIPTIT, tt.DESCRTIPTIT DESCTIPTIT,
         TO_CHAR(f.DTNEG,'YYYY-MM-DD') DTNEG, f.CODCTABCOINT CODCTABCOINT, c.DESCRICAO CONTADESC
  FROM TGFFIN f
  JOIN TGFPAR p ON p.CODPARC = f.CODPARC AND p.TIPPESSOA = 'J'
  LEFT JOIN TSIEMP e ON e.CODEMP = f.CODEMP
  LEFT JOIN TSIBCO b ON b.CODBCO = f.CODBCO
  LEFT JOIN TSICTA c ON c.CODCTABCOINT = f.CODCTABCOINT
  LEFT JOIN TGFTIT tt ON tt.CODTIPTIT = f.CODTIPTIT
  WHERE f.RECDESP = 1 AND f.DHBAIXA IS NULL AND f.PROVISAO = 'N'
    AND f.CODEMP IN (${emp})
    -- SO TITULO QUE E BOLETO. Sem esta linha a cobranca alcancava deposito, NF cancelada,
    -- compensacao contabil, PDD e debito de funcionario: 871 titulos e R$ 5,5M que nao se
    -- cobra por mensagem. Ver o comentario de cobranca_config.tipos_titulo.
    AND f.CODTIPTIT IN (${tipos})
    AND f.DTVENC < TRUNC(SYSDATE) + ${dias + 1}
    AND TRUNC(SYSDATE) - TRUNC(f.DTVENC) <= ${atrasoMax}
    -- intra-grupo fora: cobrar a propria holding por CNPJ que e nosso nao e cobranca
    AND NOT EXISTS (
      SELECT 1 FROM TSIEMP x
      WHERE REPLACE(REPLACE(REPLACE(x.CGC,'.',''),'/',''),'-','')
          = REPLACE(REPLACE(REPLACE(p.CGC_CPF,'.',''),'/',''),'-','')
    )
) ORDER BY NUFIN OFFSET ${off} ROWS FETCH NEXT 2000 ROWS ONLY`;

const SQL_CONTATOS = (parcs: string) => `
SELECT c.CODPARC, c.NOMECONTATO, c.CARGO, c.AD_DPTOCONTATO, c.EMAIL, c.CELULAR, c.TELEFONE,
       c.RESPCOBRANCA, c.RECEBEBOLETOEMAIL
FROM TGFCTT c WHERE c.ATIVO = 'S' AND c.CODPARC IN (${parcs})`;

const SQL_PARCEIROS = (parcs: string) => `
SELECT p.CODPARC, p.NOMEPARC, p.EMAIL, p.EMAILNFE, p.TELEFONE, p.AD_TELEFONE
FROM TGFPAR p WHERE p.CODPARC IN (${parcs})`;

/**
 * O titulo sem boleto no ERP pode ganhar um?
 *
 * Nem sempre. Ha titulos cujo boleto foi emitido DIRETO NO BANCO, fora do Sankhya: o
 * cliente ja tem um boleto valido na mao. Gerar outro criaria um segundo codigo de barras
 * para a mesma divida — o cliente pagaria o antigo e a baixa nunca fecharia, ou pagaria os
 * dois. Levantado com a gestao em 22/09: a conta 113 (Grafeno) inteira, e a conta 112
 * (Safra) nos titulos negociados entre 06/10/2025 e 23/07/2026, que foram os primeiros e
 * sairam manualmente no banco.
 *
 * A regra vem de cobranca_config.boleto_nao_geravel, nao daqui: ela tem prazo de validade.
 * Quando o periodo manual do Safra nao tiver mais titulo em aberto, e um UPDATE.
 */
function avaliarGeravel(t: any, regras: any[]): { geravel: boolean; motivo: string | null } {
  for (const r of (Array.isArray(regras) ? regras : [])) {
    if (Number(r?.conta) !== Number(t.codctabcoint)) continue;
    // sem janela de data, a conta inteira esta fora
    const de = r?.dtneg_de ? String(r.dtneg_de) : null;
    const ate = r?.dtneg_ate ? String(r.dtneg_ate) : null;
    if (de || ate) {
      const d = t.dtneg;
      if (!d) continue;                        // sem DTNEG nao da para afirmar que casa
      if (de && d < de) continue;
      if (ate && d > ate) continue;
    }
    return { geravel: false, motivo: String(r?.motivo || "boleto emitido fora do ERP") };
  }
  return { geravel: true, motivo: null };
}

/* ----------------------------------------------------------------------- main */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const { data: cfg } = await sb.from("cobranca_config").select("*").eq("id", 1).maybeSingle();
    const DIAS = Math.max(1, Number(cfg?.dias_a_vencer ?? 7));
    const ATRASO_MAX = Math.max(1, Number(cfg?.atraso_max ?? 180));
    const EMPRESAS = (cfg?.empresas?.length ? cfg.empresas : [1, 2, 14]).map((x: any) => Number(x) || 0).filter(Boolean);
    const TIPOS = (cfg?.tipos_titulo?.length ? cfg.tipos_titulo : [4, 55]).map((x: any) => Number(x) || 0).filter(Boolean);
    if (!TIPOS.length) throw new Error("cobranca_config.tipos_titulo vazio \u2014 sem tipo de titulo nao ha o que cobrar");
    const REGRAS_BOLETO = Array.isArray(cfg?.boleto_nao_geravel) ? cfg.boleto_nao_geravel : [];

    const base = (Deno.env.get("SANKHYA_URL") || "").replace(/\/$/, "");
    const sess = await login(base, Deno.env.get("SANKHYA_USER")!, Deno.env.get("SANKHYA_PASS")!);

    /* ---- 1. titulos ---- */
    const titulos: any[] = [];
    for (let off = 0; off < 100000; off += 2000) {
      const rows = await query(base, sess, SQL_TITULOS(EMPRESAS.join(","), TIPOS.join(","), DIAS, ATRASO_MAX, off));
      for (const r of rows) {
        const dtvenc = dataIso(r[5]);
        if (!dtvenc) continue;                        // sem vencimento nao se cobra nada
        const dias = N(r[6]);
        const matriz = N(r[2]);
        titulos.push({
          nufin: N(r[0]), codparc: N(r[1]), matriz: matriz > 0 ? matriz : null, codemp: N(r[3]),
          numnota: N(r[4]) || null, dtvenc, dias_atraso: dias, valor: Number(r[7]) || 0,
          fase: dias > 0 ? "vencido" : "a_vencer",
          nossonum: S(r[8]), codbco: N(r[9]) || null, banco: S(r[10]),
          carteira: S(r[11]), agencia: S(r[12]), conta: S(r[13]),
          linha_digitavel: S(r[14]), codigo_barras: digitos(r[15]) || null, pix: S(r[16]),
          cedente: S(r[17]), cedente_cnpj: digitos(r[18]) || null,
          sacado: S(r[19]), sacado_cnpj: digitos(r[20]) || null,
          codtiptit: N(r[21]) || null, tipo_titulo: S(r[22]),
          dtneg: dataIso(r[23]), codctabcoint: N(r[24]) || null, conta_desc: S(r[25]),
          atualizado: new Date().toISOString(),
        });
      }
      if (rows.length < 2000) break;
    }
    // Um Sankhya mudo nao e "zero inadimplente": seria apagar o snapshot por causa de uma
    // sessao perdida. Mesma trava que o cobranca-refresh ja carrega.
    if (!titulos.length) throw new Error("Sankhya nao devolveu titulo nenhum — abortado ANTES de apagar o snapshot");

    const parcs = [...new Set(titulos.map((t) => t.codparc))];

    /* ---- 2. contatos: Sankhya (TGFCTT -> TGFPAR) e, por ultimo, o CRM ---- */
    const contatos: Record<string, any> = {};
    const guarda = (codparc: number, canal: string, valor: string | null, nome: any, funcao: string, origem: string, prioridade: number) => {
      if (!valor) return;
      const k = `${codparc}|${canal}|${valor}`;
      // primeiro a escrever ganha, e a varredura vai do melhor para o pior — entao um
      // e-mail que aparece no financeiro E no cadastro fica registrado como financeiro.
      if (contatos[k]) return;
      contatos[k] = { codparc, canal, valor, nome: S(nome), funcao, origem, prioridade, atualizado: new Date().toISOString() };
    };

    for (let i = 0; i < parcs.length; i += 500) {
      const lote = parcs.slice(i, i + 500).join(",");
      const ctt = await query(base, sess, SQL_CONTATOS(lote));
      // duas passadas: a de prioridade alta primeiro, para ela ganhar o desempate acima
      const linhas = ctt.map((c) => ({
        codparc: N(c[0]), nome: S(c[1]), cargo: S(c[2]), dpto: String(c[3] ?? "").trim().toUpperCase(),
        email: c[4], celular: c[5], telefone: c[6],
        resp: String(c[7] ?? "").toUpperCase() === "S", recbol: String(c[8] ?? "").toUpperCase() === "S",
      }));
      const nivel = (l: any) => (l.resp || l.recbol) ? 10 : (l.dpto === "FINANCEIRO" ? 20 : 30);
      for (const p of [10, 20, 30]) {
        for (const l of linhas.filter((x) => nivel(x) === p)) {
          const origem = p === 10 ? "sankhya_respcobranca" : p === 20 ? "sankhya_financeiro" : "sankhya_contato";
          const funcao = l.cargo || (p === 20 ? "Financeiro" : "Contato");
          guarda(l.codparc, "whatsapp", celularBom(l.celular), l.nome, funcao, origem, p);
          guarda(l.codparc, "whatsapp", celularBom(l.telefone), l.nome, funcao, origem, p + 1);
          for (const e of emails(l.email)) guarda(l.codparc, "email", e, l.nome, funcao, origem, p);
        }
      }
      // nivel 40: o cadastro do parceiro. E o que salva 90% da carteira.
      const pars = await query(base, sess, SQL_PARCEIROS(lote));
      for (const r of pars) {
        const cp = N(r[0]); const nome = S(r[1]);
        guarda(cp, "whatsapp", celularBom(r[5]), nome, "Cadastro", "parceiro_sankhya", 40);
        guarda(cp, "whatsapp", celularBom(r[4]), nome, "Cadastro", "parceiro_sankhya", 41);
        for (const e of emails(r[2])) guarda(cp, "email", e, nome, "Cadastro", "parceiro_sankhya", 40);
        for (const e of emails(r[3])) guarda(cp, "email", e, nome, "Cadastro NF-e", "parceiro_sankhya", 41);
      }
    }
    // nivel 50: o CRM. So chega aqui quem o ERP nao soube responder.
    for (let i = 0; i < parcs.length; i += 300) {
      const { data: gc } = await sb.from("ghl_contato").select("codparc,nome,fone,email").in("codparc", parcs.slice(i, i + 300));
      for (const g of (gc || [])) {
        guarda(Number(g.codparc), "whatsapp", celularBom(g.fone), g.nome, "CRM", "crm", 50);
        for (const e of emails(g.email)) guarda(Number(g.codparc), "email", e, g.nome, "CRM", "crm", 50);
      }
    }

    /* ---- 3. grava. O boleto_url ja rendido e preservado: o PDF de um titulo que nao
            mudou continua valendo, e re-renderizar 1.000 boletos por rodada seria
            desperdicio puro. ---- */
    const { data: antigos } = await sb.from("cobranca_titulo").select("nufin,valor,dtvenc,boleto_url,boleto_em");
    const cache: Record<string, any> = {};
    for (const a of (antigos || [])) cache[String(a.nufin)] = a;
    for (const t of titulos) {
      const a = cache[String(t.nufin)];
      // so reaproveita se valor E vencimento continuam os mesmos: prorrogacao ou
      // renegociacao muda o codigo de barras, e o PDF antigo passaria a mentir.
      if (a?.boleto_url && Number(a.valor) === Number(t.valor) && String(a.dtvenc) === t.dtvenc) {
        t.boleto_url = a.boleto_url; t.boleto_em = a.boleto_em;
      }
    }

    const { error: eDelT } = await sb.from("cobranca_titulo").delete().neq("nufin", -1); if (eDelT) throw eDelT;
    for (let i = 0; i < titulos.length; i += 500) { const { error } = await sb.from("cobranca_titulo").insert(titulos.slice(i, i + 500)); if (error) throw error; }

    const lista = Object.values(contatos);
    const { error: eDelC } = await sb.from("cobranca_contato").delete().neq("codparc", -1); if (eDelC) throw eDelC;
    for (let i = 0; i < lista.length; i += 500) { const { error } = await sb.from("cobranca_contato").insert(lista.slice(i, i + 500)); if (error) throw error; }

    /* ---- 4. resumo honesto: o que da para cobrar e o que nao da ---- */
    const vencidos = titulos.filter((t) => t.fase === "vencido");
    const aVencer = titulos.filter((t) => t.fase === "a_vencer");
    const comBoleto = (arr: any[]) => arr.filter((t) => t.linha_digitavel && t.codigo_barras?.length === 44).length;
    // Conta PARCEIROS, nao contatos. A primeira versao somava um por contato empatado na
    // melhor prioridade, entao um cliente com telefone E e-mail do cadastro contava duas
    // vezes e a soma (926) passava do numero de parceiros (783) — um numero que, lido de
    // fora, faria a cobertura do financeiro parecer maior do que e.
    const melhorPorParc: Record<string, { prioridade: number; origem: string }> = {};
    for (const c of lista as any[]) {
      const k = String(c.codparc);
      const atual = melhorPorParc[k];
      if (!atual || c.prioridade < atual.prioridade) melhorPorParc[k] = { prioridade: c.prioridade, origem: c.origem };
    }
    const porOrigem: Record<string, number> = {};
    for (const v of Object.values(melhorPorParc)) porOrigem[v.origem] = (porOrigem[v.origem] || 0) + 1;
    const semContato = parcs.filter((p) => melhorPorParc[String(p)] === undefined);

    return j({
      ok: true,
      tipos_titulo: TIPOS,
      titulos: titulos.length,
      parceiros: parcs.length,
      vencido: { titulos: vencidos.length, valor: Math.round(vencidos.reduce((a, b) => a + b.valor, 0)), com_boleto: comBoleto(vencidos), sem_boleto: vencidos.length - comBoleto(vencidos) },
      a_vencer: { titulos: aVencer.length, valor: Math.round(aVencer.reduce((a, b) => a + b.valor, 0)), com_boleto: comBoleto(aVencer), sem_boleto: aVencer.length - comBoleto(aVencer), dias: DIAS },
      contatos: lista.length,
      // quantos parceiros tem como MELHOR contato cada origem — a leitura que diz se a
      // cobranca esta falando com o financeiro ou com quem atende o telefone
      melhor_origem: porOrigem,
      sem_contato_nenhum: semContato.length,
      boletos_reaproveitados: titulos.filter((t) => t.boleto_url).length,
    });
  } catch (e) { return j({ ok: false, erro: detalhar(e) }, 500); }
});
