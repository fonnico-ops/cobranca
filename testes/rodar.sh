#!/usr/bin/env bash
# Roda todas as suites. Existe porque os comandos soltos do README envelheceram uma vez:
# a lista de exports do `montar_puro` ficou desatualizada e tres suites pararam de importar.
# Aqui a lista mora num lugar so.
set -euo pipefail
cd "$(dirname "$0")"

npm install --no-save esbuild@0.24.0 >/dev/null 2>&1 || true
ESB="npx --yes esbuild@0.24.0"

# O `montar` exporta com nome no fim do arquivo (fatiado antes do Deno.serve).
node -e '
const fs=require("fs");
const s=fs.readFileSync("../supabase/functions/cobranca-montar/index.ts","utf8");
fs.writeFileSync("montar_puro.ts", s.slice(0, s.indexOf("Deno.serve(")).replace(/^import .*$/m,"") +
"\nexport { linhasTitulos, primeiroNome, nomeGentil, textoVencido, textoAVencer, html, assinar, sobreOsBoletos, TETO_WPP, TETO_EMAIL, MARCA_BOLETOS, MARCA_RODAPE };\n");
// atende e seguir ja usam `export function`: aqui basta fatiar.
for (const fn of ["cobranca-atende","cobranca-seguir","cobranca-emitidos"]) {
  const t=fs.readFileSync("../supabase/functions/"+fn+"/index.ts","utf8");
  fs.writeFileSync(fn.replace("cobranca-","")+"_puro.ts", t.slice(0, t.indexOf("Deno.serve(")).replace(/^import .*$/gm,""));
}'

$ESB ../supabase/functions/cobranca-boleto/boleto_pdf.ts --format=esm --outfile=boleto_pdf.mjs --log-level=error
$ESB montar_puro.ts  --format=esm --outfile=montar_puro.mjs  --log-level=error
$ESB atende_puro.ts  --format=esm --outfile=atende_puro.mjs  --log-level=error
$ESB seguir_puro.ts  --format=esm --outfile=seguir_puro.mjs  --log-level=error
$ESB emitidos_puro.ts --format=esm --outfile=emitidos_puro.mjs --log-level=error

falhou=0
for t in boleto_pdf montar boleto_mensagem assinatura marca conversa emitidos; do
  printf '%-18s ' "$t"
  if saida=$(node "$t.teste.mjs" 2>&1); then echo "$saida" | tail -1
  else echo "FALHOU"; echo "$saida"; falhou=1; fi
done
exit $falhou
