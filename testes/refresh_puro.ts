// cobranca-refresh (v8) — publicado com este nome; a pasta chamava-se cobranca-titulos-refresh
// e o cobranca-cron chamava a copia velha desse nome, que nao grava dt_impressao nem fase futuro.
// cobranca-refresh (v7) — espelha do Sankhya os titulos abertos que interessam a
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

/**
 * TRES fases, desde 23/09 — e a terceira existe por um motivo estreito.
 *
 * 'futuro' e o boleto recem-impresso que vence longe. Ele entra no espelho para o
 * cobranca-emitidos poder entrega-lo no dia em que nasceu; mas NAO pode virar 'a_vencer',
 * senao o lembrete de sexta ("vence na proxima semana") passaria a avisar sobre vencimento
 * de daqui a um ano. O cobranca-montar le so 'vencido' e 'a_vencer', entao ignora 'futuro'
 * sozinho, sem precisar saber que ele existe.
 *
 * `dias` e TRUNC(SYSDATE) - TRUNC(DTVENC): positivo = atrasado, negativo = falta vencer.
 * O dia do vencimento (dias = 0) e 'a_vencer': ainda da tempo de pagar.
 *
 * Ver sql/013_boleto_na_impressao.sql.
 */
export function faseDoTitulo(dias: number, janelaDias: number): "vencido" | "a_vencer" | "futuro" {
  if (dias > 0) return "vencido";
  return -dias <= janelaDias ? "a_vencer" : "futuro";
}

