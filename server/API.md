# SeekerTag API

API HTTP funcional para etiquetas QR/NFC e devolução por conversa privada. Dados persistem em SQLite. Requer Node.js 24 ou superior.

```sh
cd server
npm install
npm start
npm test
```

O serviço escuta `0.0.0.0:4318`. Base local: `http://localhost:4318/api`. `GET /api/health` retorna `{ ok, service, publicUrl }`.

## Configuração

Defina variáveis no ambiente do processo, quando necessário; nenhum arquivo de credenciais é exigido.

| Variável | Padrão | Finalidade |
|---|---|---|
| `PORT` | `4318` | Porta da API. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `DATABASE_PATH` | `server/data/seekertag.sqlite` | Banco persistente; arquivos de dados são ignorados pelo Git. |
| `PUBLIC_URL` | `http://localhost:8081` | Origem canônica do app web, usada em todos os QRs e etiquetas. Somente `http(s)://host[:port]`, sem credenciais/caminho/query. |
| `CORS_ORIGINS` | vazio | Origens adicionais, separadas por vírgula. A origem de `PUBLIC_URL`, `http://localhost:8081` e `http://127.0.0.1:8081` já são permitidas. Clientes nativos sem cabeçalho Origin são aceitos. |
| `WEB_DIST_PATH` | `../dist`, quando contém `index.html` | Export web do Expo servido pelo mesmo processo da API. Caminho explícito inválido impede inicialização. |
| `NOTIFICATIONS_ENABLED` | `false` | Ativa o transporte opcional de avisos por e-mail quando remetente, credencial e origem pública HTTPS estão configurados. |
| `RESEND_API_KEY` | vazio | Credencial do provedor, lida somente do ambiente e nunca retornada pela API. |
| `NOTIFICATION_FROM` | vazio | Remetente autorizado no provedor, por exemplo `SeekerTag <avisos@seu-dominio.com>`. |

Para ler a etiqueta em outro celular na mesma rede, configure `PUBLIC_URL` com o IP local e a porta do app web e a URL da API correspondente no cliente Expo. Para funcionamento pela internet, publique web e API com HTTPS, domínio estável e armazenamento persistente. **QRs emitidos com localhost só abrem no computador que hospeda o app.** Imprima etiquetas definitivas depois de definir o domínio público. A API nunca usa o cabeçalho Host do visitante para compor o QR.

Depois de exportar a aplicação Expo para `dist`, `npm start` também serve a interface pela mesma porta da API. Configure `PUBLIC_URL` com a origem pública desse processo. Arquivos estáticos ficam limitados ao diretório exportado; arquivos ocultos, travessia de diretórios e links simbólicos que escapam dele são rejeitados. Somente `GET /`, `GET /found/:code`, `GET /chat/:id`, `GET /saved` e `GET /owner-chat/:id` recebem o `index.html` como fallback, permitindo abrir QRs e conversas diretamente. A conversa de dono ainda exige autenticação na API. Assets ausentes, rotas desconhecidas de `/api` e métodos não GET não recebem HTML como fallback.

## Convenções e autenticação

Requests e respostas são JSON com campos `camelCase`. Timestamps usam ISO 8601 UTC. Erros têm `{ error: string, code: string }`. IDs de objetos são UUIDs; códigos públicos têm 96 bits de aleatoriedade. Credenciais e mensagens nunca vão em parâmetros de URL.

Login retorna um token opaco. Envie `Authorization: Bearer TOKEN` em todas as rotas de dono. Sessões duram 30 dias; logout revoga a sessão atual. Recuperação revoga todas as sessões. O banco guarda apenas hashes de tokens e códigos de recuperação. Senhas usam scrypt com salt individual e comparação em tempo constante.

Um aviso anônimo retorna outro token, uma capacidade exclusiva daquela conversa. Use esse token somente nas rotas `/finder/reports/:id`. Um token de dono não acessa uma conversa de finder e vice-versa. Guarde a capacidade no mesmo navegador/dispositivo; ela não é enviada por e-mail e não pode ser recuperada se o armazenamento do navegador for apagado. A conversa encerrada permanece legível, mas não recebe novas mensagens.

### Operações repetíveis e resposta perdida

