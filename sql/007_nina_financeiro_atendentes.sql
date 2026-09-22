-- 007_nina_financeiro_atendentes.sql
--
-- CORRECAO: a cobranca estava apontada para a Nina ERRADA.
--
-- O CRM tem duas Ninas, e ate aqui cobranca_config.instancia='Nina' resolvia para a de
-- marketing:
--   Nina Nitron     zEMc7K35JO8eUGghqHMN  marketing@nitron.com.br  escopo lead
--   Nina Financeiro uXX2Hl2LLRZ1D7Io1T9J  cobranca@nitron.com.br   (nao estava cadastrada)
--
-- A assinatura ja dizia cobranca@nitron.com.br e (11) 96456-0761, mas o envio sairia pela
-- conta de marketing: numero errado no WhatsApp e a resposta do cliente caindo na caixa de
-- marketing em vez da de cobranca. Pego antes de o motor ser ligado.
--
-- ATENCAO: `instancia` tem de bater com o TOKEN DA INSTANCIA NO ZAPTOS, nao com o nome do
-- usuario do CRM. O campanhas-enviar confere contra este cadastro e recusa o envio se
-- divergir — o que e a falha segura, mas trava tudo. Conferir no Zaptos antes de ligar.
insert into public.instancia_ghl (instancia, usuario_ghl, usuario_ghl_id, escopo, ativa, empresa, observacao)
values ('Nina Financeiro', 'Nina Financeiro', 'uXX2Hl2LLRZ1D7Io1T9J', 'cobranca', true, 'nitron',
        'Usuaria de cobranca no CRM (cobranca@nitron.com.br). Numero 5511964560761.')
on conflict (instancia) do update
  set usuario_ghl = excluded.usuario_ghl, usuario_ghl_id = excluded.usuario_ghl_id,
      escopo = excluded.escopo, ativa = true, empresa = excluded.empresa;

insert into public.assistente_instancia (nome, instancia, fone, ativo)
values ('Nina Financeiro', 'Nina Financeiro', '5511964560761', true)
on conflict do nothing;

update public.cobranca_config set instancia = 'Nina Financeiro' where id = 1;

-- ---------------------------------------------------------------------------
-- Para quem a Nina passa a conversa quando nao sabe responder.
-- ---------------------------------------------------------------------------
create table if not exists public.cobranca_atendente (
  usuario_ghl_id text primary key,
  nome           text not null,
  email          text,
  peso           integer not null default 1,
  ativo          boolean not null default true,
  recebidos      integer not null default 0,
  criado_em      timestamptz not null default now()
);
alter table public.cobranca_atendente enable row level security;

insert into public.cobranca_atendente (usuario_ghl_id, nome, email, peso) values
  ('FgI7CSoSbbPwWYhX7kem', 'Karla Lins',        'karla.lins@nitron.com.br',        1),
  ('prFUPJJkIIvN6OwykAKU', 'Bianca Cavalcante', 'bianca.cavalcante@nitron.com.br', 1)
on conflict (usuario_ghl_id) do update set nome = excluded.nome, email = excluded.email, ativo = true;
