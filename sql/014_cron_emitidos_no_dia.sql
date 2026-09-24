-- 014 — a entrega do boleto sai NO DIA, e nao no dia seguinte
--
-- O cobranca-emitidos roda as 21h UTC (18h de SP). Mas o espelho do ERP so era atualizado as
-- 5h40 UTC (2h40 da manha) — entao um boleto impresso as 14h de hoje so aparecia no espelho
-- as 2h40 de amanha, e so saia as 18h de amanha. Vinte e oito horas depois de nascer, numa
-- rotina cujo nome inteiro e "o boleto chega quando ele nasce".
--
-- Tres passos, vinte minutos entre eles, so em dia util (o emitidos ja era 1-5):
--   20h10 UTC  espelha o ERP        -> traz o que foi impresso hoje
--   20h30 UTC  gera os PDFs         -> so dos que entraram agora
--   21h00 UTC  entrega              -> ja existia
--
-- Vinte minutos e folga, nao estimativa: o refresh leva ~40s com 1.900 titulos e a geracao
-- de PDF faz ~300 por chamada em ~60s. Se um atrasar, o proximo passo simplesmente acha
-- menos coisa e o dia seguinte completa — nada duplica, porque o `boleto_entregue` e por
-- NUFIN e o boleto so se gera quando `boleto_url` esta nulo.

select cron.schedule('cobranca-emitidos-espelho', '10 20 * * 1-5', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-refresh',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YmVpZXVteGN1b210cnZscXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzU2NjEsImV4cCI6MjEwMTYxMTY2MX0.r7zk6EdIxpDYkzjKNCUlzvipVFi-CZPYfoMZXXA9q0g'),
    body := '{}'::jsonb, timeout_milliseconds := 180000);
$$);

select cron.schedule('cobranca-emitidos-boletos', '30 20 * * 1-5', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-boleto',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YmVpZXVteGN1b210cnZscXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzU2NjEsImV4cCI6MjEwMTYxMTY2MX0.r7zk6EdIxpDYkzjKNCUlzvipVFi-CZPYfoMZXXA9q0g'),
    body := '{"limite":300}'::jsonb, timeout_milliseconds := 200000);
$$);
