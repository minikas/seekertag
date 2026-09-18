# SeekerTag API

API HTTP funcional para etiquetas QR/NFC e devolução por conversa privada. Dados persistem em SQLite. Requer Node.js 24 ou superior.

```sh
npm ci
npm run api
npm test
```

O serviço escuta `0.0.0.0:4318`. Base local: `http://localhost:4318/api`. `GET /api/health` retorna `{ ok, service, publicUrl }`.

## Configuração

Defina variáveis no ambiente do processo ou em `apps/api/.env`, carregado pelos comandos start/dev. O arquivo é opcional; veja `.env.example` para os nomes. Segredos dos provedores ficam somente na API.

| Variável | Padrão | Finalidade |
|---|---|---|
| `PORT` | `4318` | Porta da API. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `DATABASE_PATH` | `apps/api/data/seekertag.sqlite` | Banco persistente; arquivos de dados são ignorados pelo Git. |
| `PUBLIC_URL` | `http://localhost:4318` (ou `PORT`) | Origem canônica da API, usada em todos os QRs e etiquetas. Somente `http(s)://host[:port]`, sem credenciais/caminho/query. |
| `CORS_ORIGINS` | vazio | Origens adicionais, separadas por vírgula. A origem de `PUBLIC_URL` já é permitida. Clientes nativos sem cabeçalho Origin são aceitos. |

Para ler uma etiqueta em outro celular, configure `PUBLIC_URL` com a origem da API e `EXPO_PUBLIC_API_URL` com essa mesma origem seguida de `/api`. Na rede local, use um IP acessível pelos aparelhos. Pela internet, hospede somente a API com HTTPS, domínio estável e armazenamento persistente. A API nunca usa o cabeçalho Host do visitante para compor o QR.

Não há frontend web nem arquivos estáticos. `GET /found/:code` e `GET /chat/:id` retornam `302` com um link `seekertag:///found/CODIGO?origin=ORIGEM` ou `seekertag:///chat/ID?origin=ORIGEM`. A origem vem de `PUBLIC_URL`; parâmetros enviados pelo visitante não são repassados. O app instalado valida essa origem contra sua API configurada. Links de conversa não contêm credenciais. Não há página alternativa para quem não instalou o app. A raiz e os recursos desconhecidos retornam JSON `404`.

## Convenções e autenticação

Requests e respostas são JSON com campos `camelCase`, exceto o callback Apple, que também aceita `form_post`. Timestamps usam ISO 8601 UTC. Erros têm `{ error: string, code: string }`. IDs de objetos são UUIDs; códigos públicos têm 96 bits de aleatoriedade. Tokens de sessão e mensagens nunca vão em parâmetros de URL.

Login retorna um token opaco. Envie `Authorization: Bearer TOKEN` em todas as rotas de dono. Sessões duram 30 dias; logout revoga a sessão atual. Recuperação revoga todas as sessões. O banco guarda apenas hashes de tokens e códigos de recuperação. Senhas usam scrypt com salt individual e comparação em tempo constante.

Um aviso anônimo retorna outro token, uma capacidade exclusiva daquela conversa. Use esse token somente nas rotas `/finder/reports/:id`. Um token de dono não acessa uma conversa de finder e vice-versa. Guarde a capacidade no armazenamento seguro do aplicativo; ela não é enviada por e-mail e não pode ser recuperada se os dados do aplicativo forem apagados. A conversa encerrada permanece legível, mas não recebe novas mensagens.

