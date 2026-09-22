import { sanear, blocoDivida, blocoOrigem, frasesBoleto, sistema, escolherAtendente } from "./atende_puro.mjs";
import { textoToque, textoPromessa, proximoToqueEm, agoraSp, blocoRegua } from "./seguir_puro.mjs";
let f = 0;
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { console.log("  FALHA " + m); f++; } };

console.log("1) sanear — a IA nao escreve numero (o limite que sustenta os outros)");
ok(sanear("Oi! Segue o boleto, qualquer coisa me chama.") === null, "prosa limpa passa");
ok(sanear("São R$ 1.234,56 em aberto.") !== null, "recusa valor");
ok(sanear("Vence dia 15") !== null, "recusa data inventada");
ok(sanear("NF 188412") !== null, "recusa numero de nota");
ok(sanear("Segue a 2a via") !== null, "recusa ate digito solto (2a via) — a regra e sem excecao");
ok(sanear("Segue a segunda via") === null, "por extenso passa");
ok(sanear("   ") !== null, "recusa vazio");
ok(sanear("x".repeat(1300)) !== null, "recusa texto longo demais");
ok(/1234/.test(String(sanear("paga 1234"))), "o motivo da recusa mostra o que foi achado");

console.log("2) blocoDivida — os numeros vem do banco, e o total fecha");
const ts = (n) => Array.from({ length: n }, (_, i) => ({ valor: 100 + i, dtvenc: `2026-0${1 + (i % 9)}-1${i % 9}`, numnota: 900 + i }));
const b5 = blocoDivida(ts(5));
ok(b5.lista.split("\n").length === 5, "5 titulos => 5 linhas");
ok(Math.abs(b5.total - ts(5).reduce((a, t) => a + t.valor, 0)) < 0.01, "total = soma");
const b20 = blocoDivida(ts(20));
ok(b20.lista.split("\n").length === 9, "20 titulos => 8 linhas + resumo");
ok(Math.abs(b20.total - ts(20).reduce((a, t) => a + t.valor, 0)) < 0.01, "total continua sendo o de TUDO, nao so o mostrado");
const soma20 = [...b20.lista.matchAll(/R\$ ([\d.]+,\d{2})/g)].map((m) => Number(m[1].replace(/\./g, "").replace(",", "."))).reduce((a, x) => a + x, 0);
ok(Math.abs(soma20 - b20.total) < 0.01, "a soma do que aparece + o resto = o total (nada some)");

console.log("3) blocoOrigem — de onde vem o boleto");
const venda = [{ valor: 500, dtvenc: "2026-08-10", numnota: 188412, serie: "1", parcela: "2", parcelas_total: 3, operacao: "Venda Nitron", dt_emissao: "2026-05-26" }];
const oV = blocoOrigem(venda);
ok(/NF 188412\/1/.test(oV), "diz a nota e a serie");
ok(/parcela 2 de 3/.test(oV), "diz a parcela");
ok(!/Venda Nitron/.test(oV), "NAO manda o nome interno da operacao do ERP para o cliente");
// producao: 15 titulos com operacao "Venda Reemissao de Nota com Problema" e 161 com
// "Venda Clientes Especiais". Nomenclatura interna numa cobranca troca a conversa sobre
// pagamento por uma conversa sobre o problema da nota.
ok(!/Problema/.test(blocoOrigem([{ ...venda[0], operacao: "Venda Reemissão de Nota com Problema" }])),
   "nem o pior nome de operacao vaza");
// producao: no Clube o TGFFIN.NUMNOTA vem com o numero do CONTRATO (nufin 1509888: numnota
// 42, contrato 42). "NF 42" manda o cliente procurar uma nota que nao existe.
const dividaClube = blocoDivida([{ valor: 1100, dtvenc: "2026-09-25", numnota: 42, contrato: 42 }]);
ok(!/NF/.test(dividaClube), "titulo de contrato nao ganha 'NF' na lista da divida");
ok(/NF 900/.test(blocoDivida(ts(1)).lista), "titulo de venda continua mostrando a NF");
ok(/emitida em 26\/05/.test(oV), "diz emissao da nota");
ok(!/entregue/i.test(oV), "NAO fala em entrega quando nao ha status");
const entregue = blocoOrigem([{ ...venda[0], entrega_status: "Entregue" }]);
ok(/consta entregue/.test(entregue), "quando o status diz Entregue, ela pode confirmar");
ok(!/entregue em/i.test(entregue), "e mesmo assim nao inventa DATA de entrega");
const clube = blocoOrigem([{ valor: 1500, dtvenc: "2026-08-10", contrato: 112, parcela: "09", parcelas_total: 12, contrato_parcelas: 12, contrato_inicio: "2025-12-09" }]);
ok(/contrato do Clube nº 112/.test(clube), "Clube: diz o contrato");
ok(/parcela 9 de 12/.test(clube), "Clube: zero a esquerda nao vaza ('09' => 9)");
ok(!/NF/.test(clube), "Clube nao tem nota e nao finge ter");
ok(!/12 parcelas/.test(clube), "com 'parcela 9 de 12' nao repete '12 parcelas' depois");
// contrato 42 da producao: parcela "11", NUNOTA nulo => a contagem por nota volta 0 e o
// total tem de vir do contrato. Sem isso sai "parcela 11" sem o "de 12".
const clubeSemNota = blocoOrigem([{ valor: 1100, dtvenc: "2026-09-25", contrato: 42, parcela: "11", parcelas_total: 12, contrato_parcelas: 12 }]);
ok(/parcela 11 de 12/.test(clubeSemNota), "Clube sem nota: parcela 11 de 12 (o total vem do contrato)");
const seco = blocoOrigem([{ valor: 80, dtvenc: "2026-08-10" }]);
ok(!/NF|contrato|parcela/.test(seco), "sem origem: so valor e vencimento, sem invencao");
const oMuitos = blocoOrigem(ts(20));
ok(oMuitos.split("\n").length === 7, "20 titulos => 6 linhas + resumo");

