# Motor de cobrança — Nitronplast

Automatiza a cobrança dos títulos **vencidos** e o aviso dos títulos **a vencer na próxima
semana**, com o boleto em anexo, saindo por **WhatsApp e e-mail pelo Go High Level, na voz
da Nina**.

Roda como Edge Functions no projeto Supabase `integracao-crm-sankhya`
(`bwbeieumxcuomtrvlqxs`) e se apoia no trilho de disparo que já existia
(`fila_envio` → `fila-processar` → `campanhas-enviar` → GHL).

---

## Como funciona, em quatro passos

```
  Sankhya (TGFFIN, TGFCTT, TGFPAR)
         │
         ▼
  1. cobranca-titulos-refresh   quem deve, quanto, e para quem falar
         │   → cobranca_titulo · cobranca_contato
         ▼
  2. cobranca-boleto            desenha o PDF e hospeda no Storage
         │   → cobranca_titulo.boleto_url
         ▼
  3. cobranca-montar            monta um card por grupo, com o texto pronto
         │   → cobranca_fila  (status: aguardando)
         ▼
  4. cobranca-aprovar           dispara o que foi aprovado
         ├── WhatsApp → fila_envio → fila-processar → GHL (anexo = PDF)
         └── E-mail   → GHL direto, com attachments + link do boleto
```

O `cobranca-cron` encadeia os quatro na cadência combinada. O `cobranca-painel` é a tela
onde alguém lê a mensagem e aprova.

---

## Cadência

| Rotina | Quando (America/Sao_Paulo) |
|---|---|
| Títulos vencidos | segunda, quarta e sexta, 9h |
| Títulos a vencer (7 dias) | sexta, 9h |

Na sexta as duas listas coincidem e o **a vencer ganha**: o cliente recebe no máximo um
toque por dia. O vencido daquela sexta volta na segunda.

## A mensagem

Escrita em código, não por IA — ela carrega valor, vencimento e número de NF, e um dígito
trocado manda o cliente pagar o que não deve.

**Quatro regras fixas:**

1. Nunca cita outro cliente nem o total da carteira.
2. Nunca ameaça no primeiro toque — protesto e negativação não aparecem.
3. Sempre dá uma saída: comprovante, prazo, parcelamento.
4. Sempre diz o que está anexo, e sempre diz quando **não** está.

O texto varia em quatro pontos: até 7 dias de atraso é "passando para lembrar", acima disso
"estou entrando em contato"; quem não tem nome de pessoa recebe "Olá, tudo bem?"; a frase do
boleto tem três versões (anexo / eu providencio / saiu pelo banco); e listas longas viram
resumo por loja.

**Assinatura — a mesma nos dois canais** (`cobranca_config.assinatura`):

```
Obrigada!
Nina — Financeiro Nitron

NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA
CNPJ 54.886.460/0001-98
(11) 96456-0761 · cobranca@nitron.com.br
```

No e-mail o rodapé sai em corpo menor e cinza, separado por um filete: ali ele é
identificação, não mensagem. **Campo vazio não é impresso** — nunca deixe placeholder na
config, ele chegaria ao cliente.

**E-mail:** assunto `Nitronplast — títulos em aberto (R$ X)`, PDFs anexos e botões de link
logo após a frase do boleto (não no rodapé), porque anexo de PDF é a primeira coisa que
filtro de spam corporativo remove.

**WhatsApp:** sai pelo número **(11) 96456-0761 — Nina Financeiro**, via GHL. O envio usa
`type: "SMS"` na API do GHL, que é o que o Zaptos converte em WhatsApp.

## Para quem a cobrança vai

O pedido era "enviar nos contatos de cobrança do Sankhya, caso não tenha mandar no que
tem". Isso virou uma escada de prioridade em `cobranca_contato.prioridade` — menor ganha:

| # | Origem | O que é |
|---|---|---|
| 10 | `sankhya_respcobranca` | `TGFCTT.RESPCOBRANCA='S'` ou `RECEBEBOLETOEMAIL='S'` |
| 20 | `sankhya_financeiro` | `TGFCTT.AD_DPTOCONTATO = Financeiro` |
| 30 | `sankhya_contato` | outro contato ativo do parceiro (Compras, Fiscal…) |
| 40 | `parceiro_sankhya` | o cadastro do parceiro: `TGFPAR.EMAIL`, `TELEFONE`, `AD_TELEFONE` |
| 50 | `crm` | `ghl_contato`, último recurso |

