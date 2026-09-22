# Testes

Rodam em Node (o gerador de PDF e os textos da mensagem são TypeScript sem nada de Deno).

```bash
npm install --no-save esbuild@0.24.0

# 1) gerador de boleto: ITF, estrutura do PDF, acentuação, escape
npx esbuild ../supabase/functions/cobranca-boleto/boleto_pdf.ts --format=esm --outfile=boleto_pdf.mjs
node boleto_pdf.teste.mjs

# 2) montagem da mensagem: teto da lista e saudação
#    (fatia as funções puras do index.ts, que termina em Deno.serve)
node -e "const fs=require('fs');const s=fs.readFileSync('../supabase/functions/cobranca-montar/index.ts','utf8');
fs.writeFileSync('montar_puro.ts', s.slice(0, s.indexOf('Deno.serve(')).replace(/^import .*$/m,'') +
'\nexport { linhasTitulos, primeiroNome, nomeGentil, textoVencido, textoAVencer, html, TETO_WPP, TETO_EMAIL };\n')"
npx esbuild montar_puro.ts --format=esm --outfile=montar_puro.mjs
node montar.teste.mjs

# 3) as tres situacoes de boleto na mensagem (anexo / 2a via / emitido no banco)
node boleto_mensagem.teste.mjs
```

O que cada um cobre está em `docs/ARQUITETURA.md`, seções 3 e 4.

Conferência extra do PDF, opcional (rasteriza a primeira página):

```bash
npm install --no-save pdfjs-dist@4.0.379 @napi-rs/canvas@0.1.65
node raster.mjs   # escreve boleto.png
```
