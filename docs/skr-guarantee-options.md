# SeekerTag — alternativas para proteger a recompensa

> Registro anterior ao compromisso v2. O comportamento atual e as verificações estão no [relatório v2](skr-commitment-review.md); consulte também o [ABI atual](skr-protocol.md). Artefatos de teste podem ter sido atualizados pela execução v2.

**Análise de 16 de setembro de 2026. Proposta de arquitetura e produto, sem mudança no contrato.** Duas frentes de agentes revisaram mecanismos on-chain e experiência de devolução; o coordenador confrontou as propostas com o código atual e fontes oficiais.

## Recomendação

Para impedir que o dono libere antecipadamente o depósito usando outra carteira, recomendo um **piloto com aprovação independente obrigatória**, preferencialmente um ponto parceiro que verifique e receba o objeto. Toda saída antes do vencimento precisa respeitar essa aprovação. Um servidor que apenas verifica assinaturas de carteiras não fornece essa independência.

Como melhoria menor, é possível fixar a carteira de quem encontrou antes da entrega e impedir sua substituição. Isso protege um finder honesto já reconhecido, mas não elimina a possibilidade de o dono começar o processo com uma carteira própria. Não apresentaria essa versão como solução completa para a limitação encontrada.

Há também uma solução estritamente temporal: proibir **qualquer** saída até a data combinada. Isso garante que o saldo fique preso por X dias, mas também impede pagar um finder legítimo antes dessa data e não determina quem merece o dinheiro depois. Serve se a prioridade for manter o depósito, não garantir a recompensa pela devolução.

## Três garantias diferentes

| Garantia | É possível assegurar apenas pelo contrato? | Condição |
| --- | --- | --- |
| O saldo não sai antes da data X | Sim | Nenhuma instrução pode movimentá-lo antes de X, inclusive pagamento, cancelamento e caminhos administrativos |
| Depois de aceitar uma devolução, o dono não troca o destinatário | Sim | Carteira, valor e regras ficam vinculados ao caso; expiração/cancelamento não podem contornar esse vínculo |
| A pessoa paga realmente encontrou e devolveu o objeto | Não a partir de carteiras e QR sozinhos | Exige informação externa confiável sobre o objeto, a entrega e as partes |

O contrato atual deixa `release` receber uma carteira e uma referência escolhidas pelo dono: [implementação](../programs/reward-escrow/src/lib.rs). A prova de carteira/conversa é uma regra da API; uma transação direta não passa por ela. O [teste local](../tests/rewards/escrow.localnet.test.mjs) já demonstrou o pagamento à própria carteira.

