// cobranca-boleto (v2) — renderiza o PDF da segunda via e hospeda no Storage.
//
// v2: o desenho passou a ser o mesmo do ERP (duas vias, grade do Jasper) e ganhou a area
// do PIX. Por isso o SELECT traz agora `pix`, `parcela`, `serie` e `dtneg`: sem o payload
// de TGFFIN.AD_PIXQRCODE a caixa do PIX sai VAZIA, que e o combinado — um QR inventado
// manda o dinheiro para a conta errada.
//
// Por que o PDF nasce aqui e nao na hora do envio: o GHL busca o anexo por URL publica,
// entao o arquivo precisa existir ANTES da mensagem sair. E porque re-renderizar o mesmo
// boleto a cada toque de cobranca seria desperdicio — o titulo so muda quando o valor ou
// o vencimento muda, e o refresh ja invalida o cache nesse caso.
//
// NOME DO ARQUIVO COM TOKEN ALEATORIO. O bucket e publico porque o GHL precisa baixar
// sem credencial, e o boleto carrega nome do cliente, CNPJ e valor devido. Com o NUFIN no
// nome, qualquer um varreria a carteira inteira contando de 1 em 1. Com 16 bytes de
// aleatoriedade, a URL e o segredo.
//
// Uso:
//   POST {}                      -> renderiza todos os titulos pendentes (respeita `limite`)
//   POST {"nufins":[1,2,3]}      -> so esses
//   POST {"limite":50}           -> teto por chamada (padrao 300)
//   POST {"refazer":true}        -> ignora o que ja tem URL e renderiza de novo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gerarBoletoPdf, exigirBoleto, type Titulo } from "./boleto_pdf.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "boletos";

function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const key = srvKey();
    const sb = createClient(url, key);
    const b = await req.json().catch(() => ({}));
    const limite = Math.max(1, Math.min(1000, Number(b.limite) || 300));
    const refazer = b.refazer === true;

    let q = sb.from("cobranca_titulo")
      .select("nufin,numnota,serie,parcela,dtneg,dtvenc,valor,nossonum,banco,codbco,carteira,agencia,conta,linha_digitavel,codigo_barras,pix,cedente,cedente_cnpj,sacado,sacado_cnpj,boleto_url")
      .not("linha_digitavel", "is", null);
    if (Array.isArray(b.nufins) && b.nufins.length) q = q.in("nufin", b.nufins.map((x: any) => Number(x)).filter(Boolean));
    if (!refazer) q = q.is("boleto_url", null);
    // vencimento mais proximo primeiro: e o boleto que a proxima rodada vai precisar
    const { data: titulos, error } = await q.order("dtvenc", { ascending: true }).limit(limite);
    if (error) throw error;

    let feitos = 0; const recusados: any[] = []; const falhas: any[] = [];
    for (const t of (titulos || [])) {
      const motivo = exigirBoleto(t as Titulo);
      if (motivo) { recusados.push({ nufin: t.nufin, motivo }); continue; }
      try {
        const pdf = gerarBoletoPdf(t as Titulo);
        const caminho = `${String(t.dtvenc).slice(0, 7)}/${t.nufin}-${token()}.pdf`;
        const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminho}`, {
          method: "POST",
          headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/pdf", "x-upsert": "true", "cache-control": "max-age=604800" },
          body: pdf,
        });
        if (!r.ok) { falhas.push({ nufin: t.nufin, erro: "storage " + r.status + ": " + (await r.text()).slice(0, 140) }); continue; }
        const publica = `${url}/storage/v1/object/public/${BUCKET}/${caminho}`;
        const { error: eUp } = await sb.from("cobranca_titulo").update({ boleto_url: publica, boleto_em: new Date().toISOString() }).eq("nufin", t.nufin);
        if (eUp) { falhas.push({ nufin: t.nufin, erro: "update: " + eUp.message }); continue; }
        feitos++;
      } catch (e) { falhas.push({ nufin: t.nufin, erro: String(e).slice(0, 200) }); }
    }

    const { count: pendentes } = await sb.from("cobranca_titulo").select("nufin", { count: "exact", head: true })
      .not("linha_digitavel", "is", null).is("boleto_url", null);

    return j({
      ok: true, gerados: feitos, avaliados: (titulos || []).length,
      recusados: recusados.length ? recusados.slice(0, 20) : undefined,
      falhas: falhas.length ? falhas.slice(0, 20) : undefined,
      ainda_pendentes: pendentes ?? null,
    });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
