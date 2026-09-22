-- 010_cron_conversa.sql — agenda o atendimento e a cadencia.
--
-- Os dois jobs entram JA ATIVOS, e isso e de proposito: o que decide se sai mensagem nao e
-- o cron, e a config (cobranca_config.ativo para o toque, atende_ativo para a resposta).
-- Enquanto elas estiverem false, os jobs rodam e as funcoes respondem 409 sem tocar em
-- nada. Job criado depois, "na hora de ligar", e job que alguem esquece de criar — e a
-- cadencia inteira fica parada sem ninguem notar, que e o pior dos dois erros.
--
-- FUSO: o cron do Postgres roda em UTC. Sao Paulo e UTC-3, entao 12-20 UTC = 9h-17h59 em SP,
-- e nessa faixa o dia da semana e o mesmo nos dois fusos (nao cruza meia-noite).

-- A resposta ao cliente: de 10 em 10 minutos no horario comercial.
-- Nao e por minuto porque cada rodada le conversas do GHL e chama o modelo; e nao e de hora
-- em hora porque quem escreveu "manda o boleto" e espera 50 minutos desiste e liga.
select cron.schedule(
  'cobranca-atende-10min',
  '*/10 12-20 * * 1-5',
  $$ select net.http_post(
       url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-atende',
       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('cobranca.anon_key', true)),
       body := '{}'::jsonb,
       timeout_milliseconds := 170000) $$
);

-- A cadencia: duas passadas por dia. A funcao mesma confere se esta na janela e quais
-- conversas tem toque vencido, entao rodar duas vezes nao gera dois toques.
select cron.schedule(
  'cobranca-seguir-2x-dia',
  '13 13,17 * * 1-5',
  $$ select net.http_post(
       url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-seguir',
       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('cobranca.anon_key', true)),
       body := '{}'::jsonb,
       timeout_milliseconds := 170000) $$
);

-- NOTA: no banco de producao a chave vai literal no comando do job, como nos jobs que ja
-- existiam (cobranca-hora, cobranca-boletos-lote). O `current_setting` acima e so para este
-- arquivo nao carregar a chave no git.
