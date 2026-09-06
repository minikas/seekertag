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

## APK entregue e verificação

O APK local está em `artifacts/SeekerTag-preview.apk`. É um pacote Android arm64 para teste, assinado com chave de desenvolvimento, com o JavaScript embutido. Nesta compilação, a API aponta para **http://192.168.1.44:4318/api**. O computador e o Seeker precisam estar na mesma rede, e o serviço deve continuar rodando.

Para reiniciar a versão compilada pela rede:

```sh
npm run serve:lan
```

Se o IP do computador mudar, recompile o APK com `EXPO_PUBLIC_API_URL` atualizado ou use uma API pública estável. Instalar este APK não publica o app em uma loja.

O tema usa as bases escuras do Orkest e o destaque lavanda `#C4A1FF`, sem sublabels decorativas. O fundo do QR permanece branco para leitura e impressão. A versão Android escura passou por compilação release, verificação de assinatura e inspeção dos recursos dentro do APK.

O APK atualizado passou pelo fluxo Maestro em um emulador com perfil Pixel 7, Android 16/API 36: login, criação de objeto e QR, sessão após encerrar e reabrir, abertura por link manual, aviso ao dono e acesso à conversa após outro reinício. O teste confirmou o objeto e a mensagem na API real. As evidências ficam em `artifacts/native-android/`. Ainda não houve teste em aparelho físico.

## O que funciona

- Cadastro, login, logout e recuperação com código de uso único; senhas com scrypt, sessões revogáveis.
- Criar e editar objetos, categoria, anotação particular e mensagem pública.
- Busca, filtros, indicadores calculados, marcar perdido, pausar e reativar.
- QR real, PDF A4 com seis etiquetas, copiar/compartilhar link e gravação NFC em hardware compatível.
- Página de quem encontra sem cadastro ou instalação; nenhum e-mail, telefone ou anotação privada do dono é enviado.
- Conversa entre dono e finder com histórico persistente e atualização periódica enquanto o app está aberto.
- Acesso do finder salvo por 30 dias no mesmo navegador. Limpar os dados do site remove o acesso neste aparelho. O link sozinho não permite que outro navegador leia a conversa.
- Confirmação de devolução que encerra as conversas do objeto e atualiza seu histórico.
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

Não há push ou envio de e-mail: os avisos ficam na caixa de conversas e são atualizados enquanto o aplicativo está aberto. Uma implantação pública com HTTPS, serviços de notificações, testes com NFC físico/Seed Vault e publicação na dApp Store são etapas próprias. A etiqueta é passiva e não rastreia localização.

Mensagens são privadas por autorização da API, sem criptografia ponta a ponta. Sessões web do dono duram a aba; credenciais do finder persistem no navegador por 30 dias. No Android e no iOS, o SecureStore protege as credenciais em repouso. Quem opera o servidor controla o banco. Não há telemetria nem SDK de anúncios.

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