**Por que os níveis 40 e 50 não são detalhe.** Medido na produção em 22/09: dos 1.078
clientes com título vencido, apenas **111 (10%)** têm um contato do financeiro cadastrado
com telefone ou e-mail, e só **253 (23%)** têm qualquer contato em `TGFCTT`. Mas **99%**
têm e-mail e telefone no cadastro do parceiro. Sem o fallback, a cobrança falaria com um
décimo da carteira.

O painel mostra a origem de cada destino com cor: verde quando falamos com quem cuida de
pagar, âmbar quando é o cadastro geral, cinza quando só sobrou o CRM.

---

## O que entra na cobrança

**Só título que é boleto.** Isso é filtro, não detalhe: `CODTIPTIT` 4 (BOLETO) e 55 (BOLETO
CLUBE NITRON), configurável em `cobranca_config.tipos_titulo`.

Sem esse filtro, a cobrança alcançaria — medido em 22/09, na janela de cobrança — mais 871
títulos e R$ 5,5M que **não se cobra por mensagem**:

| Fora | Títulos | Valor | Por quê |
|---|---|---|---|
| Depósito / Depósito Antecipado | 367 | R$ 4,11M | é o cliente que deposita |
| NEGOCIAÇÃO COMERCIAL | 167 | R$ 102k | acordo em andamento |
| VENDA CLUBE NITRON | 144 | R$ 550k | o boleto do clube é o tipo 55 |
| NF Cancelada/Devolvida | 108 | R$ 156k | a nota não existe mais |
| COMPENSAÇÃO DÉBITO/CRÉDITO | 13 | R$ 477k | ajuste contábil |
| PDD, débito de funcionário, cheque devolvido, cartão, PIX | ~70 | — | não é dívida de cliente |

**PROTESTADO (30) e Cartório (38)** são boleto, mas já estão em via jurídica — cobrança
amigável ali é incoerente. Ficam de fora; a campanha `cobranca_juridico` do catálogo trata.

## O boleto

O Sankhya **não guarda o PDF do boleto** em lugar nenhum — conferido em `TGFFIN`,
`AD_BOLHYAK` e `TGFHBA`. O que o ERP tem é `LINHADIGITAVEL` e `CODIGOBARRA` de 44 dígitos.
O `boleto_pdf.ts` desenha a ficha a partir deles, sem dependência e **sem calcular nenhum
dígito**. Se a linha digitável não existe, recusa emitir.

**Cobertura real (22/09), só nos títulos que são boleto:**

| | títulos | com boleto no ERP |
|---|---|---|
| Vencidos | 546 | 507 (93%) |
| A vencer em 7 dias | 507 | 430 (85%) |

Dos 116 sem boleto:

- **15 dá para gerar** — a mensagem oferece a 2ª via.
- **101 já têm boleto, emitido direto no banco**, fora do ERP. A mensagem **não promete 2ª
  via automática** para esses: diz que o boleto saiu pelo banco e encaminha ao financeiro.

### Quais não podem ganhar boleto novo

Gerar um segundo boleto para uma dívida que já tem um cria dois códigos de barras: o cliente
paga o antigo e a baixa nunca fecha, ou paga os dois. A regra mora em
`cobranca_config.boleto_nao_geravel`, como dado:

| Conta | Janela | Títulos | Motivo |
|---|---|---|---|
| 113 GRAFENO DIGITAL | toda | 73 | boleto emitido direto no banco |
| 112 MATRIZ SAFRA 2 | DTNEG 06/10/2025 – 23/07/2026 | 28 | os primeiros do Safra saíram manualmente |

Safra **fora** dessa janela e os demais bancos (Itaú, conta 4) podem gerar normalmente.

A regra é dado e não código porque tem prazo: quando o período manual do Safra não tiver
mais título em aberto, é um `UPDATE`, não um deploy.

## A Nina responde, insiste, e sabe quando parar

A cobrança não é mais um disparo sem depois. Quando o cliente responde, a **Nina Financeiro**
atende; quando ele não responde, ela insiste; e quando o assunto sai do que ela pode resolver,
a conversa vai para a **Karla** ou a **Bianca** no CRM.

### O que ela resolve sozinha

