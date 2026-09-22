# Alteracoes em funcoes de producao

O motor de cobranca reaproveita o trilho de disparo que ja existe
(`fila_envio` -> `fila-processar` -> `campanhas-enviar` -> GHL) em vez de abrir um
caminho novo para o GHL. Isso mantem num lugar so a trava de instancia, a confirmacao de
troca, a pos-checagem de queda e o teto por minuto — tudo que essas funcoes aprenderam
em producao e que um caminho paralelo teria de reaprender do zero, a custa dos clientes.

Reaproveitar exigiu duas mudancas, ambas aditivas: nenhum campo existente mudou de
significado, e uma chamada que nao passe os campos novos se comporta exatamente como antes.

## `campanhas-enviar` v40 -> v41

**1. `anexos` (array de URLs) — anexo de verdade, nao imagem.**
Ja existia `imagens`, que no WhatsApp vira `attachments` e no e-mail vira `<img>` no corpo
(montado pelo `fila-processar`). Um boleto em PDF por esse caminho apareceria como imagem
quebrada no e-mail. Agora:

| campo    | WhatsApp                  | E-mail                          |
|----------|---------------------------|---------------------------------|
| `imagens`| `attachments` (como hoje) | `<img>` no corpo (como hoje)    |
| `anexos` | `attachments`             | `attachments` do POST de e-mail |

**2. `forcar_dono` — a cobranca sai pela Nina, e devolve o contato para quem era dono.**
O numero de saida no WhatsApp e o do `assignedTo` do contato no CRM. Cobranca precisa
falar com a voz do financeiro, nao da representante comercial — foi a decisao do gestor.
Mas trocar o dono e deixar assim tem preco conhecido nesta base: a v33 registra que um
teste deixou o contato do gestor com a Camyla e derrubou por dois dias os avisos de lead,
que saem pela Nina. Entao `forcar_dono` **devolve o dono anterior depois do envio**, num
`finally` — inclusive quando o envio falha. A janela em que o contato fica com a Nina e a
do proprio envio.

## `fila-processar` v29 -> v30

Repassa `fila_envio.anexos` para o `campanhas-enviar`, nos dois canais, e repassa
`forcar_dono` quando a linha pede. Nada mais muda: a fila continua lendo as mesmas
colunas, com os mesmos tetos e as mesmas pausas por instancia.

Duas colunas novas em `fila_envio` (`anexos text[]`, `forcar_dono boolean`), ambas
aceitando nulo — linha antiga e linha de outra campanha seguem funcionando sem tocar em nada.
