# Recompensas Solana

O contrato Anchor fica em `contracts/seekertag-escrow`. O programa esperado pela API e pelo Android é `4vUZidqPqRNfVvagWxzZL4xBXeyJLrkuwKfKicVniQWB`. A configuração inicial é devnet. O login SIWS continua sem transação e sem taxa; cada depósito, renovação, pagamento ou reembolso solicita uma assinatura própria.

## Regras

- Depósito: SOL nativo ou tokens do programa SPL Token original. Mainnet fixa os mints oficiais de USDC e SKR; Token-2022 e saldo em staking não são aceitos.
- Prazo inicial: de 1 hora a 5 anos, escolhido pelo dono em horas, dias, meses ou anos. O formulário aceita quantidades inteiras; mês equivale a 30 dias e ano a 365 dias. A transação usa segundos inteiros e a contagem começa no relógio da rede.
- Renovação: assinatura do dono; soma o período escolhido a `max(vencimento, agora)` e limita o resultado a 5 anos a partir de agora. Não diminui o prazo e não movimenta a recompensa.
- Devolução: carteira do dono e verificador do serviço assinam juntos. O contrato envia o valor líquido ao endereço de recebimento confirmado na conversa e a comissão à treasury registrada no depósito. Verificador e treasury devem ser carteiras distintas. O programa registra o hash do ID da conversa e o destinatário. O servidor sozinho não pode pagar ou retirar fundos.
- Recebimento: o visitante pode colar um endereço Solana sem conta, Seeker, conexão de carteira ou assinatura. A credencial da conversa autoriza o cadastro; a API valida a chave pública on-curve, recusa a carteira do dono/pagador e impede a substituição de um endereço já confirmado. A conexão SIWS continua opcional. `recipientMethod=address` indica endereço informado, sem comprovação de posse; `signature` indica SIWS verificado. A coluna legada `verified_at` registra o instante da confirmação, cujo método fica em `confirmation_method`. Registros anteriores preservam o método `signature`. Cadastrar o endereço não movimenta fundos: o dono ainda revisa e assina o pagamento.
- Cancelamento: somente o dono e apenas após o vencimento. O dinheiro volta à carteira que fez o depósito. Não há cancelamento antecipado, resgate automático no vencimento ou pagamento automático ao visitante.
- Pagamento encerra todas as conversas abertas do objeto e incrementa uma única devolução. Sem reserva, continua disponível a confirmação de devolução comum.
- A recompensa e a transferência de titularidade ficam bloqueadas enquanto existir depósito pendente ou reserva. Depois do envio de qualquer operação, toda a edição do objeto fica bloqueada na API e no Android, com o badge “Aguardando confirmação”. Nome, categoria e anotações voltam a ser editáveis após confirmação, falha finalizada ou expiração comprovada na rede. Uma falha de conexão não libera o bloqueio.

O contrato guarda um recibo permanente de 260 bytes, incluindo `treasury` e `fee_bps`. Esses valores são congelados no depósito: mudanças de configuração afetam apenas novas reservas. O recibo impede reabertura/replay e permite recuperar o estado mesmo quando o RPC não retém a transação antiga. O custo dessa conta não é devolvido. A conta SPL do cofre é fechada no pagamento/reembolso, devolvendo seu aluguel ao dono; contas de tokens do destinatário e da treasury continuam existindo. A revisão apresenta a comissão, a taxa da rede e o custo de criação separadamente. Na liberação SOL, destinatário e treasury podem precisar de saldo mínimo para manter uma conta nova. A preparação calcula somente a diferença necessária depois do pagamento e inclui transferências explícitas da carteira pagadora, limitadas a 0,001 SOL por endereço. A revisão separa esses complementos e informa que permanecem com os destinatários, além do custo adicional total. Destinatários coincidentes são agrupados; comissão zero não exige complemento para treasury separada. Valores ou destinos alterados exigem nova revisão e são conferidos na mensagem assinada. Se a exigência de saldo mínimo da rede superar esse teto ou o RPC retornar zero/um valor inválido, a preparação recusa a operação. Doações extras para o cofre voltam ao depositante e não impedem a liquidação. O cálculo usa unidades inteiras e arredonda a comissão para baixo; recompensas mínimas podem gerar comissão zero.