- manda o boleto / a 2ª via;
- confirma valor e vencimento;
- **diz de onde vem a cobrança**: NF e série, *parcela X de Y*, data em que a nota foi
  emitida — ou, se for Clube, o número do contrato e a parcela;
- recebe comprovante de pagamento;
- anota promessa de pagamento (e cala até o dia seguinte à data prometida);
- aceita um "não quero mais receber" sem insistir.

### O que ela nunca resolve — vira repasse

Prazo, adiar vencimento, parcelar, desconto, abatimento, renegociação. Contestação de valor,
devolução, nota errada, mercadoria que não chegou, **data de entrega**. Juros, multa,
protesto, negativação, advogado. Pedido de falar com uma pessoa, reclamação, cliente irritado.
E qualquer coisa que ela não entendeu.

### A cadência

Cinco toques, e depois uma pessoa. O toque 1 é a cobrança do dia; os toques 2 a 5 saem a cada
2, 3, 4 e 7 dias úteis. Sem retorno no quinto, a conversa passa para a Karla ou a Bianca.
Não existe toque 6.

Só dia útil, 9h–18h de São Paulo. Toque que não saiu (instância caída, por exemplo) não conta.
A dívida é reconferida no Sankhya antes de **cada** toque — cobrar quem já pagou custa mais
caro do que não cobrar.

### A IA não escreve número

O modelo escreve só o texto; valor, vencimento, NF, parcela e contrato entram por marcador e
são preenchidos pelo código, lendo o `cobranca_titulo`. Se o modelo escrever um algarismo por
conta própria, **a mensagem não é enviada** — ela é reescrita uma vez e, se insistir, a
conversa vai para uma atendente. Um dígito trocado manda o cliente pagar o que não deve.

### Onde acompanhar

```
/functions/v1/cobranca-painel?aba=conversas
```

Status de cada conversa, em que toque está, quem prometeu pagar e para quando, quem foi
repassado e por quê, e as últimas falas dos dois lados.

---

## Ligar o motor

O motor nasce **desligado**, de propósito.

```sql
-- 1. confira a fila em modo seco, sem gravar nada
--    (cobranca-montar com {"seco":true} devolve a amostra e as mensagens)

-- 2. ligue o motor
update cobranca_config set ativo = true where id = 1;

-- 3. a fila passa a exigir aprovação no painel:
--    /functions/v1/cobranca-painel?fase=vencido
--    /functions/v1/cobranca-painel?fase=a_vencer

-- 4. depois que confiar no texto e nos destinos, dispense o painel:
update cobranca_config set auto_aprovar = true where id = 1;
```

Para parar tudo na hora: `update cobranca_config set ativo = false where id = 1;`

### Ligar o atendimento (é outra chave, de propósito)

Disparar cobrança e deixar um robô conversando são decisões de risco diferente, então são
duas chaves — não se deve poder tomar as duas sem querer:

```sql
-- o atendimento da Nina (responder o que o cliente escreveu)
update cobranca_config set atende_ativo = true where id = 1;
```

Os jobs no `pg_cron` já estão criados e ativos (`cobranca-atende-10min`,
`cobranca-seguir-2x-dia`). Enquanto as chaves estiverem `false` eles rodam e as funções
respondem `409` sem tocar em nada — job criado só "na hora de ligar" é job que alguém esquece.

**Antes de ligar**, veja o que ela responderia sem mandar nada:

```
POST /functions/v1/cobranca-atende   { "dry": true }
POST /functions/v1/cobranca-seguir   { "dry": true }
```

`dry` mostra a resposta gerada, os anexos, o repasse e a promessa que ela reconheceu — e não
escreve nem envia nada.

Para calar só a conversa, mantendo a cobrança do dia:
`update cobranca_config set atende_ativo = false where id = 1;`

### Devolver os contatos que a Nina pegou emprestado

Para o WhatsApp sair pelo número da Nina, ela precisa ser dona do contato no CRM no
momento do envio (o GHL ignora `fromNumber` — isso já foi medido e está registrado no
`campanha-dono`). O dono anterior fica gravado, e devolver é uma chamada:

```
POST /functions/v1/campanha-dono   { "acao": "devolver", "campanha": "cobranca" }
```

---

## Parâmetros (`cobranca_config`, uma linha)

