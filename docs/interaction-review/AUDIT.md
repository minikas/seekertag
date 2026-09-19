# SeekerTag — análise de hierarquia e interações

Data: 19/09/2026. Escopo: interface móvel em `apps/mobile`, caminhos de entrada e fronteiras com interfaces externas. Método: leitura dos componentes ativos, estados, condicionais, handlers e código instalado da biblioteca; pesquisa em documentação primária e GitHub; protótipo web independente. Não houve reprodução dos achados no dispositivo Android nesta etapa.

## Diagnóstico

Há três fenômenos que podem parecer o mesmo “switch”:

1. **Desmontagem pelo aplicativo.** A tela anterior sai da árvore React. `stackBehavior="push"` não tem como preservá-la.
2. **Troca de conteúdo dentro do mesmo componente.** Pode ser correta numa sequência de revisão, mas enfraquece a hierarquia quando usada como navegação entre páginas sem histórico ou preservação de scroll.
3. **Sobreposição existente com pouca evidência visual.** Um filho com a mesma altura pode ocultar o pai embora ele continue montado. Recompensa já usa `push`; não classificá-la como `switch` técnico.

`Sheet` em `ui.tsx` é um `Modal` nativo de tela inteira. `Screen` é uma página comum. `ScreenBottomSheet` é um bottom sheet local dentro da superfície existente. `AccountActionSheet` e `RewardEditorSheet` são `BottomSheetModal` com `push`. Os nomes dos componentes não bastam para saber sua hierarquia.

## Achados prioritários

### 1. Editar desmonta os detalhes do objeto

**Evidência:** `Dashboard.tsx:137–138` monta o formulário e exige `selected && !form` para montar `TagDetails`. O componente de detalhes é removido durante a edição. Cancelar recria-o; posição e estados locais não são preservados por esse caminho.

**Direção:** manter o detalhe no histórico e hospedar a edição no contexto correto da tela. Fechar o menu de opções ao iniciar edição é adequado; remover o objeto de origem não é. Salvar atualiza o objeto e fecha a tarefa.

### 2. Consultar o objeto descarta o rascunho da conversa

**Evidência:** `Dashboard.tsx:139` chama `setChat(undefined)` antes de `setSelected(tag)`. `Conversation.tsx` guarda a mensagem no formulário local e inicializa `body` vazio. `conversationTag` permite reabrir a conversa, mas não guarda a mensagem não enviada nem o estado visual.

**Direção:** conversa como destino de conteúdo com consulta contextual do objeto; rascunhos indexados por conversa. A simulação permite digitar antes de abrir o objeto e verificar a diferença no retorno. A perda é inferida diretamente do ciclo de montagem; não é um resultado de teste no aparelho.

### 3. Categorias substitui a superfície do formulário

**Evidência:** `TagForm.tsx:218` retorna `Categories` no lugar dos sheets. Os hooks do `TagForm` continuam montados: **os campos não são perdidos**. Entretanto, o sheet e a superfície de scroll saem da árvore. O efeito em `128–142` também encerra e reapresenta o modal. `Categories.tsx:34` troca a lista pelo editor.

**Direção:** painel de categorias contextual ao formulário; criar/editar categoria como etapa interna desse painel, com retorno à seleção. A partir da Conta, categorias é uma página; o editor é uma tarefa sobre essa lista. A mesma entidade pode ter apresentações diferentes conforme a origem.

### 4. Prévia de visitante perde o caminho de volta

**Evidência:** `TagDetails.tsx:180–183` abre o deep link. O ternário em `App.tsx:77` troca `Dashboard` por `Found`; `goHome` limpa a rota e recria o dashboard. Isso perde seleção, abas e estados locais da árvore autenticada anterior.

**Direção:** prévia interna com retorno explícito ao objeto. Link externo e QR continuam tendo entrada própria; registrar origem e destino de fallback. Preservar a verificação `viewerIsOwner`, sem habilitar o dono a avisar a si mesmo.

### 5. Caminho de recompensa ausente no chat do encontrador por notificação

**Evidência:** Dashboard abre `Conversation` com `presentation="sheet"` e `finder={finderChat}`. O botão de detalhes do encontrador está no bloco `!sheet` de `Conversation.tsx:32–35`; o `headerRight` do dashboard é condicionado a `!finderChat`. Esse caminho não oferece o mesmo acesso à recompensa e à carteira que a conversa aberta via Found.

**Direção:** acesso consistente aos dados do objeto/recompensa em todas as entradas da conversa, com guarda de rascunho e retorno ao contexto correto. Corrigir essa paridade junto da hierarquia da conversa.

### 6. Voltar e camadas ativas têm contratos diferentes