## Confirmação e falhas de rede

### Como identificar uma recompensa oficial

O programa de escrow é público: qualquer pessoa pode criar um depósito diretamente e escolher verificador, treasury e comissão. O ID do programa, um saldo positivo ou três endereços distintos não provam vínculo com o SeekerTag. A política oficial é validada pela API, não por uma configuração global no contrato.

Uma integração deve obter a recompensa pela API SeekerTag de confiança, vinculada ao objeto/conversa, e conferir o recibo finalizado na rede. Não aceite como referência parâmetros fornecidos pelo próprio depositante. Verifique:

- Rede e programa esperados, incluindo o genesis hash do RPC e o proprietário da conta de escrow.
- Endereço PDA derivado de `reward`, carteira pagadora e ID da reserva; formato e discriminador do recibo de 260 bytes.
- Carteira pagadora, ID, verificador, treasury, comissão, mint e valor exatos registrados pela API quando o depósito foi preparado.
- Estado da reserva e prazo. `reserved` com prazo vencido já permite reembolso pelo dono; `released` e `refunded` não são reservas disponíveis.
- Para SOL reservado, saldo suficiente para recompensa mais aluguel do recibo. Para SPL, PDA do cofre, programa SPL Token original, mint, autoridade do escrow, conta não congelada e saldo suficiente.
- Para pagamento concluído, destinatário e hash da conversa esperados, além do estado `released`.

Para novos depósitos, use os parâmetros atuais de `/api/rewards/config`. Para depósitos antigos, use os parâmetros históricos da reserva mantidos pela API: rotação de chaves, treasury ou comissão não invalida recibos anteriores. `config.verifiers` lista chaves privadas disponíveis para assinatura, não um registro histórico completo de recompensas oficiais. A remoção de uma chave não torna uma reserva falsa.

O método interno `chain.read(reward)` verifica o recibo contra um registro confiável do banco; passar a ele dados copiados de um escrow desconhecido não autentica a origem desse escrow. Uma integração que não consegue obter a referência confiável ou confirmar a rede deve exibir estado não verificado. Antes de assinar, também confira as instruções e permissões completas com `verifyRewardTransaction`; a API compara a mensagem assinada com a preparação original.

### Reconciliação

Os valores monetários atravessam a API como strings de unidades inteiras. O servidor compara dono, verificador, treasury, percentual, mint, valor e ID do recibo finalizado; consulta também o saldo do cofre. Nunca marca uma reserva apenas porque a carteira retornou uma assinatura. Se não conseguir verificar a rede, informa `unverified`.

Cada operação tem uma transação preparada, com blockhash e prazo de validade. A API e o Android conferem todas as instruções e permissões de todas as contas, preservando a ordem original da mensagem para evitar diferenças de `localeCompare` entre Node e Hermes. Após a assinatura, exigem os mesmos bytes da mensagem preparada e verificam todas as assinaturas: instruções extras, carteira pagadora, valores ou destinatários alterados são rejeitados. O Android guarda a transação assinada antes de enviar, e o servidor grava a mesma assinatura antes de transmitir. Retentativas reutilizam os mesmos bytes, sem criar outro depósito.

Novas operações incluem `computeBudget: fixed-v2`: limite de 200.000 unidades e preço de 100.000 micro-lamports por unidade (20.000 lamports de prioridade), o preço observado na Seed Vault Wallet do Seeker durante o teste nativo. Esse valor é uma configuração testada, não um mínimo universal documentado do protocolo. O RPC calcula a taxa total antes da revisão e da verificação de saldo. Declarar as duas instruções com esse preço evita a alteração de 1.000 para 100.000 micro-lamports observada na carteira após a revisão, que invalidava a conferência da mensagem. Operações antigas preservam seu formato sem orçamento explícito ou com `fixed-v1` (1.000 micro-lamports por unidade); qualquer mudança de taxa ou instrução após a revisão continua sendo rejeitada.

