# SeekerTag — integração SKR e revisão

> Registro anterior ao compromisso v2. O comportamento atual e as verificações estão no [relatório v2](skr-commitment-review.md); consulte também o [ABI atual](skr-protocol.md). Artefatos de teste podem ter sido atualizados pela execução v2.

**16 de setembro de 2026 · branch `feat/skr-reward-escrow` · implementação local concluída.**

O aplicativo agora possui depósito de recompensa, comprovação da carteira de quem encontrou, pagamento autorizado pelo dono, retirada após vencimento e renovação por **7, 15 ou 30 dias mantendo o mesmo QR e o mesmo saldo**. O contrato, a API e a interface foram exercitados juntos numa blockchain local. Não houve implantação pública nem movimentação de SKR real. A função permanece desativada por padrão.

## O que foi entregue

| Camada | Comportamento |
| --- | --- |
| Contrato Solana | Cofre SPL por recompensa, dono como autorizador, valor inteiro fixo, prazo renovável, pagamento ou reembolso único e recibo persistente |
| API e SQLite | Intenções persistidas antes da assinatura, leitura finalizada da blockchain, conferência de rede/mint/programa/recibo, prova Ed25519 de carteira por conversa, histórico e proteção das operações da etiqueta |
| Aplicativo | Revisão explícita antes de assinar, carteira web ou Android MWA, rede/token/programa fixados no build, estados pendentes e indisponíveis, botões de renovação e pagamento |
| Privacidade | Nenhum contato pessoal ou token de acesso escrito na blockchain; carteiras, valores e transferências são públicos |
| Distribuição | Docker inclui o SDK compartilhado e recebe os endereços públicos no build; compilação e testes locais têm comandos reproduzíveis |

O QR identifica o objeto. A recompensa é um registro separado: renovar altera seu vencimento; pagar/reembolsar encerra esse registro; outro ciclo pode criar outro depósito sem reimprimir a etiqueta. Como antes, manter a URL válida também exige preservar o domínio público.

SHA256 do binário SBF local testado (`programs/reward-escrow/target/deploy/seekertag_reward_escrow.so`): `25980873344e2aad3f33f9d3ba33b5d5d9bfeb0b60cf182d5d202dae0cc8f8af`. O binário de uma futura publicação deve ser verificado separadamente.

## Resultado das verificações

| Verificação | Resultado | O que comprova / limite |
| --- | --- | --- |
| TypeScript | Passou | Tipos da aplicação e interfaces compartilhadas |
| Unitários da aplicação | 20 passaram | Inclui oito testes do validador de transação antes da assinatura |
| API | 31 passaram | Inclui nove cenários específicos de recompensa; verificações adversariais de RPC usam respostas controladas |
| SDK do contrato | 6 passaram | Precisão até u64 máximo, formato das instruções, PDAs e recibos |
| Rust | 4 passaram; Clippy estrito sem avisos | Validação local do programa e análise estática |
| Compilação SBF | Passou | Binário real produzido pelas ferramentas Solana; `npm run build:rewards` reproduz o build |
| Contrato + API em localnet | 19 resultados passaram | Inclui grupos de subtestes, movimentação SPL real local, cenários adversariais, concorrência e fluxo completo da API; nenhuma moeda real |
| Regressão web | 34 passaram | Chromium desktop, WebKit desktop e WebKit com perfil iPhone; sem skips ou retries |
| Recompensa no navegador | Passou | Depósito de 100.000001, +15 dias com QR igual, prova da carteira, pagamento exato e conclusão da conversa com API/SBF reais; somente carteira externa substituída por adaptador de teste |
| Console e rede desse fluxo | Sem erros | 65 requisições de API concluídas; nenhum HTTP 4xx/5xx ou erro de transporte; maior duração observada 145 ms na API local, sem contar aprovação/finalização da carteira |
| Visual | Conferido | Painel de depósito, carteira comprovada no viewport de 390 px e pagamento; sem rolagem horizontal no cenário móvel |
| Android | Exportação Hermes passou | Valida empacotamento JavaScript/MWA; não equivale a APK novo ou carteira real em aparelho |
| Docker | Build e smoke passaram | API health/config e página inicial HTTP 200, interface renderizada sem erro de console, execução como usuário `node` |

Evidências locais: [fluxo de recompensa](../artifacts/rewards/browser/verification.json), [depósito](../artifacts/rewards/browser/owner-funded.png), [carteira de quem encontrou](../artifacts/rewards/browser/finder-mobile-verified.png), [pagamento](../artifacts/rewards/browser/owner-paid.png), [regressão web](../artifacts/cross-browser-results.json) e [dependências](../artifacts/rewards/dependency-audit.json). Artefatos são ignorados pelo Git e ficam disponíveis nesta máquina; código dos testes e relatórios permanecem no repositório.

## Achados corrigidos durante as revisões