**Evidência:** `Screen` e `Sheet` tentam fechar teclado antes da tela. `AccountActionSheet` chama `dismiss()` diretamente em seu BackHandler. Em `TagDetails`, o handler `close()` prioriza `overlay` e `page`, mas não `pendingStatus`; a confirmação é renderizada como conteúdo, não como `overlay`. A origem não recebe o mesmo isolamento de acessibilidade das demais sobreposições.

**Risco a validar no aparelho:** Voltar numa confirmação de status pode executar o fechamento do detalhe, em vez de fechar só a confirmação. O wireframe marca explicitamente essa limitação; comportamento de dispatch nativo não foi medido.

**Direção:** contrato único: teclado visível → fechar teclado; subtarefa ativa → fechar subtarefa; página → voltar um nível; raiz → comportamento da plataforma. Durante operação em curso, seguir a política real de cancelamento/retomada, sem liberar descarte acidental. Manter apenas a camada ativa acessível ao TalkBack.

### 7. Entradas externas podem interromper rascunhos

**Evidência:** o efeito de `notification` em `Dashboard.tsx:58–62` limpa conta, seleção e formulário. Formulários também permitem dismiss sem confirmação de alterações, fora dos estados ocupados.

**Direção:** separar destino de notificação e tarefa atualmente aberta. Preservar ou confirmar descarte de rascunho antes da mudança. Notificação aberta dentro da lista já mantém a lista montada, e isso deve ser preservado.

## O que manter

- Troca entre abas do mesmo nível; o ajuste é preservar estado e melhorar seus rótulos, sem transformar abas em uma pilha de sheets.
- Preferências, recebimento de etiquetas, filtro da lista, NFC e menus contextuais já sobrepostos à origem.
- Seletores de moeda/unidade já usam `push`.
- Etapas de ajuda e revisão no mesmo painel: trocar conteúdo é apropriado quando é a mesma tarefa.
- Câmera e interfaces externas de carteira, OAuth, documentos e compartilhamento precisam de apresentação própria e retorno explícito.
- Confirmação de devolução e pagamento já possui revisão contextual; conservar seus estados de rede, destinatário, custos, permissões e idempotência.
- Criação do objeto ocorre antes da preparação do depósito, permitindo retentar no mesmo objeto. A proposta não altera essa regra.

## Hierarquia proposta

| Relação | Apresentação | Exemplo | Retorno esperado |
| --- | --- | --- | --- |
| Destinos irmãos | Abas | Meus objetos / Conversas / Tags | Estado independente por aba |
| Conteúdo subordinado | Página no histórico | Conta → Categorias; lista → conversa | Página anterior, mesma posição |
| Tarefa ligada ao conteúdo | Sheet ou modal da página | Editar objeto; transferir | Objeto preservado |
| Escolha curta | Painel contextual | Moeda, unidade, filtro, tema | Fecha só seletor; aplica escolha |
| Próxima etapa da tarefa | Conteúdo interno com retorno | Valor → revisão; prazo de renovação | Volta à etapa anterior, sem nova torre de modais |
| Decisão destrutiva | Confirmação localizada | Excluir categoria; transferir posse | Cancelar mantém tarefa e campos |
| Entrada externa | Destino com origem/fallback | QR, notificação, link | Retorno definido e rascunho protegido |
| Interface do sistema | Apresentação nativa | Carteira, câmera, compartilhar | Mesma operação e contexto |

Na simulação, uma borda/cabeçalho do pai aparece quando há espaço. Isso é uma escolha da proposta, não uma exigência universal de plataforma. Em teclado aberto, fontes grandes ou tela pequena, o filho pode ocupar a tela inteira: título, Voltar, estado e origem continuam sendo o contrato. Não fixar alturas em pixels no aplicativo com base no wireframe.

## Implicações de implementação futura

1. Tornar explícitos origem, destino e histórico, reduzindo combinações de booleans em Dashboard. Páginas e tarefas têm ciclos de vida separados.
2. Preservar detalhes durante edição e rascunhos de chat por `reportId`. Corrigir consulta de objeto e prévia interna.
3. Unificar a apresentação de conversa do dono/encontrador nas entradas por lista, notificação, QR e deep link.
4. Revisar a hospedagem de sheets: o `Sheet` atual cria seu próprio `BottomSheetModalProvider` dentro de um Modal nativo. Um portal do provider raiz não deve ser simplesmente deixado atrás desse Modal. Projetar a camada proprietária antes de trocar condicionais.
5. Remover a necessidade de desmontar o formulário ao abrir categorias sem reintroduzir o problema Android de teclado documentado no comentário do próprio `TagForm`. Validar uma única superfície ativa para o IME.
6. Padronizar foco, acessibilidade, Back, descarte de rascunho, gestos e operações ocupadas. Ajustar alturas somente depois da hierarquia estar correta.
7. Avaliar native stack/React Navigation como opção de implementação, sem presumir migração total ou compatibilidade automática de uma versão. O protótipo não instala bibliotecas.

