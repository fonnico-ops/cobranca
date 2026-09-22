-- 011_regua_e_assinatura.sql — a régua de cobrança, e o rodapé com os fixos.
--
-- 1. A RÉGUA (pedido da gestão em 22/09)
--
-- Do 3o toque em diante a mensagem endurece. O que endurece NAO e o tom: e a clareza
-- sobre o que vai acontecer e quando. A severidade vem dos DIAS DE ATRASO reais, nao do
-- numero do toque, e cada passo e anunciado com a data exata, calculada do vencimento.
--
-- TRES REGRAS QUE MANTEM O AVISO VALENDO:
--   a) So entra aqui o que a empresa FAZ. Anunciar um passo e nao executa-lo ensina a
--      carteira inteira a ignorar o aviso — e ai nenhuma mensagem funciona mais.
--   b) A mensagem anuncia o que VAI acontecer. Nunca afirma que um passo ja foi executado:
--      o motor nao negativa, nao protesta e nao notifica ninguem; quem faz e o financeiro.
--   c) So em titulo VENCIDO. Falar de cartorio num aviso de vencimento futuro destroi a
--      relacao com um cliente que ainda nao deve nada.
--
-- Para voltar ao tom cordial sem deploy: update cobranca_config set protesto_aviso = false.
alter table public.cobranca_config
  add column if not exists protesto_aviso boolean not null default true,
  add column if not exists regua_cobranca jsonb not null default '[]'::jsonb;

update public.cobranca_config set regua_cobranca = '[
  {"dias": 10, "passo": "negativação nos órgãos de proteção ao crédito"},
  {"dias": 15, "passo": "protesto em cartório"},
  {"dias": 25, "passo": "notificação extrajudicial"}
]'::jsonb where id = 1;

-- 2. O RODAPÉ COM OS FIXOS
--
-- Quem quer LIGAR precisava adivinhar qual dos numeros era celular. Agora os fixos vem
-- primeiro, o celular vai rotulado como WhatsApp, e o e-mail ganhou linha propria — tres
-- contatos amontoados numa linha so nao se leem no celular.
update public.cobranca_config set assinatura = jsonb_build_object(
  'linha',        'Nina — Financeiro Nitron',
  'razao_social', 'NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA',
  'cnpj',         '54.886.460/0001-98',
  'telefones',    jsonb_build_array('(11) 2413-2244', '(11) 2413-2246'),
  'telefone',     '(11) 96456-0761',
  'email',        'cobranca@nitron.com.br'
) where id = 1;

-- 3. AS EMPRESAS
-- A cobranca passa a cobrir 1, 2, 4 e 14 (a 4 entrou em 22/09: +236 titulos).
update public.cobranca_config set empresas = '{1,2,4,14}' where id = 1;

-- Sobre "nao cobrar cliente deposito": nada a fazer. "Deposito" no ERP e TIPO DE TITULO
-- (15 «Depósito» e 29 «DEPOSITO ANTECIPADO»), nao classificacao de cliente, e o filtro
-- cobranca_config.tipos_titulo = {4,55} ja os deixa de fora. Um cliente que tem boleto E
-- deposito continua sendo cobrado pelos boletos dele, que e o correto. Confirmado com a
-- gestao em 22/09.
