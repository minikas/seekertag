# Correções e segunda auditoria — 18/09/2026

Uma equipe corrigiu os problemas da [auditoria inicial](audit-2026-09-18.md). Em seguida, três revisores independentes examinaram reconciliação, pagamentos e aplicativo/autorização. A segunda equipe encontrou três casos adicionais, reproduzidos e corrigidos antes do encerramento. Nenhum P1/P2 demonstrado permanece aberto no escopo examinado; isso não constitui certificação de segurança.

| Problema | Resultado |
| --- | --- |
| Confirmação contra leitura antiga do escrow | Nova leitura finalizada com `minContextSlot` da assinatura; confirmação exige o efeito esperado. Consultas concorrentes compartilham a reconciliação. |
| Associação de pagamento sobrescrita pela corrida antiga | Recuperação pelo histórico persistido de operações, recibo on-chain e carteira comprovada da conversa; operações obsoletas não reabrem reservas encerradas. |
| Cotas compartilhadas pelo proxy | `TRUST_PROXY_HOPS=1` somente na topologia privada do Compose; acesso direto usa zero. Testes HTTP verificam isolamento e cabeçalhos forjados. |
| Transferência por e-mail reivindicado sem verificação | API e Android aceitam ID da conta ou carteira vinculada; e-mail é recusado também pelo campo legado. |
| Devolução sem recompensa não encerra conversas | Confirmação chama `/reports/:id/resolve`, atualiza histórico, contadores e telas; falha não apresenta falso sucesso. |
| Pagamento SOL para contas sem saldo mínimo | Complementos explícitos, limitados a 0,001 SOL por endereço, revisados e validados nos bytes assinados; destinatários coincidentes são agrupados. |
| Acesso do visitante à carteira | O acesso pelos detalhes já estava implementado nas alterações locais anteriores à rodada de correção. Foi preservado e verificado no Android, sem incluí-lo neste commit. O componente de recompensa recebeu tratamento de erro/repetição e validação do estado da conversa. |

Os três casos adicionais foram:

- **Renovação concorrente:** uma preparação atrasada podia usar o vencimento anterior e ser considerada confirmada pelo efeito de outra renovação. Agora retorna `409 REWARD_CHANGED`; uma nova preparação usa o vencimento atual. Regressão permanente na suíte de reconciliação.
- **Rent RPC inválido:** o SDK pode devolver zero após erro JSON-RPC. A preparação SOL agora recusa esse resultado, evitando omitir um complemento necessário. Teste injeta o erro real na camada HTTP do SDK.
- **Restauração sem conversas:** a primeira correção bloqueava indevidamente um objeto perdido com reserva e nenhuma conversa aberta. Os controles permitem restaurar esse status, preservando o bloqueio quando há devolução com recompensa a concluir.

O contrato Rust, seu ABI e o programa publicado não foram alterados. Os testes executaram novamente o SBF compilado no LiteSVM. SHA-256: `54bede9941642618fcd06afbf6b16e2779331bac308430991e2594fe8f402083`.

## Validação

| Verificação | Resultado |
| --- | --- |
| `npm run test:all` | TypeScript aprovado; 55 testes mobile e 51 testes API passaram |
| `npm run test:escrow` | SBF recompilado; 65 testes passaram |
| Total automatizado | **171 testes aprovados**, zero falhas |
| Revisão independente | Três pareceres; reproduções adicionais e retestes aprovados |
| Android de teste no Seeker físico | Devolução sem recompensa encerrou a conversa e registrou `recovery_count=1`; visitante abriu detalhes e visualizou a confirmação de carteira; nenhuma resposta HTTP de erro no servidor isolado |
| APK final no Seeker físico | Reinstalação confirmada por hash; dashboard abriu com a sessão existente; nenhum erro fatal nos logs do processo |

O QA de fluxo usou um APK separado (`app.seekertag.mobile.audit`), API loopback, SQLite em memória, identidade OAuth sintética e LiteSVM. Não utilizou credenciais de produção nem assinou transações com a carteira real. O APK de QA foi compilado antes dos três ajustes finais da segunda auditoria; esses ajustes foram cobertos pelos testes de regressão e incorporados à compilação final. O emulador apresentou ANR do System UI, por isso a execução visual foi concluída no Seeker físico via ADB. Maestro não concluiu o roteiro; a evidência de fluxo vem de interação ADB, hierarquia acessível, capturas e estado da API.

Durante a instalação separada, um toque acionou inadvertidamente a opção de verificação única do Play Protect. O APK de teste pode ter sido enviado ao Google. Nenhuma configuração de envio permanente foi selecionada.

O APK final foi reconstruído com a origem habitual `https://api-seeker.viralizai.co/api` e reinstalado no Seeker conectado com `adb install -r`. O SHA-256 do `base.apk` instalado foi conferido e corresponde exatamente ao artefato entregue. A instalação descartável foi removida, o aplicativo normal reabilitado e o encaminhamento ADB de teste removido. Artefato local: `artifacts/remediation-2026-09-18/SeekerTag-delivery.apk`; SHA-256: `9b3676e9c8713d9b966adc1382554929e0876b5d564d089c353a403c0b202944`.

Na conferência da entrega, também foi reproduzido um problema do build incremental: trocar `EXPO_PUBLIC_API_URL` não invalidava a tarefa Gradle e o APK retinha o endereço anterior. O script agora força somente a tarefa de bundle com a [opção `--rerun` do Gradle](https://docs.gradle.org/current/userguide/command_line_interface.html#sec:rerun_tasks). O novo APK foi inspecionado: contém a API habitual e não contém a URL de QA. A compilação real com essa correção passou.

## Escopo da entrega

O commit contém somente mudanças desta rodada e o relatório inicial. README e `ConversationReward.tsx` tiveram seus trechos separados no índice. As edições anteriores de conversa, retorno da carteira, componentes de interface, tradução ampla do README, landing, Caddy e apresentações continuam fora do commit. Os testes e APKs refletem o checkout completo, que inclui essas alterações anteriores preservadas.

As mudanças da API e do Compose estão locais: o servidor remoto não foi publicado nesta tarefa. O novo aplicativo mantém a origem já utilizada no aparelho. A ativação das correções de servidor e dos complementos SOL depende da implantação coordenada da API e do cliente atualizado. Não é necessário alterar o programa on-chain para essas correções.

Continuam fora da validação: bytecode e autoridade de upgrade efetivos da rede, configuração remota, carteira real, câmera e NFC. Os alertas moderados de dependências descritos na auditoria inicial permanecem, sem exploração demonstrada nos caminhos examinados.

Evidências locais em `artifacts/remediation-2026-09-18/` (pasta ignorada pelo Git): `test-all-final.log`, `test-escrow-final.log`, `audit-reconciliation.md`, `audit-payments.md`, `audit-app-security.md`, `native-return-state.json`, `native-final-state.json`, `native-return-success.png`, `native-finder-wallet.png`, `build-delivery-final.log`, `install-delivery-final.log`, `delivery-bundle-verification.json` e `delivery-verification.json`. Os testes de regressão estão versionados em `apps/api/test/` e `apps/mobile/tests/unit/`.
