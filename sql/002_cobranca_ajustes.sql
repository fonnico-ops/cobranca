-- 002_cobranca_ajustes.sql — aplicado logo depois do 001.

-- Revertido: as duas colunas nasceram para um patch no campanhas-enviar/fila-processar
-- que acabou NAO sendo feito (ver docs/FUNCOES-DE-PRODUCAO.md). O WhatsApp usa o campo
-- `imagens`, que o fila-processar ja repassa como `attachments`; o e-mail sai pelo
-- cobranca-aprovar. Coluna que nada le e mentira no schema.
alter table public.fila_envio drop column if exists anexos;
alter table public.fila_envio drop column if exists forcar_dono;

-- A prestacao de contas da rodada: o que foi tentado, por qual canal, para qual destino.
alter table public.cobranca_fila add column if not exists envios jsonb not null default '[]'::jsonb;
comment on column public.cobranca_fila.envios is
  'Um registro por destino tentado: {canal, destino, origem, ok, motivo, fila_id, anexos, em}.';

-- Bucket dos boletos: publico porque o GHL busca o anexo por URL sem credencial. O segredo
-- e o token aleatorio no nome do arquivo, nao o bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletos', 'boletos', true, 2097152, array['application/pdf'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['application/pdf'];
