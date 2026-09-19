# Notificações, conversa e carteira de recebimento

Investigação de 19/09/2026. Alterações locais, sem commit/push e sem deploy da API.

## Causa do carregamento lento e HTTP 429

O listener de token de push chamava `configure(false)`, que chamava `registerPush`, que consultava `getDevicePushTokenAsync` novamente. No Android, essa consulta emite o mesmo evento de token. O resultado era um ciclo de consultas nativas e `POST /notifications/devices`.

A [documentação do Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#pushtokenlistenertoken) alerta explicitamente sobre esse ciclo. A implementação instalada confirma a sequência `promise.resolve(token)` → `onNewToken(token)` em `expo-notifications/android/src/main/java/expo/modules/notifications/tokens/PushTokenModule.kt`.

A API limita gravações autenticadas a 100/minuto e requisições globais a 300/minuto por IP. O registro repetido consumia esses limites; consultas de notificações, conversa e categorias competiam com essas chamadas e recebiam 429 ou expiravam no cliente.

Medições agregadas no servidor durante o teste com o Seeker físico:

| Janela | Registros de push | Respostas observadas |
| --- | ---: | --- |
| Antes, 20 segundos | 337 | Captura inicial somente de entrada |
| Antes, 10 segundos | 291 | 288 respostas 429 e 4 respostas 200, incluindo uma consulta de saúde |
| Depois, 90 segundos | 2, correspondentes a duas inicializações completas | 47 respostas 200; nenhum 429 |
| APK final, 60 segundos durante edição/categorias | 0 | 27 respostas 200, incluindo duas consultas de categorias; nenhum 429 |

A observação guardou somente contagens de rotas normalizadas, status e duração no servidor, sem cabeçalhos, credenciais ou corpos. Esses tempos não medem a latência total do aparelho. Evidências ignoradas pelo Git em `qa/artifacts/network-investigation/`.

O listener agora repassa seu token diretamente. Bootstrap e evento nativo compartilham a requisição em andamento; resultados bem-sucedidos são reutilizados por cinco minutos. Novo token, sessão ou idioma exige novo registro. Falhas podem ser tentadas novamente na retomada do app. Os limites da API permanecem iguais.

## Layout e categorias

A conversa tinha uma lista limitada a 360 pontos dentro do scroll da página; o composer seguia o conteúdo. Agora a página usa a altura disponível, a lista rola independentemente e o composer fica no rodapé. `KeyboardAvoidingView` com posição medida na janela mantém o campo acima do teclado, seguindo a [documentação da versão 1.21](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/1.21.0/api/components/keyboard-avoiding-view). A entrada do encontrador usa o mesmo layout.

O formulário deixava a região de categorias vazia enquanto consultava a API e desabilitava o gerenciamento durante o carregamento da recompensa. A região agora distingue carregamento, erro com nova tentativa e lista vazia. Escolher/gerenciar categorias independe da consulta da recompensa; transações em andamento mantêm suas guardas. Fechar o gerenciamento recarrega as categorias do formulário.

## O que um scanner malicioso pode fazer

Escanear o QR permite iniciar uma conversa, sujeito aos limites existentes. Isso não prova posse física do objeto. Nessa conversa, o visitante pode informar um endereço Solana; uma assinatura da carteira é opcional e, quando usada, prova a carteira, não a posse do objeto.

- O endereço fica vinculado àquela conversa. Ele não substitui a carteira de outra conversa nem reserva o pagamento para o primeiro visitante.
- Salvar o endereço não cria uma operação de liberação, não transmite transação e não move a recompensa.
- Preparar o pagamento exige a sessão do dono da tag e a seleção de uma conversa aberta dessa tag. O destinatário vem do registro dessa conversa, não de um endereço arbitrário enviado pelo cliente.
- Transmitir o pagamento exige a assinatura da carteira que financiou a reserva. Ter somente uma sessão ou token de visitante não basta.
- O dono pode escolher a conversa do encontrador legítimo mesmo que outra pessoa tenha cadastrado uma carteira antes.

**Não existe hoje uma ação específica de rejeitar, bloquear ou denunciar a conversa.** Ignorar o pedido impede o pagamento, mas não remove a conversa suspeita. `resolve` significa devolução concluída e incrementa o histórico; não serve como rejeição. Com recompensa ativa, ele também exige liberação/cancelamento da reserva.

O controle existente mais próximo é arquivar o objeto: a API passa a bloquear novos avisos e mensagens para toda a tag, inclusive de encontradores legítimos. Isso não seleciona um remetente e não equivale a rejeitar uma conversa.

Um próximo recurso de rejeição precisaria encerrar somente a conversa recusada, impedir novas mensagens nela e preservar as demais conversas, a reserva e o histórico de devoluções. Isso não foi implementado nesta investigação. Os limites existentes também não substituem controles de denúncia ou proteção contra vários remetentes/IPs.

## Verificação automatizada

- TypeScript e 75 testes mobile passaram, incluindo cinco testes do provider real de notificações com o comportamento de emissão nativa do Android, duplicação, rotação, falha/retry, sessão, idioma e expiração.
- Os 17 testes de API/escrow em `apps/api/test/escrow/api.test.js` passaram em banco temporário e LiteSVM. O novo cenário cadastra primeiro uma carteira maliciosa, rejeita tentativas de pagamento e acesso cruzado e confirma que o dono ainda consegue pagar ao encontrador legítimo. Nenhum pagamento ou aviso real foi enviado.
- Passaram no Seeker físico com o APK final: `notifications-conversation.yaml` (inclui `navigation-conversation.yaml`) e `navigation-hierarchy.yaml`. Foram conferidos composer no rodapé e acima do teclado, notificação → conversa → objeto → retorno, reabertura com rascunho, retomada do app, categorias → editor → descarte → formulário preservado, prévia e cancelamento de arquivamento. Capturas e logs estão em `qa/artifacts/network-investigation/maestro-layout/` e `categories-final/`. Não houve envio de mensagens ou salvamento de objetos/categorias nos testes do aparelho.
- O APK foi reconstruído e reinstalado; seu SHA-256 coincide com o instalado: `a24b10a3dd1eb367ea97e91e1449821d87847eec53fb96f862200726550c82a5`. Logcat não apresentou erros React Native/Android Runtime na verificação.