| Campo | Padrão | O que faz |
|---|---|---|
| `ativo` | `false` | chave geral. `false` trava montar e aprovar |
| `auto_aprovar` | `false` | `true` dispensa o painel |
| `dias_a_vencer` | `7` | janela do aviso de vencimento |
| `atraso_min` / `atraso_max` | `1` / `180` | faixa de atraso que é cobrança (acima é jurídico) |
| `valor_min` | `50` | abaixo disso não vale um toque |
| `instancia` | `Nina` | quem assina |
| `forcar_instancia` | `true` | empresta o contato para a Nina antes de enviar |
| `canais` | `{whatsapp,email}` | desligue um canal tirando-o daqui |
| `reenvio_min_dias` | `5` | não repete o mesmo grupo antes disso |
| `cap_grupos_run` | `40` | teto de grupos por rodada |
| `empresas` | `{1,2,14}` | empresas do Sankhya |
| `tipos_titulo` | `{4,55}` | CODTIPTIT que é boleto. Fora daqui não se cobra |
| `boleto_nao_geravel` | Grafeno + Safra | contas/janelas cujo boleto saiu direto no banco |
| `assinatura` | Nina — Financeiro Nitron | quem assina + rodapé de identificação |
| `remetente` | `Nina` | primeiro nome usado no corpo ("me avise e eu providencio") |

---

## Decisões que valem explicar

**Um card por grupo, não por CNPJ.** Rede com três lojas vencidas recebe uma mensagem com
o detalhe por loja. Três cobranças no mesmo dia é como o cliente para de levar o remetente
a sério.

**O texto é escrito em código, não por IA.** A mensagem carrega valor, vencimento e número
de NF. Um dígito trocado manda o cliente pagar o que não deve, e a conversa vira uma
discussão sobre o número em vez do pagamento.

**O e-mail leva anexo *e* link.** Anexo de PDF é a primeira coisa que filtro de spam
corporativo remove. Com o link, a cobrança continua de pé mesmo se o anexo não passar.

**RLS ligada e sem policy nas quatro tabelas novas.** O `service_role` das Edge Functions
ignora RLS, então o motor funciona; o anon key não lê nada. Estas tabelas carregam nome de
cliente, valor devido e link de boleto — o padrão de RLS desligada de outras tabelas deste
projeto não deveria ser estendido a dado de inadimplência.

**O nome do arquivo do boleto tem token aleatório.** O bucket é público porque o GHL
precisa baixar sem credencial. Com o NUFIN no nome, qualquer um varreria a carteira
contando de 1 em 1.

---

## Arquivos

```
sql/001_cobranca_schema.sql              as quatro tabelas
sql/002_cobranca_ajustes.sql             bucket dos boletos e a coluna `envios`
sql/003_cron.sql                         a cadência no pg_cron
sql/004_tipo_titulo.sql                  só título que é boleto
sql/005_boleto_geravel.sql               quais não podem ganhar boleto novo
sql/006_assinatura.sql                   a assinatura das mensagens
sql/006b_empresa_nome.sql                "Nitron" no corpo e no assunto
sql/007_nina_financeiro_atendentes.sql   a Nina certa, e Karla/Bianca
sql/008_conversa.sql                     cobranca_conversa e a cadência
sql/009_origem_do_titulo.sql             de onde vem o boleto (e o que o ERP não tem)
sql/010_cron_conversa.sql                os jobs do atendimento e da cadência
supabase/functions/
  cobranca-titulos-refresh/index.ts      Sankhya → cobranca_titulo + cobranca_contato
  cobranca-boleto/index.ts               orquestra a renderização e o upload
  cobranca-boleto/boleto_pdf.ts          o gerador de PDF, sem dependência
  cobranca-montar/index.ts               monta os cards e escreve as mensagens
  cobranca-aprovar/index.ts              dispara (WhatsApp na fila, e-mail direto)
  cobranca-atende/index.ts               a Nina lê e responde, dentro do envelope
  cobranca-seguir/index.ts               a cadência de cinco toques, e o repasse
  cobranca-painel/index.ts               a tela de aprovação
  cobranca-cron/index.ts                 a cadência
docs/ARQUITETURA.md                      o detalhe técnico
docs/FUNCOES-DE-PRODUCAO.md              por que NÃO alteramos as funções existentes
testes/                                  os testes e como rodá-los
```
