# Auditoria técnica — SeekerTag

**Data:** 6 de setembro de 2026. **Base:** `b7ee44d0533dbf4fec8dca1c63c2506a36331c05`.

Foram confirmados **seis achados**, principalmente em respostas tardias ou perdidas. Os controles de autorização do servidor não apresentaram bypass nesta revisão. Os 68 testes automatizados e três fluxos nativos registrados no README continuam sendo evidência dos cenários que exercitam; não cobrem todos os estados de uma operação parcialmente concluída.

A revisão leu `AGENTS.md`, fonte de API/autenticação, armazenamento, navegação e rede, e os testes existentes. As reproduções usaram a API real com SQLite em memória, portas efêmeras de loopback e um proxy HTTP temporário. O proxy encaminha a requisição integralmente ao servidor e só retém ou descarta a resposta depois de recebê-la: não substitui regras de negócio nem respostas da API por fixtures. Os cenários de interface usaram Chromium e o export web local já existente, sem refazer builds ou iniciar emuladores. Nenhuma base de usuário, fonte ou teste do produto foi alterado. As verificações abaixo não foram adicionadas à contagem de 68 testes.

| ID | Severidade | Achado | Evidência |
|---|---|---|---|
| T1 | Alta — P1 | Repetir um POST cuja resposta se perdeu duplica avisos e mensagens | Reproduzido na API real |
| T2 | Média — P2 | Resposta perdida na recuperação deixa o novo código de recuperação inacessível | Reproduzido na API real |
| T3 | Média — P2 | Um 401 tardio da conta anterior encerra a sessão local da conta nova | Reproduzido no navegador |
| T4 | Média — P2 | Uma resposta de envio apaga o próximo rascunho digitado durante a espera | Reproduzido no navegador |
| T5 | Média — P2 | Resposta tardia de aviso do finder desfaz a navegação escolhida pelo usuário | Reproduzido no navegador |
| T6 | Média — P2 | Falha transitória na restauração de sessão deixa o usuário no cadastro até recarregar | Reproduzido no navegador |

## T1 — POST confirmado no servidor pode ser repetido como uma nova operação

**Local:** [server/app.js:361](/Users/kas/seekertag/server/app.js:361), [server/app.js:206](/Users/kas/seekertag/server/app.js:206), [src/api.ts:12](/Users/kas/seekertag/src/api.ts:12), [src/Found.tsx:11](/Users/kas/seekertag/src/Found.tsx:11), [src/Conversation.tsx:11](/Users/kas/seekertag/src/Conversation.tsx:11).

**Reprodução:** criar uma etiqueta sintética; enviar `POST /public/tags/:code/reports`; deixar o servidor concluir e fechar o socket do proxy antes de entregar a resposta. Repetir exatamente o corpo enviado. Consultar `/reports` autenticado como dono. Repetir o experimento com `POST /reports/:id/messages` e consultar a conversa.

**Resultado observado:** duas conversas para o mesmo aviso; duas mensagens com o mesmo texto para uma resposta repetida. O primeiro aviso cria uma capacidade que o finder nunca recebeu. Cada repetição gera outro ID e outra capacidade. A API não aceita uma identidade estável da operação nem consulta um resultado anterior. O erro de transporte apresentado ao cliente não distingue “não enviado” de “gravado, resposta perdida”.

**Impacto:** o dono pode responder na primeira conversa enquanto o finder acompanha apenas a segunda. Avisos duplicados consomem cotas e confundem a coordenação da devolução. Mensagens podem ser repetidas após uma única intenção de envio. Não foi observado acesso indevido entre contas.

**Correção proposta:** gerar e persistir um identificador de operação no cliente antes do envio; usar restrição única e deduplicação transacional no servidor; repetir a mesma operação até seu resultado ser conhecido. Para o aviso anônimo, o protocolo também precisa permitir recuperar o acesso ao resultado com a mesma prova secreta da operação. Não deduplicar somente por texto: duas mensagens iguais podem ser legítimas. Testar a falha depois do commit, além da queda antes da entrega.

**Lacuna de cobertura:** [network-resilience.spec.ts:47](/Users/kas/seekertag/tests/e2e/network-resilience.spec.ts:47) desliga a rede antes do POST e verifica zero registros antes do retry. Esse teste está correto, mas deliberadamente não alcança o estado reproduzido aqui. O próprio README já distingue essa limitação.

## T2 — Recuperação consome a chave antes de garantir que a substituta foi recebida

**Local:** [server/app.js:264](/Users/kas/seekertag/server/app.js:264), [server/app.js:254](/Users/kas/seekertag/server/app.js:254), [src/Auth.tsx:15](/Users/kas/seekertag/src/Auth.tsx:15), [App.tsx:29](/Users/kas/seekertag/App.tsx:29).

**Reprodução:** criar conta sintética e guardar o código inicial; enviar `/auth/recover` com esse código e uma senha nova; descartar a resposta depois de a API concluir a transação. Repetir a recuperação com os mesmos dados. Fazer login com a senha nova.

