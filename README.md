# SeekerTag

Etiquetas QR/NFC para devolver objetos sem expor os contatos do dono. Aplicativo Expo para Android, iOS e web, com API Node.js e banco SQLite persistente. Baseado na ideia ReturnTag, com o nome SeekerTag. Veja abaixo os testes realizados e os limites de cada plataforma.

## Executar

Requer Node.js 24 e npm.

```sh
npm ci
npm ci --prefix server
npm run dev
```

Abra **http://localhost:8081**, crie uma conta e guarde o código de recuperação. Os objetos começam vazios; não há conta padrão, senha embutida ou dados simulados.

Para usar dois celulares na mesma rede, pare a execução anterior e rode:

```sh
npm run dev:lan
```

O comando detecta o IP da rede e configura os links das etiquetas e a API. `SEEKERTAG_LAN_HOST` permite escolher outro IP se a máquina tiver várias interfaces. Os celulares precisam alcançar o computador. Um QR emitido com `localhost` só funciona no próprio computador; IPs locais podem mudar. Para etiquetas definitivas, use um domínio HTTPS estável.

## Versão compilada

```sh
npm run build:web
npm run serve
```

Abra **http://localhost:4318**. A mesma aplicação Node entrega a interface, os links públicos e a API. Não depende de Metro. Banco padrão: `server/data/seekertag.sqlite`, com arquivos auxiliares WAL/SHM. `npm run dev` e `npm run serve` compartilham a porta da API: execute um por vez.

Para hospedar com domínio próprio:

```sh
PUBLIC_URL=https://seu-dominio.example npm run serve
```

Configure HTTPS no proxy, volume persistente, backup e limites de requisições na borda. Não use `example` como domínio real. `PUBLIC_URL` deve ser a origem pública do app; `EXPO_PUBLIC_API_URL`, nos builds nativos, aponta para essa origem seguida de `/api`. Nenhuma credencial de serviço é necessária para o fluxo básico.

Há um `Dockerfile` que compila o Expo web e executa apenas o servidor em produção:

```sh
docker build -t seekertag .
docker run --rm -p 4318:4318 -v seekertag-data:/data \
  -e PUBLIC_URL=https://seu-dominio.example seekertag
```

O domínio deve apontar para o proxy HTTPS que atende o contêiner. O volume mantém as contas, etiquetas e conversas entre reinicializações. A configuração Docker é fornecida para implantação; não publica automaticamente um serviço.

## Avisos por e-mail e domínio permanente

A integração preparada usa Resend. O fluxo básico continua funcionando sem ela. A pessoa escolhe “Minha conta → Avisos por e-mail”, confirma um código recebido no endereço da própria conta e pode desativar os avisos depois.

Para ativar, o responsável precisa de um domínio HTTPS permanente para `PUBLIC_URL`, um remetente verificado no Resend e as variáveis privadas de servidor `NOTIFICATIONS_ENABLED=true`, `RESEND_API_KEY` e `NOTIFICATION_FROM`. O [modelo de configuração](.env.example) não contém credenciais. Configure os valores pelo gerenciador de segredos da hospedagem; nunca use o prefixo `EXPO_PUBLIC_` para uma chave de serviço. Para um arquivo privado local já configurado, o servidor pode ser iniciado com `node --env-file=.env server/index.js` depois do build web.

O servidor agrupa avisos da mesma conversa por 30 segundos e processa a fila a cada 15 segundos. Não envia o conteúdo das mensagens nem credenciais por e-mail: o link exige login do dono. Leitura, encerramento e desativação cancelam os avisos pendentes antes do envio. Falhas temporárias usam repetição com a mesma chave no provedor, no máximo seis tentativas e dentro de 23 horas. Aceitação pelo provedor não comprova entrega na caixa de entrada; o painel informa falhas definitivas e as mensagens permanecem no app.

A fila, as preferências, os desafios e o segredo de verificação persistem no SQLite. Preserve o banco completo nos backups. Mudar de domínio não atualiza QRs já impressos: mantenha o domínio original ou um redirecionamento permanente. Uma mudança de origem durante um envio incerto interrompe aquele aviso para evitar repetição com conteúdo diferente. Reiniciar o servidor retoma as operações pendentes elegíveis.

