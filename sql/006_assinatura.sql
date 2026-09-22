-- 006_assinatura.sql — a assinatura das mensagens vira dado.
--
-- Era so "Nina — Nitronplast" no fonte. Serve no WhatsApp, mas num e-mail de cobranca e
-- fraco: sem razao social e CNPJ, um e-mail pedindo pagamento tem cara de golpe — justo
-- quando o cliente vai pagar. A decisao da gestao foi usar o MESMO rodape nos dois canais.
--
-- CAMPO VAZIO NAO E IMPRESSO. Nunca deixar placeholder aqui ("(xx) xxxx-xxxx"): ele chegaria
-- ao cliente, e isso e pior do que rodape nenhum.
alter table public.cobranca_config
  add column if not exists assinatura jsonb not null default
  '{"linha":"Nina — Financeiro Nitron",
    "razao_social":"NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA",
    "cnpj":"54.886.460/0001-98",
    "telefone":"",
    "email":""}'::jsonb;

-- valores de producao
update public.cobranca_config set assinatura = jsonb_build_object(
  'linha',        'Nina — Financeiro Nitron',
  'razao_social', 'NITRONPLAST INDÚSTRIA E COMÉRCIO LTDA',
  'cnpj',         '54.886.460/0001-98',
  'telefone',     '(11) 96456-0761',
  'email',        'cobranca@nitron.com.br'
) where id = 1;
