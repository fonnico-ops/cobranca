// cobranca-painel (v1) — a tela de aprovacao. HTML montado no servidor, com a chave de
// servico ficando no servidor: as tabelas de cobranca tem RLS ligada e sem policy, entao
// o anon key nao le nada. O navegador so ve o que esta na pagina.
//
// GET  ?rodada=YYYY-MM-DD&fase=vencido    -> a tela
// POST { acao:"aprovar"|"recusar", ids:[...] } -> repassa ao cobranca-aprovar
//
// O que a tela mostra de proposito, antes do botao:
//   - a MENSAGEM inteira, como o cliente vai ler. Aprovar sem ler o texto nao e aprovar.
//   - o DESTINO e de onde ele veio (financeiro do Sankhya? cadastro? CRM?). A diferenca
//     entre cobrar o financeiro e cobrar o telefone da recepcao e grande, e so a origem conta.
//   - quantos boletos vao anexos e quantos titulos ficaram SEM boleto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (v: any) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const ORIGEM_ROTULO: Record<string, string> = {
  sankhya_respcobranca: "Resp. cobrança (Sankhya)",
  sankhya_financeiro: "Financeiro (Sankhya)",
  sankhya_contato: "Contato (Sankhya)",
  parceiro_sankhya: "Cadastro do parceiro",
  crm: "CRM",
};
// verde = falamos com quem cuida de pagar; ambar = e o cadastro geral; cinza = so o CRM
const ORIGEM_COR: Record<string, string> = {
  sankhya_respcobranca: "#0a7", sankhya_financeiro: "#0a7",
  sankhya_contato: "#c80", parceiro_sankhya: "#c80", crm: "#888",
};