console.log("4) frasesBoleto — as tres situacoes");
const anexo = frasesBoleto([{ boleto_url: "https://x/a.pdf" }, { boleto_url: "https://x/b.pdf" }]);
ok(/Seguem os boletos/.test(anexo.texto) && anexo.urls.length === 2, "dois anexos: plural e as duas urls");
const nenhum = frasesBoleto([{ boleto_geravel: true }]);
ok(/providenciar a segunda via/.test(nenhum.texto) && !nenhum.urls.length, "sem boleto: promete providenciar");
const banco = frasesBoleto([{ boleto_geravel: false }]);
ok(/direto pelo banco/.test(banco.texto), "emitido no banco: nao promete 2a via, diz que sai por la");
ok(!/providenciar/.test(banco.texto), "e nao promete o que nao pode cumprir");

console.log("5) o prompt carrega os limites que a gestao fixou");
const sys = sistema({ empresa: "Nitron", hoje: "22/09/2026" });
for (const t of ["[[REPASSA:", "[[ORIGEM]]", "[[BOLETO]]", "[[PROMESSA:", "[[PARAR]]", "NAO ESCREVE ALGARISMO"])
  ok(sys.includes(t), `o prompt fala de ${t}`);
for (const t of ["parcelar", "desconto", "protesto", "entrega"])
  ok(new RegExp(t, "i").test(sys), `${t} esta tratado no prompt`);
ok(/Nitron/.test(sys) && /22\/09\/2026/.test(sys), "empresa e data entram no prompt");

console.log("6) rodizio das atendentes");
const karla = { usuario_ghl_id: "K", nome: "Karla", peso: 1, recebidos: 5, ativo: true };
const bianca = { usuario_ghl_id: "B", nome: "Bianca", peso: 1, recebidos: 2, ativo: true };
ok(escolherAtendente([karla, bianca]).nome === "Bianca", "quem recebeu menos leva o proximo");
ok(escolherAtendente([karla, { ...bianca, ativo: false }]).nome === "Karla", "inativa nao recebe");
ok(escolherAtendente([]) === null, "sem atendente devolve null (e quem chama nao repassa)");
// peso 4 => carga = recebidos/4. Com 7 recebidos ela esta em 1,75 contra os 2,0 da Bianca,
// e ainda leva o proximo. Numeros escolhidos para NAO empatar: no empate quem decide e o
// embaralhamento, e o teste passaria ou falharia conforme o sorteio.
ok(escolherAtendente([{ ...karla, peso: 4, recebidos: 7 }, bianca]).nome === "Karla", "peso 4 aguenta ~4x a carga por repasse");
let sorteios = new Set();
for (let i = 0; i < 40; i++) sorteios.add(escolherAtendente([{ ...karla, recebidos: 3 }, { ...bianca, recebidos: 3 }]).nome);
ok(sorteios.size === 2, "empatadas: o desempate e sorteado, nao sempre a primeira do banco");

console.log("7) os toques");
const ctx = { nome: "Ana", total: 1000, titulos: [{ valor: 1000, dtvenc: "2026-08-01" }], temBoleto: true, empresa: "Nitron", maxToques: 5 };
const t2 = textoToque(2, ctx), t5 = textoToque(5, ctx);
ok(/Olá, Ana!/.test(t2), "cumprimenta pelo nome");
ok(/R\$ 1\.000,00/.test(t2) && /01\/08/.test(t2), "valor e vencimento vem do codigo, nao de IA");
ok(!/protesto|negativa|jurídic|advogad/i.test(t2 + t5), "nenhum toque ameaca");
ok(/colega do financeiro/.test(t5), "o ultimo toque avisa que uma pessoa assume");
ok(!/colega do financeiro/.test(t2), "e so o ultimo faz esse aviso");
ok(/anexo/.test(t2), "com boleto: diz que vai anexo");
ok(/segunda via/.test(textoToque(2, { ...ctx, temBoleto: false })), "sem boleto: oferece a 2a via");
ok(textoToque(3, ctx) !== textoToque(4, ctx) && textoToque(4, ctx) !== t5, "cada toque tem texto proprio");
const semNome = textoToque(2, { ...ctx, nome: "" });
ok(/^Olá!/.test(semNome) && !/Olá, !/.test(semNome), "sem nome, cumprimenta sem nome (e nao 'Ola, !')");
const plural = textoToque(2, { ...ctx, total: 300, titulos: [{ valor: 100, dtvenc: "2026-08-01" }, { valor: 200, dtvenc: "2026-07-01" }] });
ok(/2 títulos/.test(plural) && /01\/07/.test(plural), "plural conta certo e usa o vencimento MAIS ANTIGO");

