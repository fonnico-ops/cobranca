-- 003_cron.sql — a cadencia.
--
-- O calendario mora no cobranca-cron, nao aqui: o pg_cron roda em UTC, e "sexta de manha"
-- em UTC e quinta a noite no Brasil. A funcao le o fuso America/Sao_Paulo e decide se e a
-- hora; este job so a chama de hora em hora.
--
-- Trocar <ANON_KEY> pela chave anon do projeto antes de rodar.

select cron.schedule('cobranca-hora', '7 * * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-cron',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{}'::jsonb, timeout_milliseconds := 170000) $$);

-- Os boletos sao desenhados de madrugada, em lotes, para a rodada das 9h achar o PDF pronto
-- em vez de renderizar mil na hora.
select cron.schedule('cobranca-boletos-lote', '*/20 3-8 * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-boleto',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{"limite":200}'::jsonb, timeout_milliseconds := 170000) $$);