function pagina(cards: any[], ctx: any): string {
  const total = cards.reduce((a, c) => a + Number(c.valor || 0), 0);
  const cartoes = cards.map((c) => {
    const contatos = (Array.isArray(c.contatos) ? c.contatos : []);
    const wpp = contatos.find((x: any) => x.canal === "whatsapp");
    const mail = contatos.find((x: any) => x.canal === "email");
    const boletos = Array.isArray(c.boletos) ? c.boletos : [];
    const destino = (t: any, rotulo: string) => t
      ? `<div class="dest"><b>${rotulo}</b> ${esc(t.valor)}
           <span class="org" style="background:${ORIGEM_COR[t.origem] || "#888"}">${esc(ORIGEM_ROTULO[t.origem] || t.origem)}</span>
           ${t.nome ? `<span class="quem">${esc(t.nome)}${t.funcao ? " · " + esc(t.funcao) : ""}</span>` : ""}</div>`
      : `<div class="dest vazio"><b>${rotulo}</b> sem contato</div>`;
    return `<article class="card" data-id="${c.id}">
      <header>
        <label><input type="checkbox" class="sel" value="${c.id}"${c.status === "aguardando" ? " checked" : " disabled"}></label>
        <div class="tit"><h3>${esc(c.nome || "grupo " + c.grupo)}</h3>
          <div class="meta">${c.n_titulos} título${c.n_titulos > 1 ? "s" : ""}
            ${c.fase === "vencido" ? ` · maior atraso <b>${c.maior_atraso}d</b>` : ""}
            ${(c.codparcs || []).length > 1 ? ` · ${(c.codparcs || []).length} lojas` : ""}</div></div>
        <div class="vlr">${brl(c.valor)}</div>
      </header>
      <div class="anex">
        ${boletos.length ? `<span class="ok">${boletos.length} boleto${boletos.length > 1 ? "s" : ""} anexo${boletos.length > 1 ? "s" : ""}</span>` : ""}
        ${c.sem_boleto ? `<span class="falta">${c.sem_boleto} título${c.sem_boleto > 1 ? "s" : ""} sem boleto no ERP</span>` : ""}
        ${boletos.slice(0, 6).map((b: any) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">PDF ${esc(String(b.dtvenc).slice(8, 10) + "/" + String(b.dtvenc).slice(5, 7))}</a>`).join("")}
      </div>
      ${destino(wpp, "WhatsApp")}${destino(mail, "E-mail")}
      <pre class="msg">${esc(c.mensagem)}</pre>
      ${c.status !== "aguardando" ? `<div class="jasaiu">${esc(c.status)}${c.motivo ? " — " + esc(c.motivo) : ""}</div>` : ""}
    </article>`;
  }).join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cobrança — aprovação</title><style>
:root{--bg:#f6f7f9;--fg:#111;--card:#fff;--bd:#e3e5e9;--mut:#666;--ac:#0b5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14161a;--fg:#e9eaec;--card:#1c1f24;--bd:#2a2e35;--mut:#9aa0a8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.barra{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{font:600 14px system-ui;padding:9px 16px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--fg);cursor:pointer}
button.go{background:var(--ac);border-color:var(--ac);color:#fff}button[disabled]{opacity:.5;cursor:not-allowed}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin:12px 0}
.card header{display:flex;gap:10px;align-items:flex-start}
.tit{flex:1;min-width:0}h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.meta{color:var(--mut);font-size:12.5px}
.vlr{font:700 17px system-ui;white-space:nowrap}
.anex{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 6px;font-size:12px;align-items:center}
.anex .ok{background:#0a7;color:#fff;padding:2px 8px;border-radius:99px}
.anex .falta{background:#c60;color:#fff;padding:2px 8px;border-radius:99px}
.anex a{color:var(--ac);text-decoration:none;border:1px solid var(--bd);padding:2px 8px;border-radius:99px}
.dest{font-size:13px;margin:3px 0;overflow-wrap:anywhere}.dest b{display:inline-block;min-width:74px;color:var(--mut);font-weight:600}
.dest.vazio{color:var(--mut)}
.org{font-size:11px;color:#fff;padding:1px 7px;border-radius:99px;margin-left:4px;white-space:nowrap}
.quem{color:var(--mut);font-size:12px;margin-left:4px}
.msg{white-space:pre-wrap;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;margin:10px 0 0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.jasaiu{margin-top:8px;font-size:12.5px;color:var(--mut)}
#aviso{padding:10px 12px;border-radius:8px;margin:10px 0;display:none}
.vazio-tudo{text-align:center;color:var(--mut);padding:60px 20px}
@media(max-width:560px){.wrap{padding:12px}.card header{flex-wrap:wrap}.vlr{width:100%}}
</style></head><body><div class="wrap">
<h1>Cobrança — ${ctx.fase === "vencido" ? "títulos vencidos" : "a vencer na próxima semana"}</h1>
<div class="sub">rodada ${esc(ctx.rodada)} · ${cards.length} grupo(s) · ${brl(total)} · sai pela <b>${esc(ctx.instancia)}</b>${ctx.desligado ? ' · <b style="color:#c60">motor desligado (cobranca_config.ativo = false)</b>' : ""}</div>
<div class="barra">
  <button id="todos">Marcar todos</button><button id="nenhum">Desmarcar</button>
  <span style="flex:1"></span>
  <button id="recusar">Recusar</button>
  <button id="aprovar" class="go">Aprovar e disparar</button>
</div>
<div id="aviso"></div>
${cards.length ? cartoes : '<div class="vazio-tudo">Nada aguardando aprovação nesta rodada.<br>Rode o <code>cobranca-montar</code> para montar a fila.</div>'}
</div><script>
const $=(s)=>document.querySelector(s), $$=(s)=>[...document.querySelectorAll(s)];
const sels=()=>$$(".sel:checked:not([disabled])").map(x=>Number(x.value));
function aviso(t,erro){const a=$("#aviso");a.style.display="block";a.textContent=t;
  a.style.background=erro?"#fde8e8":"#e6f6ee";a.style.color=erro?"#8a1c1c":"#0a5c38";}
$("#todos").onclick=()=>$$(".sel:not([disabled])").forEach(x=>x.checked=true);
$("#nenhum").onclick=()=>$$(".sel").forEach(x=>x.checked=false);
async function manda(acao){
  const ids=sels();
  if(!ids.length) return aviso("Nenhum card marcado.",true);
  const verbo = acao==="aprovar" ? "DISPARAR a cobran\\u00e7a de" : "recusar";
  if(!confirm("Confirma "+verbo+" "+ids.length+" grupo(s)?\\n\\nNo aprovar, as mensagens saem de verdade para os clientes.")) return;
  $("#aprovar").disabled=true;$("#recusar").disabled=true;aviso("Processando "+ids.length+"\\u2026");
  try{
    const r=await fetch(location.pathname+location.search,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao,ids})});
    const d=await r.json();
    if(!d.ok) throw new Error(d.erro||"falhou");
    aviso(acao==="aprovar"
      ? ("Pronto: "+(d.enfileirados||0)+" grupo(s) \\u2014 "+(d.whatsapp_na_fila||0)+" WhatsApp na fila, "+(d.email_enviado||0)+" e-mail enviado"+(d.erros?", "+d.erros+" com erro":"")+". Recarregando\\u2026")
      : ((d.recusados||0)+" recusado(s). Recarregando\\u2026"));
    setTimeout(()=>location.reload(),2200);
  }catch(e){aviso("Erro: "+e.message,true);$("#aprovar").disabled=false;$("#recusar").disabled=false;}
}
$("#aprovar").onclick=()=>manda("aprovar");
$("#recusar").onclick=()=>manda("recusar");
</script></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, srvKey());
    const u = new URL(req.url);
    const rodada = (u.searchParams.get("rodada") || hojeSp()).slice(0, 10);
    const fase = u.searchParams.get("fase") || "vencido";

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => Number(x)).filter(Boolean);
      if (!ids.length) return j({ ok: false, erro: "sem ids" }, 400);
      const corpo = b.acao === "recusar"
        ? { recusar: ids, aprovado_por: "painel", motivo: "recusado no painel" }
        : { ids, aprovado_por: "painel" };
      const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/cobranca-aprovar", {
        method: "POST",
        headers: { Authorization: "Bearer " + srvKey(), "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      return j(await r.json().catch(() => ({ ok: false, erro: "resposta ilegivel do cobranca-aprovar" })), r.status);
    }

    const { data: cfg } = await sb.from("cobranca_config").select("ativo,instancia").eq("id", 1).maybeSingle();
    const { data: cards, error } = await sb.from("cobranca_fila").select("*")
      .eq("rodada", rodada).eq("fase", fase).order("valor", { ascending: false }).limit(300);
    if (error) throw error;

    return new Response(pagina(cards || [], { rodada, fase, instancia: cfg?.instancia || "Nina", desligado: cfg?.ativo !== true }), {
      headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) { return j({ ok: false, erro: String(e) }, 500); }
});