A impossibilidade de inferir entrega física não depende de uma biblioteca: para o contrato, duas assinaturas válidas têm o mesmo formato quando vêm de duas pessoas ou de duas carteiras controladas por uma só. A documentação de [multisig SPL](https://www.solana-program.com/docs/token#multisig-usage) define limiares de assinaturas, não identidade humana. Nossa conclusão é que contar chaves não estabelece independência entre pessoas.

Informações externas exigem uma fonte e acrescentam confiança nessa fonte; a documentação sobre [oráculos](https://ethereum.org/developers/docs/oracles/) descreve esse limite. A aplicação ao objeto perdido é uma inferência desta análise, não uma garantia oferecida por um fornecedor.

## Comparação das alternativas

| Alternativa | Melhoria real | O que continua possível | Avaliação |
| --- | --- | --- | --- |
| Proibir carteira igual à do dono | Evita um erro ou pagamento literal à mesma chave | Dono usa outra carteira | Insuficiente |
| Duas assinaturas: dono + finder | Impede agir sem a chave de um finder honesto já escolhido | Dono controla ambas antes do vínculo; partes podem entrar em impasse | Melhoria parcial |
| Multisig 2 de 3: dono, finder e mediador | Permite algumas resoluções de desacordo | Dono + finder fictício já somam duas assinaturas | Não atende à exigência de aprovação independente obrigatória |
| Destinatário fixado + compromisso antes da entrega | Evita troca de carteira, redução do valor e retirada unilateral durante o compromisso | Seleção inicial de finder fictício; recusa posterior de reconhecer entrega | Boa versão intermediária, com garantia limitada |
| Prazo de espera e contestação | Oferece tempo para identificar um problema | Ninguém contesta um caso falso; notificações falham; disputa sem decisão prende fundos | Complemento, não prova de legitimidade |
| Bloqueio estrito até X | Garante retenção de saldo até X | Pagamento a carteira própria depois de X; finder legítimo também espera | Válido para garantia temporal |
| Mediador obrigatório em toda saída antecipada | Dono não consegue liberar usando somente suas próprias chaves | Mediador pode ser enganado, ficar offline ou participar de conluio | Opção para piloto assistido |
| Parceiro que inspeciona e recebe o objeto | Acrescenta observação e custódia físicas independentes | Erro do parceiro, objeto trocado, entrega encenada ou conluio | Melhor fundamento para uma modalidade de devolução protegida |
| Fundo de proteção com limite | Pode compensar casos elegíveis quando o processo falha | Fraude em pedidos de compensação; orçamento insuficiente | Complemento operacional futuro |

Arbitragem tem precedentes concretos, com evidências, taxas e prazos. O [Kleros Escrow](https://docs.kleros.io/products/escrow/kleros-escrow-specifications) documenta esses mecanismos para ETH/ERC20; é referência de desenho, não uma integração Solana/SKR pronta validada nesta rodada. Para recompensas pequenas, não assumiria que seu custo operacional cabe no produto sem medir primeiro.

## O piloto recomendado

Começaria com poucos pontos participantes e casos atendidos manualmente. Uma recepção, estabelecimento ou organizador participante poderia exercer o papel; nenhum parceiro ou serviço existente foi presumido nesta análise. A chave do verificador precisa ser controlada pelo operador independente, e não escolhida livremente pelo dono para cada pagamento.

Fluxo proposto:

1. **Depositar:** o dono escolhe valor e prazo e aceita previamente a política e os verificadores permitidos.
2. **Combinar a entrega:** finder comprova a carteira; as partes aceitam valor, destino, local e prazo. O verificador admite o caso. Conversar ou escanear o QR, sozinho, não bloqueia o depósito.
3. **Vincular o compromisso:** o contrato fixa a carteira e a referência do caso. O dono não pode trocar o beneficiário, reduzir o valor ou usar o vencimento original para desfazer uma entrega em andamento.
4. **Verificar o objeto:** o parceiro compara objeto e informações privadas de identificação. O QR identifica o registro, mas não basta como prova de que aquele é o objeto correto.
5. **Receber e pagar:** uma atestação válida do parceiro autoriza o pagamento ao finder vinculado. Preferencialmente, registrar a aceitação da entrega e transferir os tokens na mesma transação on-chain. O encontro físico continua dependendo do parceiro; não se torna atomicamente reversível pela blockchain.
6. **Retirar o objeto:** o dono busca o objeto já guardado pelo parceiro, conforme as condições aceitas.

**A mudança de produto é explícita:** hoje o dono conserva o veto até a assinatura final. Para proteger quem entregou contra a recusa posterior do dono, ele precisa autorizar previamente uma condição verificável por outra parte, ou aceitar arbitragem que possa decidir sem seu consentimento final. Manter um veto absoluto do dono e garantir pagamento apesar desse veto são objetivos incompatíveis.

O fundo continua em uma conta controlada pelo programa. A participação do verificador é uma nova autoridade de autorização; não deve ser descrita como ausência de intermediário. O programa deve restringir destinos ao dono e ao finder vinculado, sem uma instrução administrativa genérica para sacar para qualquer carteira.

### Prazos, contestação e indisponibilidade

Separar o vencimento da **oferta** do prazo do **compromisso de entrega**. A duração de contestação e de atendimento precisa acompanhar a operação real. Não adotaria automaticamente uma janela curta enquanto o aplicativo só atualiza conversas quando aberto; seria necessário planejar comunicação e disponibilidade de suporte.

| Situação | Regra recomendada |
| --- | --- |
| Oferta vence sem caso ativo válido | Dono pode retirar ou renovar, como hoje |
| Conversa aberta, mas compromisso ainda não aceito | Não cria direito automático ao saldo nem congela a oferta indefinidamente |
| Compromisso aceito, parceiro indisponível antes da entrega | Não concluir a entrega protegida; usar outro parceiro previamente permitido ou deixar expirar o prazo de entrega |
| Prazo de entrega termina sem recebimento atestado | Caso pode voltar a oferta aberta; dono só retira quando o prazo original permitir |
| Divergência sobre o objeto antes de atestar recebimento | Não tratar como entrega concluída; encaminhar ao verificador alternativo ou mediador previsto nos termos |
| Recebimento válido já registrado e definitivo | Vencimento original não devolve o dinheiro ao dono; qualquer executor autorizado pelas regras pode concluir o pagamento fixo, sem nova decisão discricionária |
| Entrega física ocorreu sem recibo ou fora do procedimento | Exige investigação/possível proteção limitada; um temporizador não determina quem diz a verdade |

Para o piloto mais simples, a checagem acontece **antes** de emitir a atestação definitiva. Depois dela, a recompensa pertence ao finder conforme os termos: o dono assume a confiança na inspeção do parceiro. Se o produto preferir permitir contestação depois do recebimento, precisará acrescentar `EM_DISPUTA`, árbitro substituto e regra final explícita. Default de reembolso favorece o dono; default de pagamento favorece o finder; esperar para sempre prejudica disponibilidade. Nenhuma das três escolhas descobre a verdade física.

Cancelar um compromisso por acordo pode devolver o saldo ao estado de oferta, mantendo o prazo original. **Não pode existir reembolso antecipado só com dono + finder:** se ambos forem carteiras da mesma pessoa, isso recria a saída que queremos impedir. A exigência independente precisa abranger cancelamentos, liquidação parcial e caminhos de recuperação, não apenas a instrução chamada `release`.

Não basta o parceiro emitir um recibo fora da blockchain e desaparecer: antes de considerar o recebimento definitivo, a atestação precisa estar confirmada ou o próprio pagamento deve estar concluído. Finalizar uma ação após um prazo ainda exige uma transação e alguém que pague a taxa; o relógio não executa sozinho.

## QR, NFC e Seeker

**O QR permanece igual.** Ele aponta para o objeto, enquanto compromissos, vencimentos e recibos mudam separadamente. Em oferta aberta, continuam possíveis +7/+15/+30 dias. Com finder já vinculado, alterações no prazo da entrega exigem o consentimento previsto no acordo, sem criar um veto novo ou alterar a carteira. Renovar a oferta não pode prorrogar uma disputa unilateralmente.

SGT e Seed Vault são úteis, mas não resolvem este problema. A documentação descreve o SGT como prova associada ao dispositivo e o Seed Vault como proteção de chaves; isso não demonstra que a pessoa encontrou o objeto, nem que duas carteiras têm donos diferentes. [Solana Mobile: Seeker](https://docs.solanamobile.com/solana-mobile-stack/seeker).

Uma etiqueta NFC com criptografia pode melhorar a autenticação da etiqueta e reduzir cópia simples. A [NXP descreve autenticação por leitura, AES e recursos de detecção de violação](https://www.nxp.com/products/rfid-nfc/nfc-hf/ntag-for-tags-and-labels/ntag-424-dna-424-dna-tagtamper-advanced-security-and-privacy-for-trusted-iot-applications%3ANTAG424DNA). A inferência para SeekerTag é limitada: autenticar o chip não comprova entrega, identidade humana ou que o chip permaneceu preso ao objeto original. QR público, NFC com URL e segredo conhecido pelo dono não são testemunhas independentes.

Não exigiria SGT ou carteira para avisar sobre o objeto e conversar. A carteira passa a ser necessária para aceitar o recebimento em SKR; não tornaria um Seeker obrigatório para quem encontra.

## Critérios para uma futura implementação

1. Todas as saídas antecipadas exigem uma autorização independente válida ou uma autorização independente definitiva já registrada para aquele caso. Controlar dono e finder simultaneamente não basta.
2. A autoridade/política aplicável é fixada no depósito; dono e servidor não podem trocá-la por uma chave arbitrária enquanto houver fundos comprometidos. Substitutos precisam estar previstos.
3. Atestação liga rede, programa, depósito, caso, carteira destinatária, valor, ação e nonce/prazo; não serve para outra recompensa nem pode ser repetida.
4. Destinatário e valor ficam imutáveis depois do aceite. Não há pagamento da mesma recompensa para dois casos.
5. Escanear um QR ou abrir muitas conversas não permite prender o saldo. Admissão de um caso exige o processo previsto e tem prazo limitado antes da entrega.
6. Expiração e renovação não desfazem uma entrega já atestada nem permitem reembolso concorrente com pagamento.
7. A confirmação de custódia e o pagamento devem evitar um intervalo em que a autoridade possa revogar uma aprovação já considerada definitiva pelo finder.
8. O contrato continua verificando mint, contas, saldo, precisão e assinatura; a nova política não substitui os controles existentes.
9. A política de upgrade precisa sustentar essas regras. Quem consegue substituir o código pode alterar as garantias; [a documentação de implantação Solana](https://solana.com/docs/programs/deploying) explica essa autoridade.
10. A interface apresenta claramente oferta disponível, compromisso aceito, verificação pendente, pagamento e eventual disputa. Não chama simples comprovação de carteira de comprovação de entrega.

Custos a medir no piloto: minutos de atendimento, deslocamento, guarda do objeto, proporção de contestações, taxa de erro/fraude e transações patrocinadas. Não foi estimado preço sem dados. Um fundo de proteção só deve ser prometido quando houver orçamento, elegibilidade e limites definidos.

## Decisão que a análise permite tomar

- Se a prioridade for **saldo preso por X dias**, o bloqueio estrito até a data resolve essa garantia específica e adia também pagamentos legítimos.
- Se a prioridade for **melhorar o fluxo sem operação humana**, destinatário vinculado e compromisso antes da entrega são uma evolução parcial, com o risco inicial de carteiras alternativas explicitado.
- Se a prioridade for **impedir a liberação antecipada unilateral e proteger a devolução**, recomendo o piloto com verificador obrigatório e recebimento por parceiro. A garantia é condicionada à honestidade e disponibilidade desse serviço; não elimina conluio nem prova que houve uma perda histórica verdadeira.

Nenhuma dessas modalidades foi implementada nesta rodada. A versão existente, seus testes e os depósitos permanecem com as regras anteriores. A próxima alteração precisa escolher explicitamente qual garantia o produto oferecerá, especialmente se o dono autorizará o pagamento antecipadamente ao aceitar a condição de entrega verificada.
