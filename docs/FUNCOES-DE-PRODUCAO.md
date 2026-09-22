# Nenhuma função de produção foi alterada

Vale registrar porque, durante a construção, o caminho óbvio parecia ser outro.

O motor de cobrança reaproveita o trilho que já existe
(`fila_envio` → `fila-processar` → `campanhas-enviar` → GHL). A primeira ideia foi
**estender** essas duas funções: `anexos` como campo próprio (PDF vira `attachments` no
WhatsApp e no e-mail, em vez de `<img>` no corpo) e `forcar_dono` para a mensagem sair pela
Nina. As colunas `fila_envio.anexos` e `fila_envio.forcar_dono` chegaram a ser criadas.

**Foram revertidas.** Duas razões, nessa ordem:

1. **O `campanhas-enviar` está na v40** e concentra tudo que se aprendeu quebrando em
   produção: trava de instância, confirmação de troca, pós-checagem de entrega, queda pelo
   nome da instância, exceção estreita do modo aviso. Reescrever o arquivo inteiro para
   adicionar dois campos põe em risco uma função que custou meses de incidentes — e o
   histórico dela registra, por versão, o preço de cada um.

2. **Não era necessário.** O que a cobrança precisava já existia ou cabia em pouco código:

   | Necessidade | Como foi resolvida |
   |---|---|
   | Anexo no WhatsApp | `fila_envio.imagens` já vira `attachments` no POST do GHL. Para o Zaptos, PDF é anexo como qualquer outro. |
   | Anexo no e-mail | ~40 linhas próprias no `cobranca-aprovar`. O caminho do e-mail não tem nenhuma das sutilezas de instância que justificam o trilho compartilhado. |
   | Sair pela Nina | Empréstimo do contato, com o dono anterior registrado — o mesmo mecanismo do `campanha-dono`, que já existia e já provou que o GHL ignora `fromNumber`. |

Coluna que nada lê é mentira no schema, então `anexos` e `forcar_dono` foram removidas de
`fila_envio` (ver `sql/002_cobranca_ajustes.sql`).

## Quando valerá a pena mexer

Se o `campanhas-enviar` for tocado por outro motivo, aproveitar para dar a ele `anexos` no
e-mail — e então **remover** o envio direto do `cobranca-aprovar`, para o e-mail voltar ao
trilho comum. Enquanto isso não acontece, a duplicação está documentada em
`docs/ARQUITETURA.md`, seção 1.