## Critérios de aceitação no Android

- Editar e cancelar devolve ao mesmo objeto, com posição anterior; salvar atualiza o mesmo objeto.
- Abrir categorias pelo formulário preserva nome, nota, mensagem, recompensa, posição e foco; salvar uma categoria não cria outro objeto.
- Digitar no chat → consultar objeto → voltar mantém rascunho e posição. Verificar dono e encontrador, por todas as entradas.
- Abrir a prévia interna → voltar retorna ao objeto, não ao início.
- Back com teclado aberto não elimina rascunho nem fecha uma camada indevida; Back na confirmação fecha somente a confirmação.
- Preferências e seletores fecham uma única camada e restauram foco; TalkBack não alcança conteúdo coberto.
- Notificação durante edição protege o rascunho; notificação em abertura fria tem fallback coerente.
- Campos e ação principal permanecem alcançáveis com teclado, fontes ampliadas e telas pequenas; não há dois gerenciadores de teclado competindo.
- Cancelar login/carteira volta à tarefa; transação enviada é reconciliada sem duplicação; sucesso não é confundido com aprovação ainda pendente.
- Scanner trata permissão negada e link manual; NFC diferencia espera, cancelamento, erro e sucesso físico real.
- Após qualquer alteração que afete `apps/mobile`, gerar e reinstalar APK no dispositivo ADB antes da entrega, como exige `AGENTS.md`.

## Pesquisa e limites

As referências abaixo embasam critérios, não certificam o comportamento do SeekerTag. A análise do produto é nossa aplicação dessas referências ao código local.

