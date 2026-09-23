-- 013 — o boleto recem-nascido, e nao o que acabou de entrar na janela de 7 dias
--
-- O DEFEITO QUE ISTO CONSERTA (23/09)
--   O cobranca-emitidos existe para mandar o boleto NO DIA em que ele e registrado no banco.
--   Mas ele lia o espelho `cobranca_titulo`, e o espelho so puxa `DTVENC < hoje + 8`. Entao
--   ele nunca via um boleto nascer: via um titulo ENTRAR na janela de sete dias, e tratava as
--   duas coisas como a mesma. Na hora de ligar, 129 clientes iam receber "saiu o boleto da sua
--   compra, estou mandando assim que foi registrado" sobre boletos impressos ha ate onze meses,
--   vencendo em dois dias. O texto afirmaria o contrario do que aconteceu.
--
--   Medido no ERP no mesmo dia: 10.282 titulos a vencer, dos quais so 972 dentro dos 7 dias.
--   5.616 ja tinham boleto registrado e o espelho nunca os tinha visto.
--
-- O SINAL CERTO E `TGFFIN.DH_IMPRESSAO`
--   72% de preenchimento no universo a vencer, e 100% nos dias recentes. Entre 60 e 200 por
--   dia util, com vencimentos de poucos dias a mais de um ano — que e exatamente a definicao
--   de "nasceu hoje", independente de quando vence. (AD_DTLIBBOLETO, AD_STATUSBOLETO e
--   TIMDTIMPBOL: zero preenchidos. NUMREMESSA: 6%.)
--
-- POR QUE UMA TERCEIRA FASE
--   O espelho passa a puxar tambem o que foi impresso nos ultimos dias, e esses titulos vencem
--   longe. Se entrassem como 'a_vencer' o lembrete de sexta passaria a avisar sobre vencimento
--   de daqui a um ano. 'futuro' existe para que o cobranca-montar continue enxergando so o que
--   ele deve enxergar: 'vencido' e 'a_vencer'.

alter table public.cobranca_titulo
  add column if not exists dt_impressao date;

comment on column public.cobranca_titulo.dt_impressao is
  'TGFFIN.DH_IMPRESSAO — quando o boleto foi impresso/registrado. E o gatilho do cobranca-emitidos: nao confundir com dtneg (negociacao) nem dtvenc.';

create index if not exists cobranca_titulo_dt_impressao_idx
  on public.cobranca_titulo (dt_impressao)
  where dt_impressao is not null;

-- quantos dias para tras o espelho puxa impressao, e ate onde o emitidos considera "novo".
-- 5 dias cobre o fim de semana (impresso na sexta, rodada na segunda) com folga para um dia
-- de falha. As duas funcoes tem de ler o MESMO numero, senao o emitidos procura titulo que o
-- espelho nao trouxe — dai o valor morar na config e nao numa constante em cada arquivo.
alter table public.cobranca_config
  add column if not exists emitidos_janela_dias integer not null default 5;

comment on column public.cobranca_config.emitidos_janela_dias is
  'Dias de DH_IMPRESSAO para tras que o refresh puxa e o emitidos considera recem-registrado.';
