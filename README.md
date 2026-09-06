# SeekerTag

Etiquetas QR/NFC para devolver objetos sem expor os contatos do dono. Aplicativo Expo para Android e web, com API Node.js e banco SQLite persistente. Baseado na ideia ReturnTag, com o nome SeekerTag.

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

Configure HTTPS no proxy, volume persistente, backup e limites de requisições na borda. Não use `example` como domínio real. `PUBLIC_URL` deve ser a origem pública do app; `EXPO_PUBLIC_API_URL`, quando necessário no build Android, aponta para essa origem seguida de `/api`. Nenhuma credencial de serviço é necessária para o fluxo básico.

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

Validação executada em 6 de setembro de 2026: **12 testes de backend**, **8 testes de ponta a ponta no ambiente de desenvolvimento** e **8 na exportação de produção** passaram. TypeScript e auditorias npm da aplicação e do servidor passaram, sem vulnerabilidades reportadas. A exportação web carrega somente a fonte de ícones utilizada (56 KB), além dos bundles JavaScript. O override de `xcode → uuid` corrige uma dependência indireta antiga; a geração de UUID desse pacote foi verificada.

O tema usa as bases escuras do Orkest e o destaque lavanda `#C4A1FF`, sem sublabels decorativas. Os 8 testes de ponta a ponta passaram novamente após essa atualização, com revisão visual de desktop e mobile. O fundo do QR permanece branco para leitura e impressão.

No emulador Android, o APK standalone inicial abriu sem Metro e sem erros `AndroidRuntime`/`ReactNativeJS`. Foram verificados cadastro real, objeto/QR, PDF no compartilhamento e na impressão do sistema, sessão após encerrar e reabrir, estados de NFC/carteira indisponíveis, permissão da câmera e abertura por link manual. Leitura ótica de QR, gravação em etiqueta NFC física e autorização em carteira real não foram exercitadas.

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

O projeto usa **Expo SDK 57 / React Native 0.86 / TypeScript**, com componentes compartilhados entre web e Android. A câmera usa `expo-camera`; PDF e compartilhamento usam módulos Expo; credenciais nativas ficam no SecureStore. NFC usa `react-native-nfc-manager` v4 beta, que suporta a New Architecture.

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

## Limites desta entrega

Recompensas são **promessas opcionais**, claramente identificadas na interface. O app não recebe, bloqueia, libera ou reembolsa dinheiro. Escrow, pagamentos USDC/SKR, associação verificada de carteira/alias `.skr` e verificação SGT não estão implementados. A conexão de carteira é opcional e local; não equivale a provar propriedade de uma etiqueta.

Não há push ou envio de e-mail: os avisos ficam na caixa de conversas e são atualizados enquanto o aplicativo está aberto. Uma implantação pública com HTTPS, serviços de notificações, testes com NFC físico/Seed Vault e publicação na dApp Store são etapas próprias. A etiqueta é passiva e não rastreia localização.

Mensagens são privadas por autorização da API, sem criptografia ponta a ponta. Sessões web do dono duram a aba; credenciais do finder persistem no navegador por 30 dias. No Android, o SecureStore protege as credenciais em repouso. Quem opera o servidor controla o banco. Não há telemetria nem SDK de anúncios.

## Testar

```sh
npm run typecheck
npm test
# Com a API e a interface em execução:
npm run test:e2e
```

Os testes usam APIs e bancos reais isolados, sem mocks do produto. Cobrem isolamento entre contas, capacidades do finder, recuperação concorrente, revogação, persistência, QR/PDF, transferência, validação de entrada, servir arquivos sem traversal, e o ciclo dono → finder → conversa → devolução. Os testes de navegador também verificam telas pequenas, console e falhas de rede.

Para testar a compilação servida no mesmo processo, use `WEB_URL=http://localhost:4318` nos testes de interface. Os testes HTTP separados usam `API_URL` quando definido. Artefatos locais de QA ficam em `artifacts/` e são ignorados pelo Git, pois podem conter dados de teste. Os testes não salvam traces com credenciais.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `App.tsx` | Sessão, rotas públicas, leitura QR e onboarding |
| `src/Dashboard.tsx` | Objetos, busca, conversas e conta |
| `src/TagForm.tsx`, `src/TagDetails.tsx` | Cadastro, etiqueta, PDF/NFC e transferência |
| `src/Found.tsx`, `src/Conversation.tsx` | Fluxo público e relay de mensagens |
| `src/platform/` | Armazenamento, carteira, câmera, NFC e arquivos por plataforma |
| `server/` | API, SQLite, autenticação, QR/PDF e web compilada |
| `tests/e2e/` | Testes de navegador e auditoria HTTP |

Contrato completo e limites operacionais: [server/API.md](server/API.md).

Fontes oficiais para a escolha de Expo: [SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Solana Mobile + Expo](https://docs.solanamobile.com/react-native/expo), [Mobile Wallet Adapter](https://docs.solanamobile.com/solana-mobile-stack/mobile-wallet-adapter).
