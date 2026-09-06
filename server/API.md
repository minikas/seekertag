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

Para ler a etiqueta em outro celular na mesma rede, configure `PUBLIC_URL` com o IP local e a porta do app web e a URL da API correspondente no cliente Expo. Para funcionamento pela internet, publique web e API com HTTPS, domínio estável e armazenamento persistente. **QRs emitidos com localhost só abrem no computador que hospeda o app.** Imprima etiquetas definitivas depois de definir o domínio público. A API nunca usa o cabeçalho Host do visitante para compor o QR.

Depois de exportar a aplicação Expo para `dist`, `npm start` também serve a interface pela mesma porta da API. Configure `PUBLIC_URL` com a origem pública desse processo. Arquivos estáticos ficam limitados ao diretório exportado; arquivos ocultos, travessia de diretórios e links simbólicos que escapam dele são rejeitados. Somente `GET /`, `GET /found/:code` e `GET /chat/:id` recebem o `index.html` como fallback, permitindo abrir QRs e conversas diretamente. Assets ausentes, rotas desconhecidas de `/api` e métodos não GET não recebem HTML como fallback.

## Convenções e autenticação

Requests e respostas são JSON com campos `camelCase`. Timestamps usam ISO 8601 UTC. Erros têm `{ error: string, code: string }`. IDs de objetos são UUIDs; códigos públicos têm 96 bits de aleatoriedade. Credenciais e mensagens nunca vão em parâmetros de URL.

Login retorna um token opaco. Envie `Authorization: Bearer TOKEN` em todas as rotas de dono. Sessões duram 30 dias; logout revoga a sessão atual. Recuperação revoga todas as sessões. O banco guarda apenas hashes de tokens e códigos de recuperação. Senhas usam scrypt com salt individual e comparação em tempo constante.

Um aviso anônimo retorna outro token, uma capacidade exclusiva daquela conversa. Use esse token somente nas rotas `/finder/reports/:id`. Um token de dono não acessa uma conversa de finder e vice-versa. Guarde a capacidade no mesmo navegador/dispositivo; ela não é enviada por e-mail e não pode ser recuperada se o armazenamento do navegador for apagado. A conversa encerrada permanece legível, mas não recebe novas mensagens.

### Conta

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` | `201 { token, user, recoveryCode }` |
| `POST /auth/login` | `{ email, password }` | `{ token, user }` |
| `POST /auth/recover` | `{ email, recoveryCode, password }` (senha nova) | `{ token, user, recoveryCode }` (novo código) |
| `GET /auth/me` | — | `{ user }` |
| `POST /auth/logout` | — | `204` |
| `GET /account/export` | — | JSON para download com `{ exportedAt, user, tags, reports }`; cada report inclui mensagens. |

`user`: `{ id, name, email, createdAt }`. Nome: 1–80 caracteres. Senha: 10–128 caracteres, espaços preservados. E-mail é normalizado para minúsculas. Não há envio/verificação de e-mail. O código de recuperação aparece uma vez, deve ser guardado pelo usuário e é invalidado após o uso; a resposta de recuperação sempre fornece um substituto. O export é uma cópia legível dos dados, sem senhas, hashes ou tokens; não existe importação automática.

### Etiquetas do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /tags` | — | `{ tags: Tag[] }`, recentes primeiro |
| `POST /tags` | `{ name, category?, color?, description?, publicMessage?, status?, rewardAmount?, rewardCurrency? }` | `201 { tag }` |
| `GET /tags/:id` | — | `{ tag }` |
| `PATCH /tags/:id` | Campos editáveis da criação | `{ tag }` |
| `GET /tags/:id/history` | — | `{ events: [{ id, type, status, createdAt }] }`, recentes primeiro |
| `POST /tags/:id/transfer` | `{ email, password }` (senha do dono atual) | `{ ok: true }` |
| `GET /tags/:id/qr.png` | — | PNG 900×900, attachment |
| `GET /tags/:id/label.pdf` | — | PDF A4 com seis etiquetas recortáveis, attachment |

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
  recoveryCount: number;
  reportCount: number;
  openReportCount: number;
};
```

Nome: 1–80 caracteres; categoria/cor: 1–32; descrição privada/mensagem pública: até 500. Campos omitidos recebem `category: 'other'`, `color: '#B9C79B'`, `status: 'active'`, textos vazios, `rewardAmount: 0`, `rewardCurrency: 'BRL'`. Até 500 etiquetas por conta. O dono desativa uma etiqueta com `PATCH { status: 'paused' }`; a mesma etiqueta pode ser reativada, mantendo seu QR.

Transferência exige conta de destino existente, senha correta e ausência de conversas abertas. O QR continua igual. Descrição privada, mensagem pública, recompensa e métricas de devoluções anteriores são zeradas. Conversas antigas permanecem acessíveis apenas ao dono anterior e aos respectivos finders; o novo dono recebe somente conversas criadas após a transferência. O histórico do novo dono inicia na transferência.

Recompensa é um **valor opcional prometido pelo dono**, de 0 a 1.000.000 na unidade escolhida. Esta API não recebe, custodia, deposita, bloqueia, paga ou reembolsa fundos. Não há escrow nem transações de blockchain. Confirmar devolução registra a recuperação do objeto e não executa pagamento.

### Página pública e finder

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /public/tags/:code` | — | `{ tag: PublicTag }` |
| `POST /public/tags/:code/reports` | `{ finderName?, message }` | `201 { report, token, messages }` |
| `GET /finder/reports/:id` | — | `{ report, messages, tag: PublicTag }` |
| `POST /finder/reports/:id/messages` | `{ body }` | `201 { message }` |

