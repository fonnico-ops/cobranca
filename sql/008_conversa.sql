-- 008_conversa.sql — a Nina Financeiro deixa de ser um disparador e vira atendimento.
--
-- Ate aqui o motor mandava a cobranca e virava as costas: se o cliente respondesse
-- "manda a 2a via" ou "pago na sexta", ninguem lia. A conversa existia no CRM e morria la.
--
-- O QUE MUDA
--   cobranca-atende  le o que o cliente respondeu e responde, DENTRO de um envelope estreito.
--   cobranca-seguir  insiste enquanto ninguem responde, e no fim passa para uma atendente.
--
-- OS TRES LIMITES QUE A GESTAO FIXOU (e que estao codificados, nao so escritos):
--   1. SO O OPERACIONAL. A Nina manda 2a via, confirma valor e vencimento, recebe
--      comprovante e anota promessa de pagamento. Prazo, parcelamento e desconto NAO sao
--      dela: viram repasse. Combinar desconto por WhatsApp e dinheiro que nao volta.
--   2. CINCO TOQUES. Depois do quinto sem resposta, a divida deixa de ser de robo.
--   3. ELA RESPONDE, E SO REPASSA SE TRAVAR. Pedir ajuda a cada frase seria pior do que
--      nao atender.
--
-- O LIMITE QUE NAO FOI PEDIDO, MAS E O QUE IMPORTA:
--   A Nina so fala em conversa que O MOTOR ABRIU (linha nesta tabela) e so sobre a divida
--   daquele grupo. Um atendimento que varre "todas as conversas nao lidas" da location
--   responderia lead de marketing, cliente reclamando de entrega e representante — pela
--   caixa da cobranca. E esta location tem todas as tres coisas.

create table if not exists public.cobranca_conversa (
  contact_id      text primary key,                 -- o contato no GHL, que e onde a conversa vive
  conversation_id text,
  grupo           integer not null,                 -- codparc da matriz: a divida de que se fala
  nome            text,
  canal           text not null default 'whatsapp', -- whatsapp | email
  destino         text,                             -- fone ou e-mail, como saiu
  fase            text,                             -- vencido | a_vencer, da rodada que abriu

  -- 'ativa'     o robo toca e responde
  -- 'promessa'  o cliente marcou data; o robo cala ate o dia seguinte a ela
  -- 'repassada' uma pessoa assumiu — o robo NAO fala mais, em hipotese nenhuma
  -- 'encerrada' pagou, ou pediu para parar (ver nao_perturbe)
  status          text not null default 'ativa',

  toques            integer not null default 0,     -- toques ja dados, contando o primeiro
  ultimo_toque_em   timestamptz,
  proximo_toque_em  timestamptz,

  respondeu         boolean not null default false,
  ultimo_inbound_id text,                           -- de-duplicacao: nao responder duas vezes a mesma
  ultimo_inbound_em timestamptz,

  promessa_data   date,
  promessa_valor  numeric(14,2),

  -- Pediu para parar. Isto NAO e o mesmo que 'encerrada' por pagamento: o cobranca-montar
  -- pula este grupo nas proximas rodadas. Cobrar de novo quem pediu para parar e o caminho
  -- mais curto para o numero ser denunciado — e perder o canal inteiro, nao so este cliente.
  nao_perturbe    boolean not null default false,

  repassada_para    text,                           -- usuario_ghl_id da atendente
  repassada_nome    text,
  repassada_em      timestamptz,
  repassada_motivo  text,

  -- o que foi dito, dos dois lados: [{em, dir:'in'|'out', texto, meta}]
  -- Guardado aqui, e nao so no CRM, porque e com isto que a IA e o proximo toque se orientam
  -- — e porque quando uma resposta sair errada e daqui que se descobre o que ela leu.
  historico       jsonb not null default '[]'::jsonb,

  criado_em       timestamptz not null default now(),
  atualizado      timestamptz not null default now()
);
alter table public.cobranca_conversa enable row level security;   -- sem policy: so service_role

create index if not exists cobranca_conversa_toque_ix on public.cobranca_conversa (proximo_toque_em) where status in ('ativa','promessa');
create index if not exists cobranca_conversa_grupo_ix on public.cobranca_conversa (grupo);

-- ---------------------------------------------------------------------------
-- Parametros da cadencia e do atendimento.
-- ---------------------------------------------------------------------------
alter table public.cobranca_config
  -- Desligado por padrao, e SEPARADO de `ativo`. Ligar o disparo e ligar o robo que conversa
  -- sao duas decisoes de risco diferente, e nao se deve poder tomar as duas sem querer.
  add column if not exists atende_ativo boolean not null default false,
  add column if not exists toques_max integer not null default 5,
  -- espera (em dias corridos) DEPOIS de cada toque. O ultimo e a espera antes do repasse.
  -- Cai sempre em dia util: cobranca que chega sabado nao e lida e queima um toque.
  add column if not exists toques_espera integer[] not null default '{2,3,4,7,7}',
  add column if not exists ia_modelo text not null default 'claude-sonnet-5';

-- ---------------------------------------------------------------------------
-- Onde a Nina para e uma pessoa comeca.
--
-- `cobranca_atendente` (007) ja tem Karla e Bianca. Aqui so entra o contador do rodizio,
-- que e por peso e com memoria: sem o `recebidos`, sortear a cada repasse concentra numa
-- so em qualquer amostra pequena — e um repasse por dia e amostra pequena.
-- ---------------------------------------------------------------------------
alter table public.cobranca_atendente
  add column if not exists ultimo_recebido_em timestamptz;
