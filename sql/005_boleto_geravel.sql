-- 005_boleto_geravel.sql — quais titulos NAO podem ganhar boleto novo.
--
-- Ha titulos cujo boleto foi emitido DIRETO NO BANCO, fora do ERP. O cliente ja tem um
-- boleto valido; gerar outro criaria um segundo codigo de barras para a mesma divida.
--
--   conta 113 GRAFENO DIGITAL ........... toda ......................... 73 titulos
--   conta 112 MATRIZ SAFRA 2 ............ DTNEG 06/10/2025 a 23/07/2026 . 28 titulos
--   conta 112 fora desse periodo, e demais bancos ..................... pode gerar
alter table public.cobranca_config
  add column if not exists boleto_nao_geravel jsonb not null default
  '[{"conta":113,"motivo":"Grafeno: boleto emitido direto no banco, fora do ERP"},
    {"conta":112,"dtneg_de":"2025-10-06","dtneg_ate":"2026-07-23","motivo":"Safra: os primeiros boletos foram feitos manualmente no banco"}]'::jsonb;

alter table public.cobranca_titulo add column if not exists dtneg date;
alter table public.cobranca_titulo add column if not exists codctabcoint integer;
alter table public.cobranca_titulo add column if not exists conta_desc text;
alter table public.cobranca_titulo add column if not exists boleto_geravel boolean;
alter table public.cobranca_titulo add column if not exists boleto_motivo text;

alter table public.cobranca_fila add column if not exists sem_boleto_no_banco integer not null default 0;