Nesta entrega os testes capturam o transporte localmente. O domínio público, a conta do serviço e o recebimento em uma caixa de e-mail real ainda dependem de configuração. Referências: [envio de e-mail Resend](https://resend.com/docs/api-reference/emails/send-email) e [idempotência do provedor](https://resend.com/docs/dashboard/emails/idempotency-keys).

## APK entregue e verificação

O APK local está em `artifacts/SeekerTag-preview.apk`. É um pacote Android arm64 para teste, assinado com chave de desenvolvimento, com o JavaScript embutido. Nesta compilação, a API aponta para **http://192.168.1.44:4318/api**. O computador e o Seeker precisam estar na mesma rede, e o serviço deve continuar rodando.

Com o servidor desta entrega ativo, [baixe o APK pela rede local](http://192.168.1.44:4318/SeekerTag-preview.apk). SHA256: `bfc1c5aabf5611855cb4ca2f94d5cbe0265edb23c9d0faf8e7b3f0bd4363c870`.

Para reiniciar a versão compilada pela rede:

```sh
npm run serve:lan
```

Se o IP do computador mudar, recompile o APK com `EXPO_PUBLIC_API_URL` atualizado ou use uma API pública estável. Instalar este APK não publica o app em uma loja.

O tema usa as bases escuras do Orkest e o destaque lavanda `#C4A1FF`, sem sublabels decorativas. O fundo do QR permanece branco para leitura e impressão. A versão Android escura passou por compilação release, verificação de assinatura e inspeção dos recursos dentro do APK.

O APK atualizado passou por dois fluxos Maestro em um emulador com perfil Pixel 7, Android 16/API 36: login, criação simples de objeto e QR, sessão após encerrar e reabrir, abertura por link manual, aviso ao dono e acesso pela lista de conversas após outro reinício. O teste confirmou o objeto e a mensagem na API real. Também passaram o leitor com teclado e Voltar, o rascunho após reinício e o envio com o teclado aberto. As evidências ficam em `artifacts/native-android/`. Ainda não houve teste em aparelho físico.

## O que funciona

- Cadastro, login, logout e recuperação com código de uso único; senhas com scrypt, sessões revogáveis.
- Criar e editar objetos, categoria, anotação particular e mensagem pública.
- Busca, filtros, indicadores calculados, marcar perdido, pausar e reativar.
- QR real e PDF A4 em três formatos: padrão (6 etiquetas), compacto (15) e dobrável (4). Copiar/compartilhar link e gravação NFC em hardware compatível.
- Criação simples com nome e categoria; opções extras recolhidas. Confirmação opcional de que a etiqueta foi presa e testada, identificada como declaração da pessoa.
- Página de quem encontra sem cadastro ou instalação; nenhum e-mail, telefone ou anotação privada do dono é enviado.
- Conversa entre dono e finder com histórico persistente, mensagens não lidas e atualização periódica. O histórico acompanha novas mensagens quando você está no final; preserva sua posição ao ler mensagens antigas.
- Envios de etiquetas, avisos e mensagens recuperáveis após queda da resposta, usando a mesma operação. Rascunhos novos não são apagados pela conclusão de um envio anterior.
- Restauração de sessão com reconexão e proteção contra respostas atrasadas de outra conta.
- Lista “Minhas conversas” para voltar sem escanear novamente. Acesso do finder salvo por 30 dias no mesmo navegador. Limpar os dados do site remove o acesso neste aparelho. O link sozinho não permite que outro navegador leia a conversa.
- Confirmação de devolução que encerra as conversas do objeto e atualiza seu histórico. Avisos por engano, sem devolução ou indesejados podem ser encerrados separadamente, sem registrar uma devolução.
- Novo código de recuperação emitido mediante senha atual, com repetição segura se a resposta se perder. Copiar/guardar o código antes de continuar.
- Alertas opcionais por e-mail, com confirmação do endereço, fila SQLite e integração Resend. Exigem configuração no servidor; a instalação local mantém os alertas desativados.
- Transferência para outra conta, confirmada com a senha atual, preservando a privacidade das conversas anteriores.
- Conexão opcional de carteira Solana por Mobile Wallet Adapter no Android ou carteira injetada compatível na web.

## Android e Expo

O projeto usa **Expo SDK 57 / React Native 0.86 / TypeScript**, com componentes compartilhados entre web, Android e iOS. A câmera usa `expo-camera`; PDF e compartilhamento usam módulos Expo; credenciais nativas ficam no SecureStore. NFC usa `react-native-nfc-manager` v4 beta, que suporta a New Architecture.

As integrações NFC e Mobile Wallet Adapter precisam de uma compilação nativa; o Expo Go não contém esses módulos. O app trata sua indisponibilidade sem simular conexão ou gravação.

```sh
# API acessível pelo dispositivo, por exemplo na rede local:
EXPO_PUBLIC_API_URL=http://IP-DO-COMPUTADOR:4318/api npm run android
```

Para regenerar o APK standalone arm64 sem depender do Metro:

```sh
npm run build:android
# API pública fixa, se houver:
EXPO_PUBLIC_API_URL=https://seu-dominio.example/api npm run build:android
```

O script detecta a rede local, JDK/SDK no macOS, limita a compilação a arm64 e copia o resultado para `artifacts/SeekerTag-preview.apk`. `-- --incremental` pode ser usado quando apenas o código JavaScript/TypeScript mudou.

Para a base nativa já compilada e identificada desta entrega, `scripts/rebundle-native.mjs ios|android` permite atualizar apenas o JavaScript e cria candidatos separados. O script confere os hashes da base, as dependências/configurações, a versão Hermes, a assinatura e, no Android, o alinhamento e a identidade dos arquivos nativos. A única promoção de dependência permitida é `@noble/hashes` 2.4.0, que já fazia parte do mesmo grafo instalado e contém somente JavaScript. Mudanças em módulos nativos, recursos ou configurações exigem build completo. Os candidatos precisam passar pelo teste nativo antes de substituir os artefatos entregues.

Requer JDK 17, Android SDK/NDK e emulador ou aparelho. `eas.json` inclui perfis development, preview APK e production AAB; builds remotos dependem da conta Expo do responsável. O plugin `plugins/withAndroidCompatibility.js` permite HTTP nas compilações locais. Defina `allowCleartext: false` no `app.json` para uma distribuição com API HTTPS.

## iPhone: navegador e aplicativo iOS

São duas formas de uso diferentes. O APK entregue é exclusivo do Android e não instala no iPhone.

**Navegador:** abra o endereço web do SeekerTag no Safari, na mesma rede do servidor local. Cadastro, objetos, página pública e conversas não dependem da instalação de um aplicativo. O botão de câmera dentro do site exige HTTPS (ou localhost no próprio aparelho); o endereço HTTP da rede local permite abrir links e colá-los no leitor. A câmera do sistema também pode abrir o QR diretamente no navegador. Safari não oferece a integração Web NFC utilizada pelo app; use o QR. Carteira na web depende de um navegador com provedor Solana compatível, como o navegador da própria carteira.

**iOS nativo:** a base Expo suporta iOS 16.4+; exige compilação própria. Para desenvolver com Xcode e CocoaPods instalados:

```sh
# Use um endereço que o simulador ou aparelho consiga alcançar:
EXPO_PUBLIC_API_URL=http://192.168.1.44:4318/api npm run ios
```

Para gerar um pacote Release independente do Metro para um simulador arm64 (Apple Silicon):

```sh
xcrun simctl list devices available
# Substitua o UUID pelo simulador que você escolheu:
IOS_SIMULATOR_UDID=UUID-DO-SIMULADOR \
EXPO_PUBLIC_API_URL=http://192.168.1.44:4318/api npm run build:ios:simulator
```

O resultado fica em `artifacts/SeekerTag-ios-simulator.app`. O script mantém a assinatura local de simulador do Xcode, necessária para testar SecureStore/Keychain. Precisa de espaço livre para CocoaPods, frameworks e produtos intermediários.

Não use o fallback Android `10.0.2.2` para um build iOS independente. O endereço da API precisa estar configurado durante a compilação. O acesso pela rede local exige a permissão do iOS. NFC depende de iPhone e etiqueta compatíveis e de uma compilação com os entitlements apropriados. A conexão nativa Mobile Wallet Adapter é oferecida somente no Android; ela é opcional para os demais fluxos.

Build de simulador não é um IPA instalável no telefone. Instalação em iPhone físico, TestFlight ou App Store exige assinatura/provisionamento Apple; nenhuma distribuição iOS foi publicada. O resultado do teste nativo desta rodada está separado na tabela de validação abaixo.

Referências de plataforma: [requisitos do Expo 57](https://docs.expo.dev/versions/v57.0.0/), [câmera Expo](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), [acesso à câmera em contexto seguro](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [Web NFC](https://developer.chrome.com/docs/capabilities/nfc) e [integração MWA](https://docs.solanamobile.com/developers/mobile-wallet-adapter).

## Limites desta entrega

Recompensas são **promessas opcionais**, claramente identificadas na interface. O app não recebe, bloqueia, libera ou reembolsa dinheiro. Escrow, pagamentos USDC/SKR, associação verificada de carteira/alias `.skr` e verificação SGT não estão implementados. A conexão de carteira é opcional e local; não equivale a provar propriedade de uma etiqueta.

Não há push. Os avisos ficam em Conversas; o envio opcional de e-mail está implementado, mas ainda não foi ativado nesta instalação. Uma implantação pública com HTTPS, recebimento real dos e-mails, testes com NFC físico/Seed Vault e publicação na dApp Store dependem da configuração e validação externa. A etiqueta é passiva e não rastreia localização.

Mensagens são privadas por autorização da API, sem criptografia ponta a ponta. Sessões web do dono duram a aba; credenciais do finder persistem no navegador por 30 dias. No Android e no iOS, o SecureStore protege as credenciais em repouso. Quem opera o servidor controla o banco. Não há telemetria nem SDK de anúncios. Os registros locais de envios ainda pendentes não expiram automaticamente. Após a conclusão, as chaves e o conteúdo são apagados; pequenos marcadores com hash e data permanecem para impedir que uma aba antiga restaure operações concluídas. Remover um acesso salvo também remove os envios e rascunhos daquela conversa.

## Testar

```sh
# Instala os dois motores usados nos testes de navegador:
npx playwright install chromium webkit

# TypeScript, testes unitários, API e navegadores:
npm run test:all

# Camadas individuais:
npm run typecheck
npm run test:unit
npm run test:api
npm run test:e2e
```

`test:all` reúne as verificações de Node e navegador; testes nativos dependem dos simuladores e são executados separadamente.

`test:e2e` compila a fonte atual em `artifacts/test-web`. O Playwright inicia o servidor de teste com SQLite temporário e encerra ambos ao concluir. A publicação em `dist`, o APK e o banco em `server/data` permanecem separados desse processo.

Os testes de API e navegador exercitam o produto com API e banco reais. Os testes unitários de armazenamento usam uma implementação de `Storage` em memória para verificar o adaptador real, incluindo expiração, migração e indisponibilidade do navegador. Não é uma simulação dos fluxos de negócio.

Para apontar os testes a uma instalação existente, defina `WEB_URL` e `API_URL` com origens correspondentes. Esses testes criam contas, etiquetas e mensagens; use somente uma instalação dedicada à verificação. Sem essas variáveis, a execução usa o ambiente isolado local.

Artefatos locais de QA ficam em `artifacts/` e são ignorados pelo Git, pois podem conter dados de teste. Os testes não salvam traces com credenciais. A matriz de navegadores usa Chromium e WebKit, incluindo viewport/touch de iPhone. A queda de rede é aplicada pelo próprio navegador: o POST falha de verdade, o rascunho fica preservado, e o teste consulta o banco pela API para confirmar que o reenvio gera uma única mensagem. A suíte também retém ou descarta respostas depois que a API gravou a operação: verifica repetição após reinício, rascunho novo durante envio, navegação tardia, restauração e troca de sessões. Os testes de notificações exercitam a API e o SQLite reais com transporte de e-mail capturado em memória; não enviam e-mails externos. [WebKit emulado](https://playwright.dev/docs/browsers#webkit) não equivale a Safari rodando em um iPhone físico.

### Testes nativos

Requer Maestro, simulador/emulador iniciado e SeekerTag instalado. Para instalar o pacote iOS de teste em um simulador já aberto:

```sh
xcrun simctl install UUID-DO-SIMULADOR artifacts/SeekerTag-ios-simulator.app
```

Execute o fluxo compartilhado de login, objeto, QR manual e persistência:

```sh
NATIVE_PLATFORM=ios NATIVE_DEVICE_ID=UUID-DO-SIMULADOR \
EXPO_PUBLIC_API_URL=http://192.168.1.44:4318/api npm run test:native

# Android: use o identificador exibido por adb devices:
NATIVE_PLATFORM=android NATIVE_DEVICE_ID=emulator-5554 \
EXPO_PUBLIC_API_URL=http://192.168.1.44:4318/api npm run test:native
```

A URL precisa coincidir com a API embutida no aplicativo instalado. Diferentemente do Playwright, este comando não inicia um servidor isolado: cria duas contas sintéticas e objetos na API indicada. Use uma API de teste e compile o app para esse mesmo endereço. O fluxo usa login pela interface, cria um objeto pela interface e confere o resultado na API, reinicia o app para testar a sessão, abre um QR por link manual e verifica o aviso e o acesso persistente do finder pela lista de conversas salvas, sem precisar escanear de novo. O cadastro dessas contas é feito pela API.

Depois do fluxo principal no mesmo dispositivo, verifique teclado, rascunho após reinício e envio. No iOS, execute também o compartilhador de PDF e os estados de NFC/carteira indisponíveis:

```sh
NATIVE_PLATFORM=ios NATIVE_DEVICE_ID=UUID-DO-SIMULADOR \
node scripts/test-native-extra.mjs composer

NATIVE_PLATFORM=ios NATIVE_DEVICE_ID=UUID-DO-SIMULADOR \
node scripts/test-native-extra.mjs ios-services

# Depois do fluxo principal Android:
NATIVE_PLATFORM=android NATIVE_DEVICE_ID=emulator-5554 \
node scripts/test-native-extra.mjs composer
```

Os testes extras usam a conta, o objeto e a conversa deixados pelo fluxo principal. O dispositivo deve continuar iniciado, com acesso à API. A verificação do compartilhador aceita o sistema em português, inglês ou espanhol. O cenário de NFC indisponível se aplica ao simulador, não a um iPhone com NFC. Os wrappers guardam apenas os relatórios e as capturas escolhidas, apagando os dumps temporários do Maestro.

Evidências e logs com credenciais removidas ficam em `artifacts/native-ios/` e `artifacts/native-android/`. O teste usa o armazenamento seguro real do app e não limpa o Keychain global nem apaga o simulador.

### Estado da validação

Última execução da matriz: **6 de setembro de 2026, 16:38 UTC**, concluída em 4,3 minutos. Nesta implementação passaram **32 testes unitários, 42 testes de API e 85 execuções do Playwright: 159 verificações automatizadas**, além dos fluxos nativos abaixo. O Playwright terminou com **zero falhas, skips, casos instáveis ou retries**. O [relatório HTML](artifacts/cross-browser-report/index.html) e os [resultados JSON](artifacts/cross-browser-results.json) correspondem à mesma rodada final.

| Camada | Resultado desta implementação | Escopo |
| --- | --- | --- |
| Unitários | 32 passaram | Armazenamento, expiração, migração, concorrência entre abas, operações pendentes, remoção de acessos, Base58/NFC |
| API | 42 passaram | 31 testes de API/QR/PDF e 11 de notificações: autorização, persistência, perdas após commit, repetição, verificação de e-mail e fila |
| Navegadores | 85 passaram | 2 contratos HTTP, 28 Chromium, 27 WebKit desktop e 28 WebKit com perfil iPhone |
| iOS nativo | Pacote atualizado e 3 fluxos Maestro passaram no iPhone 17e/iOS 26.5 | Fluxo principal com confirmação na API, sessões e conversas após reinício; teclado, rascunho e envio; PDF no compartilhador; indisponibilidade de NFC/carteira no simulador |
| Android | Pacote atualizado e 2 fluxos Maestro passaram no Pixel 7/Android 16 | Fluxo principal com confirmação na API; sessão e conversas após reinício; leitor com teclado e Voltar; rascunho persistente e envio com teclado aberto |
| Hardware e distribuição | Não realizados | QR impresso/leitura óptica, NFC físico, carteira real, recebimento real de e-mail, iPhone físico/TestFlight/App Store e produção HTTPS |

Os pacotes desta implementação reutilizam os binários nativos Release já compilados, com JavaScript Hermes atualizado e assinaturas verificadas. O script compara configuração, dependências e arquivos nativos com a base antes de produzir cada candidato; os testes nativos rodam após sua instalação. Não houve mudança de módulos nativos nesta implementação. As verificações ficam em `artifacts/ios-ux-build-verification.json` e `artifacts/android-ux-build-verification.json`; os resultados Maestro ficam em `artifacts/native-ios/` e `artifacts/native-android/`.

As regressões incluem resposta perdida depois de gravar no banco, novo rascunho durante envio, saída da conversa durante POST, recuperação de senha/código, sessão antiga respondendo após novo login, reconexão e quota ao atualizar o índice de conversas. Os testes de notificações usam transporte capturado, sem envio externo. Durante a validação foram corrigidas também duas condições de corrida das próprias fixtures, aguardando a carga real antes de revogar a sessão ou recarregar a conversa; a auditoria de erros permaneceu ativa.

Os percentuais de cobertura publicados anteriormente se referiam ao servidor anterior à implementação e não são atribuídos a esta versão. Para medir a fonte atual:

```sh
cd server
node --test --experimental-test-coverage --test-coverage-include=app.js --test-coverage-include=notifications.js test/*.test.js
```

Cobertura de código, emulação de navegador e simuladores não substituem os testes físicos pendentes. O [relatório de implementação](docs/reviews/2026-09-06/implementacao.md) relaciona a entrega às propostas da auditoria.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `App.tsx` | Sessão, reconexão, rotas públicas/privadas, leitura QR e código de recuperação |
| `src/Dashboard.tsx` | Objetos, busca, conversas e conta |
| `src/TagForm.tsx`, `src/TagDetails.tsx` | Cadastro, etiqueta, PDF/NFC e transferência |
| `src/Found.tsx`, `src/Conversation.tsx`, `src/SavedConversations.tsx` | Fluxo público, mensagens, leitura e acessos salvos |
| `src/mutationStore.ts`, `src/finderStore.ts` | Envios recuperáveis, concorrência entre abas e índice de conversas |
| `src/NotificationsPanel.tsx`, `server/notifications.js` | Preferências verificadas, fila persistente e transporte de e-mail |
| `src/platform/` | Armazenamento, carteira, câmera, NFC e arquivos por plataforma |
| `server/` | API, SQLite, autenticação, QR/PDF e web compilada |
| `tests/unit/`, `server/test/` | Regras locais, armazenamento e API |
| `tests/e2e/` | Matriz de navegadores e auditoria HTTP |
| `tests/native/` | Testes reexecutáveis em simulador nativo |

Contrato completo e limites operacionais: [server/API.md](server/API.md).

Fontes oficiais para a escolha de Expo: [SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Solana Mobile + Expo](https://docs.solanamobile.com/react-native/expo), [Mobile Wallet Adapter](https://docs.solanamobile.com/solana-mobile-stack/mobile-wallet-adapter).