`POST /tags`, `POST /public/tags/:code/reports` e os dois endpoints de mensagens aceitam `operationKey` opcional no JSON. Clientes antigos continuam funcionando sem o campo; nesse caso, cada POST válido cria um recurso novo. Clientes atuais devem gerar **32 bytes aleatórios com CSPRNG**, representados por 64 caracteres hexadecimais, e persistir a chave junto ao corpo antes de enviar. Maiúsculas são normalizadas para minúsculas. Chaves nulas ou em formato inválido retornam `400 INVALID_OPERATION_KEY`.

A mesma chave com o mesmo conteúdo validado retorna o mesmo recurso, mantendo `201`; aviso público também retorna a mesma capacidade. Campos editáveis são normalizados antes da comparação, e campos desconhecidos não alteram o conteúdo considerado. Tags e reports são apresentados com seu estado atual; mensagens são imutáveis. A mesma chave com conteúdo diferente retorna `409 OPERATION_CONFLICT`, sem alterar dados. O escopo inclui a ação e o dono, ou a etiqueta pública/conversa e papel, conforme o endpoint.

Registro da operação e escrita do recurso ocorrem na mesma transação SQLite. Repetições sobrevivem a reinício e não têm expiração automática nesta versão. O banco guarda somente digest da chave, HMAC do conteúdo e referência ao recurso; capacidades de finder são derivadas da chave com domínio separado e persistidas somente como hash. **A chave de operação de um aviso é um segredo que permite retomar aquela conversa:** não a coloque em URL, log ou telemetria.

Autorização é verificada antes de qualquer replay autenticado. Logout/expiração continuam retornando `401`; antigo dono não recupera dados da etiqueta transferida (`404`). Repetir uma criação de aviso ou mensagem já gravada funciona após pausa/encerramento, pois apenas consulta a gravação anterior; uma chave nova respeita o bloqueio. Replays continuam sujeitos aos limites de requisições.

Em falha de conexão, aborto, resposta `5xx` ou `429`, preserve chave e corpo para repetir. `400` de validação e `413` acontecem antes de escrever esse pedido. Não interprete perda da resposta como prova de que o servidor não gravou. Nunca reutilize a chave para outro conteúdo no mesmo escopo.

### Conta

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` | `201 { token, user, recoveryCode }` |
| `POST /auth/login` | `{ email, password }` | `{ token, user }` |
| `POST /auth/recover` | `{ email, recoveryCode, password }` (senha nova) | `{ token, user, recoveryCode }` (novo código) |
| `GET /auth/me` | — | `{ user }` |
| `POST /auth/logout` | — | `204` |
| `POST /account/recovery-code` | `{ password, operationKey }` (senha atual; chave obrigatória) | `{ recoveryCode }` |
| `GET /account/export` | — | JSON para download com `{ exportedAt, user, tags, reports }`; cada report inclui mensagens. |

`user`: `{ id, name, email, createdAt }`. Nome: 1–80 caracteres. Senha: 10–128 caracteres, espaços preservados. E-mail é normalizado para minúsculas. Cadastro e login não exigem verificação de e-mail. O código de recuperação deve ser guardado pelo usuário e é invalidado após o uso; a resposta de recuperação sempre fornece um substituto. O export é uma cópia legível dos dados, sem senhas, hashes ou tokens; não existe importação automática.

`/account/recovery-code` exige sessão válida e reautenticação com senha atual. Emite um novo código e invalida o anterior, sem mudar senha ou revogar sessões. A mesma operação pode obter o código novamente, inclusive após reinício, desde que ele continue atual. Se outra emissão o substituiu, o replay retorna `409 OPERATION_SUPERSEDED`; uma operação antiga nunca restaura um código invalidado. A senha e a sessão são revalidadas após scrypt. O código é derivado com domínio separado da chave secreta de operação; somente seu hash persiste no usuário. Guarde a chave de operação como credencial.

`/auth/recover` permanece de uso único. Se a resposta de recuperação se perder após o servidor trocar a senha, entre com a **senha nova** e use `/account/recovery-code` para emitir um código conhecido. Essa emissão é repetível mesmo se sua própria resposta se perder.

### Etiquetas do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /tags` | — | `{ tags: Tag[] }`, recentes primeiro |
| `POST /tags` | `{ name, category?, color?, description?, publicMessage?, status?, rewardAmount?, rewardCurrency?, operationKey? }` | `201 { tag }` |
| `GET /tags/:id` | — | `{ tag }` |
| `PATCH /tags/:id` | Campos editáveis da criação e/ou `{ prepared: boolean }` | `{ tag }` |
| `GET /tags/:id/history` | — | `{ events: [{ id, type, status, createdAt }] }`, recentes primeiro |
| `POST /tags/:id/transfer` | `{ email, password }` (senha do dono atual) | `{ ok: true }` |
| `GET /tags/:id/qr.png` | — | PNG 900×900, attachment |
| `GET /tags/:id/label.pdf?format=standard\|compact\|fold` | — | PDF A4, attachment; padrão `standard` |

