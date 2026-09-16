# Configuração da integração SKR

A integração está desativada por padrão. Os testes criam sua própria blockchain, moeda de teste e carteiras descartáveis. Não existe programa SeekerTag publicado em devnet/mainnet por esta entrega.

## Reproduzir a verificação local

Use Node 24, Rust/Cargo e as ferramentas oficiais Agave/Solana contendo `cargo-build-sbf` e `solana-test-validator`. Nesta revisão foram usados Agave 4.2.2 e platform-tools v1.54; o SHA256 do arquivo oficial macOS arm64 foi conferido antes da extração. Instalações e binários de teste ficam fora do Git. Consulte as [ferramentas oficiais](https://github.com/anza-xyz/agave/releases) e a [documentação de implantação Solana](https://solana.com/docs/programs/deploying).

```sh
npm ci
npm ci --prefix server
# Caso as ferramentas não estejam no PATH:
export SOLANA_BIN_DIR=/caminho/para/solana-release/bin
npm run build:rewards
npm run typecheck
npm test
npm run test:rewards:unit
npm run test:rewards:localnet
npx playwright install chromium webkit
npm run test:rewards:browser
npm run test:e2e
```

Os caminhos são exemplos, não valores de outra instalação. O build SBF usa o `Cargo.lock`. Os testes Rust adicionais são `cargo test --manifest-path programs/reward-escrow/Cargo.toml --locked` e `cargo clippy --manifest-path programs/reward-escrow/Cargo.toml --all-targets --locked -- -D warnings`.

`test:rewards:localnet` executa os cenários em série, com validadores e SQLite descartáveis. `test:rewards:browser` compila sua própria web em `artifacts/rewards/browser/web`, com rede/mint/programa fixados antes da exportação. App, API e contrato são reais; apenas a carteira externa é um adaptador de teste que assina com chaves efêmeras mantidas no processo Node. Nenhuma carteira existente é carregada. Os scripts não aceitam RPC remoto. Ao terminar, os serviços e bancos temporários são encerrados; screenshots e resultados sem credenciais ficam em `artifacts/rewards/`.

## Configuração de uma implantação de teste

Após uma implantação deliberada do programa em **devnet**, crie um mint de teste SPL tradicional com seis casas decimais e sem autoridade de congelamento. Não utilize o endereço do SKR oficial numa rede de testes. Não confunda o token sintético com SKR real.

| Variável no servidor | Valor / finalidade |
| --- | --- |
| `SKR_REWARDS_ENABLED` | `true` para habilitar a configuração |
| `SKR_CLUSTER` | `devnet`, `localnet` ou `mainnet-beta` |
| `SKR_RPC_URL` | Endpoint da rede; HTTPS fora de localnet; nunca publicado no cliente |
| `SKR_PROGRAM_ID` | Endereço do programa efetivamente implantado |
| `SKR_MINT` | Mint permitido; seis decimais, SPL tradicional e sem freeze authority |
| `SKR_GENESIS_HASH` | Obrigatório para localnet; devnet/mainnet possuem genesis fixado no código |
| `PUBLIC_URL` | Origem HTTPS estável usada pelos QR e desafios de comprovação |

| Variável ao compilar web/Android | Valor / finalidade |
| --- | --- |
| `EXPO_PUBLIC_SKR_CLUSTER` | Mesma rede do servidor; padrão `devnet` |
| `EXPO_PUBLIC_SKR_PROGRAM_ID` | Mesmo programa; obrigatório para assinar |
| `EXPO_PUBLIC_SKR_MINT` | Mesmo mint; obrigatório para assinar |
| `EXPO_PUBLIC_APP_ORIGIN` | Origem pública dos desafios; use quando a origem da API for diferente da aplicação |
| `EXPO_PUBLIC_API_URL` | URL da API nos builds nativos; web no mesmo servidor pode usar o padrão |

São identidades públicas fixadas no build, não segredos. A API não pode escolher outro programa/token na hora da assinatura. Alterar variáveis somente no servidor não atualiza um app já compilado. Os scripts web limpam o cache Metro: na revisão, reutilizar o cache após mudar essas variáveis conservou valores antigos. Em exports manuais use `--clear`; em builds nativos alterados, faça uma compilação limpa e confira os endereços antes de assinar. Não coloque chaves privadas ou credenciais de RPC em `EXPO_PUBLIC_*`.

Para o Docker, passe essas identidades durante o build:

```sh
docker build -t seekertag:devnet \
  --build-arg EXPO_PUBLIC_SKR_CLUSTER=devnet \
  --build-arg EXPO_PUBLIC_SKR_PROGRAM_ID=ENDERECO_DO_PROGRAMA \
  --build-arg EXPO_PUBLIC_SKR_MINT=ENDERECO_DO_MINT_DE_TESTE \
  --build-arg EXPO_PUBLIC_APP_ORIGIN=https://seu-dominio.example .
```

Substitua os exemplos pelos endereços de sua implantação; configure as variáveis de servidor no ambiente de execução. Nenhum comando de implantação com fundos reais é executado automaticamente. O backend exige Node24/SQLite e uma única instância escritora por banco; a fila de operações é local ao processo. A implantação horizontal exige coordenação adicional.

## Comportamento e recuperação

- Depósito: dono escolhe valor e prazo, revisa e assina. Só aparece confirmado após leitura finalizada da blockchain.
- Renovação: acrescenta 7, 15 ou 30 dias a `max(agora, vencimento anterior)`. Usa o mesmo saldo e QR; cobra apenas a taxa da transação em SOL. Limite do contrato: vencimento até 365 dias à frente.
- Compromisso: a pessoa comprova sua carteira; antes da entrega, o dono revisa e assina o vínculo àquela conversa. Só a confirmação na rede fixa o destinatário.
- Pagamento: após receber o objeto, o dono revisa e assina a liberação para a carteira fixada. A conclusão da conversa aguarda a confirmação desse pagamento.
- Renúncia: a carteira fixada pode assinar a renúncia voluntária, sem pagamento, pagando a taxa em SOL. A oferta reabre com o mesmo saldo, prazo e QR.
- Vencimento: uma oferta sem compromisso pode ser renovada ou retirada pelo dono. Um compromisso ativo não expira automaticamente, bloqueia retirada/renovação e pode ser pago após o vencimento original. Um impasse pode manter fundos bloqueados indefinidamente.
- Envio incerto: use **Atualizar confirmação**. O mesmo recibo e a intenção persistida permitem reconciliar após reinício. Um rascunho só é cancelável quando a transação expirou e a rede confirmou ausência de depósito.
- Indisponibilidade da rede: o saldo aparece sem verificação; a aplicação não inventa pagamento nem libera operações protegidas. Desabilitar novos depósitos também não apaga o histórico.
- Carteira web: selecione a mesma rede na carteira. O app não controla o RPC de uma carteira injetada. Android usa MWA e requer devnet/mainnet; localnet é testada pelo navegador.

A etiqueta é independente do depósito: o código do QR e a URL permanecem iguais. Um novo ciclo após pagamento/reembolso usa outro recibo para impedir repetição de transações antigas.

## Compatibilidade v2

O contrato e o cliente agora usam recibos de 224 bytes `SKREWRD2`, incompatíveis com v1. A migração SQLite preserva registros e vínculos, mas não migra fundos on-chain. Use implantação separada para v2 e mantenha um plano de liquidação e cliente compatível para eventuais fundos v1. O trabalho local não publicou nenhuma versão em mainnet.

## Limites antes de usar SKR real

O [relatório de segurança](skr-contract-security-review.md) descreve a autorização do dono, a confiança na autoridade de upgrade e o custo das contas permanentes. A revisão local não autoriza uma publicação com fundos reais. Ainda faltam uma decisão sobre autoridade de upgrade, verificação do binário publicado, validação de carteira em aparelho Android e tratamento das dependências descritas no [relatório do compromisso v2](skr-commitment-review.md).
