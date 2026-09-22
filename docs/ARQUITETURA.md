# Arquitetura — motor de cobrança

Detalhe técnico das decisões. O README cobre o uso; aqui está o porquê.

---

## 1. Por que reaproveitar o trilho de disparo em vez de falar com o GHL direto

O projeto já tinha um caminho para o GHL: `fila_envio` → `fila-processar` → `campanhas-enviar`.
Esse caminho carrega coisas que só se aprende quebrando em produção, e o histórico de versões
das funções registra cada uma:

- **Trava de instância** (v22): WhatsApp sem instância sai pela última instância a que o
  contato ficou preso — de outro assunto, de outro mês.
- **Confirmação de troca** (v23): o `sleep` de 1500ms perdia a corrida. Hoje a função lê a
  conversa até o app confirmar, e recusa enviar se não confirmar.
- **Pós-checagem de entrega** (v29): em 26/08 oito mensagens foram marcadas "enviado" e
  nenhuma chegou — a instância estava desconectada e só o ZaptosWPP avisou, escrevendo na
  conversa.
- **Queda pelo nome** (v31): em 03/09 quatro instâncias saudáveis foram pausadas porque a
  função procurava a frase e não o nome. 174 mensagens ficaram presas doze dias.
- **Teto por minuto, por instância** (v20): o limite que protege de bloqueio é o do número.

Um caminho paralelo teria de reaprender tudo isso, e reaprenderia à custa dos clientes.
Por isso o WhatsApp da cobrança entra em `fila_envio` como qualquer campanha.

### A exceção: o e-mail

O e-mail sai do `cobranca-aprovar`, direto para o GHL. Motivo concreto: o corpo do e-mail
na fila é montado com `imagens` viradas em `<img>` pelo `fila-processar`, e um PDF por esse
caminho vira imagem quebrada. O POST de e-mail do GHL aceita `attachments`, que é o que o
boleto precisa.

Essa exceção custa ~40 linhas que duplicam o "achar ou criar contato". Foi preferida a
alterar o `campanhas-enviar`, que está na v40 e concentra toda a lógica acima: o ganho não
pagava o risco de mexer nele. **Se um dia o `campanhas-enviar` ganhar `anexos` no e-mail,
este caminho deve ser removido** — a nota está em `supabase/functions/_patches/README.md`.

### E o WhatsApp, como leva o PDF?

Pelo campo `fila_envio.imagens`. O nome é histórico: o que o `fila-processar` faz com ele é
passar como `attachments` no POST do texto — o campo de anexo do GHL. Para o Zaptos um PDF é
anexo como qualquer outro. Renomear a coluna mexeria em função de produção sem ganho.

---

## 2. O empréstimo do contato para a Nina

O número que o cliente vê no WhatsApp é o do **usuário remetente**, e numa mensagem de API o
remetente é o `assignedTo` do contato. Isso já foi medido: o `campanha-dono` registra que
`fromNumber` foi testado em 26/08 e **o GHL ignora** — a mensagem foi gravada com o userId
da dona do contato.

Então, para a cobrança sair pela Nina, a Nina precisa ser dona do contato no momento do envio.

O `cobranca-aprovar` faz isso como **empréstimo**, não como troca de carteira:

1. Grava `campanha_dono_emprestado` com `dono_antes`, `dono_depois` e `campanha='cobranca'`.
2. Só então faz o `PUT assignedTo`.
3. Se o PUT falhar, apaga o registro.

**Anota antes de trocar**, nessa ordem, por causa de 26/08: o upsert falhou calado (o índice
único era parcial e `ON CONFLICT` não o aceita como alvo) e 9 contatos trocaram de dono sem
registro de quem eram — exatamente o caso que a tabela existe para evitar.

Devolver reusa a função que já existe:

```
POST /functions/v1/campanha-dono   { "acao": "devolver", "campanha": "cobranca" }
```

**Consequência a acompanhar:** enquanto emprestado, o contato pertence à Nina no CRM. Campanha
de representante para esse mesmo contato vai bater na trava de divergência de dono do
`campanhas-enviar` (que é um aviso proposital, não um bug). Devolver depois de cada ciclo de
cobrança mantém isso curto.

---

## 3. O gerador de PDF

`supabase/functions/cobranca-boleto/boleto_pdf.ts`, ~310 linhas, zero dependências.

### O que ele não faz

Não calcula **nada**: nem DV, nem fator de vencimento, nem campo livre. Lê
`TGFFIN.LINHADIGITAVEL` e `TGFFIN.CODIGOBARRA` e desenha. Se a linha digitável não existe,
`exigirBoleto()` recusa. Um boleto com dígito calculado por nós é um boleto que pode cair na
conta errada, e a conciliação nunca fecharia.

### O código de barras

Interleaved 2 of 5, 44 dígitos:

