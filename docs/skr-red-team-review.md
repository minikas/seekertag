# Verificação adversarial local

> Registro anterior ao compromisso v2. O comportamento atual e as verificações estão no [relatório v2](skr-commitment-review.md); consulte também o [ABI atual](skr-protocol.md). Artefatos de teste podem ter sido atualizados pela execução v2.

16 de setembro de 2026. Casos de contrato e de fronteira da carteira elaborados por um agente que implementou a API, sem autoria do contrato ou da interface. A execução final, o reforço das asserções e este registro foram concluídos pelo coordenador. É uma revisão interna com papéis separados, não auditoria externa ou certificação.

## Resultado executado

`npm run test:rewards:localnet` passou: **19 resultados**, incluindo os grupos de subtestes, sem falhas, skips ou cancelamentos. A execução usou o binário SBF compilado, contas SPL reais numa blockchain local e carteiras efêmeras. Não houve conexão a mainnet, assinatura com carteira existente ou movimentação de moeda real.

| Tentativa / propriedade | Resultado observado |
| --- | --- |
| Servidor escolher outro programa/mint sob rótulo de rede de testes | Cliente recusou antes da assinatura, inclusive quando os pins do build estavam ausentes |
| Misturar recibos e cofres de recompensas e donos diferentes | Programa recusou; saldos originais preservados |
| Usar outro bump PDA válido, sobrepor contas ou fornecer recibo vazio | Programa recusou; recibo falso permaneceu sem inicialização |
| Usar carteira delegada para financiar com conta de outro dono | Programa recusou fonte não canônica |
| Transferir ou fechar cofre diretamente como terceiro | SPL Token recusou; saldo permaneceu no cofre |
| Depositar e pagar `u64::MAX` | Valor integral transferido, sem arredondamento ou overflow |
| Reutilizar recibo já pago | Recusado |
| Enviar instruções truncadas, longas, prazo negativo ou extremo | Recusado pelo programa |
| Duas liquidações na mesma transação | Segunda recusada; primeira transferência revertida atomicamente |
| Remover assinatura do dono ou substituí-lo | Recusado pelo programa |
| Substituir mint, programa SPL, cofre ou conta destinatária | Recusado |
| Usar mint congelável ou conta destinatária não canônica | Recusado |
| Enviar SOL ao futuro endereço antes do depósito | Inicialização legítima ainda funcionou |
| Doar tokens extras ao cofre | Pagamento original funcionou; extras permaneceram no cofre, conforme limitação v1 |
| Dois pagamentos concorrentes | Apenas um sucesso; cofre liquidado uma vez |
| Retirar antes do prazo ou pagar após vencimento | Recusado |
| Renovar saldo vencido sem retirá-lo | Mesmo recibo e saldo, sem novo depósito |
| Renovação concorrente com reembolso | Apenas uma operação teve sucesso |
| Dono pagar a própria carteira antes do vencimento | **Permitido; limitação econômica confirmada**, não tratada como garantia de bloqueio até vencimento |

As asserções negativas exigem `SendTransactionError` e logs identificando falha do programa esperado. Falhas de conexão, serialização ou assinatura local não contam como defesa bem-sucedida. Nos casos de concorrência, a operação perdedora também precisa demonstrar rejeição no programa.

## API e aplicação

Os 31 testes da API incluem nove casos específicos de recompensa. Exercitam autorização, rede/mint/programa incorretos, preparo idempotente e concorrente, expiração segura de intenção, alteração/transferência de etiqueta, falha de RPC, recibos substituídos, assinatura Ed25519 vinculada a domínio/conversa/nonce/prazo, repetição e troca de destinatário, resolução prematura e fila de consultas públicas.

O teste API + SBF real confirmou depósito de `100.000001`, renovação de 15 dias preservando o QR, prova de carteira, pagamento de exatamente `100000001` unidades à conta escolhida e conclusão apenas da conversa correspondente. Os testes de cliente reconstruíram a mensagem antes de assinar e recusaram instruções adicionais, troca de destinatário e mudança de rede/token/programa.

## Limites

Não houve fuzzing prolongado, prova formal, teste de carga distribuída, inspeção de programa publicado ou sessão MWA física. O limite exato de relógio foi inspecionado no código; os testes locais atravessam o vencimento sem controlar precisamente o segundo de inclusão. A autoridade de upgrade de uma implantação futura permanece uma decisão separada.

A autorização pelo dono permite pagamentos para outras carteiras controladas por ele. Comprovar a carteira na aplicação não comprova identidade humana distinta nem entrega física. O resultado desta rodada é a ausência de uma forma demonstrada de terceiros movimentarem o depósito nos cenários exercitados; não é uma promessa de ausência de vulnerabilidades.

Veja o [relatório do contrato](skr-contract-security-review.md), a [revisão de integração](skr-integration-audit.md) e o [relatório consolidado](skr-delivery-review.md).
