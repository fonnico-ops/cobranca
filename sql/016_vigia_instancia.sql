-- 016 — o vigia do numero de WhatsApp da cobranca.
--
-- Em 24/09 as 18:24 a instancia "Nina Financeiro" caiu. O trilho compartilhado pausou a
-- instancia e o cobranca-aprovar passou a recusar lote — ou seja, o sistema se protegeu
-- sozinho e NINGUEM soube. O numero passou 14 horas fora, e a cobranca do dia nao saiu: sem
-- erro na tela, sem aviso. Este arquivo cria o que faltava — o aviso.
--
-- alerta_fone           para quem mandar (so digitos). Vazio = ninguem e avisado.
-- alerta_instancia      por qual instancia mandar. Vazio = o vigia escolhe uma viva (a que
--                       caiu nunca manda: seria pedir ao aparelho quebrado que avise que quebrou).
-- alerta_lembrete_horas de quanto em quanto tempo lembrar enquanto continuar caida (so 8h-20h).
-- vigia_estado          o que o vigia viu da ultima vez; e o que permite avisar na MUDANCA e
--                       nao a cada 10 minutos.
alter table cobranca_config add column if not exists alerta_fone text;
alter table cobranca_config add column if not exists alerta_instancia text;
alter table cobranca_config add column if not exists alerta_lembrete_horas int default 3;
alter table cobranca_config add column if not exists vigia_estado jsonb;

-- o numero de alerta ja existia no trilho compartilhado; comeca igual para nao inventar outro
update cobranca_config
   set alerta_fone = coalesce(alerta_fone, (select alerta_fone from fila_config where id = 1))
 where id = 1;

comment on column cobranca_config.alerta_fone is
  'Numero (so digitos) que recebe aviso quando o WhatsApp da cobranca cai ou volta.';

-- de 10 em 10 minutos, o dia inteiro: a queda nao escolhe horario. Quem escolhe horario e o
-- LEMBRETE (8h-20h), dentro da propria funcao.
select cron.schedule('cobranca-vigia-10min', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-vigia',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{}'::jsonb) $$);
