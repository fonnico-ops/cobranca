# Testes

```bash
./rodar.sh
```

Roda as seis suites. O script existe porque os comandos soltos que estavam aqui envelheceram
uma vez: a lista de exports do `montar_puro` ficou desatualizada e três suites pararam de
importar. Agora a lista mora num lugar só.

| suite | o que cobre |
|---|---|
| `boleto_pdf` | ITF ida e volta, offsets do xref, `/Length`, acento Latin-1, escape |
| `montar` | teto da lista (o caso das 352 duplicatas), saudação ("Olá, 001!") |
| `boleto_mensagem` | as três situações do boleto: anexo / 2ª via / emitido no banco |
| `assinatura` | rodapé em dado, campo vazio não impresso |
| `marca` | os botões de boleto antes da assinatura, não depois |
| `conversa` | `sanear()`, os blocos de dívida e de origem, o rodízio, os cinco toques |

O que cada um cobre em detalhe está em `docs/ARQUITETURA.md`, seções 3, 4, 9 e 10.

Conferência extra do PDF, opcional (rasteriza a primeira página):

```bash
npm install --no-save pdfjs-dist@4.0.379 @napi-rs/canvas@0.1.65
node raster.mjs   # escreve boleto.png
```
