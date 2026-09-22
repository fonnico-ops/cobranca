-- 012_boleto_na_emissao.sql — o boleto chega quando NASCE, e o aviso da semana vira lembrete.
--
-- O PEDIDO: "ao final do dia, enviar todos os boletos que foram registrados no banco, para o
-- cliente nao receber o boleto apenas uma semana antes do vencimento".
--
-- O motor de cobranca so olhava para quem esta vencido ou vence na proxima semana. Um boleto
-- emitido hoje, com vencimento em 60 dias, so encontrava o cliente 53 dias depois — quando
-- ele ja fechou a programacao de pagamento do mes. Agora sai no fim do dia em que e emitido.
--
-- E, como consequencia direta, o aviso da semana anterior mudou de natureza: o cliente ja tem
-- o PDF ha semanas quando ele chega. Repetir o anexo ensina o cliente a ignorar os dois — ele
-- passa a achar que toda mensagem nossa e a mesma coisa. Entao esse virou LEMBRETE: so a data,
-- com a 2a via a pedido. Quem, por algum motivo, nao recebeu na emissao continua recebendo o
-- anexo — ver textoAVencer() no cobranca-montar.
--
-- COMO A ROTINA SABE O QUE E NOVO
--   Nao por data do ERP. O `AD_HYAKRECSITUACAO` tem os estados do registro mas so 0,8% de
--   preenchimento, e o refresh APAGA e reescreve o cobranca_titulo inteiro todo dia — entao
--   qualquer marca dentro dele se perde. O controle vive fora, aqui.
create table if not exists public.boleto_entregue (
  nufin      bigint primary key,
  grupo      integer,
  canal      text,
  destino    text,
  fila_id    bigint,
  enviado_em timestamptz not null default now(),
  backfill   boolean not null default false
);
alter table public.boleto_entregue enable row level security;   -- sem policy: so service_role
create index if not exists boleto_entregue_grupo_ix on public.boleto_entregue (grupo);

alter table public.cobranca_config
  add column if not exists emitidos_ativo boolean not null default false,
  add column if not exists emitidos_cap integer not null default 60;

-- A ESTREIA E UM BACKFILL. Sem isso o primeiro disparo mandaria a carteira inteira de uma vez.
-- Rodado em 22/09: 555 titulos marcados, nada enviado.
--   POST /functions/v1/cobranca-emitidos {"backfill": true}
--
-- O cron entra JA ATIVO e a funcao recusa com 409 enquanto emitidos_ativo = false — job criado
-- "na hora de ligar" e job que alguem esquece de criar.
--   cron: cobranca-emitidos-fim-do-dia  '0 21 * * 1-5'  (18h em Sao Paulo, seg-sex)
--
-- Para ligar: update cobranca_config set emitidos_ativo = true where id = 1;