- [Android: níveis e padrões de navegação](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns).
- [Android: navegação e histórico](https://developer.android.com/guide/navigation/backstack).
- [Apple: Explore navigation design for iOS, WWDC22](https://developer.apple.com/videos/play/wwdc2022/10001/). Usado para a distinção entre conteúdo hierárquico e tarefas; a proposta é adaptada ao Android.
- [Gorhom: props de modal](https://gorhom.dev/react-native-bottom-sheet/modal/props). A nota de disponibilidade apenas em v3 não foi tratada como fonte definitiva.
- [GitHub: provider Gorhom v5.2.14](https://github.com/gorhom/react-native-bottom-sheet/blob/v5.2.14/src/components/bottomSheetModalProvider/BottomSheetModalProvider.tsx) e [constantes da mesma versão](https://github.com/gorhom/react-native-bottom-sheet/blob/v5.2.14/src/components/bottomSheetModal/constants.ts). Confirmados também em `node_modules`: padrão `switch`; `switch` minimiza e `replace` dispensa.
- [React Navigation: modais](https://reactnavigation.org/docs/modal/) e [exemplo oficial NativeStack no GitHub](https://github.com/react-navigation/react-navigation/blob/main/example/src/Screens/NativeStack.tsx).
- [W3C: padrão de diálogo modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Referência web para foco e isolamento; o Android exige validação nativa equivalente.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), lido antes da escrita do protótipo.

Componentes de aparência, traduções, modelos e funções de API foram usados como suporte quando necessário, não contados como novas telas. `ProfileMenu.tsx` está sem importação e não representa um caminho ativo. O inventário cobre famílias de interação da interface; não é uma auditoria de segurança, consistência financeira, API, desempenho ou matriz exaustiva de todas as combinações possíveis de erro.

## Inventário por interação

A tabela a seguir é a mesma apresentada no site, derivada de `data.js`.


| Interação | Decisão | Atual | Proposta | Evidência |
| --- | --- | --- | --- | --- |
| Início ↔ Conversas ↔ Tags | refinar | Troca de aba; início/conversas compartilham scroll e switchTab o zera. | Manter troca; preservar estado por aba e adicionar rótulos. | Dashboard.tsx:26–31, 56, 131 |
| Estatísticas / Ver todos / Arquivados | refinar | browseTags troca para Tags e muda key. | Destino e filtro explícitos; não recriar a lista sem necessidade. | Dashboard.tsx:57, 84, 100, 105, 127 |
| Busca / limpar / atualizar lista | manter | Busca e filtros locais; pull-to-refresh. | Manter feedback local, vazio, erro e rolagem coerentes. | ObjectsScreen.tsx:25–74 |
| Lista → filtro | manter | ScreenBottomSheet sobre a lista. | Fechar só filtro ao selecionar; manter foco de origem. | ObjectsScreen.tsx:78–93 |
| Lista → etiqueta / QR | refinar | Sheet é um Modal nativo de tela inteira. | Detalhe em página com histórico; QR continua conteúdo. | Dashboard.tsx:138 · ui.tsx:66–83 |
| Etiqueta → opções | manter | Painel dentro do Modal do detalhe. | Manter menu contextual; consumir menu ao escolher tarefa. | TagDetails.tsx:246–255 |
| Etiqueta → editar | corrigir | selected && !form desmonta detalhe. | Edição modal sobre detalhe preservado. | Dashboard.tsx:137–138 |
| Adicionar objeto → salvar | refinar | Formulário em sheet; ao salvar abre detalhe. | Manter tarefa; guardar rascunho e definir destino de sucesso. | TagForm.tsx:148–174 · Dashboard.tsx:137 |
| Formulário → gerenciar categorias | corrigir | Retorno antecipado remove sheet; hooks guardam os campos. | Subtarefa contextual sem desmontar formulário. | TagForm.tsx:128–142, 218 |
| Categorias → criar / editar | corrigir | CategoryEditor substitui lista por retorno condicional. | Pela Conta: editor modal. Pelo formulário: etapa interna do painel. | Categories.tsx:34 |
| Categoria → excluir / realocar | manter | Confirmação em ScreenBottomSheet; exige destino se há objetos. | Manter confirmação sobre editor e preservar campos ao cancelar. | Categories.tsx:82–90 |
| Formulário → recompensa | refinar | push explícito, alturas iguais às do formulário. | Manter push; origem visível quando houver espaço e retorno explícito. | RewardEditorSheet.tsx:16, 34 |
| Recompensa → moeda | manter | AccountActionSheet push. | Manter escolha curta, retorno e moeda selecionada. | RewardFields.tsx:86 |
| Recompensa → unidade do prazo | manter | AccountActionSheet push. | Manter escolha curta e validação no campo. | RewardFields.tsx:36 |
| Valor / percentuais / conversão | manter | Estado e validação inline; consulta de saldo e estimativa. | Não criar modais para alterações de campo. | RewardFields.tsx:54–85 |
| Salvar → revisão de depósito | manter | Salva objeto antes da operação; revisão no mesmo sheet. | Manter etapas e identidade durável para não duplicar objeto. | TagForm.tsx:148–174, 274–287 |
| Revisão → assinatura externa | manter | Abre carteira; operação possui reconciliação. | Retomar mesma operação após retorno, cancelamento ou interrupção. | useReward.ts · platform/wallet-return.ts |
| Reserva → renovar | refinar | Outro sheet sobre recompensa; unidade pode adicionar mais um. | Renovação como etapa interna, mantendo voltar à reserva. | TagForm.tsx:298–324 |
| Reserva → cancelar e recuperar | refinar | Confirmação push; revisão volta ao painel de recompensa. | Confirmação localizada e revisão da mesma tarefa. | TagForm.tsx:326–333 |
| Conversa do dono → abrir | refinar | AccountActionSheet com histórico de mensagens e compositor. | Página de conversa para uso longo e teclado; preservar rascunho. | Dashboard.tsx:139–141 · Conversation.tsx |
| Conversa do dono → ver objeto | corrigir | setChat(undefined) desmonta Conversation. | Consulta sobre conversa; rascunho por reportId. | Dashboard.tsx:138–140 |
| Enviar mensagem / erro / resolução | manter | Envio inline, loading, erro e estado devolvido. | Manter sem abrir outra tela; não zerar rascunho ao consultar objeto. | Conversation.tsx:26–56 |
| Notificações → conversa interna | refinar | Lista fica montada sob chat em sheet. | Conversa no histórico; voltar à mesma notificação/lista. | Dashboard.tsx:129, 139 · NotificationsScreen.tsx |
| Push externo → conversa | corrigir | Zera conta, seleção e formulário ao consumir target. | Resolver rascunho ativo e guardar origem antes de trocar de tarefa. | Dashboard.tsx:58–62 · App.tsx:75 |
| Notificações: permissão / ler / mais | manter | Ações inline; permissão do sistema; paginação. | Manter indicadores locais e não mudar destino ao marcar lidas. | NotificationsScreen.tsx:21–50 |
| Etiqueta → ver como visitante | corrigir | Deep link troca Dashboard por Found; volta ao início. | Prévia com retorno ao objeto; entrada externa independente. | TagDetails.tsx:180–183 · App.tsx:77 |
| Scanner / câmera negada / link manual | refinar | Modal inteiro; resultado substitui rota raiz. | Scanner inteiro; fechar leitura após resultado e registrar origem. | platform/QrScanner.tsx · App.tsx:73 |
| Link externo / QR → Found | refinar | Rota de entrada sem pilha; Voltar vai ao início. | Definir fallback de retorno e respeitar sessão e dono. | App.tsx:35–48, 77 · Found.tsx:31–61 |
| Encontrador → avisar dono → chat | refinar | Rota muda de code para chatId; conversa anônima é persistida. | Conversa ligada ao objeto, com aviso já enviado e sem duplicação. | Found.tsx:64 · App.tsx:77 |
| Encontrador → salvar conversa na conta | manter | AccountActionSheet com provedores; OAuth externo. | Manter sheet e preservar conversa quando login for cancelado. | Found.tsx:65–76, 128–135 |
| Encontrador → recompensa → carteira | refinar | Detalhes e formulário de recebimento em sheets empilhados. | Carteira como etapa do painel de recompensa; mostrar destino. | Conversation.tsx:57–61 · ReceivingWalletSheet.tsx |
| Conversa finder aberta por notificação | corrigir | presentation=sheet suprime cabeçalho que contém Ver objeto; headerRight é só do dono. | Oferecer acesso à recompensa/carteira em ambas as apresentações. | Conversation.tsx:32–35 · Dashboard.tsx:139 |
| Dono → finalizar devolução e pagar | manter | Confirmação e revisão em AccountActionSheet. | Manter decisão explícita, rede, destinatário e estado de confirmação. | RewardReleaseSheet.tsx:19–26 |
| Etiqueta → detalhes informativos | refinar | page=info e contentKey remontam ScrollView. | Página filha com retorno à posição do QR. | TagDetails.tsx:248, 266, 292–296 |
| Etiqueta → transferir / reautenticar | refinar | Troca conteúdo interno; exige senha/provedor. | Tarefa sobre objeto, revisão do destinatário e proteção de rascunho. | TagDetails.tsx:218–234, 297–306 |
| Perdido / arquivar / restaurar / devolver | refinar | Confirmação existe; pendingStatus fora de overlay; Back não prioriza estado. | Confirmação é a camada ativa; Back fecha só ela. Verificar em ADB. | TagDetails.tsx:115–121, 308–317 |
| Gravar NFC / cancelar / erro | manter | ScreenBottomSheet sobre QR; cancelNfcWrite no fechamento. | Manter processo contextual e feedback verdadeiro do hardware. | TagDetails.tsx:186–213, 256–264 |
| Baixar PDF / compartilhar PDF ou link | manter | Interfaces nativas de documento e compartilhamento. | Manter ida e volta ao objeto e feedback local. | TagDetails.tsx:157–178 |
| Conta → formas de entrar / categorias | refinar | Screen troca contentKey ou retorna Categories. | Páginas filhas em histórico com estado preservado. | Account.tsx:38–42 |
| Conta → tema / idioma / rede | manter | AccountActionSheet push; rede indisponível fica desabilitada. | Manter seleção curta; não prometer mudança de rede. | Account.tsx:66–78 · PreferenceOptions.tsx |
| Conta → receber etiquetas / copiar ID | manter | Painel com ID e feedback de cópia. | Manter ação pequena e contextual. | ReceiveLabels.tsx · Account.tsx:66–67 |
| Vincular acesso / copiar carteira | manter | Provedor externo e feedback inline de cópia. | Retomar a mesma página de formas de entrar. | platform/WalletPanel.tsx:26–55 |
| Boas-vindas → métodos → login | manter | Métodos sobre Auth; login troca raiz. | Manter sheet e troca de raiz após autenticar. | Auth.tsx:41–50 · App.tsx:77 |
| Sair / sessão expirada / recuperação | manter | Sai da raiz autenticada; chave em Modal não dispensável. | Limpar pilhas privadas; confirmação explícita da chave se aplicável. | App.tsx:71–80 · Account.tsx:38 |
| Ajuda → próxima / anterior / ocultar | refinar | Passos no mesmo sheet; X significa não mostrar novamente. | Manter passos; separar fechar de desativar a dica permanentemente. | HelpSheet.tsx:33–44 |
| Voltar / teclado / foco / rascunhos | corrigir | Handlers distribuídos; AccountActionSheet dispensa direto; formulário fecha sem revisão de alterações. | Prioridade definida: teclado, camada ativa, página. Proteger rascunhos sujos e restaurar foco. | Screen.tsx:10–16 · AccountActionSheet.tsx:23 · TagForm.tsx:120–125 |
