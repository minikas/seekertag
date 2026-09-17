# Recompensas Solana

O contrato Anchor fica em `contracts/seekertag-escrow`. O programa esperado pela API e pelo Android é `4vUZidqPqRNfVvagWxzZL4xBXeyJLrkuwKfKicVniQWB`. A configuração inicial é devnet. O login SIWS continua sem transação e sem taxa; cada depósito, renovação, pagamento ou reembolso solicita uma assinatura própria.

## Regras

- Depósito: SOL nativo ou tokens do programa SPL Token original. Mainnet fixa os mints oficiais de USDC e SKR; Token-2022 e saldo em staking não são aceitos.
- Prazo inicial: de 1 hora a 5 anos, escolhido pelo dono em horas, dias, meses ou anos. O formulário aceita quantidades inteiras; mês equivale a 30 dias e ano a 365 dias. A transação usa segundos inteiros e a contagem começa no relógio da rede.
- Renovação: assinatura do dono; soma o período escolhido a `max(vencimento, agora)` e limita o resultado a 5 anos a partir de agora. Não diminui o prazo e não movimenta a recompensa.
- Devolução: carteira do dono e verificador do serviço assinam juntos, pagando exatamente a recompensa à carteira que comprovou posse na conversa. O programa registra o hash do ID da conversa e o destinatário. O servidor sozinho não pode pagar ou retirar fundos.
- Cancelamento: somente o dono e apenas após o vencimento. O dinheiro volta à carteira que fez o depósito. Não há cancelamento antecipado, resgate automático no vencimento ou pagamento automático ao visitante.
- Pagamento encerra todas as conversas abertas do objeto e incrementa uma única devolução. Sem reserva, continua disponível a confirmação de devolução comum.
- A recompensa e a transferência de titularidade ficam bloqueadas enquanto existir depósito pendente ou reserva. Nome, categoria e anotações continuam editáveis.

O contrato guarda um recibo permanente de 226 bytes. Ele impede reabertura/replay e permite recuperar o estado mesmo quando o RPC não retém a transação antiga. O custo dessa conta não é devolvido. A conta SPL do cofre é fechada no pagamento/reembolso, devolvendo seu aluguel ao dono; contas de tokens do destinatário continuam existindo. A revisão apresenta taxa e custo de criação separadamente. Doações extras para o cofre voltam ao depositante e não impedem a liquidação.

## Confirmação e falhas de rede

Os valores monetários atravessam a API como strings de unidades inteiras. O servidor compara dono, verificador, mint, valor e ID do recibo finalizado; consulta também o saldo do cofre. Nunca marca uma reserva apenas porque a carteira retornou uma assinatura. Se não conseguir verificar a rede, informa `unverified`.

Cada operação tem uma transação preparada, com blockhash e prazo de validade. A API e o Android conferem todas as instruções e permissões de todas as contas, preservando a ordem original da mensagem para evitar diferenças de `localeCompare` entre Node e Hermes. Após a assinatura, exigem os mesmos bytes da mensagem preparada e verificam todas as assinaturas: instruções extras, carteira pagadora, valores ou destinatários alterados são rejeitados. O Android guarda a transação assinada antes de enviar, e o servidor grava a mesma assinatura antes de transmitir. Retentativas reutilizam os mesmos bytes, sem criar outro depósito.

Novas operações incluem `computeBudget: fixed-v1`: limite de 200.000 unidades e preço de 1.000 micro-lamports por unidade (200 lamports de prioridade). O RPC calcula a taxa total antes da revisão e da verificação de saldo. Declarar as duas instruções evita que a Seed Vault Wallet as acrescente após a revisão, alterando a mensagem e invalidando a assinatura parcial do verificador nos pagamentos. Operações antigas preservam o formato sem orçamento explícito; qualquer mudança de taxa ou instrução após a revisão continua sendo rejeitada.