`PublicTag` contém exclusivamente `{ code, name, category, color, publicMessage, status, rewardAmount, rewardCurrency }`. Não inclui e-mail, nome da conta, ID do dono, descrição privada ou histórico. Etiqueta pausada responde `410 TAG_PAUSED` à consulta pública, criação de aviso e envio de mensagens. Uma conversa existente pode continuar sendo lida e mostra o status pausado. `active` e `lost` aceitam avisos: encontrar um item antes de o dono perceber a perda também é um caso válido.

`finderName`: até 60 caracteres, opcional, padrão `Pessoa que encontrou`. Mensagem inicial e respostas: 1–2.000 caracteres. A API transporta texto como dado; o cliente deve renderizar como texto e não como HTML. Não há envio de localização ou contato implícito; o usuário escolhe o que compartilha na mensagem.

### Conversas do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /reports` | — | `{ reports: Report[] }`, atualização recente primeiro |
| `GET /reports/:id` | — | `{ report, messages }` |
| `POST /reports/:id/messages` | `{ body }` | `201 { message }` |
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
  messageCount: number;
};
type Message = {
  id: number;
  role: 'owner' | 'finder';
  body: string;
  createdAt: string;
};
```

Faça polling da conversa e lista de avisos enquanto a tela estiver visível. O produto não envia push/e-mail. As mensagens são persistidas e consultadas pela outra pessoa. Resolver é idempotente: fecha todas as conversas abertas daquele item, ativa a etiqueta, preenche `returnedAt` e incrementa `recoveryCount` uma única vez por devolução. Novos avisos futuros podem registrar outra devolução. Report encerrado rejeita mensagens com `409 REPORT_RESOLVED`.

## Controles e limites

- Todo acesso de dono filtra pelo usuário autenticado; IDs de outra conta retornam `404`.
- Recovery e transferência revalidam a autorização após o hash assíncrono de senha; códigos não podem ser usados duas vezes em requisições concorrentes.
- CORS restringe origens web. Tokens nunca são aceitos por query string e não são cookies. Respostas usam `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `X-Content-Type-Options: nosniff`.
- Corpo JSON máximo: 16 KiB. Até 100 conversas abertas por etiqueta e 1.000 mensagens por conversa.
- Limite global: 300 requests/min/IP. Autenticação: 30 requests/15 min/IP; login/recovery também 10/15 min/e-mail. Avisos anônimos: 6/10 min/IP. Mensagens: 30/min/conta ou conversa. Escritas de dono: 100/min/conta. Limites são locais ao processo e reiniciam junto com ele.
- O serviço não confia em `X-Forwarded-For`. Atrás de proxy, limite também na borda; as cotas locais podem agregar visitantes pelo IP do proxy. Escala com vários processos exige rate limiting compartilhado e banco apropriado.
- Banco em arquivo recebe permissão `0600`; diretório novo, `0700`. Use disco persistente, backup consistente do SQLite e acesso restrito ao host. Mensagens são privadas por autorização, não criptografadas ponta a ponta.

## Verificação

`npm test` executa testes HTTP reais contra portas efêmeras e bancos isolados, sem depender da instância de desenvolvimento. Cobrem ciclo completo de devolução, privacidade, autorização, capacidades, pausa/reativação, transferência, recuperação/revogação inclusive concorrente, persistência após restart, bytes de PNG/PDF, URL canônica, validação, limite de spam, export estático, fallback de rotas e proteção contra acesso fora do diretório web.

Referências primárias de implementação: [SQLite no Node.js](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) e [API Express 5](https://expressjs.com/en/5x/api/). O módulo SQLite embutido exibe aviso experimental no Node.js 24 usado na validação; nenhum driver nativo extra é necessário.
