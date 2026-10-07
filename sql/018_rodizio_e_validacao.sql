-- 018 — O RODIZIO KARLA/BIANCA, O RITMO PROPRIO DA COBRANCA E A PORTA NO NUMERO DE DESTINO
--
-- POR QUE
--   1. Um numero so levou a cobranca duas vezes ao chao: "Campanhas Nitron" foi RESTRINGIDA
--      pelo WhatsApp em 27/08, e "Nina Financeiro" caiu em 25/09 e ficou 12 dias fora — nesses
--      12 dias a fila acumulou 145 mensagens que nunca sairam. Com dois numeros alternando, a
--      queda de um nao para a cobranca, e cada numero manda metade do volume.
--   2. O ritmo pedido pelo gestor em 07/10: "enviar cada mensagem no intervalo de 2 minutos de
--      cada numero". O `fila_config` NAO serve para isso — ele e compartilhado com todas as
--      campanhas (representantes, reativacao, comunicado), e 2 minutos por mensagem ali
--      atrasaria todas elas. Entao a cobranca ganha ritmo proprio: a mensagem nasce RETIDA
--      ('segurado', que o fila-processar ignora) e o `cobranca-liberar` solta uma por numero a
--      cada 2 minutos. Efeito colateral de graca: fila retida nao explode na volta de uma
--      queda, que era o medo do gestor desde o audio de 24/09.
--   3. Numero de destino errado e o que faz a Meta restringir um numero: mandar para quem nao
--      tem WhatsApp conta como spam. O projeto ja tinha o validador (ator Apify
--      `devscrapper~whatsapp-number-validator`, campo `exists`, usado pelo motor-validar) — o
--      que faltava era a cobranca consultar isso ANTES de enfileirar. Agora o veredito mora em
--      `cobranca_fone` e vale por 60 dias.
--
-- O QUE NAO MUDA: o numero de saida continua sendo o do DONO do contato no CRM (provado em
-- 26/08: o GHL ignora `fromNumber`). Entao "alternar numero" e, na pratica, alternar para qual
-- usuaria o contato e emprestado na hora do envio — Karla ou Bianca, uma por vez.

/* ---------------------------------------------------------------- as duas instancias */
-- escopo 'cobranca' e o mesmo da Nina Financeiro: e o que separa quem cobra de quem atende rep.
insert into instancia_ghl (instancia, usuario_ghl, usuario_ghl_id, escopo, ativa, empresa, observacao)
values
  ('Karla',  'Karla Lins',         'FgI7CSoSbbPwWYhX7kem', 'cobranca', true, 'nitron',
   'Cobranca, rodizio com a Bianca. WhatsApp Business no fixo 11 2413-2256. Quem recebe a resposta e ela mesma — e ela tem alcada para prazo e desconto, a Nina nao.'),
  ('Bianca', 'Bianca Cavalcante',  'prFUPJJkIIvN6OwykAKU', 'cobranca', true, 'nitron',
   'Cobranca, rodizio com a Karla. WhatsApp Business no fixo 11 2413-2244.')
on conflict (instancia) do update
  set usuario_ghl_id = excluded.usuario_ghl_id,
      escopo = excluded.escopo, ativa = true, empresa = excluded.empresa,
      observacao = excluded.observacao;

-- o cadastro que o trilho compartilhado usa para saber o numero de cada instancia
insert into assistente_instancia (nome, instancia, fone, ativo)
values ('Karla', 'Karla', '551124132256', true),
       ('Bianca', 'Bianca', '551124132244', true)
on conflict (nome) do update set instancia = excluded.instancia, fone = excluded.fone, ativo = true;

/* ------------------------------------------------------- o rodizio e o ritmo da cobranca */
-- `instancias` manda; `instancia` (singular) fica como reserva para quem nao tem rodizio.
alter table cobranca_config add column if not exists instancias text[];
-- segundos entre duas mensagens DO MESMO numero. 120 = o pedido de 07/10.
alter table cobranca_config add column if not exists wpp_intervalo_seg int default 120;
-- fora desta janela (hora de Sao Paulo) nada e liberado: cobranca as 3h da manha e o tipo de
-- mensagem que faz o cliente bloquear o numero, e numero bloqueado e o que queremos evitar.
alter table cobranca_config add column if not exists janela_hora_de int default 8;
alter table cobranca_config add column if not exists janela_hora_ate int default 20;

update cobranca_config
   set instancias = array['Karla','Bianca'],
       wpp_intervalo_seg = coalesce(wpp_intervalo_seg, 120)
 where id = 1;

comment on column cobranca_config.instancias is
  'Rodizio de numeros da cobranca, em ordem. Cada card sai por uma; a pausada e pulada.';
comment on column cobranca_config.wpp_intervalo_seg is
  'Segundos entre duas mensagens do MESMO numero (nao e o fila_config, que e compartilhado).';

/* ------------------------------------------------- o livro do que o liberador ja soltou */
-- E daqui que sai o "faz 2 minutos?". Nao serve olhar `fila_envio.enviado_em`: entre soltar e
-- sair ha ate um minuto (o cron do trilho), e nesse intervalo o liberador soltaria outra.
create table if not exists cobranca_liberacao (
  id          bigserial primary key,
  instancia   text not null,
  fila_id     bigint,
  liberado_em timestamptz not null default now()
);
create index if not exists cobranca_liberacao_inst_idx on cobranca_liberacao (instancia, liberado_em desc);
alter table cobranca_liberacao enable row level security;

/* --------------------------------------------- o veredito por numero, para nao reconsultar */
-- `existe` e a palavra do ator Apify (campo `exists`). `estado`:
--   VALIDO    tem WhatsApp — pode enfileirar
--   INVALIDO  nao tem — a cobranca vai so por e-mail, e o numero NAO e tentado
--   FIXO      telefone fixo (10 digitos ou 3o digito != 9): nunca tem WhatsApp de verdade
--   LIXO      cadastro furado (digito repetido, tamanho errado, DDD inexistente)
--   ARRISCADO o ator nao soube responder — nao condena, mas fica registrado
create table if not exists cobranca_fone (
  fone       text primary key,
  estado     text not null,
  existe     boolean,
  motivo     text,
  run_id     text,
  checado_em timestamptz not null default now()
);
create index if not exists cobranca_fone_estado_idx on cobranca_fone (estado, checado_em desc);
alter table cobranca_fone enable row level security;
comment on table cobranca_fone is
  'Veredito por numero (ator Apify whatsapp-number-validator + regra de forma). Vale 60 dias.';

/* ------------------------------------------------------------------------------- crons */
-- o liberador roda a cada minuto: ele mesmo decide se ja deu a hora de cada numero
select cron.schedule('cobranca-liberar-1min', '* * * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-liberar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{}'::jsonb) $$);

-- a validacao roda de 5 em 5 minutos: ela comeca a corrida no Apify numa passada e le o
-- resultado na seguinte (o mesmo desenho do motor-validar — corrida de ator nao cabe no tempo
-- de uma Edge Function).
select cron.schedule('cobranca-fones-5min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-fones',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{}'::jsonb) $$);