A reconciliação usa o recibo finalizado e o estado da assinatura. Antes de expirar uma operação, relê o recibo com `minContextSlot` no slot finalizado que ultrapassou a validade, evitando descartar um depósito que confirmou entre duas consultas. Leitura da recompensa, leitura de operação e novas tentativas reconciliam o estado. O Android consulta enquanto a tela está em primeiro plano e retoma ao reabrir; não depende de uma tarefa em segundo plano para manter a custódia.

`reserved` significa saldo confirmado, `expired` significa reserva ainda existente e já cancelável, `released` pagamento confirmado, `refunded` devolução confirmada. `pending` não é reserva garantida. Valores antigos sem recibo são apenas anunciados.

## Configuração

Instale as dependências na raiz e em `server`. A API lê:

| Variável | Uso |
|---|---|
| `REWARD_VERIFIER_KEYPAIR` | Caminho privado de uma chave Ed25519 do verificador; vazio desabilita depósitos |
| `REWARD_NETWORK` | `devnet` por padrão; `localnet` somente para testes; `mainnet` exige ativação adicional |
| `REWARD_RPC_URL` | RPC HTTPS; loopback HTTP permitido somente para localnet |
| `REWARD_TEST_USDC_MINT` | Mint de teste em devnet/localnet; padrão é o mint Circle devnet |
| `REWARD_TEST_SKR_MINT` | Mint de teste em devnet/localnet; se ausente, SKR não é oferecido |
| `REWARDS_ALLOW_MAINNET` | Deve ser `true` para ativar deliberadamente mainnet |

Em mainnet os mints são fixos no código, ignorando as variáveis de teste:

- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 casas decimais.
- SKR: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`, 6 casas decimais.

O RPC deve corresponder ao genesis hash da rede configurada e conter o programa executável. Não coloque chave privada em `EXPO_PUBLIC_*`, logs ou commits. Monte a chave como arquivo privado no servidor e preserve-a junto ao backup do SQLite. Perder esse verificador impede novos pagamentos das reservas existentes; o cancelamento do dono após o vencimento continua possível no contrato. A autoridade de atualização do programa também deve ser protegida: uma publicação atualizável continua dependendo dela.

## Build e testes

```sh
npm ci
npm ci --prefix server
npm run build:escrow
npm --prefix server run test:escrow
npm run test:all
```

`build:escrow` usa `cargo-build-sbf` do Agave (ou `CARGO_BUILD_SBF`) com dependências Rust travadas. A suíte carrega o `.so` real no LiteSVM: SOL/USDC/SKR, saldos, datas, renovação, cancelamento, assinatura dupla, contas de destino e replay. A integração HTTP usa SQLite isolado e a mesma implementação RPC da produção sobre essa VM; testa finality atrasada, perdas de resposta e isolamento de sessões. A VM pode avançar o relógio e conferir reembolso no vencimento sem esperar dias.

Para publicar em **devnet**, use apenas chaves de desenvolvimento e SOL do faucet. Gere chaves de programa/pagador/buffer separadas, mantenha os caminhos privados e use `solana program deploy` com `--url devnet`, `--program-id`, `--buffer`, `--keypair` e `--upgrade-authority` explícitos. A chave de programa precisa corresponder ao ID compilado. Nunca reaproveite automaticamente o signer padrão do CLI.

Após publicar o programa:

```sh
# Requer artifacts/reward-keys/devnet-payer.json e verifier.json privados.
# Cria dois mints próprios SEM valor real, exclusivos de devnet:
node scripts/devnet-rewards.mjs init
node scripts/devnet-rewards.mjs fund ENDERECO_PUBLICO_DO_SEEKER

# Fluxo real de devnet em API/SQLite isolados, com carteiras de teste:
npm run test:devnet

