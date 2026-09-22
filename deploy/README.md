# Publicação da API

Este diretório publica a API e o Finder Web em `https://api-seeker.viralizai.co`
com Docker e Caddy. O backend Node atende somente `/api/*`; a imagem Caddy
compila `apps/finder-web` e atende `/found/*`, `/chat/*` e `/finder-assets/*`.
O volume `seekertag_data` mantém o SQLite entre reinicializações e o volume
`caddy_data` preserva os certificados TLS.

## Antes de iniciar

1. Crie uma VM Oracle Cloud Always Free com Ubuntu e IP público reservado.
2. No DNS de `viralizai.co`, crie o registro `A`:

   ```text
   api-seeker  <IP-público-da-VM>
   ```

   Remova qualquer registro `AAAA` para esse nome, a menos que a VM também
   tenha IPv6 público configurado.
3. Libere TCP `80` e `443` no Security List/Network Security Group da Oracle e
   no firewall da VM. Caddy só obtém e renova o certificado quando o DNS aponta
   para a VM e essas portas estão acessíveis.
4. Instale Docker Engine e o plugin Docker Compose na VM. Clone este repositório
   em um diretório privado do usuário que operará o serviço.

## Configurar e iniciar

Na raiz do repositório na VM:

```sh
cp deploy/api.env.example deploy/api.env
chmod 600 deploy/api.env
docker compose -f compose.production.yml up --build -d
docker compose -f compose.production.yml logs -f
```

Depois que o DNS propagar, confirme:

```sh
curl --fail https://api-seeker.viralizai.co/api/health
```

O retorno deve conter `"publicUrl":"https://api-seeker.viralizai.co"`.
Confirme também que uma rota Finder válida recebe HTML e os cabeçalhos de
segurança; códigos inexistentes exibem o estado de erro fornecido pela API.
O arquivo `deploy/api.env` nunca deve entrar no Git. Preencha as credenciais de
Google, Apple ou recompensas somente quando esses recursos forem ativados.

O Compose configura `TRUST_PROXY_HOPS=1`: a API confia apenas no primeiro salto,
o Caddy, para identificar o IP do cliente e separar as cotas de autenticação.
Mantenha a porta `4318` sem publicação no host e sem outra entrada pública.
O Caddy deve substituir os cabeçalhos de encaminhamento recebidos do cliente.
Os assets do Finder são copiados para a imagem Caddy durante o build, sem serem
servidos ou montados no container da API. Portanto, mudanças em `apps/finder-web`
exigem reconstruir o serviço `caddy`.
Ao executar a API diretamente, use o padrão `TRUST_PROXY_HOPS=0`; não reutilize
o valor `1` em uma topologia com acesso direto à API ou caminhos de tamanhos diferentes.

## Aplicativo Android

Publique uma nova compilação Android com a origem da API embutida:

```sh
EXPO_PUBLIC_API_URL=https://api-seeker.viralizai.co/api npm run build:android
```

Instale e valide essa compilação antes de emitir etiquetas definitivas. QRs e
NFCs criados por ela apontarão para o domínio HTTPS estável acima.

## Notificações de mensagens

A API cria automaticamente as tabelas de leitura, dispositivos e fila de push
ao iniciar. Publique o backend completo e suas dependências antes de instalar o
aplicativo. A central inclui mensagens recebidas pelo dono e por quem salvou a
conversa em sua conta, inclusive as anteriores à atualização. O estado de leitura
fica na conta e independe da permissão de notificações do Android.

O envio com o app fechado usa Firebase Cloud Messaging diretamente da API,
por meio de `firebase-admin`. O APK recebe a configuração `google-services.json`;
a chave privada fica somente no servidor. Não é necessário projeto EAS.

Siga o [guia de configuração do Firebase](FIREBASE.md) para criar o projeto,
validar os arquivos, configurar a API e recompilar o APK. Sem as credenciais,
a central e os avisos de mensagens novas com o app aberto continuam funcionando.

A fila persiste no SQLite e repete falhas temporárias. Tokens inválidos são
removidos; logout, troca de conta e expiração da sessão revogam a associação.
Mensagens lidas antes do envio são retiradas da fila. A aceitação pelo FCM não
comprova que o aparelho exibiu o aviso; valide a entrega em um Android real.

## Verificação do domínio na carteira Android

A carteira de referência do Solana Mobile verifica a associação entre o domínio,
o pacote Android e o certificado que assinou o APK. O Caddy publica essa
associação em `/.well-known/assetlinks.json`.

Após iniciar os containers, copie o arquivo público para o volume persistente:

```sh
docker compose -f compose.production.yml exec -T caddy mkdir -p /data/seekertag-public/.well-known
docker compose -f compose.production.yml cp deploy/public/.well-known/assetlinks.json caddy:/data/seekertag-public/.well-known/assetlinks.json
curl --fail https://api-seeker.viralizai.co/.well-known/assetlinks.json
```

O arquivo versionado contém o SHA-256 do certificado do APK de **preview**.
Ao publicar um APK com outra assinatura, atualize o fingerprint para o
certificado correspondente. Não use essa associação de debug como configuração
final de assinatura de produção. A troca do arquivo público não exige reinstalar
um APK que já possua o certificado associado.

## Vídeo público da demonstração

O Caddy serve `/demo/*` a partir de `/data/seekertag-demo` no mesmo volume
persistente. Coloque somente os arquivos públicos da demonstração nesse
diretório. As demais rotas continuam encaminhadas à API.
