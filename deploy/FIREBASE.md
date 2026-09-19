# Firebase para notificações Android

O SeekerTag usa `expo-notifications` no Android e `firebase-admin` na API para
enviar pelo FCM. Não precisa de EAS, Firestore, Firebase Authentication ou Cloud
Functions. As contas e mensagens continuam no SQLite da API.

Sem os arquivos abaixo, a central funciona e o app exibe avisos de mensagens
novas enquanto está aberto. A entrega com o app em segundo plano ou fechado
só fica ativa depois da configuração e de uma nova compilação Android.

## 1. Criar o projeto e registrar o Android

1. Abra o [Firebase Console](https://console.firebase.google.com/) e crie um
   projeto chamado **SeekerTag**. Google Analytics é opcional para este fluxo.
2. Anote o **ID do projeto**, por exemplo `seekertag-a1b2c`. É diferente do nome
   de exibição e do número do projeto.
3. Na visão geral, selecione **Adicionar app → Android** e informe exatamente:

   ```text
   app.seekertag.mobile
   ```

4. Baixe `google-services.json` e salve em:

   ```text
   apps/mobile/google-services.json
   ```

   Pode também definir `GOOGLE_SERVICES_JSON` com o caminho absoluto. O Expo
   prebuild já cuida do Gradle e do SDK nativo; não copie os exemplos Java/Kotlin
   do assistente para o projeto. SHA-1 não é necessário para este fluxo de FCM.
5. Em **Configurações do projeto → Cloud Messaging**, confirme que **Firebase
   Cloud Messaging API (V1)** está habilitada. Se necessário, habilite a
   **Firebase Cloud Messaging API** na biblioteca de APIs do Google Cloud
   usando o mesmo projeto.

Referências: [registrar o app Android](https://firebase.google.com/docs/android/setup)
e [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## 2. Gerar a credencial do servidor

Em **Configurações do projeto → Contas de serviço → Firebase Admin SDK**, use
**Gerar nova chave privada**. Salve o JSON baixado em um local privado, fora de
`apps/mobile`. Ele é diferente de `google-services.json` e permite que nossa API
envie mensagens. Não cole seu conteúdo em conversas nem o adicione ao Git.

Na raiz deste repositório, valide os arquivos localmente:

```sh
npm run check:firebase -- apps/mobile/google-services.json /caminho/privado/service-account.json
```

O comando verifica o pacote Android, os IDs de projeto e o formato da chave sem
imprimir credenciais nem enviar mensagens. Os dois arquivos devem pertencer ao
mesmo projeto. Permissões do Google Cloud e entrega real são verificadas no teste
final, depois do deploy.

Referência: [credenciais do Firebase Admin SDK](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments).

## 3. Ativar no servidor atual

O Compose monta `deploy/firebase` somente para leitura dentro do container. No
computador, copie a chave para o servidor:

```sh
ssh seekertag-vps 'install -d -m 750 -o 1000 -g 1000 /opt/seekertag/deploy/firebase'
scp /caminho/privado/service-account.json seekertag-vps:/opt/seekertag/deploy/firebase/service-account.json
ssh seekertag-vps 'chown 1000:1000 /opt/seekertag/deploy/firebase/service-account.json && chmod 400 /opt/seekertag/deploy/firebase/service-account.json'
```

No servidor, edite `/opt/seekertag/deploy/api.env`, preservando as outras
configurações, e preencha com o **ID real do seu projeto**:

```dotenv
FIREBASE_PROJECT_ID=seekertag-a1b2c
FIREBASE_SERVICE_ACCOUNT_FILE=/run/seekertag-firebase/service-account.json
```

O segundo caminho é o de dentro do container. A imagem executa como UID 1000;
por isso a propriedade do arquivo acima. A pasta e chaves comuns do Firebase
estão excluídas do Git e do contexto de build Docker.

Recrie a API para carregar as variáveis e a chave:

```sh
cd /opt/seekertag
docker compose -f compose.production.yml up -d --build --no-deps --wait api
curl --fail https://api-seeker.viralizai.co/api/health
```

Sem as duas variáveis, push fica desativado e a central continua disponível.
Uma configuração parcial, arquivo inacessível ou projeto divergente impede a
inicialização para evitar uma configuração silenciosamente incorreta.

## 4. Recompilar e instalar no Seeker

No computador, na raiz do repositório, com `google-services.json` já salvo:

```sh
EXPO_PUBLIC_API_URL=https://api-seeker.viralizai.co/api npm run build:android
adb -s SM02G40619112679 install -r artifacts/SeekerTag-preview.apk
```

Não use `--incremental` ao adicionar ou alterar o JSON: ele muda a configuração
nativa. Não basta reiniciar o Metro. Abra o app, entre na conta e permita
notificações; a central também oferece o controle de permissão. O token FCM é
registrado automaticamente na API e atualizado quando o Android o renova.

## 5. Confirmar a entrega

1. Use duas contas e uma tag de teste. O destinatário deve abrir o novo APK
   conectado à internet para registrar o dispositivo.
2. Envie uma mensagem pela outra conta. Com a conversa fora da tela, verifique
   o aviso e o contador no sino. Toque no aviso e confirme a conversa correta.
3. Coloque o app do destinatário em segundo plano e envie outra mensagem.
4. Remova o app da lista de recentes, envie novamente e toque no aviso para
   testar a abertura com o processo encerrado.
5. Responda como dono e repita para quem encontrou a tag. Essa pessoa precisa
   salvar a conversa em uma conta para receber avisos de resposta.
6. Leia a conversa e volte à central; a contagem deve diminuir. Feche e abra o
   app para confirmar que a leitura foi salva na conta.

O encerramento forçado nas configurações do Android bloqueia push até abrir o
app de novo. O envio também depende de internet, Google Play Services e das
permissões do sistema. A fila tenta reenviar falhas temporárias, mas a aceitação
pelo FCM não é uma confirmação de exibição no aparelho.

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| Central informa que o servidor não oferece notificações | Publique o backend atualizado; `GET /api/notifications` exige autenticação. |
| Central funciona, mas só há aviso com o app aberto | Confira o JSON no APK, as duas variáveis da API e a permissão Android. Volte ao app depois de ativar o servidor para renovar o cadastro. |
| `PUSH_PROJECT_MISMATCH` | O projeto do APK e o da chave da API precisam ser iguais; recompile com o JSON correto. |
| API não inicia após configurar a chave | Confira caminho interno, UID 1000, JSON de conta de serviço e ID do projeto. |
| `FCM delivery: retry` nos logs da API | Verifique conexão de saída, API FCM habilitada e permissão de envio da conta de serviço. A fila repete falhas sem registrar conteúdo nem tokens. |
| A chave foi revogada | Gere e copie uma substituta; recrie o container. Não exige outro APK quando o projeto é o mesmo. |

Implementação baseada no [Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
e no [envio direto a FCM com Expo](https://docs.expo.dev/push-notifications/sending-notifications-custom/).
