-- 006b_empresa_nome.sql — a marca usada no CORPO da mensagem e no assunto do e-mail.
--
-- O texto dizia "aqui na Nitronplast" enquanto a assinatura dizia "Nitron": duas marcas na
-- mesma mensagem. A gestao pediu "Nitron". Nao confundir com assinatura.razao_social, que e
-- o nome juridico do rodape e nao muda por gosto.
alter table public.cobranca_config
  add column if not exists empresa_nome text not null default 'Nitron';
