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
cobranca-refresh  →  cobranca-boleto  →  cobranca-montar  →  cobranca-aprovar
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

## 9. A Nina Financeiro conversando

Até aqui o motor mandava a cobrança e virava as costas. Quem respondia "manda a 2ª via" ou
"pago sexta" falava sozinho, e quem **não** respondia nunca mais era lembrado — que é
exatamente quem se queria cobrar.

Duas funções fecham o ciclo:

| | |
|---|---|
| `cobranca-atende` | lê o que o cliente respondeu no GHL e responde, dentro de um envelope estreito |
| `cobranca-seguir` | insiste enquanto ninguém responde e, no fim, entrega a conversa a uma pessoa |

O estado da conversa vive em `cobranca_conversa`, uma linha por contato do CRM.

### Os quatro limites

Três a gestão pediu. O quarto é o que sustenta os outros.

**1. A Nina só fala em conversa que o motor abriu.** A varredura é de conversas não lidas da
location — e essa location tem lead de marketing, cliente reclamando de entrega e
representante, tudo junto. O filtro é a própria tabela `cobranca_conversa`: contato sem linha
lá não é olhado. Um atendimento que respondesse "toda conversa não lida" responderia lead de
marketing pela caixa da cobrança, e ninguém descobriria antes do cliente.

**2. Só o operacional.** 2ª via, confirmar valor e vencimento, dizer de onde vem o título,
receber comprovante, anotar promessa de pagamento. Prazo, parcelamento, desconto, contestação
de valor, juros, protesto: repassa. Um desconto combinado por robô é dinheiro que não volta.

**3. Repassada é repassada.** Assim que a conversa vai para a Karla ou a Bianca, o robô não
fala mais nela. Robô e pessoa escrevendo na mesma conversa apaga o trabalho da atendente no
meio.

**4. A IA não escreve algarismo. Nenhum.** É a regra da casa (o `copiloto-repasse` já faz o
mesmo com CNPJ) e aqui vale em dobro: a conversa carrega valor, vencimento, NF e linha
digitável. Um dígito trocado manda o cliente pagar o que não deve — e a conversa vira
discussão sobre o número em vez de pagamento.

O modelo escreve **só prosa** e pede os números por marcador:

| marcador | o código preenche com |
|---|---|
| `[[DIVIDA]]` | a lista dos títulos em aberto, valor e vencimento de cada um |
| `[[TOTAL]]` | a soma em aberto |
| `[[ORIGEM]]` | de onde vem cada título (§10) |
| `[[BOLETO]]` | anexa os PDFs e escreve a frase certa sobre eles |

E `sanear()` confere: **qualquer** algarismo na prosa do modelo reprova a resposta. Uma
tentativa de reescrever; se reprovar de novo, a conversa vai para uma atendente em vez de
sair um texto improvisado. Isso é deliberado — mandar um número inventado é pior do que a
Karla ler a conversa.

Marcadores de controle, que somem do texto: `[[REPASSA:motivo]]`, `[[PROMESSA:AAAA-MM-DD]]`,
`[[PAGO]]`, `[[PARAR]]`.

### A cadência: cinco toques, depois uma pessoa

O toque 1 é a cobrança do `cobranca-aprovar`, que já nasce gravada em `cobranca_conversa`.
Os toques 2 a 5 saem do `cobranca-seguir`, com espera crescente
(`cobranca_config.toques_espera`, hoje `{2,3,4,7,7}` dias). Vencido o quinto, a conversa vai
para a Karla ou a Bianca. **Não existe toque 6**: robô que insiste para sempre não cobra, só
treina o cliente a ignorar o número.

Detalhes que não são enfeite:

- **Toque que não saiu não conta.** Uma instância caída por dois dias consumiria o orçamento
  de cinco toques sem o cliente receber nada — e ele seria repassado a uma atendente que vai
  perguntar por que ninguém o procurou.
- **Nunca sábado nem domingo.** `proximoToqueEm()` empurra para o próximo dia útil, e a
  função ainda confere a janela (seg–sex, 9h–18h em São Paulo) antes de tocar. Cobrança às
  23h de domingo é o tipo de coisa que faz o cliente bloquear o número.
- **Promessa cala o robô.** Marcou data, o próximo toque é o dia *seguinte* a ela. Tocar
  antes é desconfiar na cara de quem acabou de se comprometer.
- **Quem respondeu sai da cadência de quem sumiu**: próximo toque em uma semana, não em dois
  dias.
- **A dívida é reconferida antes de cada toque.** Entre o toque 1 e o 5 passam duas semanas,
  e cobrar quem já pagou custa mais caro do que não cobrar.
