-- 004_tipo_titulo.sql — cobranca so roda em titulo que E boleto.
--
-- Medido em 22/09 na janela de cobranca (ate 180d de atraso, >= R$ 50):
--   CODTIPTIT 4 (BOLETO) + 55 (BOLETO CLUBE NITRON) ..... 1.065 tit, R$ 2,89M, 88% com boleto
--   tudo o mais .......................................... 871 tit, R$ 5,54M,  3% com boleto
--
-- O "tudo o mais" nao e divida a cobrar por mensagem:
--   Deposito / Deposito Antecipado .... 367 tit, R$ 4,11M  o cliente e quem deposita
--   NEGOCIACAO COMERCIAL .............. 167 tit, R$ 102k   acordo em andamento
--   VENDA CLUBE NITRON ................ 144 tit, R$ 550k   o boleto do clube e o tipo 55
--   NF Cancelada/Devolvida ............ 108 tit, R$ 156k   a nota nao existe mais
--   COMPENSACAO DEBITO/CREDITO ........  13 tit, R$ 477k   ajuste contabil
--   PDD CLIENTES, DEBITO FUNCIONARIO, Cheque Devolvido, cartao, PIX, Debito c/c...
--
-- PROTESTADO (30) e Cartorio (38) SAO boleto, mas ja estao em via juridica.
alter table public.cobranca_config
  add column if not exists tipos_titulo integer[] not null default '{4,55}';

alter table public.cobranca_titulo add column if not exists codtiptit integer;
alter table public.cobranca_titulo add column if not exists tipo_titulo text;