Artefatos locais de QA ficam em `artifacts/` e são ignorados pelo Git, pois podem conter dados de teste. Os testes não salvam traces com credenciais. A matriz de navegadores usa Chromium e WebKit, incluindo viewport/touch de iPhone. A queda de rede é aplicada pelo próprio navegador: o POST falha de verdade, o rascunho fica preservado, e o teste consulta o banco pela API para confirmar que o reenvio gera uma única mensagem. Esse cenário cobre falha antes da entrega, não a perda da resposta depois que o servidor já gravou a mensagem. [WebKit emulado](https://playwright.dev/docs/browsers#webkit) não equivale a Safari rodando em um iPhone físico.

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

A URL precisa coincidir com a API embutida no aplicativo instalado. Diferentemente do Playwright, este comando não inicia um servidor isolado: cria duas contas sintéticas e objetos na API indicada. Use uma API de teste e compile o app para esse mesmo endereço. O fluxo usa login pela interface, cria um objeto pela interface e confere o resultado na API, reinicia o app para testar a sessão, abre um QR por link manual e verifica o aviso e o acesso persistente do finder. O cadastro dessas contas é feito pela API.

Após esse fluxo no mesmo simulador iOS, teste o compartilhador de PDF e os estados de NFC/carteira indisponíveis:

```sh
maestro test --device UUID-DO-SIMULADOR \
  --test-output-dir artifacts/native-ios-services --format JUNIT \
  --output artifacts/native-ios-services-report.xml tests/native/ios-services.yaml
```

Esse teste usa a conta e o objeto deixados pelo fluxo anterior. O simulador deve continuar iniciado, com acesso à API. A verificação do compartilhador aceita o sistema em português, inglês ou espanhol. O cenário de NFC indisponível se aplica ao simulador, não a um iPhone com NFC.

Evidências e logs com credenciais removidas ficam em `artifacts/native-ios/` e `artifacts/native-android/`. O teste usa o armazenamento seguro real do app e não limpa o Keychain global nem apaga o simulador.

### Estado da validação

Última revisão: 6 de setembro de 2026. A suíte foi ampliada porque a rodada anterior tinha 12 testes de API e 8 cenários E2E executados em Chromium; não havia validação iOS/WebKit. Nesta revisão, os 12 testes unitários, 22 testes de API e 34 casos do Playwright passaram: 68 verificações automatizadas, além de dois fluxos Maestro no iOS e um no Android. O relatório dos 34 casos Playwright está em `artifacts/cross-browser-report/index.html`, com dados em `artifacts/cross-browser-results.json`.

| Camada | Resultado desta revisão | Escopo |
| --- | --- | --- |
| Unitários | 12 passaram | Sessões, capacidades com expiração, validação Base58, links NFC, nomes de PDF |
| API | 22 passaram | Autorização, persistência, concorrência, limites e decodificação real de QR/PDF |
| Navegadores | 34 passaram, sem skips ou retries | 2 contratos HTTP, 11 Chromium, 10 WebKit desktop e 11 WebKit com perfil iPhone |
| iOS nativo | Build Release e dois fluxos Maestro passaram no simulador iPhone 17e, iOS 26.5 | Login, objeto conferido na API, QR, sessão após reinício, aviso e acesso persistente do finder; PDF no compartilhador nativo; estados de NFC/carteira indisponíveis |
| Android | APK atualizado compilado, assinatura verificada e fluxo Maestro aprovado no Android 16/API 36 | Login, objeto conferido na API, QR, sessão após reinício, aviso e acesso persistente do finder; emulador com perfil Pixel 7 |
| Hardware e distribuição | Não realizados | Leitura óptica de QR, gravação NFC física, carteira real, TestFlight/App Store e produção HTTPS |

A instrumentação de `server/app.js` mediu 98,86% das linhas, 93,75% dos ramos e 100% das funções. Esses números cobrem o servidor de aplicação, não implantação, proxy, falha de disco ou hardware. Para reproduzir:

```sh
cd server
node --test --experimental-test-coverage --test-coverage-include=app.js test/*.test.js
```

A tabela distingue testes executados, limites da plataforma e validações que exigem aparelhos ou serviços externos. Cobertura de código não substitui os testes físicos pendentes.

Esta rodada corrigiu dois problemas encontrados nos testes: um ciclo ao usar Voltar depois de abrir uma conversa existente e a falta de orientação quando o navegador não conseguia autorizar a câmera. Ambos passaram pela verificação de regressão.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `App.tsx` | Sessão, rotas públicas, leitura QR e onboarding |
| `src/Dashboard.tsx` | Objetos, busca, conversas e conta |
| `src/TagForm.tsx`, `src/TagDetails.tsx` | Cadastro, etiqueta, PDF/NFC e transferência |
| `src/Found.tsx`, `src/Conversation.tsx` | Fluxo público e relay de mensagens |
| `src/platform/` | Armazenamento, carteira, câmera, NFC e arquivos por plataforma |
| `server/` | API, SQLite, autenticação, QR/PDF e web compilada |
| `tests/unit/`, `server/test/` | Regras locais, armazenamento e API |
| `tests/e2e/` | Matriz de navegadores e auditoria HTTP |
| `tests/native/` | Testes reexecutáveis em simulador nativo |

Contrato completo e limites operacionais: [server/API.md](server/API.md).

Fontes oficiais para a escolha de Expo: [SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Solana Mobile + Expo](https://docs.solanamobile.com/react-native/expo), [Mobile Wallet Adapter](https://docs.solanamobile.com/solana-mobile-stack/mobile-wallet-adapter).
