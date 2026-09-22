-- 009_origem_do_titulo.sql — a Nina precisa saber DE ONDE vem o boleto.
--
-- A primeira pergunta de quem recebe uma cobranca nao e "quanto" — e "de que e isso?".
-- Ate aqui a unica resposta possivel era o numero da NF, e "NF 188412" nao diz nada a
-- quem esta do outro lado. Quem nao consegue responder isso perde a conversa: o cliente
-- para de discutir pagamento e passa a discutir se a divida existe.
--
-- O QUE O ERP TEM, DE VERDADE (medido em 22/09 sobre os 2.465 titulos da carteira de
-- cobranca — os que sao boleto, vencidos ate 180 dias ou a vencer em 15):
--
--   DESDOBRAMENTO (a parcela)        2.464  99,9%   -> "parcela 2 de 3"
--   NUMNOTA + TGFCAB                 1.656    67%   -> nota, serie, tipo de operacao, saida
--   AD_NUCONT (contrato do Clube)      397    16%   -> contrato, parcelas, mensalidade
--   sem nota E sem contrato            470    19%   -> ai nao ha origem para dar
--
-- E O QUE ELE NAO TEM — a parte que importa registrar, porque foi perguntado:
--
--   TGFCAB.AD_DTENTREGA          0 de 2.465
--   TGFCAB.AD_STATUSENTREGA      0 de 2.465
--   AD_TSIAGENENT (agendamento)  2 de 2.465
--   TGFCAB.DTPREVENT            51 de 2.465  (2%)
--
--   NAO EXISTE data de entrega nestes titulos. O que existe e a DATA DE SAIDA DA NOTA
--   (TGFCAB.DTENTSAI, 1.656 = todas as que tem nota), que e quando a mercadoria saiu
--   daqui — e outra coisa, e e assim que vai ser dita.
--   O `entrega_nota` do Supabase cobre 232 dos 1.058 titulos e so diz "Entregue", sem data.
--   Entao: quando ele disser "Entregue", a Nina pode confirmar que consta entregue; data
--   de entrega ela NAO tem, e perguntar isso vira repasse. Inventar uma data de entrega
--   numa cobranca e dar ao cliente o argumento para nao pagar.
alter table public.cobranca_titulo
  add column if not exists serie             text,      -- TGFFIN.SERIENOTA
  add column if not exists parcela           text,      -- TGFFIN.DESDOBRAMENTO ("1", "09", "A")
  add column if not exists parcelas_total    integer,   -- quantos desdobramentos a nota/contrato gerou
  add column if not exists dt_emissao        date,      -- TGFCAB.DTENTSAI: a SAIDA da nota, nao a entrega
  add column if not exists operacao          text,      -- TGFTOP.DESCROPER: "Venda ...", "Clube ..."
  add column if not exists contrato          integer,   -- TGFFIN.AD_NUCONT -> AD_CONTRATO
  add column if not exists contrato_parcelas integer,
  add column if not exists contrato_valor    numeric(14,2),
  add column if not exists contrato_inicio   date,
  add column if not exists entrega_status    text;      -- do entrega_nota, quando houver

comment on column public.cobranca_titulo.dt_emissao is
  'Data de saida da nota (TGFCAB.DTENTSAI). NAO e data de entrega: o ERP nao tem data de entrega para estes titulos.';
comment on column public.cobranca_titulo.entrega_status is
  'Status vindo de entrega_nota, quando a nota esta la (cobre ~22%). So diz "Entregue" ou nada.';
