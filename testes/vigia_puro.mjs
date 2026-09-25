const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const srvKey = () => Deno.env.get("SRV_JWT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const horaSp = () => Number((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));
const qdo = (t) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "\u2014";
function ha(desde, agora = Date.now()) {
  const min = Math.max(0, Math.round((agora - new Date(desde).getTime()) / 6e4));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
function podeLembrar(hora, ultimoEm, esperaHoras, agora = Date.now()) {
  if (hora < 8 || hora > 20) return false;
  if (!ultimoEm) return true;
  return agora - new Date(ultimoEm).getTime() >= esperaHoras * 36e5;
}
export {
  ha,
  podeLembrar
};