| | |
|---|---|
| Start | `N N N N` (barra, espaço, barra, espaço — todos estreitos) |
| Par de dígitos | 5 barras do primeiro intercaladas com 5 espaços do segundo |
| Stop | `W N N` |
| Total | 227 elementos, 114 barras, 405 unidades |
| Largura | 103 mm ⇒ estreito = 103/405 = **0,2543 mm** (FEBRABAN: 0,254) |

O teste faz o caminho de volta: decodifica os elementos desenhados e confere que voltam os
mesmos 44 dígitos.

### O PDF

A4, uma página, duas vias (recibo do sacado + ficha de compensação) separadas por tracejado.
Fontes base-14 (Helvetica), sem embutir: o arquivo fica em ~11 KB e abre em qualquer aparelho.
Texto em Latin-1/WinAnsi, que cobre os acentos do português.

O `xref` usa offset **em bytes**, não em caracteres — contar caracteres daria o número errado
em qualquer acento e o PDF não abriria.

### O que os testes pegaram

- **Round-trip do ITF** em 4 códigos, incluindo os extremos `000…` e `999…`.
- **Offsets do xref**: os 6 apontam para o início do objeto certo.
- **`/Length`** bate com o stream real.
- **Acentos** gravados como byte Latin-1, sem vazar sequência UTF-8.
- **Escape** de `(`, `)` e `\`, que quebrariam a string do PDF.
- Um **defeito real**: a linha de corte era o caractere ✂ (U+2702), que não existe em
  Latin-1 e saía como uma fileira de `?`. Apareceu no texto que o pdf.js extraiu do arquivo,
  não na leitura do código. Virou um tracejado desenhado.

O PDF foi lido por um parser de verdade (`pdfjs-dist`), que extraiu todos os campos
corretamente, e rasterizado para conferência visual do layout e do código de barras.

### Hospedagem

Bucket `boletos`, público, só `application/pdf`, teto de 2 MB. Público porque o GHL busca o
anexo por URL, sem credencial. O nome do arquivo leva **16 bytes aleatórios**
(`2026-04/1535437-bafa310f10c8….pdf`): com o NUFIN sozinho, qualquer um varreria a carteira
contando de 1 em 1. A URL é o segredo.

---

## 4. O que a primeira rodada com dado real corrigiu

A rodada seca de 22/09 rodou contra a carteira inteira antes de qualquer envio. Ela pegou
dois defeitos que nenhum teste sintético teria pego:

**Mensagem com 352 linhas.** Uma rede de 50 lojas tem 352 duplicatas em aberto, e o texto
listava todas. `linhasTitulos()` ganhou teto (12 no WhatsApp, 40 no e-mail) e, acima dele,
**muda de forma** em vez de cortar: com várias lojas, o resumo passa a ser por loja — que é a
primeira pergunta que o financeiro de uma rede faz. O total continua sendo a soma de tudo, e
a mensagem diz o que não coube. Um teste confere que a soma do resumo bate com o total.

**"Olá, 001!"** O contato veio do cadastro do parceiro, onde o "nome do contato" é a razão
social `001 - INTERLAGOS - SP`. `primeiroNome()` passou a só aceitar o que parece nome de
gente: começa com letra, tem ao menos três letras, e não é palavra de razão social. Sem isso,
cai para o nome da empresa; sem ele, um cumprimento sem nome — melhor do que um nome errado.

---

## 4b. Só título que é boleto

A v1 do snapshot pegava qualquer título a receber em aberto. Estava errado, e a gestão
apontou: *"tem títulos que são depósitos, que acabam não gerando boleto. O ideal é rodar
esses títulos que são boletos. Se não é boleto não roda."*

Medido na janela de cobrança (até 180d, ≥ R$ 50):

| | Títulos | Valor | Com boleto |
|---|---|---|---|
| `CODTIPTIT` 4 + 55 (boleto) | 1.065 | R$ 2,89M | 88% |
| Todo o resto | 871 | R$ 5,54M | 3% |

O "resto" não é dívida a cobrar por mensagem, e cobrar seria errado de formas concretas:
depósito é o que o próprio cliente vai fazer; NF cancelada não existe mais; compensação e PDD
são ajuste contábil; débito de funcionário nem é cliente. A baixa taxa de boleto nesses
tipos (3%) é sintoma, não causa — eles nunca tiveram boleto porque nunca deveriam ter.

Esse filtro também desfaz um número que eu tinha reportado antes de conhecê-lo: "37% dos
vencidos têm boleto" era artefato de misturar tipos. Entre os títulos que **são** boleto, a
cobertura é de 88%.

### E o boleto que existe, mas não no ERP

Dos que sobram sem boleto, a maioria **já tem um**, emitido direto no banco:

- conta **113 (Grafeno)**, inteira — 73 títulos
- conta **112 (Safra)**, negociados entre **06/10/2025 e 23/07/2026** — 28 títulos, que foram
  os primeiros do Safra e saíram manualmente no banco

Safra fora dessa janela, e os demais bancos, podem gerar normalmente.

Isso muda duas coisas. A ação de gerar boleto **nunca** deve tocá-los (dois códigos de barras
para a mesma dívida), e a mensagem não pode prometer 2ª via automática para eles — por isso
`sobreOsBoletos()` tem três caminhos e não dois: anexo, "eu providencio", e "saiu pelo banco,
o financeiro te manda".

A regra vive em `cobranca_config.boleto_nao_geravel` porque tem prazo de validade: quando o
período manual do Safra não tiver mais título em aberto, é um `UPDATE`.

## 5. O card é um retrato, e retrato envelhece

Entre montar e aprovar, o cliente pode ter pago. No cron os dois passos correm seguidos e a
janela é de segundos, mas o painel não: um card de sexta aprovado na segunda cobraria quem já
quitou.

Antes de enviar, o `cobranca-aprovar` confere os NUFINs do card contra `cobranca_titulo`, que
o refresh acabou de reescrever do Sankhya. Sumiu algum, o card **não sai** — volta para
`aguardando` com o motivo, e um novo `cobranca-montar` o reescreve com a dívida certa.

Recalcular o texto ali seria pior: a pessoa aprovou **um** texto, e trocá-lo depois do OK é
aprovar por ela.

---

## 6. Ordem do encadeamento

```
cobranca-titulos-refresh  →  cobranca-boleto  →  cobranca-montar  →  cobranca-aprovar
```

Montar antes de renderizar o boleto produziria card sem anexo, dizendo ao cliente que o boleto
vai junto quando não vai. O `cobranca-cron` respeita essa ordem, serialmente.

Falha no refresh **para a rodada** — sem o Sankhya não há o que cobrar. Falha no boleto **não
para**: cobrança sem anexo ainda é cobrança, e o texto já diz que a 2ª via vem a pedido.

O fuso é `America/Sao_Paulo`, sempre. O Deno roda em UTC, e "sexta de manhã" em UTC é quinta à
noite no Brasil — o aviso da semana sairia um dia antes, toda semana.

---

## 7. Travas de segurança, reunidas

| Trava | Onde | O que evita |
|---|---|---|
| `cobranca_config.ativo = false` | montar, aprovar | o motor não roda sem alguém ligar |
| `auto_aprovar = false` | montar, cron | nada sai sem OK no painel |
| Sankhya mudo aborta antes do delete | refresh | apagar o snapshot por causa de uma sessão perdida |
| `exigirBoleto()` | boleto_pdf | emitir boleto com dado faltando ou remendado |
| Guarda de frescor | aprovar | cobrar quem já pagou |
| `unique (rodada, fase, grupo)` | schema | rodar o montar duas vezes duplicar cobrança |
| `reenvio_min_dias` | montar | martelar o mesmo cliente |
| `cap_grupos_run` | montar | uma rodada disparar a carteira inteira |
| Instância pausada bloqueia | aprovar | enfileirar para um número que caiu |
| Anota antes de trocar o dono | aprovar | perder para quem devolver o contato |
| RLS ligada, sem policy | schema | anon key ler inadimplência |
| Token aleatório no nome do PDF | boleto | varrer a carteira pela URL |
| Um destino por canal | aprovar | uma cobrança virar quatro |

---

## 8. O que ficou de fora, e por quê

**Gerar os boletos que faltam.** Existe a ação `Gerar Boletos Não Gerados`
(`nitron.boletosAtrasados.BaGerarBoletosNaoGerados`) no Sankhya. Depois do filtro por tipo e
da regra de banco, ela valeria para apenas **15 títulos** — os outros 101 sem boleto já têm
um, emitido direto no banco. Não foi acionada: é escrita no ERP com efeito bancário real.

**Se um dia ela entrar na rotina, ela PRECISA respeitar `boleto_nao_geravel`.** Rodar a ação
sem esse filtro geraria um segundo código de barras para 101 dívidas que já têm boleto na mão
do cliente — o pior erro possível neste sistema. A coluna `cobranca_titulo.boleto_geravel` já
marca cada título; a consulta é `where boleto_geravel = true`.

**Títulos com mais de 180 dias de atraso.** Ficam fora por `atraso_max`. A carteira toda é de
R$ 11,5M; dentro da janela de cobrança são R$ 3,4M. O resto é jurídico, e a campanha
`cobranca_juridico` que já existe no catálogo trata disso — sem empurrão comercial.

**Clientes pessoa física.** O snapshot filtra `TIPPESSOA = 'J'`, seguindo o filtro já validado
pelo time no `cobranca-refresh`. Mudar é tirar uma condição do SQL, mas deveria ser decisão
consciente: `RECDESP = 1` com pessoa física pode alcançar adiantamento de funcionário.

**Resposta do cliente.** Quem responder a cobrança cai na conversa da Nina no CRM, como
qualquer outro atendimento. Roteamento automático da resposta (o que o `campanha-dono varrer`
faz para campanhas) não foi ligado para cobrança.