- **Pediu para parar, para.** `nao_perturbe` faz o `cobranca-montar` pular o grupo nas
  rodadas seguintes. Cobrar de novo quem pediu para parar é o caminho mais curto para o
  número ser denunciado — e perder o número custa a carteira inteira, não um cliente.

### O repasse

Três coisas acontecem juntas, nesta ordem:

1. o contato muda de dono no CRM (é assim que a conversa aparece na fila dela);
2. uma **nota** no contato diz por que ela chegou, com a última fala do cliente. Nota e não
   tarefa: a nota fica junto da conversa, tarefa vira lista paralela que ninguém abre. Se
   este passo falhasse, a atendente abriria uma conversa sem contexto — que é como o repasse
   morre na prática;
3. `cobranca_conversa.status = 'repassada'`, e o robô perde a permissão de falar.

O rodízio entre Karla e Bianca é por peso **com memória** (`cobranca_atendente.recebidos`):
sem o contador, sortear a cada repasse concentra numa só em qualquer amostra pequena — e um
repasse por dia é amostra pequena.

O contato estava *emprestado* à Nina (§2), então o repasse atualiza `dono_depois`. Sem isso o
`campanha-dono` veria `dono_depois = Nina`, acharia que alguém mexeu por fora, e deixaria o
contato com a atendente para sempre.

### Supervisão

`cobranca-painel?aba=conversas`: status, toque atual, promessa, quem recebeu o repasse e por
quê, e as últimas seis falas dos dois lados. Robô que conversa sem tela de supervisão é robô
que ninguém corrige.

---

## 10. De onde vem o boleto

A primeira pergunta de quem recebe uma cobrança não é *quanto* — é *de que é isso*. Até aqui
a única resposta possível era o número da NF, e "NF 188412" não diz nada a quem está do outro
lado. Quem não responde isso perde a conversa: o cliente para de discutir pagamento e passa a
discutir se a dívida existe.

Medido na carteira de cobrança em 22/09 (1.053 títulos que são boleto, empresas 1/2/14):

| | |
|---|---|
| parcela (`TGFFIN.DESDOBRAMENTO`) | 1.052 · 99,9% |
| nota fiscal + `TGFCAB` | 841 |
| contrato do Clube (`TGFFIN.AD_NUCONT`) | 211 |
| sem origem nenhuma | 1 |
| status de entrega (do `entrega_nota`) | 214 · 20% |

Então a Nina consegue dizer, de praticamente todo título: a NF e a série, **parcela X de Y**,
a data em que a nota foi emitida — ou, no Clube, o **número do contrato** e a parcela.

### Data de entrega não existe

Foi pedida, e a resposta honesta é que o ERP não tem:

| campo | preenchido |
|---|---|
| `TGFCAB.AD_DTENTREGA` | 0 de 2.465 |
| `TGFCAB.AD_STATUSENTREGA` | 0 de 2.465 |
| `AD_TSIAGENENT` (agendamento) | 2 de 2.465 |
| `TGFCAB.DTPREVENT` | 51 de 2.465 (2%) |

O que existe é `TGFCAB.DTENTSAI` — **quando a nota foi emitida / a mercadoria saiu daqui**, e
isso é outra coisa. O `entrega_nota` do Supabase cobre 20% dos títulos e só diz "Entregue",
sem data.

Consequência codificada: a Nina diz "nota emitida em DD/MM" e, quando o `entrega_nota`
afirma, "consta entregue". **Data** de entrega ela não tem, e perguntar isso é repasse.
Inventar uma data de entrega numa cobrança é entregar ao cliente o argumento para não pagar.

### Duas coisas que só o dado real mostrou

- **No Clube, `TGFFIN.NUMNOTA` vem com o número do contrato, não com uma nota fiscal.**
  Visto no `nufin` 1509888: `numnota` 42, `contrato` 42. Sem guarda, a mensagem diria "NF 42"
  e o cliente iria procurar no sistema dele uma nota que não existe. E o total de parcelas do
  Clube não vem da nota (a contagem por nota volta 0, porque `NUNOTA` é nulo): vem de
  `AD_CONTRATO.QTDPARCELAS`.
- **O nome do tipo de operação não vai para o cliente.** `TGFTOP.DESCROPER` é nomenclatura
  interna: na produção há 15 títulos com *"Venda Reemissão de Nota com Problema"* e 161 com
  *"Venda Clientes Especiais"*. Mandar isso numa cobrança troca a conversa sobre pagamento
  por uma conversa sobre o problema da nota, ou sobre que clientes são "especiais". O campo
  fica guardado em `cobranca_titulo.operacao` para o painel e para a atendente.

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
