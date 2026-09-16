# SeekerTag — compromisso prévio da recompensa SKR

**16 de setembro de 2026 · branch local `feat/skr-reward-escrow` · protocolo v2.**

Implementado o modelo escolhido: **entrega direta, compromisso assinado antes da entrega e pagamento autorizado pelo dono**. O contrato, a API e as telas aplicam as mesmas regras. A etiqueta e seu QR permanecem iguais. Nenhum programa foi publicado, nenhum SKR real foi movimentado e a integração continua desligada por padrão.

## Como funciona

1. A pessoa escaneia o QR e envia uma mensagem. Isso não reserva a recompensa, não altera o prazo e não comprova posse do objeto.
2. A pessoa comprova sua carteira na conversa. O dono verifica as informações e combina a entrega.
3. Antes da entrega, o dono usa **Comprometer recompensa**, revisa a carteira e assina. A confirmação na blockchain fixa o destinatário e a conversa.
4. Depois de receber o objeto, o dono usa **Recebi o objeto: revisar pagamento** e assina a liberação para essa carteira. A devolução só pode ser concluída no aplicativo após o pagamento confirmado.
5. Se a entrega for abandonada, quem recebe pode renunciar voluntariamente. A tela exige escrever **RENUNCIAR** e informa que isso **não paga a recompensa**. A oferta volta a ficar livre com mesmo saldo, prazo e QR.

| Situação | Poder do dono | Poder de quem encontrou |
| --- | --- | --- |
| Oferta sem compromisso | Renovar +7/+15/+30 dias; comprometer antes do vencimento; retirar após vencer | Enviar mensagem e comprovar carteira, sem alterar a oferta |
| Compromisso confirmado | Pagar exclusivamente à carteira fixada; não pode trocar, renovar ou retirar | Manter o compromisso ou assinar renúncia sem pagamento |
| Compromisso após prazo original | Continua podendo pagar; não ganha direito ao reembolso | Continua podendo manter ou renunciar |
| Renúncia confirmada | Volta a gerir a oferta; pode retirar se o prazo original venceu | Não recebe tokens pela renúncia |

Um compromisso **não expira automaticamente**. Sem pagamento ou renúncia, um desacordo pode manter o saldo bloqueado indefinidamente. Não há árbitro, verificador independente ou comprovação de entrega física. Antes de vincular uma pessoa honesta, o dono ainda pode escolher outra carteira que ele controla; depois do vínculo confirmado, não pode redirecioná-lo. O depósito não obriga o dono a assinar o pagamento.

## Implementação e revisão

- Contrato v2 com estados `funded`, `committed`, `paid` e `refunded`. A sequência monotônica do compromisso impede reaproveitar pagamentos, renúncias ou aceites antigos, inclusive com a mesma carteira.
- A renúncia exige a assinatura da carteira vinculada e não movimenta tokens. Essa carteira paga a taxa da transação em SOL.
- API com rotas de compromisso e renúncia, intenções persistidas, confirmação finalizada, restrições por conversa e histórico de provas imutável. Um pagamento pendente não pode impedir o preparo da renúncia; a ordem efetivamente executada no contrato decide o resultado.
- Migração SQLite preserva recompensas, intenções e relacionamentos. `committed` integra as proteções de transferência, pausa e alteração do prêmio da etiqueta.
- O aplicativo reconstrói a transação permitida, confere rede/programa/mint/signatário/sequência e atualiza o estado antes da assinatura. Outras conversas não recebem direito ao compromisso.
- TypeScript exclui artefatos gerados: a verificação não tenta ler bundles que o export está substituindo.

A revisão independente encontrou uma corrida: um compromisso direto na blockchain podia coincidir com a comprovação de outra carteira e tornar o vínculo anterior indisponível na API. O histórico imutável corrige essa situação. Um teste reproduz o caso; a conversa, o pagamento e a renúncia continuam associados à carteira efetivamente gravada no contrato.

Autores separados trabalharam no contrato e no aplicativo; o coordenador implementou API e integração. O autor da interface também revisou API e contrato. Não foi identificado um caminho de saque por terceiros na revisão realizada. Isso é revisão interna com testes, não auditoria externa ou prova formal.

## Verificação executada

| Verificação | Resultado |
| --- | --- |
| TypeScript | Passou |
| Unitários da aplicação | 23 passaram, incluindo 11 do validador de transações |
| API | 35 passaram, incluindo 13 cenários de recompensa, migração e corrida de prova |
| SDK | 7 passaram |
| Rust / Clippy | 7 testes passaram; análise estrita sem avisos |
| Compilação SBF | Passou |
| Contrato + API em localnet | 23 resultados passaram, contando os grupos de subtestes |
| Navegador com API e SBF reais | Depósito, renovação +15 dias, compromisso, renúncia sem pagamento, novo compromisso, pagamento exato e confirmação da devolução passaram |
| Console / rede do cenário SKR | Zero erros; 144 requisições de API concluídas; maior duração observada 53 ms na API local, sem contar aprovação/finalização da carteira |
| Visual | Painel de compromisso e revisão de renúncia conferidos; sem overflow horizontal no viewport de 390 px |
| Regressão web | 34 passaram em Chromium, WebKit desktop e perfil iPhone, sem retries ou skips |
| Android | Exportação Hermes passou: 1.301 módulos, bundle de 4,7 MB |

Os testes executaram SPL de teste em validadores descartáveis, com chaves efêmeras. No navegador, apenas a carteira externa foi substituída por um adaptador de teste; aplicação, API, banco e contrato eram reais. A exportação Android não representa APK novo nem teste de carteira física.

SHA256 do SBF testado: `25782ca24d1d693dd9c8caa291da52cadc1c3de737ce9af7f5fbb0f2e80fc95d`.

Evidências locais: [resultado do navegador](../artifacts/rewards/browser/verification.json), [compromisso do dono](../artifacts/rewards/browser/owner-committed.png), [compromisso no celular](../artifacts/rewards/browser/finder-mobile-committed.png), [revisão de renúncia](../artifacts/rewards/browser/finder-mobile-waiver-review.png), [pagamento](../artifacts/rewards/browser/owner-paid.png). Artefatos são ignorados pelo Git; o código dos testes permanece no repositório.

## Compatibilidade e limites de implantação

V2 usa recibos de **224 bytes, `SKREWRD2`**, incompatíveis com os 208 bytes do v1. A migração do banco não converte contas nem fundos on-chain. Uma implantação v2 deve ser separada, com plano de liquidação e cliente compatível para eventuais fundos v1. Não substituir cegamente o programa de depósitos v1 ativos.

Permanecem pendentes implantação verificada, política de autoridade de atualização e teste físico da carteira Android. Recibo/cofre mantêm seu custo em SOL; tokens excedentes doados não têm saque nesta versão. A API requer uma instância escritora por banco. Não houve novo build Docker nesta etapa; a validação Docker registrada no relatório anterior corresponde ao v1.

As dependências não mudaram nesta etapa. Os avisos remanescentes de `bigint-buffer` e `stream-json` documentados no [relatório anterior](skr-delivery-review.md) continuam pendentes. A exportação mantém avisos de resolução de módulos de bibliotecas Solana; o bundle foi gerado e os cenários web executaram sem erro.

A implementação foi validada localmente. O envio do código ao repositório não publica o contrato nem gera um novo APK; não houve merge ou implantação pública. Consulte o [protocolo v2](skr-protocol.md), a [API](../server/API.md) e a [configuração](skr-setup.md) para os detalhes reproduzíveis.
