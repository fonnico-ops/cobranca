-- 013b — a fase 'futuro' precisa caber no CHECK
--
-- Escrito DEPOIS do 013 e por causa dele: o 013 ensinou o refresh a produzir 'futuro', mas
-- a coluna continuou aceitando so 'vencido' e 'a_vencer'. O insert foi recusado no meio do
-- lote e, como o refresh daquele momento apagava tudo antes de inserir, a carteira ficou
-- com 500 linhas de 1.884 ate a rodada seguinte. O 014b trocou a gravacao por upsert para
-- que um erro assim nao apague mais nada; este arquivo e a outra metade.

alter table public.cobranca_titulo drop constraint if exists cobranca_titulo_fase_ck;
alter table public.cobranca_titulo
  add constraint cobranca_titulo_fase_ck
  check (fase = any (array['vencido'::text, 'a_vencer'::text, 'futuro'::text]));