/* ------------------------------------------------------------------------ SQL */
const SQL_TITULOS = (emp: string, tipos: string, dias: number, atrasoMax: number, impressao: number, off: number) => `
SELECT NUFIN, CODPARC, MATRIZ, CODEMP, NUMNOTA, DTVENC, DIAS, VLR, NOSSONUM, CODBCO, NOMEBCO,
       CARTEIRA, CODAGE, CODCTABCO, LINHADIG, CODBARRA, PIXQR, CEDENTE, CEDCNPJ, SACADO, SACCNPJ,
       CODTIPTIT, DESCTIPTIT, DTNEG, CODCTABCOINT, CONTADESC,
       SERIE, PARCELA, PARCTOT, DTEMISSAO, OPERACAO, CONTRATO, CONTPARC, CONTVLR, CONTINI,
       DTIMPRESSAO
FROM (
  SELECT f.NUFIN NUFIN, f.CODPARC CODPARC, NVL(p.CODPARCMATRIZ,0) MATRIZ, f.CODEMP CODEMP,
         f.NUMNOTA NUMNOTA, TO_CHAR(f.DTVENC,'YYYY-MM-DD') DTVENC,
         TRUNC(SYSDATE) - TRUNC(f.DTVENC) DIAS, f.VLRDESDOB VLR,
         f.NOSSONUM NOSSONUM, f.CODBCO CODBCO, b.NOMEBCO NOMEBCO,
         c.CARTEIRA CARTEIRA, c.CODAGE CODAGE, c.CODCTABCO CODCTABCO,
         f.LINHADIGITAVEL LINHADIG, f.CODIGOBARRA CODBARRA, f.AD_PIXQRCODE PIXQR,
         e.RAZAOSOCIAL CEDENTE, e.CGC CEDCNPJ, p.NOMEPARC SACADO, p.CGC_CPF SACCNPJ,
         f.CODTIPTIT CODTIPTIT, tt.DESCRTIPTIT DESCTIPTIT,
         TO_CHAR(f.DTNEG,'YYYY-MM-DD') DTNEG, f.CODCTABCOINT CODCTABCOINT, c.DESCRICAO CONTADESC,
         -- DE ONDE VEM ESTE BOLETO. E a primeira pergunta de quem recebe uma cobranca, e
         -- ate aqui a unica resposta possivel era "NF 188412" — que nao diz nada a ninguem.
         f.SERIENOTA SERIE, f.DESDOBRAMENTO PARCELA,
         -- quantas parcelas a nota gerou. Conta os desdobramentos de receita da MESMA nota,
         -- inclusive os ja baixados: "parcela 2 de 3" so faz sentido contando as pagas.
         (SELECT COUNT(*) FROM TGFFIN x
           WHERE x.NUNOTA = f.NUNOTA AND x.RECDESP = 1 AND x.PROVISAO = 'N') PARCTOT,
         -- DTENTSAI e a SAIDA DA NOTA, nao a entrega. O ERP nao tem data de entrega destes
         -- titulos (AD_DTENTREGA e AD_STATUSENTREGA: zero preenchidos em 2.465; agendamento:
         -- 2). Dizer "saiu em" e verdade; dizer "foi entregue em" seria invencao — e numa
         -- cobranca isso entrega ao cliente o argumento para nao pagar.
         TO_CHAR(cab.DTENTSAI,'YYYY-MM-DD') DTEMISSAO, top.DESCROPER OPERACAO,
         -- Clube: o titulo nao tem nota, tem contrato. Sao 397 dos 2.465.
         f.AD_NUCONT CONTRATO, ct.QTDPARCELAS CONTPARC, ct.VLRMENSAL CONTVLR,
         TO_CHAR(ct.DTINIVIGENCIA,'YYYY-MM-DD') CONTINI,
         -- QUANDO O BOLETO NASCEU. E o gatilho do cobranca-emitidos, e nao tem substituto:
         -- AD_DTLIBBOLETO, AD_STATUSBOLETO e TIMDTIMPBOL estao zerados nesta base, e
         -- NUMREMESSA so tem 6%. DH_IMPRESSAO tem 72% no universo a vencer e 100% nos dias
         -- recentes. Nao confundir com DTNEG (negociacao) nem com DTVENC.
         TO_CHAR(f.DH_IMPRESSAO,'YYYY-MM-DD') DTIMPRESSAO
  FROM TGFFIN f
  JOIN TGFPAR p ON p.CODPARC = f.CODPARC AND p.TIPPESSOA = 'J'
  LEFT JOIN TSIEMP e ON e.CODEMP = f.CODEMP
  LEFT JOIN TSIBCO b ON b.CODBCO = f.CODBCO
  LEFT JOIN TSICTA c ON c.CODCTABCOINT = f.CODCTABCOINT
  LEFT JOIN TGFTIT tt ON tt.CODTIPTIT = f.CODTIPTIT
  LEFT JOIN TGFCAB cab ON cab.NUNOTA = f.NUNOTA
  -- TGFCAB -> TGFTOP e join COMPOSTO (CODTIPOPER, DHTIPOPER). Ligar so pela primeira
  -- coluna multiplica as linhas por cada versao historica da operacao.
  LEFT JOIN TGFTOP top ON top.CODTIPOPER = cab.CODTIPOPER AND top.DHALTER = cab.DHTIPOPER
  LEFT JOIN AD_CONTRATO ct ON ct.NUCONT = f.AD_NUCONT
  WHERE f.RECDESP = 1 AND f.DHBAIXA IS NULL AND f.PROVISAO = 'N'
    AND f.CODEMP IN (${emp})
    -- SO TITULO QUE E BOLETO. Sem esta linha a cobranca alcancava deposito, NF cancelada,
    -- compensacao contabil, PDD e debito de funcionario: 871 titulos e R$ 5,5M que nao se
    -- cobra por mensagem. Ver o comentario de cobranca_config.tipos_titulo.
    AND f.CODTIPTIT IN (${tipos})
    -- DUAS PORTAS, e nao uma. A primeira e a carteira que se cobra: vencido ate o teto de
    -- atraso, mais o que vence na proxima semana. A segunda e o boleto RECEM-IMPRESSO, que
    -- pode vencer daqui a um ano e mesmo assim precisa sair hoje — ver 013_boleto_na_impressao.
    -- Sem esta segunda porta o cobranca-emitidos nunca via um boleto nascer: via um titulo
    -- entrar na janela de sete dias, e chamava isso de "registrado agora".
    AND (
      f.DTVENC < TRUNC(SYSDATE) + ${dias + 1}
      OR f.DH_IMPRESSAO >= TRUNC(SYSDATE) - ${impressao}
    )
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

// v5: a ORIGEM do titulo. Ver sql/009_origem_do_titulo.sql para o que o ERP tem e o que
//     nao tem — em particular: data de entrega NAO existe nestes titulos, e o que existe
//     e a data de saida da nota, que e outra coisa e vai ser dita como tal.

/* ----------------------------------------------------------------------- main */