Papéis separados implementaram contrato, backend e aplicativo. O autor da interface revisou o contrato; o autor do contrato revisou API/interface/infraestrutura; o autor do backend elaborou casos adversariais de contrato e cliente. O coordenador integrou as correções e executou a validação final.

- Doar SOL ao endereço de um depósito ainda não criado podia bloquear a API; a reconciliação agora reconhece corretamente contas vazias não inicializadas.
- Muitas consultas públicas podiam atrasar operações do dono; consultas simultâneas à mesma recompensa agora compartilham uma verificação em andamento.
- A sincronização da conversa omitia o destinatário; agora retorna carteira, referência e permissão de concluir a devolução.
- Falha de RPC podia parecer função desativada; o app preserva a visualização indisponível e não considera a recompensa paga.
- A configuração do servidor podia escolher rede/token/programa sem ancoragem suficiente no cliente; todos os três agora precisam coincidir com o build, inclusive em redes de teste.
- Uma assinatura de um ciclo anterior podia ser reapresentada ao depósito seguinte; assinaturas agora são vinculadas ao identificador da recompensa.
- A dependência Solana causou tela vazia por falta de `Buffer`; o polyfill passou a carregar antes das dependências da aplicação.
- Cache Metro conservou configuração antiga após mudança de rede; exports web limpam o cache antes de gerar o bundle.
- O próprio harness tinha colisão de portas, risco de travar no encerramento e asserções que aceitavam falhas de transporte; os testes agora isolam portas/configuração/carteiras e exigem logs de rejeição pelo programa esperado.

Veja os detalhes na [revisão de integração](skr-integration-audit.md), na [revisão do contrato](skr-contract-security-review.md) e nos [cenários adversariais](skr-red-team-review.md).

## Limitações materiais e pendências

**O depósito não garante pagamento contra um dono desonesto.** No modelo escolhido, o dono autoriza a liberação. Ele pode chamar o contrato fora do app e pagar uma carteira própria antes do vencimento. Esse comportamento foi confirmado por teste e aparece explicitamente na interface. A função de reembolso respeita o vencimento, mas o contrato não verifica entrega física nem se duas carteiras pertencem a pessoas diferentes.

**Autoridade de upgrade:** um programa publicado com autoridade de atualização pode ter seu código substituído. O endereço fixado no build não prova imutabilidade. Uma implantação futura precisa verificar o binário e registrar uma política de upgrade aceita; nenhuma autoridade foi criada ou alterada nesta tarefa.

**Dependências:** após atualizar a dependência transitiva `uuid` para 11.1.1, `npm audit --omit=dev` ainda reporta **seis entradas em cada árvore** (três altas e três moderadas), derivadas de dois avisos, não seis vulnerabilidades independentes. O comando de auditoria portanto continua saindo com erro:

| Aviso remanescente | Avaliação desta revisão |
| --- | --- |
| [bigint-buffer: overflow em toBigIntLE](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) | Biblioteca transitiva do SPL Token. A API limita os layouts a 82/165 bytes e os leitores inteiros usam campos fixos de 8 bytes; não foi demonstrada exploração nesse caminho. A dependência vulnerável continua instalada e o aviso não foi declarado resolvido. |
| [stream-json: custo quadrático nos filtros](https://github.com/advisories/GHSA-528h-pc64-c93x) | Transitiva de jayson/web3. Os caminhos inspecionados usam `StreamValues`/`Verifier` e cliente RPC, sem os filtros citados; não foi demonstrado caminho atingível nesta integração. O aviso permanece. |

Essa avaliação de alcance é limitada ao código inspecionado. Não foi aplicado `npm audit fix --force`, que propunha rebaixamentos incompatíveis da biblioteca SPL. O uso com fundos reais fica pendente do tratamento ou de uma decisão explícita sobre esses avisos, além da revisão da implantação e do teste físico de carteira.

**Custos e operação:** recibo/cofre ficam abertos, mantendo seu custo em SOL; tokens doados por fora não são recuperáveis nesta versão. A API usa uma instância escritora por banco. O servidor pode ficar indisponível e controla os registros das conversas, mas não possui chave para movimentar o cofre. Um pagamento feito diretamente fora de uma intenção reconhecida não é inventado como pagamento da conversa e pode exigir suporte.

**Escopo de teste:** esta é uma revisão interna por agentes com papéis separados, não auditoria externa, prova formal ou certificação. Não houve teste de carteira física, NFC, carga distribuída, programa publicado ou garantia de ausência de falhas. O APK anterior permanece separado desta entrega.

## Próximo uso

O código está na branch local `feat/skr-reward-escrow`, sem merge, push ou publicação automática. A [configuração reproduzível](skr-setup.md) descreve as variáveis, os testes e o processo para preparar uma implantação de teste. As etiquetas e recompensas manuais continuam funcionando com a integração desligada.