Referências: [assinatura pelo Mobile Wallet Adapter](https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly), [contrato de `sign_transactions`](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec1.0.html#sign_transactions) e [cálculo de taxas do Solana](https://solana.com/docs/core/fees/fee-structure). O teste de regressão reproduz os bytes da instrução de taxa observada no Android e exige a mesma mensagem e assinaturas válidas.

A reconciliação usa o recibo finalizado e o estado da assinatura. Ao receber uma assinatura finalizada, relê o recibo com `minContextSlot` no slot dessa assinatura e exige que o efeito correspondente esteja presente antes de confirmar e liberar o bloqueio. Reconciliações simultâneas da mesma reserva compartilham a leitura. A preparação de uma renovação verifica novamente o vencimento persistido antes de salvar; se outra renovação o tiver alterado durante a consulta RPC, retorna `REWARD_CHANGED` e exige nova revisão. Antes de expirar uma operação, também relê o recibo no slot finalizado que ultrapassou a validade, evitando descartar um depósito que confirmou entre duas consultas. Uma associação de conversa sobrescrita por versões antigas é recuperada apenas quando o recibo corresponde a uma operação preparada persistida e ao endereço de recebimento confirmado naquela conversa. Leitura da recompensa, leitura de operação e novas tentativas reconciliam o estado. O Android consulta enquanto a tela está em primeiro plano e retoma ao reabrir; não depende de uma tarefa em segundo plano para manter a custódia.

Se a assinatura ainda não aparecer na rede e continuar válida, a reconciliação retransmite os mesmos bytes, com intervalo mínimo de 5 segundos e sem envios concorrentes por operação. O Android também recupera um envio interrompido antes de chegar à API, usando a transação já assinada no armazenamento seguro. Editor e detalhes do objeto mantêm o bloqueio durante essa recuperação. A aceitação pelo RPC não garante confirmação, conforme a documentação de [`sendTransaction`](https://solana.com/docs/rpc/http/sendtransaction).

`reserved` significa saldo confirmado, `expired` significa reserva ainda existente e já cancelável, `released` pagamento confirmado, `refunded` devolução confirmada. `pending` não é reserva garantida. Valores antigos sem recibo são apenas anunciados.

## Configuração

Instale as dependências na raiz e em `server`. A API lê:

| Variável | Uso |
|---|---|
| `REWARD_VERIFIER_KEYPAIR` | Caminho privado de uma chave Ed25519 do verificador; vazio desabilita depósitos |
| `REWARD_LEGACY_VERIFIER_KEYPAIRS` | Caminhos privados antigos, separados por vírgula; somente para concluir reservas que registraram esses verificadores |
| `REWARD_TREASURY` | Endereço público on-curve que recebe a comissão; deve ser distinto do verificador e do pagador |
| `REWARD_FEE_BPS` | Comissão para novos depósitos em basis points; padrão `500` (5%), mínimo 1 e máximo 1000 |
| `REWARD_NETWORK` | `devnet` por padrão; aceita `devnet`, `testnet`, `mainnet` ou `localnet`; mainnet exige ativação adicional |
| `REWARD_RPC_URL` | RPC HTTPS; loopback HTTP permitido somente para localnet |
| `REWARD_TEST_USDC_MINT` | Mint de teste fora da mainnet; em devnet o padrão é o mint Circle devnet |
| `REWARD_TEST_SKR_MINT` | Mint de teste fora da mainnet; se ausente, SKR não é oferecido |
| `REWARDS_ALLOW_MAINNET` | Deve ser `true` para ativar deliberadamente mainnet |

Em mainnet os mints são fixos no código, ignorando as variáveis de teste:

- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 casas decimais.
- SKR: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`, 6 casas decimais.

### Ambientes e redes

Uma instância da API atende exatamente uma rede. A seleção é feita no servidor por `REWARD_NETWORK` e `REWARD_RPC_URL`; o aplicativo mostra a rede ativa em **Minha conta → Rede**, no mesmo formato das demais preferências, mas mantém treasury, verificador e programa fora dessa tela. O usuário não pode trocar a rede sem trocar de servidor. Isso impede que uma reserva criada em uma rede seja confundida com saldo, programa ou mint de outra.

- `devnet`: ambiente recomendado para desenvolvimento do aplicativo e testes funcionais; tokens não têm valor real.
- `testnet`: ambiente de stress dos validadores, pode ficar indisponível e exige publicação própria do programa e mints de teste explícitos.
- `mainnet`: dinheiro real; exige `REWARDS_ALLOW_MAINNET=true`, programa publicado, treasury de produção, RPC privado com SLA e revisão operacional.
- `localnet`: somente testes automatizados, aceitando RPC HTTP apenas em loopback.

Para manter ambientes simultâneos, execute instâncias separadas da API, cada uma com banco SQLite, URL pública, RPC, verifier e treasury próprios. O endereço da treasury é sempre variável de ambiente; somente seu endereço público chega à API. Nunca copie a chave privada da treasury para o servidor. O ID do programa precisa existir na rede escolhida, e a API recusa RPC cujo genesis hash não corresponda ao ambiente declarado.

O RPC deve corresponder ao genesis hash da rede configurada e conter o programa executável. Não coloque chave privada em `EXPO_PUBLIC_*`, logs ou commits. Monte as chaves de verificação como arquivos privados no servidor e preserve-as junto ao backup do SQLite. A treasury pode e deve ser uma carteira fria: a API conhece apenas o endereço público. Perder o verificador de uma reserva impede seu pagamento, mas o cancelamento do dono após o vencimento continua possível. A autoridade de atualização do programa também deve ser protegida: uma publicação atualizável continua dependendo dela.

### Rotação segura

- Treasury: altere `REWARD_TREASURY` e reinicie a API. Somente novos depósitos usam o endereço novo; reservas existentes continuam pagando para a treasury gravada on-chain.
- Comissão: altere `REWARD_FEE_BPS` e reinicie. Somente novos depósitos usam o percentual novo.
- Verificador: mova o caminho atual para `REWARD_LEGACY_VERIFIER_KEYPAIRS`, configure a chave nova em `REWARD_VERIFIER_KEYPAIR` e reinicie. Novos depósitos registram a chave nova; liberações existentes selecionam automaticamente a chave antiga pelo endereço salvo no recibo.
- Remova uma chave legada somente depois que não existir nenhuma reserva ativa vinculada a ela. Nunca reutilize a treasury como verificador.

Se uma chave legada for perdida, configure um novo verificador válido e remova o caminho indisponível da configuração. Reservas antigas continuam podendo ser renovadas e reembolsadas pela API com a assinatura do dono, respeitando o vencimento on-chain; o pagamento ao visitante permanece indisponível sem a chave antiga. Não remova o verificador atual sem substituí-lo: deixar `REWARD_VERIFIER_KEYPAIR` vazio desabilita a integração inteira. A recuperação não exige alterar o verificador, treasury ou comissão gravados no recibo.

## Build e testes

```sh
npm ci
npm run build:escrow
npm --workspace=seekertag-api run test:escrow
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

O utilitário recusa qualquer genesis hash fora de devnet e nunca lê a carteira padrão do CLI. `artifacts/rewards-devnet.json` contém apenas IDs públicos dos mints/programa/verificador/treasury e o percentual. Em devnet, o pagador de publicação também serve como treasury de teste; produção deve usar uma carteira fria separada. O teste publica três depósitos de uma hora, renova por um ano e paga a um visitante com carteira comprovada, verificando a divisão exata entre finder e treasury e o encerramento da conversa. Guarda assinaturas públicas em `artifacts/devnet-reward-verification.json`. Reembolso real após o prazo exige aguardar ao menos uma hora em devnet; o bloqueio e o vencimento completo são cobertos pela VM.

Para testar no Android, configure a API com os mints criados, instale o APK e encaminhe a porta por ADB. A carteira MWA precisa aceitar `solana:devnet` e `signTransactions`. Confira a revisão e aprove manualmente a assinatura; o login anterior não autoriza esses pagamentos. Cancelar a carteira deixa o pedido pendente até expirar e não anuncia uma reserva. Uma revisão aberta mantém valor e prazo se o blockhash expirar: ao tocar em Assinar, a API reconcilia o pedido anterior antes de preparar a substituição. Mudanças nas taxas exigem nova revisão.

## Rotas

Todas as rotas do dono exigem a sessão; as do visitante exigem a credencial daquela conversa.

| Método / caminho (prefixo `/api`) | Resposta / ação |
|---|---|
| `GET /rewards/prices` | Cotações informativas USD/BRL por moeda, origem e validade; 503 se indisponíveis |
| `GET /rewards/config` | Configuração e carteira do dono antes de criar o objeto |
| `GET /rewards/balance?currency=SOL` | Saldo da carteira do dono antes de criar o objeto |
| `GET /tags/:id/reward` | `reward`, `config`, `payer`; reconcilia a rede |
| `GET /tags/:id/reward/balance?currency=SOL` | `availableUnits`, `solLamports`, `fundableUnits`, `reserveLamports`, mint e casas decimais |
| `POST /tags/:id/reward/prepare` | Prepara `fund`, `renew`, `release` ou `refund`; devolve `operation` |
| `GET /reward-operations/:operationId` | Operação, estado e reserva reconciliada |
| `POST /reward-operations/:operationId/submit` | Recebe `{transaction}` em base64; verifica assinaturas e envia a mesma transação |
| `POST /reward-operations/:operationId/retry` | Reenvia a assinatura já armazenada, quando ainda válida |
| `GET /reports/:id/reward` | Reserva, endereço do visitante e método de confirmação |
| `GET /finder/reports/:id/reward` | Mesma consulta, vinculada à credencial do visitante |
| `POST /finder/reports/:id/reward/wallet/challenge` | Desafio SIWS específico da conversa, 5 minutos |
| `POST /finder/reports/:id/reward/wallet` | Cadastra `{ address }` em base58 usando a credencial da conversa, sem assinatura |
| `POST /finder/reports/:id/reward/wallet/verify` | Comprova posse, vincula carteira e consome nonce |

Depósito recebe `{kind:"fund",currency:"SOL",amount:"0.01",durationSeconds:2592000}`; renovação `{kind:"renew",durationSeconds:604800}`; pagamento `{kind:"release",reportId}`; cancelamento `{kind:"refund"}`. O servidor escolhe destinatário, valor, mint, programa, verificador, treasury e percentual a partir de dados validados. A carteira do visitante não pode ser a do dono e pode ser editada enquanto a conversa estiver aberta e nenhuma liberação estiver preparada, enviada ou confirmada. A troca gera um novo aviso ao dono; repetir o mesmo endereço não duplica o aviso.

As instruções `fund_sol`, `fund_token`, `fund_sol_timed` e `fund_token_timed` recebem treasury e percentual como parte do ABI. Não existe compatibilidade com depósitos experimentais anteriores a esse formato. As variantes antigas de prazo usam `days`; o aplicativo usa `durationSeconds` (`u32`). A API rejeita pedidos que misturam os dois formatos.

No Android, adicionar/editar objeto mostra um resumo da recompensa. Ao tocar nele, um Gorhom próprio permite configurar valor, moeda, saldo e período, mantendo o rascunho do objeto. A revisão e a confirmação também ficam nesse sheet de recompensa. A ação de renovar aparece apenas depois do vencimento da reserva. O objeto é salvo antes de preparar o depósito, mantendo seu ID ao repetir ou abandonar a revisão. Até a confirmação final, ele continua sem recompensa garantida. A liberação na conversa também usa Gorhom.

Referências: [MWA](https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly), [Anchor 0.32.1](https://www.anchor-lang.com/docs/updates/release-notes/0-32-1), [contas e restrições Anchor](https://www.anchor-lang.com/docs/references/account-constraints), [USDC oficial](https://developers.circle.com/stablecoins/usdc-contract-addresses), [SKR oficial](https://github.com/solana-mobile/react-native-samples/tree/main/skr-staking), [redes Solana](https://solana.com/docs/references/clusters).

O editor oferece 25%, 50%, 75% e Máx. sobre `fundableUnits`, usando aritmética inteira e o limite de um milhão de tokens. Para SOL, deduz aluguel e taxas estimados; para SPL, exige SOL suficiente para esses custos. A preparação recalcula os custos reais antes da assinatura.

As cotações usam a API pública sem chave da CoinGecko (`solana`, `usd-coin`, `seeker`), sob demanda, com cache/backoff de 60 segundos e validade máxima de cinco minutos. Não há polling periódico nem envio de endereços de carteira ao provedor. Cotações inválidas ou indisponíveis não são substituídas por valores fictícios. Em devnet, os preços são apenas referência dos ativos de mercado, não valor dos tokens de teste. O serviço público tem limite por IP e serve ao protótipo; produção exige um plano de dados adequado ao tráfego. Preços não participam da transação nem da validação do depósito.