```ts
type Tag = {
  id: string;
  code: string;
  name: string;
  category: string;
  color: string;
  description: string;       // Privada: só o dono vê.
  publicMessage: string;     // Exibida a quem abre o QR.
  status: 'active' | 'lost' | 'paused';
  rewardAmount: number;
  rewardCurrency: 'BRL' | 'USD' | 'USDC' | 'SOL' | 'SKR';
  publicUrl: string;         // PUBLIC_URL + /found/CODE
  createdAt: string;
  updatedAt: string;
  returnedAt: string | null;
  preparedAt: string | null; // Declaração do dono; nunca confirmação automática de QR/NFC.
  recoveryCount: number;
  reportCount: number;
  openReportCount: number;
};
```

Nome: 1–80 caracteres; categoria/cor: 1–32; descrição privada/mensagem pública: até 500. Campos omitidos recebem `category: 'other'`, `color: '#B9C79B'`, `status: 'active'`, textos vazios, `rewardAmount: 0`, `rewardCurrency: 'BRL'`. Até 500 etiquetas por conta. O dono desativa uma etiqueta com `PATCH { status: 'paused' }`; a mesma etiqueta pode ser reativada, mantendo seu QR.

Etiquetas novas começam com `preparedAt: null`. `PATCH { prepared: true }` registra a declaração do dono de que preparou a etiqueta; repetir mantém o mesmo timestamp. `prepared: false` limpa a declaração. Baixar PDF/QR não altera esse estado. O campo não aparece na resposta pública.

Todos os PDFs usam uma página A4 (210 × 297 mm) e indicam impressão em escala 100%. `standard`: seis etiquetas de aproximadamente 88,2 × 73 mm, preservando o tamanho anterior de 250 × 207 pontos; `compact`: quinze de 50 × 40 mm; `fold`: quatro de 90 × 100 mm abertas, com vinco central, resultando em 90 × 50 mm dobradas e QR nos dois lados. Formato desconhecido ou repetido retorna `400`. Os testes leem o PDF e decodificam o QR embutido; impressão e leitura físicas dependem da impressora, papel e dispositivo e devem ser verificadas pelo usuário.

Transferência exige conta de destino existente, senha correta e ausência de conversas abertas. O QR continua igual. Descrição privada, mensagem pública, recompensa, declaração `preparedAt` e métricas de devoluções anteriores são zeradas. Conversas antigas permanecem acessíveis apenas ao dono anterior e aos respectivos finders; o novo dono recebe somente conversas criadas após a transferência. O histórico do novo dono inicia na transferência.

Recompensa é um **valor opcional prometido pelo dono**, de 0 a 1.000.000 na unidade escolhida. Esta API não recebe, custodia, deposita, bloqueia, paga ou reembolsa fundos. Não há escrow nem transações de blockchain. Confirmar devolução registra a recuperação do objeto e não executa pagamento.

### Página pública e finder

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /public/tags/:code` | — | `{ tag: PublicTag }` |
| `POST /public/tags/:code/reports` | `{ finderName?, message, operationKey? }` | `201 { report, token, messages }` |
| `GET /finder/reports/:id` | — | `{ report, messages, tag: PublicTag }` |
| `POST /finder/reports/:id/messages` | `{ body, operationKey? }` | `201 { message }` |

`PublicTag` contém exclusivamente `{ code, name, category, color, publicMessage, status, rewardAmount, rewardCurrency }`. Não inclui e-mail, nome da conta, ID do dono, descrição privada ou histórico. Etiqueta pausada responde `410 TAG_PAUSED` à consulta pública, criação de aviso e envio de mensagens. Uma conversa existente pode continuar sendo lida e mostra o status pausado. `active` e `lost` aceitam avisos: encontrar um item antes de o dono perceber a perda também é um caso válido.

`finderName`: até 60 caracteres, opcional, padrão `Pessoa que encontrou`. Mensagem inicial e respostas: 1–2.000 caracteres. A API transporta texto como dado; o cliente deve renderizar como texto e não como HTML. Não há envio de localização ou contato implícito; o usuário escolhe o que compartilha na mensagem.

### Conversas do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /reports` | — | `{ reports: Report[] }`, atualização recente primeiro |
| `GET /reports/:id` | — | `{ report, messages }` |
| `POST /reports/:id/messages` | `{ body, operationKey? }` | `201 { message }` |
| `POST /reports/:id/read` | `{ lastMessageId: number }` | `{ report }` |
| `POST /reports/:id/close` | `{ reason: 'mistake' \| 'no_return' \| 'unwanted' }` | `{ report }` |
| `POST /reports/:id/resolve` | — | `{ report }` |