**Resultado observado:** o retry retorna `401`, a sessão anterior retorna `401`, e o login com a senha nova retorna `200`. Entretanto, o login não retorna o código novo e não existe rota para emitir outra chave mediante reautenticação. O servidor guarda apenas o hash da chave recém-gerada.

**Impacto:** a conta permanece acessível pela senha nova, mas o usuário perdeu seu único mecanismo de recuperação futura sem ter visto a chave substituta. Não é um bloqueio imediato da conta; torna-se definitivo se a pessoa posteriormente esquecer essa senha. A mesma arquitetura merece teste quando a guarda local falha após uma resposta bem-sucedida, mas esse segundo gatilho não foi reproduzido nesta auditoria.

**Correção proposta:** oferecer emissão de uma nova chave mediante sessão válida e confirmação da senha atual, com confirmação explícita de guarda; tratar a recuperação como operação retomável. Uma alternativa é uma etapa de confirmação para a rotação. Preservar o uso único da chave antiga sem criar uma janela permanente de replay ou armazenar segredos em claro.

**Lacuna de cobertura:** os testes atuais validam rotação, uso único, concorrência e revogação quando a resposta é recebida. Não descartam a resposta após a rotação.

## T3 — Resposta da conta A apaga uma sessão válida da conta B

**Local:** [src/Dashboard.tsx:14](/Users/kas/seekertag/src/Dashboard.tsx:14), [src/Dashboard.tsx:15](/Users/kas/seekertag/src/Dashboard.tsx:15), [App.tsx:26](/Users/kas/seekertag/App.tsx:26).

**Reprodução:** abrir o dashboard da conta A; revogar exclusivamente a sessão sintética de A no SQLite isolado; reter as respostas reais `401` de `/tags` e `/reports` geradas pelo polling de A. Sair pela interface e entrar na conta B. Confirmar login de B e presença de seu token no armazenamento da aba. Liberar as respostas antigas de A.

**Resultado observado:** a interface volta ao cadastro e `sessionStorage['seekertag.owner']` é apagado. A sessão de B continua retornando `200` diretamente na API. A falha é a invalidação local de uma sessão válida por um callback pertencente a outra sessão.

**Impacto:** logout inesperado após troca de conta, com perda do contexto de trabalho. Pode também ocorrer quando uma resposta de sessão revogada chega depois de uma nova autenticação. Não houve vazamento dos dados da conta A para B nem falha na autorização da API.

**Causa e correção proposta:** o cleanup do dashboard cancela apenas o intervalo; requisições pendentes ainda chamam `onExpired()`, que limpa a sessão ativa sem conferir qual token recebeu `401`. Cancelar/ignorar operações de componentes desmontados e associar a invalidação ao token ou geração que originou a requisição. A limpeza no armazenamento deve conferir que ainda está removendo a mesma sessão.

**Lacuna de cobertura:** há testes de expiração e recuperação da conta ativa, mas não de uma resposta antiga cruzando uma nova autenticação.

## T4 — A confirmação do primeiro envio apaga texto digitado depois

**Local:** [src/Conversation.tsx:11](/Users/kas/seekertag/src/Conversation.tsx:11), [src/Conversation.tsx:21](/Users/kas/seekertag/src/Conversation.tsx:21).

**Reprodução:** enviar “First message”; reter sua resposta real depois do commit; enquanto o botão indica envio, substituir o campo por “Second draft typed while the first sends”; liberar a resposta retida.

**Resultado observado:** o segundo texto desaparece do campo, que passa a `''`, sem ter sido enviado ou persistido. O campo continua editável durante a requisição e a conclusão chama `setBody('')` incondicionalmente para a conversa atual.

**Impacto:** perda de texto do usuário em conexão lenta. Afeta o componente compartilhado por dono e finder; a reprodução foi feita na interface do dono.

**Correção proposta:** limpar o campo somente se ainda contiver a revisão de rascunho enviada, ou separar a mensagem em trânsito do rascunho seguinte. Bloquear a edição durante o envio também evita a perda, embora limite a interação. Não basta comparar apenas o ID da conversa.

**Lacuna de cobertura:** o teste offline verifica preservação após falha, mas não digitação concorrente a um envio que termina com sucesso.

## T5 — Aviso pendente redireciona o finder após ele sair da tela

**Local:** [src/Found.tsx:11](/Users/kas/seekertag/src/Found.tsx:11), [src/Found.tsx:13](/Users/kas/seekertag/src/Found.tsx:13), [App.tsx:26](/Users/kas/seekertag/App.tsx:26).

**Reprodução:** iniciar um aviso público e reter sua resposta; tocar “Página inicial” enquanto o envio está pendente; confirmar que o cadastro/início está visível; liberar a resposta.

**Resultado observado:** o aplicativo abandona o início e navega automaticamente para `/chat/:id`, embora o finder já tenha deixado a tela. O efeito de leitura usa um marcador `live`, mas a mutação `submit()` não tem guarda equivalente antes de chamar `goChat()`.

**Impacto:** uma operação antiga desfaz a navegação posterior. O risco de confundir objetos aumenta se o usuário já tiver iniciado outro fluxo. Este último encadeamento com um segundo objeto não foi necessário para reproduzir o redirecionamento e não é apresentado como teste executado.

