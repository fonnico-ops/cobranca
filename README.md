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

---

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

## O boleto

O Sankhya **não guarda o PDF do boleto** em lugar nenhum — conferido em `TGFFIN`,
`AD_BOLHYAK` e `TGFHBA`: nenhuma URL, nenhum blob. Ele imprime na hora, por relatório.

O que o ERP tem é o que importa: `LINHADIGITAVEL` e `CODIGOBARRA` de 44 dígitos, já
calculados e registrados no banco. Então o `boleto_pdf.ts` desenha a ficha de compensação
a partir desses dois campos, sem dependência nenhuma e **sem calcular nenhum dígito** —
nem DV, nem fator de vencimento, nem campo livre. Se a linha digitável não existe, a
função se recusa a emitir.

**Cobertura real (22/09):**

| | títulos | com boleto no ERP | sem boleto |
|---|---|---|---|
| Vencidos | 2.741 | 1.014 (37%) | 1.727 |
| A vencer em 7 dias | 551 | 438 (79%) | 113 |

Os 63% de vencidos sem boleto **são cobrados assim mesmo**, com valor, NF e vencimento no
texto, e a mensagem oferece a 2ª via — foi a decisão tomada. A mensagem sempre diz o que
está anexo e sempre diz quando falta algo; ela nunca promete um boleto que não vai junto.

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
supabase/functions/
  cobranca-titulos-refresh/index.ts      Sankhya → cobranca_titulo + cobranca_contato
  cobranca-boleto/index.ts               orquestra a renderização e o upload
  cobranca-boleto/boleto_pdf.ts          o gerador de PDF, sem dependência
  cobranca-montar/index.ts               monta os cards e escreve as mensagens
  cobranca-aprovar/index.ts              dispara (WhatsApp na fila, e-mail direto)
  cobranca-painel/index.ts               a tela de aprovação
  cobranca-cron/index.ts                 a cadência
  _patches/README.md                     por que NÃO alteramos as funções de produção
docs/ARQUITETURA.md                      o detalhe técnico
```
