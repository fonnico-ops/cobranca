-- 001_cobranca_schema.sql — motor de cobranca automatizada (Nitron / projeto cobranca)
--
-- Quatro tabelas. A separacao nao e estetica: cada uma tem um tempo de vida diferente.
--   cobranca_titulo   — espelho do TGFFIN. Reescrito inteiro a cada refresh.
--   cobranca_contato  — para quem mandar, com a ORIGEM do dado. Reescrito a cada refresh.
--   cobranca_fila     — a fila de aprovacao. E o historico: nunca e apagada, e por ela
--                       que se sabe quando um cliente foi cobrado da ultima vez.
--   cobranca_config   — os parametros. Uma linha. Mudar comportamento e UPDATE, nao deploy.
--
-- RLS LIGADA E SEM POLICY em todas, de proposito. O service_role (que as edge functions
-- usam) ignora RLS, entao o motor segue funcionando; o anon key nao le nada. As tabelas
-- carregam nome de cliente, valor devido e link de boleto — o padrao de 113 tabelas com
-- RLS desligada neste projeto nao deve ser estendido para dado de inadimplencia.

-- ---------------------------------------------------------------------------
-- cobranca_titulo — 1 linha por titulo aberto dentro da janela de interesse
-- ---------------------------------------------------------------------------
create table if not exists public.cobranca_titulo (
  nufin            bigint primary key,
  codparc          integer not null,
  matriz           integer,
  codemp           integer,
  numnota          integer,
  dtvenc           date    not null,
  dias_atraso      integer not null,          -- negativo = ainda vai vencer
  valor            numeric not null,
  fase             text    not null,          -- 'vencido' | 'a_vencer'
  -- dados do boleto. Ausentes em ~63% dos vencidos: o titulo existe, o boleto nunca
  -- foi gerado no ERP. Quem nao tem linha digitavel nao ganha PDF (ver docs/ARQUITETURA.md).
  nossonum         text,
  codbco           integer,
  banco            text,
  carteira         text,
  agencia          text,
  conta            text,
  linha_digitavel  text,
  codigo_barras    text,
  pix              text,
  cedente          text,
  cedente_cnpj     text,
  sacado           text,
  sacado_cnpj      text,
  -- PDF renderizado e hospedado. Fica gravado para nao re-renderizar a cada rodada.
  boleto_url       text,
  boleto_em        timestamptz,
  atualizado       timestamptz not null default now(),
  constraint cobranca_titulo_fase_ck check (fase in ('vencido','a_vencer'))
);
create index if not exists cobranca_titulo_parc_ix  on public.cobranca_titulo (codparc);
create index if not exists cobranca_titulo_grupo_ix on public.cobranca_titulo (coalesce(matriz, codparc));
create index if not exists cobranca_titulo_fase_ix  on public.cobranca_titulo (fase, dtvenc);
alter table public.cobranca_titulo enable row level security;

-- ---------------------------------------------------------------------------
-- cobranca_contato — para quem mandar, e de onde o dado veio
-- ---------------------------------------------------------------------------
-- `prioridade` implementa literalmente o pedido: "enviar nos contatos de cobranca do
-- Sankhya, caso nao tenha mandar no que tem". Menor numero ganha.
--   10 contato do Sankhya marcado RESPCOBRANCA='S' ou RECEBEBOLETOEMAIL='S'
--   20 contato do Sankhya com AD_DPTOCONTATO = Financeiro
--   30 outro contato ativo do Sankhya (Compras, Fiscal, ...)
--   40 o cadastro do parceiro (TGFPAR.EMAIL / TELEFONE / AD_TELEFONE)
--   50 o CRM (ghl_contato), ultimo recurso
create table if not exists public.cobranca_contato (
  codparc     integer not null,
  canal       text    not null,               -- 'whatsapp' | 'email'
  valor       text    not null,               -- fone em digitos, ou email minusculo
  nome        text,
  funcao      text,
  origem      text    not null,
  prioridade  integer not null,
  atualizado  timestamptz not null default now(),
  primary key (codparc, canal, valor),
  constraint cobranca_contato_canal_ck check (canal in ('whatsapp','email'))
);
create index if not exists cobranca_contato_ordem_ix on public.cobranca_contato (codparc, canal, prioridade);
alter table public.cobranca_contato enable row level security;

