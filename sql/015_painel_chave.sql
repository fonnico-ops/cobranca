-- 015 — chave de acesso do painel.
--
-- O painel responde sem login (e o que permite abrir no navegador) e mostra nome, CNPJ e
-- divida de cliente; o botao dispara mensagem de verdade. Antes disso o que protegia era so
-- a URL ser desconhecida — e a URL deixou de ser desconhecida quando a tela passou a ser
-- servida pelo GitHub Pages, em repositorio publico.
--
-- O VALOR da chave NAO mora aqui. Este arquivo esta num repositorio publico; a chave e
-- gravada a mao (SQL editor do Supabase) e vive no link que cada pessoa da cobranca guarda:
--
--   update cobranca_config set painel_chave = '<chave>' where id = 1;
--
-- Para trocar a chave (alguem saiu do time, link vazou): rode o update com outra e mande o
-- link novo. Para desligar a exigencia, deixe NULL — a funcao volta a abrir para qualquer um.
alter table cobranca_config add column if not exists painel_chave text;

comment on column cobranca_config.painel_chave is
  'Chave que o painel exige na query (?k=). Vazio = painel aberto. O valor nao fica no repositorio.';