### Conta

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` | `201 { token, user, recoveryCode }` |
| `POST /auth/login` | `{ email, password }` | `{ token, user }` |
| `POST /auth/recover` | `{ email, recoveryCode, password }` (senha nova) | `{ token, user, recoveryCode }` (novo código) |
| `GET /auth/me` | — | `{ user }` |
| `POST /auth/logout` | — | `204` |
| `GET /account/export` | — | JSON para download com `{ exportedAt, user, tags, reports }`; cada report inclui mensagens. |

`user`: `{ id, name, email: string | null, createdAt, hasPassword, providers: ('solana'|'google'|'apple')[], walletAddress: string | null }`. Nome: 1–80 caracteres. Senha: 10–128 caracteres, espaços preservados. E-mail é normalizado para minúsculas. O cadastro por senha não envia/verifica e-mail; logins sociais aceitam e-mail somente com a declaração de verificação assinada pelo provedor. O código de recuperação aparece uma vez para contas por senha e é invalidado após o uso. O export é uma cópia legível dos dados, sem senhas, hashes ou tokens; não existe importação automática.

### Carteira e provedores sociais

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /auth/providers` | — | `{ solana, google, apple }`, disponibilidade booleana |
| `POST /auth/wallet/challenge` | `{ mode?: 'login'|'link'|'reauth', language?: 'pt'|'en'|'es' }` | `{ challengeId, payload }`, entrada SIWS gerada pela API |
| `POST /auth/wallet/verify` | `{ challengeId, address, signedMessage, signature }`, três últimos em base64 padrão | Login: `{ token, user }`; vínculo: `{ user }`; confirmação: `{ proof }` |
| `POST /auth/oauth/:provider/start` | `{ mode?, codeChallenge }`, SHA-256 base64url do verifier do app | `{ flowId, url }` |
| `GET /auth/oauth/google/callback` | `state`, `code` enviados pelo Google | `303` para `seekertag://auth/callback?code=...&state=FLOW_ID` |
| `POST /auth/oauth/apple/callback` | `form_post` da Apple com `state`, `code` ou `error` | Mesmo retorno para o aplicativo |
| `POST /auth/oauth/exchange` | `{ flowId, code, verifier }` | Login: `{ token, user }`; vínculo: `{ user }`; confirmação: `{ proof }` |

`link` e `reauth` exigem o mesmo bearer válido no início e na conclusão. Um vínculo nunca substitui um acesso de outra conta; contas não são unidas por coincidência de e-mail. O login por carteira verifica SIWS e Ed25519, domínio, endereço, nonce e prazo de cinco minutos, com consumo único. O fluxo social dura dez minutos e valida state, nonce e JWT (assinatura, emissor, audience e validade). Apenas um código temporário protegido pela prova do aplicativo aparece no deep link. Os tokens do provedor não são persistidos.

Google/Apple exigem HTTPS em `PUBLIC_URL` e as variáveis completas em `.env.example`. Os callbacks e URLs autorizados estão descritos no README. A API retorna `503 PROVIDER_UNAVAILABLE` enquanto não estiverem configurados. O banco migra contas existentes preservando IDs, objetos e sessões; faça backup antes de atualizar uma instalação de produção.

### Categorias do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /categories` | — | `{ categories: Category[] }` |
| `POST /categories` | `{ name, icon?, color? }` | `201 { category }` |
| `PATCH /categories/:id` | `{ name?, icon?, color? }` | `{ category }`, atualiza os objetos vinculados |
| `DELETE /categories/:id` | `{ replacementId? }` | `204`; exige destino da mesma conta se houver objetos |

`Category` contém `{ id, name, icon, color, defaultKey, tagCount }`. Nome: 1–32 caracteres, único por conta após normalização Unicode e comparação sem diferença de maiúsculas. Cor: hexadecimal de seis dígitos. Ícones: `shopping-bag`, `briefcase`, `key`, `heart`, `headphones`, `box`, `smartphone`, `watch`, `book`, `camera`, `credit-card`, `umbrella`, `truck`, `home`, `coffee`, `tag`. Limite: 50 categorias. Seis categorias iniciais são criadas uma vez por conta; excluí-las é permanente. `defaultKey` identifica uma opção inicial para tradução, e fica `null` após renomeá-la.

O novo cliente envia `categoryId` na criação/edição do objeto; nome e cor vêm dessa categoria. O formato antigo `category`/`color` continua aceito e vincula uma categoria pertencente à conta. Categorias de outra conta são rejeitadas. A migração mantém nomes, cores e QRs antigos; renomear ou mover uma categoria preserva QRs e histórico. Transferir uma etiqueta reutiliza uma categoria correspondente do destino ou copia a categoria para ele, sem compartilhar a propriedade. A operação falha sem transferir se precisaria criar uma categoria acima do limite.

