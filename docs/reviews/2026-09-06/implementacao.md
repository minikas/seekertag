# SeekerTag — implementação da auditoria

6 de setembro de 2026 · Implementação validada em navegador e simuladores

As propostas de confiabilidade, produto e simplificação foram aplicadas ao app Expo e à API. A base visual continua escura, com lavanda do Orkest. O domínio público, a ativação do serviço de e-mail e os testes com aparelhos físicos dependem da etapa externa descrita abaixo.

## Percursos implementados

| Antes | Agora | Evidência |
| --- | --- | --- |
| “Encontrei um objeto” começava abaixo da primeira tela, em y=770. | As três intenções aparecem na entrada; a ação de quem encontra começa em y=133. | [Entrada atual](../../../artifacts/ux-implementation-final/01-entry-390.png) |
| Criação longa, com botão em y=984. | Nome, categoria inicial e botão fixo; personalização em “Mais opções”. Botão em y=494. | [Criação atual](../../../artifacts/ux-implementation-final/03-create-390.png) e teste com Enter |
| Painel vazio com contadores, busca e filtros. | Uma ação para criar a primeira etiqueta; busca e filtros aparecem com os objetos. | Testes de simplificação |
| Criar QR aparecia como objeto “Protegido”. | “QR ativo” e preparo confirmado pela própria pessoa, sem bloquear o QR. | API, persistência e teste da confirmação explícita |
| Um único PDF e várias ações misturadas na ficha. | PDF padrão, compacto ou dobrável; gerenciamento recolhido. | PDFs A4 decodificados e três formatos verificados |
| Retomar a conversa exigia abrir o QR novamente. | “Minhas conversas” recupera os acessos salvos neste aparelho. | Testes de navegador e fluxo nativo |
| Conversas abertas serviam como indicador de novidades. | Contagem de mensagens não lidas; leitura considera o histórico visível. | Teste de mensagem recebida enquanto a pessoa lê o histórico |
| Todo encerramento registrava devolução. | Encerramento por engano, sem devolução ou contato indesejado, separado de confirmar recebimento. | API e interface |

As coordenadas foram medidas em navegador com viewport 390 × 664, sem teclado virtual. Elas não medem o tempo de uso de uma pessoa nem substituem a validação física. A inspeção final produziu dez capturas, não encontrou erros de console ou rolagem horizontal e observou 13 chamadas normais com resposta 200/201. A última mensagem continuou visível ao reduzir a janela de 1440 para 390 pixels. Os [artefatos e métricas](../../../artifacts/ux-implementation-final/metrics.json) são locais e ficam fora do Git.

## Confiabilidade

- Etiquetas, avisos e mensagens usam operações persistidas antes do POST. Uma resposta perdida permite recuperar o mesmo resultado, inclusive depois de reabrir o aplicativo.
- O registro de operações protege também o uso simultâneo de abas. Concluir uma operação não apaga a prova de repetição de outra.
- Uma resposta antiga não apaga um rascunho novo, força a navegação de quem saiu da tela ou encerra a sessão de outra conta.
- A restauração de sessão mantém o acesso salvo durante falha de transporte e tenta reconectar.
- O leitor manual no Android acompanha a abertura do teclado. O botão Voltar primeiro fecha o teclado e mantém o leitor aberto, para conferir o link e continuar. A [captura da regressão](../../../artifacts/native-android/native-reader-keyboard.png) mostra o campo e o botão acima do teclado.
- Se a recuperação de senha tiver sido gravada, mas a resposta se perder, a interface orienta entrar com a senha nova e emitir outro código mediante reautenticação. Uma emissão substituída em outra sessão deixa de bloquear novas emissões.
- A etiqueta continua mostrando que o objeto foi marcado como perdido. O preparo é uma declaração da pessoa; não é detecção física ou rastreamento.

Os testes consultam a API e o SQLite reais. Para reproduzir perdas depois da gravação, o navegador deixa a requisição chegar ao servidor e retém ou descarta apenas sua resposta. Os testes não inventam resultados de sucesso.

A validação nativa identificou duas falhas de teclado no Android que a emulação de navegador não alcançava: o leitor fechava ao tentar esconder o teclado e o botão de envio da conversa ficava coberto. Ambas foram corrigidas. Os percursos Maestro verificam essas interações e guardam [capturas do envio com teclado aberto](../../../artifacts/native-android/composer/native-composer-keyboard.png), além de confirmar rascunho e acesso após reinício.

## Alertas por e-mail

A integração Resend está preparada e permanece desativada na instalação local. Exige um domínio HTTPS permanente e um remetente configurado. A pessoa confirma o próprio endereço com um código recebido por e-mail antes de ativar os alertas.

A fila SQLite agrupa mensagens da mesma conversa, repete falhas temporárias e cancela avisos pendentes quando a mensagem foi lida, o aviso foi encerrado ou a pessoa desativou o recebimento. O conteúdo da conversa e as credenciais não entram no e-mail. O link abre a conversa do dono depois do login.

Os testes de API e interface capturam o transporte em memória. Eles cobrem verificação, perda de resposta, persistência, privacidade, repetição e desativação, sem enviar mensagens externas. Um e-mail aceito pelo provedor ainda pode não chegar à caixa de entrada; validar o recebimento real faz parte da ativação.

Configuração e limites operacionais estão no [README](../../../README.md) e no [contrato da API](../../../server/API.md).

## Validação e entrega

Passaram 32 testes unitários, 42 testes de API e 85 execuções do Playwright, totalizando 159 verificações automatizadas. A matriz final não teve falhas, skips ou retries: 2 contratos HTTP, 28 Chromium, 27 WebKit desktop e 28 WebKit com perfil iPhone. Também passaram cinco fluxos Maestro nos pacotes atualizados: três no simulador iPhone 17e/iOS 26.5 e dois no emulador Pixel 7/Android 16. Os resultados completos estão no [README](../../../README.md#estado-da-validação).

O banco da instalação local recebeu migrações aditivas, depois de um backup consistente. As 57 contas, 46 etiquetas, 14 conversas e 29 mensagens existentes foram preservadas; a verificação de integridade retornou `ok`.

A instalação está disponível em [SeekerTag na rede local](http://192.168.1.44:4318), com [download do APK aprovado](http://192.168.1.44:4318/SeekerTag-preview.apk). O computador e o celular precisam estar na mesma rede. O arquivo servido teve seu SHA256 conferido contra o APK instalado nos testes. O ambiente Android foi restaurado depois da validação, e apenas o emulador criado para esta tarefa foi removido.

## Etapa externa

Ainda faltam o domínio HTTPS escolhido, a configuração do remetente, o recebimento real dos alertas e a validação de QR impresso, NFC e carteira em aparelhos físicos. Instalar em iPhone físico ou distribuir por TestFlight requer assinatura e provisionamento Apple.

O teste exploratório com cinco pessoas proposto na auditoria continua como próximo passo de pesquisa. Não houve pesquisa com usuários nesta implementação.