-- ---------------------------------------------------------------------------
-- cobranca_fila — fila de aprovacao E historico de cobranca
-- ---------------------------------------------------------------------------
-- 1 linha por (rodada, fase, grupo). O grupo e a matriz quando existe: cobrar a rede
-- tres vezes porque ela tem tres CNPJs vencidos e como o cliente perde a confianca no
-- remetente. A unique key garante idempotencia — rodar o montar duas vezes no mesmo dia
-- nao duplica cobranca.
create table if not exists public.cobranca_fila (
  id            bigserial primary key,
  rodada        date    not null,
  fase          text    not null,
  grupo         integer not null,             -- matriz, ou o proprio codparc
  nome          text,
  codparcs      jsonb   not null default '[]'::jsonb,
  nufins        jsonb   not null default '[]'::jsonb,
  n_titulos     integer not null default 0,
  valor         numeric not null default 0,
  maior_atraso  integer not null default 0,
  boletos       jsonb   not null default '[]'::jsonb,   -- [{nufin,url,dtvenc,valor}]
  sem_boleto    integer not null default 0,
  contatos      jsonb   not null default '[]'::jsonb,   -- [{canal,valor,nome,origem}]
  origem_contato text,                                  -- a melhor origem usada
  mensagem      text,                                   -- texto do WhatsApp
  assunto       text,
  corpo_email   text,
  status        text    not null default 'aguardando',
  motivo        text,
  aprovado_por  text,
  aprovado_em   timestamptz,
  fila_ids      jsonb,                                  -- ids gerados em fila_envio
  criado_em     timestamptz not null default now(),
  constraint cobranca_fila_fase_ck   check (fase in ('vencido','a_vencer')),
  constraint cobranca_fila_status_ck check (status in ('aguardando','aprovado','recusado','enfileirado','erro','sem_contato')),
  constraint cobranca_fila_unica     unique (rodada, fase, grupo)
);
create index if not exists cobranca_fila_status_ix on public.cobranca_fila (status, rodada desc);
create index if not exists cobranca_fila_grupo_ix  on public.cobranca_fila (grupo, rodada desc);
alter table public.cobranca_fila enable row level security;

-- ---------------------------------------------------------------------------
-- cobranca_config — parametros do motor
-- ---------------------------------------------------------------------------
create table if not exists public.cobranca_config (
  id                 integer primary key default 1,
  ativo              boolean not null default false,   -- chave geral do motor
  auto_aprovar       boolean not null default false,   -- true = dispensa o painel
  dias_a_vencer      integer not null default 7,
  atraso_min         integer not null default 1,       -- ignora vencido de ontem? (1 = cobra)
  atraso_max         integer not null default 180,     -- acima disso e juridico, nao cobranca
  valor_min          numeric not null default 50,      -- nao vale cobrar centavos
  instancia          text    not null default 'Nina',
  forcar_instancia   boolean not null default true,    -- cobranca sai pela Nina, nao pela rep
  canais             text[]  not null default '{whatsapp,email}',
  reenvio_min_dias   integer not null default 5,       -- nao repete o mesmo grupo antes disso
  cap_grupos_run     integer not null default 40,
  empresas           integer[] not null default '{1,2,14}',
  remetente          text    not null default 'Nina',
  remetente_cargo    text    not null default 'Atendimento Nitronplast',
  atualizado         timestamptz not null default now(),
  constraint cobranca_config_um_ck check (id = 1)
);
alter table public.cobranca_config enable row level security;

insert into public.cobranca_config (id) values (1) on conflict (id) do nothing;

comment on table public.cobranca_titulo  is 'Espelho do TGFFIN aberto (vencido + a vencer na janela), com os dados do boleto e o PDF hospedado. Reescrito a cada cobranca-refresh.';
comment on table public.cobranca_contato is 'Contato de cobranca resolvido por parceiro. prioridade menor = melhor: 10 RESPCOBRANCA/RECEBEBOLETOEMAIL, 20 dpto Financeiro, 30 outro contato Sankhya, 40 cadastro do parceiro, 50 CRM.';
comment on table public.cobranca_fila    is 'Fila de aprovacao e historico. 1 linha por rodada/fase/grupo (matriz). A unique key torna o montar idempotente no dia.';
comment on table public.cobranca_config  is 'Parametros do motor de cobranca. ativo=false trava tudo; auto_aprovar=false exige o painel.';