### Etiquetas do dono

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /tags` | — | `{ tags: Tag[] }`, recentes primeiro |
| `POST /tags` | `{ name, categoryId?, category?, color?, description?, publicMessage?, status?, rewardAmount?, rewardCurrency? }` | `201 { tag }` |
| `GET /tags/:id` | — | `{ tag }` |
| `PATCH /tags/:id` | Campos editáveis da criação | `{ tag }` |
| `GET /tags/:id/history` | — | `{ events: [{ id, type, status, createdAt }] }`, recentes primeiro |
| `POST /tags/:id/transfer` | `{ recipient, password }` ou `{ recipient, proof }`; `email` ainda é aceito como alias de `recipient` | `{ ok: true }` |
| `GET /tags/:id/qr.png` | — | PNG 900×900, attachment |
| `GET /tags/:id/label.pdf?lang=pt` | `lang`: `pt`, `en` ou `es` (padrão `pt`) | PDF A4 com 1 etiqueta grande, 2 médias e 4 pequenas, attachment |

```ts
type Tag = {
  id: string;
  code: string;
  name: string;
  category: string;
  categoryId: string | null;
  categoryIcon: string;
  categoryDefaultKey: string | null;
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

Nome: 1–80 caracteres; categoria/cor: 1–32; descrição privada/mensagem pública: até 500. Campos omitidos recebem `category: 'other'`, `color: '#B9C79B'`, `status: 'active'`, textos vazios, `rewardAmount: 0`, `rewardCurrency: 'BRL'`. A quantidade de etiquetas por conta não tem limite de produto. O app arquiva um objeto com `PATCH { status: 'paused' }`; ele sai das listas principais e pode ser restaurado com `PATCH { status: 'active' }`, mantendo seu QR.

Transferência exige conta de destino existente, senha correta ou prova de reautenticação e ausência de conversas abertas. O destino pode ser e-mail, endereço Solana vinculado ou ID da conta. A prova dura cinco minutos, pertence à sessão que a solicitou e é consumida na mesma transação da transferência. O QR continua igual. Descrição privada, mensagem pública, recompensa e métricas de devoluções anteriores são zeradas. Conversas antigas permanecem acessíveis apenas ao dono anterior e aos respectivos finders; o novo dono recebe somente conversas criadas após a transferência. O histórico do novo dono inicia na transferência.

O campo `rewardAmount` sozinho é um **valor opcional anunciado**, de 0 a 1.000.000 na unidade escolhida. A reserva real usa o contrato Solana e só recebe estado `reserved` após confirmação finalizada do depósito. Depósito, renovação, liberação ao visitante e reembolso exigem assinatura da carteira do dono; as rotas e regras estão em [REWARDS.md](REWARDS.md). Enquanto há reserva pendente/ativa, a API bloqueia alteração do valor, transferência da etiqueta e confirmação comum de devolução.

### Consulta pública e visitante

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /public/tags/:code` | — | `{ tag: PublicTag, viewerIsOwner: boolean }` |
| `POST /public/tags/:code/reports` | `{ finderName?, message }` | `201 { report, token, messages }` |
| `GET /finder/reports/:id` | — | `{ report, messages, tag: PublicTag }` |
| `POST /finder/reports/:id/messages` | `{ body }` | `201 { message }` |

As duas rotas `/public/tags/:code` aceitam a sessão da conta no cabeçalho `Authorization`. A consulta informa `viewerIsOwner` sem expor a identidade do dono; a criação de aviso responde `403 SELF_REPORT` se a conta for a dona atual do objeto. Uma sessão informada, mas inválida ou revogada, responde `401`; ela nunca é tratada como visita anônima. Visitantes sem sessão e outras contas continuam podendo avisar o dono.

`PublicTag` contém exclusivamente `{ code, name, category, categoryIcon, color, publicMessage, status, rewardAmount, rewardCurrency }`. Não inclui e-mail, nome da conta, ID do dono, descrição privada ou histórico. Objeto arquivado (`status: 'paused'`) responde `410 TAG_PAUSED` à consulta pública, criação de aviso e envio de mensagens. Uma conversa existente pode continuar sendo lida e mostra o estado arquivado. `active` e `lost` aceitam avisos: encontrar um item antes de o dono perceber a perda também é um caso válido.

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

`npm test` executa testes HTTP reais contra portas efêmeras e bancos isolados, sem depender da instância de desenvolvimento. Cobrem ciclo completo de devolução, privacidade, autorização, capacidades, pausa/reativação, transferência, recuperação/revogação inclusive concorrente, persistência após restart, bytes de PNG/PDF, URL canônica, validação, limite de spam, redirecionamentos para o app e ausência de interface/arquivos estáticos.

Referências primárias de implementação: [SQLite no Node.js](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) e [API Express 5](https://expressjs.com/en/5x/api/). O módulo SQLite embutido exibe aviso experimental no Node.js 24 usado na validação; nenhum driver nativo extra é necessário.

## Reservas de recompensa

As rotas de depósito, renovação, pagamento, cancelamento e comprovação da carteira do visitante estão documentadas em [REWARDS.md](REWARDS.md#rotas). Objetos e prévias públicas incluem `reward` somente quando existe uma reserva/recibo; os campos legados `rewardAmount` e `rewardCurrency` continuam aceitos como valores anunciados. Alterar esses campos ou transferir uma etiqueta com reserva ativa retorna `409 REWARD_LOCKED`.