console.log("7b) a régua: do 3º toque em diante o tom endurece");
const REGUA = [
  { dias: 10, passo: "negativação nos órgãos de proteção ao crédito" },
  { dias: 15, passo: "protesto em cartório" },
  { dias: 25, passo: "notificação extrajudicial" },
];
const duro = (n, atraso) => textoToque(n, { ...ctx, atraso, regua: REGUA,
  titulos: [{ valor: 1000, dtvenc: "2026-08-01" }] });

const t3d = duro(3, 12);
ok(/vencido há 12 dias/.test(t3d), "diz há quantos dias está vencido");
ok(/10 dias de atraso — negativação/.test(t3d), "lista a régua inteira");
ok(/protesto em cartório/.test(t3d) && /notificação extrajudicial/.test(t3d), "os três passos aparecem");
// a data sai do VENCIMENTO + os dias do passo, nao de "em breve"
ok(/próximo passo é protesto em cartório, em 16\/08\/2026/.test(t3d), "próximo passo com a data exata (01/08 + 15 dias)");
ok(!/foi negativado|foi protestado|negativamos|protestamos/i.test(t3d), "NUNCA afirma que um passo já foi executado");

const t3cedo = duro(3, 3);
ok(/próximo passo é negativação.*11\/08\/2026/.test(t3cedo), "com 3 dias de atraso o próximo passo é a negativação");

const t5tarde = duro(5, 40);
ok(/Todos os prazos acima já venceram/.test(t5tarde), "passados todos os prazos, diz isso e não inventa um novo");
ok(/encaminho o caso para a nossa equipe/.test(t5tarde), "o 5º toque encaminha para gente — que é o que o sistema faz de verdade");
ok(!/eu vou protestar|vou negativar/i.test(t5tarde), "a Nina não promete executar o que quem executa é o financeiro");

// os dois freios
const aVencer = textoToque(4, { ...ctx, atraso: 0, regua: REGUA });
ok(!/cartório|negativa|extrajudicial/i.test(aVencer), "sem atraso NÃO fala em cartório (aviso de vencimento futuro)");
const semRegua = textoToque(4, { ...ctx, atraso: 30, regua: [] });
ok(!/cartório|negativa|extrajudicial/i.test(semRegua), "régua desligada devolve o tom cordial, sem deploy");
ok(/levo para a equipe/.test(semRegua), "e volta ao texto antigo");

// toques 1 e 2 seguem cordiais mesmo com atraso grande
const t2d = duro(2, 40);
ok(!/cartório|negativa|extrajudicial/i.test(t2d), "o 2º toque continua cordial: a régua só entra no 3º");

console.log("7c) blocoRegua sozinho");
ok(blocoRegua("", 20, REGUA) === "", "sem vencimento não monta nada");
ok(blocoRegua("2026-08-01", 20, []) === "", "sem régua configurada não monta nada");
const r = blocoRegua("2026-08-01", 1, [{ dias: 5, passo: "aviso" }, { dias: 2, passo: "primeiro" }]);
ok(r.indexOf("primeiro") < r.indexOf("aviso"), "ordena os passos por dias, mesmo fora de ordem na config");
ok(/em 03\/08\/2026/.test(r), "01/08 + 2 dias = 03/08");

console.log("8) promessa");
const pr = textoPromessa({ nome: "Ana", total: 500, data: "2026-09-10", temBoleto: false });
ok(/10\/09\/2026/.test(pr), "lembra a data que ELE deu");
ok(!/cobran|atraso|vencid/i.test(pr), "quem se comprometeu nao leva o texto de quem sumiu");

console.log("9) agenda do proximo toque");
const seg = new Date("2026-09-21T12:00:00Z");           // segunda
ok(proximoToqueEm(2, seg).getUTCDay() === 3, "seg + 2 dias = quarta");
ok(proximoToqueEm(4, seg).getUTCDay() === 5, "seg + 4 dias = sexta");
ok(proximoToqueEm(5, seg).getUTCDay() === 1, "seg + 5 cairia no sabado => vai para segunda");
ok(proximoToqueEm(6, seg).getUTCDay() === 1, "seg + 6 cairia no domingo => vai para segunda");
ok(proximoToqueEm(2, seg).getUTCHours() === 12, "sempre as 12:00Z (~9h em Sao Paulo)");
ok(proximoToqueEm(0, seg) > seg, "espera zero ainda anda um dia — nunca toca duas vezes no mesmo dia");
ok(typeof agoraSp().dow === "number" && agoraSp().hora >= 0, "agoraSp devolve dia e hora");

console.log(f ? `\n${f} FALHA(S)` : "\ntudo certo");
process.exit(f ? 1 : 0);