```ts
type Report = {
  id: string;
  tagId: string;
  tagName: string;            // Snapshot na criação do aviso.
  tagCode: string;
  finderName: string;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  lastMessageId: number | null;
  lastMessageRole: 'owner' | 'finder' | null;
  messageCount: number;
  unreadCount: number;       // Mensagens finder após o cursor de leitura do dono.
  closedReason: 'returned' | 'mistake' | 'no_return' | 'unwanted' | null;
  closedAt: string | null;
};
type Message = {
  id: number;
  role: 'owner' | 'finder';
  body: string;
  createdAt: string;
};
```

Faça polling da conversa e lista de avisos enquanto a tela estiver visível. As mensagens são persistidas e consultadas pela outra pessoa. O módulo opcional de avisos por e-mail pode ser configurado no servidor; sem configuração, a consulta no app continua funcionando.

GET não marca mensagens como lidas. `/read` aceita o ID da última mensagem realmente mostrada ou `0`. O ID deve pertencer à conversa; um ID futuro ou de outra conversa retorna `400`. O cursor só avança, portanto requisições antigas/concorrentes não desfazem leitura nem marcam mensagens futuras. Só o dono pode atualizar o cursor; mensagens enviadas pelo próprio dono não aumentam `unreadCount`.

Resolver é idempotente: fecha todas as conversas **ainda abertas** daquele item com `closedReason: 'returned'`, ativa a etiqueta, preenche `returnedAt` e incrementa `recoveryCount` uma única vez por devolução. Novos avisos futuros podem registrar outra devolução. `/close` encerra somente o aviso escolhido, registra motivo/timestamp e mantém o status do item, `returnedAt` e contagem de devoluções. Repetir o mesmo fechamento retorna o resultado existente; tentar trocar o motivo de um aviso já encerrado retorna `409 REPORT_RESOLVED`. Resolver um aviso anteriormente fechado por outro motivo é uma consulta sem efeito: não inventa uma devolução nem fecha um incidente posterior. Avisos encerrados mantêm `status: 'resolved'` para compatibilidade; use `closedReason` para distinguir devolução e encerramento sem devolução. Finder e dono continuam lendo o histórico; mensagens novas são rejeitadas com `409 REPORT_RESOLVED`.

### Avisos opcionais por e-mail

Todos os endpoints abaixo exigem token de dono. Respondem diretamente com `{ available, verified, enabled, pending, failedCount }`. `available` indica configuração habilitada com transporte e origem HTTPS elegível; não é uma confirmação de entrega real. Sem configuração, retorna `false` e o restante do app continua funcionando.

| Método e rota | Corpo | Efeito |
|---|---|---|
| `GET /account/notifications` | — | Consulta preferência, confirmação e quantidade de avisos cuja entrega falhou. |
| `POST /account/notifications/verification` | `{ operationKey }`, 64 caracteres hexadecimais minúsculos | Envia um código de seis dígitos ao e-mail da conta. A chave permite repetir o mesmo pedido. |
| `POST /account/notifications/verify` | `{ code }`, seis dígitos | Confirma o e-mail e ativa avisos. Repetição após confirmação consulta o estado atual e não desfaz opt-out posterior. |
| `PATCH /account/notifications` | `{ enabled: boolean }` | Ativa somente se o e-mail já foi confirmado e o transporte está disponível; desativar cancela fila pendente e desafios de verificação. |