# API do app com a configuração de teste, sem editar arquivos .env:
npm run api:devnet
```

O utilitário recusa qualquer genesis hash fora de devnet e nunca lê a carteira padrão do CLI. `artifacts/rewards-devnet.json` contém apenas IDs públicos dos mints/programa/verificador. O teste publica três depósitos de uma hora, renova por um ano e paga a um visitante com carteira comprovada, verificando o aumento exato do saldo e o encerramento da conversa. Guarda assinaturas públicas em `artifacts/devnet-reward-verification.json`. Reembolso real após o prazo exige aguardar ao menos uma hora em devnet; o bloqueio e o vencimento completo são cobertos pela VM.

Para testar no Android, configure a API com os mints criados, instale o APK e encaminhe a porta por ADB. A carteira MWA precisa aceitar `solana:devnet` e `signTransactions`. Confira a revisão e aprove manualmente a assinatura; o login anterior não autoriza esses pagamentos. Cancelar a carteira deixa o pedido pendente até expirar e não anuncia uma reserva. Uma revisão aberta mantém valor e prazo se o blockhash expirar: ao tocar em Assinar, a API reconcilia o pedido anterior antes de preparar a substituição. Mudanças nas taxas exigem nova revisão.

## Rotas

Todas as rotas do dono exigem a sessão; as do visitante exigem a credencial daquela conversa.

| Método / caminho (prefixo `/api`) | Resposta / ação |
|---|---|
| `GET /rewards/config` | Configuração e carteira do dono antes de criar o objeto |
| `GET /rewards/balance?currency=SOL` | Saldo da carteira do dono antes de criar o objeto |
| `GET /tags/:id/reward` | `reward`, `config`, `payer`; reconcilia a rede |
| `GET /tags/:id/reward/balance?currency=SOL` | `availableUnits`, `solLamports`, mint e casas decimais |
| `POST /tags/:id/reward/prepare` | Prepara `fund`, `renew`, `release` ou `refund`; devolve `operation` |
| `GET /reward-operations/:operationId` | Operação, estado e reserva reconciliada |
| `POST /reward-operations/:operationId/submit` | Recebe `{transaction}` em base64; verifica assinaturas e envia a mesma transação |
| `POST /reward-operations/:operationId/retry` | Reenvia a assinatura já armazenada, quando ainda válida |
| `GET /reports/:id/reward` | Reserva e carteira verificada do visitante |
| `GET /finder/reports/:id/reward` | Mesma consulta, vinculada à credencial do visitante |
| `POST /finder/reports/:id/reward/wallet/challenge` | Desafio SIWS específico da conversa, 5 minutos |
| `POST /finder/reports/:id/reward/wallet/verify` | Comprova posse, vincula carteira e consome nonce |

Depósito recebe `{kind:"fund",currency:"SOL",amount:"0.01",durationSeconds:2592000}`; renovação `{kind:"renew",durationSeconds:604800}`; pagamento `{kind:"release",reportId}`; cancelamento `{kind:"refund"}`. O servidor escolhe destinatário, valor, mint, programa e verificador a partir de dados validados. A carteira do visitante não pode ser a do dono e não pode ser trocada depois da confirmação na conversa.

O contrato preserva as instruções antigas `fund_sol`, `fund_token` e `renew`, com `days` de 1 a 365, para não invalidar transações já preparadas. O aplicativo novo usa `fund_sol_timed`, `fund_token_timed` e `renew_timed`, com `durationSeconds` (`u32`). A API rejeita pedidos que misturam `days` e `durationSeconds`. O recibo e as regras de liberação/reembolso não mudaram.

No Android, a seção de recompensa fica no Gorhom de adicionar/editar objeto. Valor, moeda, saldo e período são editados uma única vez; a revisão é uma etapa do mesmo sheet. O objeto é salvo antes de preparar o depósito, mantendo seu ID ao repetir ou abandonar a revisão. Até a confirmação final, ele continua sem recompensa garantida. A liberação na conversa também usa Gorhom.

Referências: [MWA](https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly), [Anchor 0.32.1](https://www.anchor-lang.com/docs/updates/release-notes/0-32-1), [contas e restrições Anchor](https://www.anchor-lang.com/docs/references/account-constraints), [USDC oficial](https://developers.circle.com/stablecoins/usdc-contract-addresses), [SKR oficial](https://github.com/solana-mobile/react-native-samples/tree/main/skr-staking), [redes Solana](https://solana.com/docs/references/clusters).
