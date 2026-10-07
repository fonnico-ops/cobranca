-- 017 — O LIVRO DE ENTREGAS: uma linha por mensagem, nao por card.
--
-- POR QUE ISTO EXISTE
--   Ate agora o painel respondia "o card saiu?" — e um card sao DUAS mensagens (WhatsApp e
--   e-mail), cada uma com destino, horario e destino final proprios. Quem cobra precisa da
--   pergunta no singular: "a mensagem para ESTE numero saiu? e o e-mail para ESTE endereco,
--   chegou?". Sem isso, um card marcado "enfileirado" podia esconder um WhatsApp preso na fila
--   e um e-mail que voltou — foi exatamente o que aconteceu em 25/09: 28 WhatsApp sairam, o
--   numero caiu as 13:56, e 24 ficaram parados sem nada na tela dizendo quais.
--
--   O estado do WhatsApp ja morava em fila_envio (uma linha por mensagem). O do e-mail nao
--   morava em lugar nenhum: o cobranca-aprovar manda direto pelo GHL e gravava apenas o
--   resultado do CLIQUE dentro de cobranca_fila.envios — sem id da mensagem, entao nao havia
--   como voltar e perguntar ao GHL se ela foi entregue ou se voltou. Este livro guarda esse id.
--
-- O QUE CADA ESTADO SIGNIFICA — e o que ele NAO afirma
--   na_fila    escrito na fila, ainda nao saiu (WhatsApp espacado, ou instancia pausada).
--   saiu       o CRM aceitou e despachou. NAO e confirmacao de entrega: para o WhatsApp,
--              ninguem nos devolve "chegou no aparelho" — o campanhas-enviar so consegue
--              provar o CONTRARIO (a linha do ZaptosWPP dizendo que a instancia caiu). Por
--              isso a tela diz "saiu", nunca "entregue", quando a fonte e o fila_envio.
--   entregue   so no e-mail, e so quando o GHL responde status 'delivered'.
--   aberto     so no e-mail: o GHL responde 'opened'. Nao vale para WhatsApp.
--   erro       nao saiu, e `detalhe` diz por que, na palavra de quem recusou.
--   Nada aqui e inferido por tempo. Mensagem sem confirmacao fica em 'saiu' para sempre, que e
--   a verdade: "despachamos e nao sabemos mais".
--
-- UMA LINHA POR (card, canal, destino): o mesmo card reaprovado reescreve a propria linha em
-- vez de criar uma segunda — senao a contagem de entregas do dia inflaria a cada reenvio.
create table if not exists cobranca_entrega (
  id              bigserial primary key,
  card_id         bigint not null references cobranca_fila(id) on delete cascade,
  rodada          date,
  fase            text,
  grupo           integer,
  nome            text,
  canal           text not null,
  destino         text not null,
  origem          text,
  -- WhatsApp: a linha do trilho compartilhado. E dela que vem o estado, sempre.
  fila_id         bigint,
  -- E-mail: os ids que o GHL devolve no POST. `ghl_email_id` e o que o endpoint de status
  -- aceita (/conversations/messages/email/{id}); `ghl_message_id` fica como reserva porque em
  -- parte das respostas so um dos dois vem preenchido.
  ghl_email_id    text,
  ghl_message_id  text,
  conversation_id text,
  estado          text not null default 'na_fila',
  detalhe         text,
  anexos          integer default 0,
  criado_em       timestamptz not null default now(),
  saiu_em         timestamptz,
  confirmado_em   timestamptz,
  checado_em      timestamptz,
  unique (card_id, canal, destino)
);

create index if not exists cobranca_entrega_rodada_idx on cobranca_entrega (rodada desc, canal, estado);
create index if not exists cobranca_entrega_criado_idx on cobranca_entrega (criado_em desc);
create index if not exists cobranca_entrega_fila_idx   on cobranca_entrega (fila_id) where fila_id is not null;
-- as que o cobranca-entregas ainda precisa perguntar ao GHL
create index if not exists cobranca_entrega_pendura_idx on cobranca_entrega (canal, estado, checado_em)
  where canal = 'email';

alter table cobranca_entrega enable row level security;   -- so a chave de servico entra, como em cobranca_fila

comment on table  cobranca_entrega is 'Uma linha por mensagem de cobranca (canal + destino). Estado: na_fila, saiu, entregue, aberto, erro.';
comment on column cobranca_entrega.estado is 'saiu = o CRM despachou; NAO e confirmacao de entrega. entregue/aberto so existem no e-mail, confirmados pelo GHL.';

/* ------------------------------------------------------------------ o que ja aconteceu
   Sem isto o livro nasceria vazio e a rodada de hoje — 59 cards aprovados as 13:31 — ficaria
   invisivel na tela nova. O passado e reconstruido de onde ele esta gravado: cada elemento de
   cobranca_fila.envios e uma mensagem, e o estado do WhatsApp vem do fila_envio.
   Sem id de e-mail: as linhas antigas de e-mail ficam em 'saiu' e nunca serao perguntadas ao
   GHL (nao ha id para perguntar). Inventar um seria pior do que a lacuna. */
insert into cobranca_entrega
  (card_id, rodada, fase, grupo, nome, canal, destino, origem, fila_id, estado, detalhe, anexos, criado_em, saiu_em)
select c.id, c.rodada, c.fase, c.grupo, c.nome,
       e->>'canal',
       e->>'destino',
       e->>'origem',
       nullif(e->>'fila_id','')::bigint,
       case
         when (e->>'ok')::boolean is not true then 'erro'
         when e->>'canal' = 'email' then 'saiu'
         when f.status = 'enviado' then 'saiu'
         when f.status = 'erro'    then 'erro'
         else 'na_fila'
       end,
       case
         when (e->>'ok')::boolean is not true then left(coalesce(e->>'motivo','sem motivo gravado'), 300)
         when f.status = 'erro' then left(coalesce(f.resultado, f.erro, 'erro sem texto'), 300)
         else null
       end,
       coalesce((e->>'anexos')::int, 0),
       coalesce((e->>'em')::timestamptz, c.aprovado_em, c.criado_em),
       case when e->>'canal' = 'email' and (e->>'ok')::boolean is true then (e->>'em')::timestamptz
            else f.enviado_em end
  from cobranca_fila c
       cross join lateral jsonb_array_elements(c.envios) e
       left join fila_envio f on f.id = nullif(e->>'fila_id','')::bigint
 where c.envios is not null
   and jsonb_typeof(c.envios) = 'array'
   and coalesce(e->>'destino','') <> ''
on conflict (card_id, canal, destino) do nothing;

-- de 10 em 10 minutos o livro confere o que mudou: a fila andou, ou o GHL ja sabe do e-mail.
-- Fora da janela comercial tambem: a fila do WhatsApp continua andando de noite.
select cron.schedule('cobranca-entregas-10min', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://bwbeieumxcuomtrvlqxs.supabase.co/functions/v1/cobranca-entregas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
    body := '{}'::jsonb) $$);
