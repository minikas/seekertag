# Implementação da hierarquia

19/09/2026. Implementação local da proposta do `AUDIT.md`, sem commit ou push.

## Comportamento entregue

- Detalhes do objeto permanecem montados durante edição. A página de informações e a prévia de visitante têm retorno ao objeto. A prévia mostra apenas os campos públicos.
- Categorias abre sobre o formulário. Criar/editar categoria é uma etapa desse painel; pela Conta, a lista é uma página e o editor é uma tarefa sobre ela.
- Conversa é uma página. Consultar o objeto mantém a conversa e o rascunho. Rascunhos são separados por conversa e papel, ficam em memória durante a sessão e são removidos após envio bem-sucedido ou troca de usuário.
- O encontrador tem acesso aos detalhes/recompensa também ao entrar por notificação. Informar carteira e renovar reserva são etapas dos respectivos painéis.
- Abas mantêm suas listas e posições de rolagem, com rótulos visíveis. Conta mantém sua página principal e rolagem sob as páginas filhas.
- Voltar fecha primeiro o teclado, depois a tarefa ou página ativa. Formulários alterados confirmam descarte. Operações ocupadas mantêm suas guardas existentes.
- Notificações aguardam a conclusão da tarefa atual. Links externos aguardam os painéis e mantêm a raiz anterior montada. Após fechar a entrada externa, o contexto anterior volta a aparecer.
- Conteúdo coberto sai da árvore de acessibilidade. O navegador guarda o controle que abriu cada camada para restaurar o foco quando um leitor de tela está ativo.
- Fechar a ajuda e desativar a dica permanentemente são ações separadas.

## Estrutura

`Navigation.tsx` e `navigation.model.ts` centralizam a prioridade de Voltar e a identidade das camadas. Descendentes ficam acima dos pais; uma página irmã mais nova cobre a árvore anterior. Isso evita depender da ordem de execução dos efeitos do React.

As páginas usam a mesma janela Android e o mesmo `BottomSheetModalProvider`. `Sheet` é a superfície de página; `AccountActionSheet`, `TagForm` e `RewardEditorSheet` usam o portal compartilhado. Cada modal repassa explicitamente seu contexto de navegação dentro do conteúdo do portal. O scanner e as demais páginas globais ficam dentro da área segura.

Não foram adicionadas dependências nem alterados endpoints, contratos de transação ou código nativo. A revisão de depósito e a criação durável do objeto antes de preparar a recompensa permanecem existentes.

## Verificação

- TypeScript: `npm run typecheck --workspace=@seekertag/mobile`.
- 75 testes unitários: `npm run test --workspace=@seekertag/mobile`, incluindo ordem de retorno, tarefa ocupada, foco por origem, isolamento dos rascunhos, registro de push e handlers reais de carregamento/envio da conversa. Envio com falha mantém o texto; sucesso limpa o rascunho.
- Fluxos Android reproduzíveis em `apps/mobile/tests/android/navigation-*.yaml`. Usam dados existentes e não enviam mensagens, salvam objetos, transferem posse ou confirmam transações.
- Evidências locais em `qa/artifacts/navigation-implementation/`, ignoradas pelo Git.
- No Seeker físico: formulário → categorias → criação cancelada → formulário mantém o texto; descarte confirmado retorna ao objeto; prévia retorna ao objeto; Back cancela apenas a confirmação de arquivamento. Conta → categorias → editor e Conta → aparência retornam um nível de cada vez.
- No Seeker com o APK final: a busca por `Backpack` permaneceu ao alternar Tags → Conversas → Tags; limpar a busca e voltar ao início também passou. O SHA-256 do APK instalado foi comparado ao arquivo gerado e é idêntico.
- No emulador: métodos de acesso fecham para a entrada; scanner respeita a área segura; Back fecha o teclado mantendo o link digitado e depois fecha a página.
- A árvore de acessibilidade nativa comprimida foi inspecionada com Categorias aberta: conteúdo do formulário e do objeto cobertos não aparece nela. A restauração audível do foco ainda requer uma sessão manual com TalkBack.
- Os 429/timeouts encontrados inicialmente foram rastreados a um loop de registro de push no cliente e corrigidos. O fluxo completo de notificações → conversa → objeto → retorno, reabertura com rascunho e retomada do app passou no Seeker com a API pública. A investigação e os ajustes de composer/categorias estão em [PUSH-AND-CONVERSATION.md](PUSH-AND-CONVERSATION.md).

Build e reinstalação:

```sh
EXPO_PUBLIC_API_URL=https://api-seeker.viralizai.co/api npm run build:android -- --incremental
adb -s SM02G40619112679 install -r artifacts/SeekerTag-preview.apk
```

O APK usa o backend público configurado, sem depender do Metro. A simulação continua em <http://localhost:4179>; o lado anterior documenta o código analisado antes desta implementação.

APK final gerado em 19/09/2026, com correções de push, composer e carregamento de categorias. SHA-256: `a24b10a3dd1eb367ea97e91e1449821d87847eec53fb96f862200726550c82a5`. O hash do APK instalado no Seeker é idêntico.