**Correção proposta:** persistir o resultado de uma operação concluída sem forçar navegação quando a tela/etiqueta original já não estiver ativa. Usar uma identidade da operação e uma geração de rota; invalidar callbacks de navegação no cleanup. Cancelar o fetch, isoladamente, não desfaz o commit já realizado no servidor.

**Lacuna de cobertura:** os testes cobrem Voltar em uma conversa concluída e retomada de conversas, mas não saída durante a criação do aviso.

## T6 — Restauração de sessão não se recupera de uma falha transitória

**Local:** [App.tsx:20](/Users/kas/seekertag/App.tsx:20), [App.tsx:26](/Users/kas/seekertag/App.tsx:26).

**Reprodução:** abrir a aplicação com um token válido já salvo e descartar as tentativas iniciais de `GET /auth/me` no proxy. Após aparecer a tela de cadastro, restaurar o transporte. A API confirma `200` para o mesmo token. Observar por 6,5 segundos e então recarregar a aba.

**Resultado observado:** zero novas tentativas automáticas antes do reload; a interface mantém o cadastro e o erro de conexão. Após o reload, a sessão e os objetos reaparecem. O token foi corretamente preservado: é o estado da interface que não oferece continuação. O efeito de inicialização roda apenas uma vez e não existe ação “Tentar novamente” para essa restauração.

**Impacto:** uma oscilação breve na abertura faz uma pessoa autenticada parecer desconectada e pode levá-la a tentar cadastrar a mesma conta. No navegador, recarregar resolve; não é perda do banco nem expiração real.

**Correção proposta:** manter um estado explícito de restauração interrompida, oferecer retry e repetir a consulta ao recuperar conectividade ou foco, com backoff e cancelamento. Continuar limpando o token somente em `401` confirmado.

**Lacuna de cobertura:** os testes de rede desligam a conexão com a conversa já carregada. Não exercitam a recuperação da primeira consulta de sessão.

## Temas sem novo achado confirmado e limites

- **Autorização e privacidade no servidor:** não foi encontrado bypass por troca de IDs, troca de token owner/finder, mass assignment, transferência ou consulta pública. As consultas filtram dono/capacidade e a resposta pública seleciona campos explicitamente. Os testes existentes cobrem essas fronteiras. T3 é um bug de estado local, não uma quebra dessa autorização.
- **Concorrência de transações já coberta:** não foi identificado novo defeito em uso único de recuperação, dupla transferência ou resolução idempotente da mesma ocorrência. Há revalidação depois de scrypt e transações SQLite. Isso não fornece idempotência de mensagens/criação de avisos, como demonstra T1.
- **Expiração do dono:** o servidor confere `expires_at`, e os testes existentes exercitam expiração/revogação. Nenhum bypass novo foi confirmado. A falha de T3 ocorre ao aplicar o resultado de uma sessão antiga à sessão atual.
- **Expiração do finder:** existe um TTL de 30 dias no armazenamento web, mas não uma expiração de capacidade no servidor nem no adaptador nativo. Uma conversa sintética com datas de 2020 ainda retornou `200` com a capacidade correta. Isso confirma uma diferença de política, **não um sétimo bug classificado**: a interface descreve por quanto tempo o acesso fica salvo no navegador, e o contrato atual não promete expiração do bearer na API. Antes de publicar, convém decidir e documentar retenção, expiração e revogação do acesso anônimo.
- **QR/PDF, CORS e arquivos estáticos:** nenhum novo defeito confirmado nesta revisão. A suíte já decodifica o PNG, abre o PDF, restringe origens e testa traversal/arquivos ocultos/symlinks. Não houve nova validação de impressão física, domínio público, proxy de produção, NFC, carteira, disco cheio ou encerramento abrupto.

## Evidência resumida da execução isolada

O script temporário de auditoria terminou com código `0`. Saída sanitizada, sem tokens, códigos de recuperação ou dados de contas reais:

```text
lost_response_duplicates: reportCount=2; sameMessageCopies=2
lost_recovery_factor: retryStatus=401; oldSessionStatus=401;
  newPasswordWorks=true; codeRecoverableFromLogin=false
new_draft_deleted: secondDraftBeforeRelease=true; fieldAfterRelease="";
  secondDraftSaved=false
late_finder_navigation: wasHome=true; redirectedAfterLateReply=true
bootstrap_no_retry: validSession=200; automaticRetriesAfterRestore=0;
  recoveredAfterManualReload=true
stale401_logs_out_new_account: accountBWasLoggedIn=true;
  accountBLoggedOutAfterAResponse=true; browserSessionCleared=true
```

O protocolo de reprodução foi observar o commit no upstream real, segurar ou descartar apenas o transporte de resposta e comparar UI com o estado persistido pela API. Nenhum destes seis achados depende de criar um comportamento falso de backend. A próxima rodada de correção deve transformar essas reproduções em regressões permanentes, começando pelo protocolo de POST e pela associação entre callbacks e sessão ativa.