O código de verificação depende de um segredo aleatório de 32 bytes do servidor, persistido em `notification_secrets`; a chave conhecida pelo cliente não permite calculá-lo. O banco guarda somente hash do código do desafio. Código válido por 15 minutos, no máximo cinco tentativas; um pedido diferente exige intervalo mínimo de um minuto. Limites adicionais por conta: oito pedidos e dez verificações a cada 15 minutos. `502 EMAIL_DELIVERY_UNCERTAIN` preserva o desafio e permite repetir a mesma operação/código; `409 VERIFICATION_EXPIRED` exige uma nova operação. Ao atualizar bancos anteriores sem segredo do servidor, desafios pendentes são invalidados; preferências já verificadas permanecem.

Somente mensagens novas de finder geram avisos para donos que confirmaram e ativaram a preferência. A fila é gravada na mesma transação da mensagem; replay não cria outro aviso. Mensagens próximas da mesma conversa são agrupadas por 30 segundos. Antes de enviar, a fila verifica leitura, encerramento e opt-out. O e-mail contém apenas um aviso genérico e link `/owner-chat/:id`, que exige login; não inclui conteúdo, contato do finder, nome do objeto, QR ou tokens. Avisos já aceitos pelo provedor não podem ser desfeitos por leitura/desativação posterior.

A fila persiste após reinício e usa uma chave estável por aviso no provedor. Falhas temporárias têm retry com atraso crescente, até seis tentativas e janela de 23 horas; falha definitiva incrementa `failedCount`. Se `PUBLIC_URL` mudar, jobs ainda não tentados recebem a origem atual; jobs com tentativa anterior ficam como falha interna `PUBLIC_URL_CHANGED`, sem reenviar endereço antigo nem mudar o conteúdo sob a mesma chave. Endereços locais/IP e HTTP não habilitam envio. A verificação do formato da origem não verifica DNS ou alcançabilidade pela internet.

## Controles e limites

- Todo acesso de dono filtra pelo usuário autenticado; IDs de outra conta retornam `404`.
- Recovery e transferência revalidam a autorização após o hash assíncrono de senha; códigos não podem ser usados duas vezes em requisições concorrentes.
- CORS restringe origens web. Tokens nunca são aceitos por query string e não são cookies. Respostas usam `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `X-Content-Type-Options: nosniff`.
- Corpo JSON máximo: 16 KiB. Até 100 conversas abertas por etiqueta e 1.000 mensagens por conversa.
- Limite global: 300 requests/min/IP. Autenticação: 30 requests/15 min/IP; login/recovery também 10/15 min/e-mail. Avisos anônimos: 6/10 min/IP. Mensagens: 30/min/conta ou conversa. Escritas de dono: 100/min/conta. Limites são locais ao processo e reiniciam junto com ele.
- O serviço não confia em `X-Forwarded-For`. Atrás de proxy, limite também na borda; as cotas locais podem agregar visitantes pelo IP do proxy. Escala com vários processos exige rate limiting compartilhado e banco apropriado.
- Banco em arquivo recebe permissão `0600`; diretório novo, `0700`. Use disco persistente, backup consistente do SQLite e acesso restrito ao host. Mensagens são privadas por autorização, não criptografadas ponta a ponta.
- Migrações adicionam colunas/tabelas dentro de transação, sem recriar/apagar dados. Avisos resolvidos na versão anterior recebem `closedReason: 'returned'` e `closedAt` do timestamp existente, pois a versão anterior só encerrava por devolução. Etiquetas existentes recebem `preparedAt: null`; leitura inicia no cursor `0`.

## Verificação

`npm test` executa testes HTTP reais contra portas efêmeras e bancos isolados, sem depender da instância de desenvolvimento. Cobrem ciclo completo de devolução, privacidade, autorização, capacidades, pausa/reativação, transferência, recuperação/revogação inclusive concorrente, persistência após restart, bytes de PNG/PDF, URL canônica, validação, limite de spam, export estático, fallback de rotas e proteção contra acesso fora do diretório web. As regressões de operações repetíveis interrompem a conexão depois de o POST ser gravado por uma API real e verificam que a repetição não duplica recurso/mensagem. Também verificam segredo ausente no SQLite, recuperação com resposta perdida, leitura monotônica, fechamento sem devolução, migração do esquema antigo e os três PDFs com QR decodificado.

Referências primárias de implementação: [SQLite no Node.js](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) e [API Express 5](https://expressjs.com/en/5x/api/). O módulo SQLite embutido exibe aviso experimental no Node.js 24 usado na validação; nenhum driver nativo extra é necessário.
