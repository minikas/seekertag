# Melhorias de produto — SeekerTag

Revisão de 6 de setembro de 2026, base `b7ee44d`. Propostas para decisão; nenhuma alteração de produto, build ou ambiente realizada nesta frente.

O próximo marco deveria ser **uma etiqueta presa e testada em um objeto, cujo aviso chega ao dono e permite combinar a devolução**. A ideia original de [ReturnTag](/Users/kas/seeker-simple-grant-ideas-2026-09-05.md) depende desse ciclo físico. A implementação atual já oferece cadastro, QR/PDF, conversa privada e confirmação de devolução; os maiores ganhos estão nas transições entre essas etapas.

As observações abaixo vêm do código e do [README](../../../README.md), sem pesquisa de uso em produção. Não há telemetria de produto nesta versão. Todas as metas são **hipóteses para um piloto exploratório**, não resultados medidos, previsões de conversão ou estimativas estatísticas. A ordem combina impacto esperado sobre devoluções e esforço relativo: **P** = alteração localizada; **M** = fluxo e persistência/API; **G** = serviço e operação adicionais. Não são compromissos de prazo.

| Ordem | Proposta | Impacto esperado | Esforço | Motivo da posição |
| --- | --- | --- | --- | --- |
| 1 | Levar a primeira etiqueta até o objeto | Muito alto | M | QR criado ainda precisa virar etiqueta utilizável |
| 2 | Imprimir no tamanho do objeto | Alto | P–M | Remove uma barreira física usando o PDF existente |
| 3 | Distinguir mensagens novas de conversas abertas | Alto | M | Torna a caixa de entrada útil e prepara os alertas |
| 4 | Mostrar que o objeto foi marcado como perdido | Médio | P | Completa uma promessa atual com dados já disponíveis |
| 5 | Avisar o dono fora do aplicativo | Muito alto | G | Fecha a maior lacuna operacional; depende de envio confiável |
| 6 | Reencontrar a conversa sem ter o objeto em mãos | Alto | M | Ajuda quem encontrou a acompanhar a resposta |
| 7 | Encerrar um aviso sem declarar uma devolução | Médio–alto | M | Preserva confiança, disponibilidade da etiqueta e histórico |

**1. Levar a primeira etiqueta até o objeto**

**Problema observável.** O formulário apresenta anotação, mensagem pública e três moedas de recompensa antes de “Criar etiqueta” ([TagForm.tsx](../../../src/TagForm.tsx#L12)). Um objeto recém-criado já entra em “Protegidos” porque seu status é `active` ([Dashboard.tsx](../../../src/Dashboard.tsx#L29)). O download apenas confirma que o PDF ficou disponível ([TagDetails.tsx](../../../src/TagDetails.tsx#L74)). Nenhuma dessas ações demonstra que a etiqueta foi presa ou testada.

**Comportamento proposto.** Primeira criação com nome, categoria e “Criar etiqueta”; os demais campos ficam em “Mais opções”. Depois, uma sequência curta: obter QR impresso ou gravar NFC → testar o link → confirmar “Prendi a etiqueta e testei”. Manter esse preparo separado de ativo/perdido/pausado. Mostrar “Etiquetas criadas” e “Uso confirmado por você”, com opção de retomar o preparo. A abertura de um link pode ajudar no teste, mas não prova leitura óptica nem fixação física.

**Pré-condição e dependências.** Para etiquetas destinadas a sair da rede local, definir origem HTTPS estável, servidor disponível e preservação dos códigos antes de imprimir. O APK atual usa IP de LAN e o alerta da interface só reconhece `localhost`/`127.0.0.1` ([TagDetails.tsx](../../../src/TagDetails.tsx#L32)). Uma configuração explícita deve distinguir demonstração local de uso permanente; HTTPS sozinho não comprova estabilidade. O operador precisa decidir como tratar QRs já impressos antes de mudar a origem. Não transformar diagnóstico de rede em um formulário para o dono.

**Métrica proposta.** Em piloto com 20 donos e material de impressão disponível: mediana de até 60 segundos para criar o primeiro QR; pelo menos 16 confirmam fixação e teste em até 24 horas. Registrar separadamente criação, obtenção do arquivo e declaração de uso.

**Aceite.** Criar sem recompensa ou carteira; retomar uma preparação interrompida; não promover download a “testado”; identificar etiquetas locais antes da impressão definitiva; testar uma etiqueta impressa com outro celular fora da LAN, em uma implantação pública preparada para o piloto. A confirmação final permanece explicitamente uma declaração da pessoa.

**2. Imprimir no tamanho do objeto**

**Problema observável.** O PDF atual contém seis cópias do mesmo QR em retângulos de 250 × 207 pontos, cerca de 88 × 73 mm, independentemente da categoria ([server/app.js](../../../server/app.js#L339)). Isso entrega um arquivo funcional, mas não oferece um formato específico para chaveiro ou coleira, categorias presentes no cadastro.

**Comportamento proposto.** Antes de baixar, escolher entre dois modelos: adesivo para superfície e etiqueta dobrável para prender. Mostrar medidas reais e uma prévia simples; preencher a folha A4 com o modelo escolhido. Manter um padrão pronto e instrução curta de recorte, fixação e teste. Oferecer NFC como alternativa a quem já possui uma etiqueta compatível, com QR de apoio quando possível.

**Dependências.** Gerador de PDF existente, escolha de medidas após provas físicas e a origem permanente da proposta 1. Legibilidade e resistência dependem também de impressão, material e uso: não prometer impermeabilidade ou durabilidade sem ensaio específico.

**Métrica proposta.** Em 10 tarefas com objetos representativos, pelo menos 8 pessoas conseguem imprimir, fixar e abrir a etiqueta sem redimensionamento manual ou ajuda; registrar o motivo de cada falha.

**Aceite.** Medidas da prévia correspondem à impressão em tamanho real; cada modelo passa por leitura com celulares físicos após ser recortado e fixado; QR conserva contraste e margem; falha ou ausência de NFC mantém a opção de QR disponível. Reduzir o desenho até caber não basta para aprovar o modelo.

**3. Distinguir mensagens novas de conversas abertas**

**Problema observável.** O indicador da navegação e o aviso no painel usam `status === 'open'`. Uma conversa já lida continua acionando o indicador até a devolução ([Dashboard.tsx](../../../src/Dashboard.tsx#L16)). A resposta da API contém a última mensagem e sua quantidade, mas não o progresso de leitura ([server/app.js](../../../server/app.js#L199)).

**Comportamento proposto.** Mostrar “Novas mensagens” separadamente de “Devoluções em andamento”. Priorizar conversas que aguardam resposta do dono. Marcar como visto somente o conjunto de mensagens efetivamente apresentado ao abrir a conversa; uma mensagem recebida depois continua nova. Começar pelo indicador privado do dono, sem expor recibos de leitura ao finder.

**Dependências.** Persistência do último identificador de mensagem visto por participante, tratamento de concorrência e sincronização entre dispositivos. Abertura da caixa de entrada, sozinha, não significa leitura de todas as conversas.

**Métrica proposta.** Em 10 tarefas com três conversas e estados misturados, pelo menos 9 pessoas encontram a mensagem que exige resposta em até 10 segundos. Medir também a proporção de conversas com resposta em 24 horas, estabelecendo a linha de base no piloto.

**Aceite.** Ler uma conversa zera apenas suas mensagens novas; conversa aberta e lida continua em andamento sem indicador de novidade; mensagem que chega durante a leitura reaparece corretamente como nova; atualização em outro dispositivo não perde mensagens nem deixa indicadores antigos.

**4. Mostrar que o objeto foi marcado como perdido**

**Problema observável.** O dono recebe “Quem encontrar verá seu aviso” ao marcar perdido ([TagDetails.tsx](../../../src/TagDetails.tsx#L67)). A API pública já retorna `status`, mas a página do finder usa a mesma apresentação para `active` e `lost` ([Found.tsx](../../../src/Found.tsx#L16), [server/app.js](../../../server/app.js#L198)).

**Comportamento proposto.** Para `lost`, mostrar “O dono marcou este objeto como perdido”, seguido de “Estou com o objeto — avisar o dono”. Para `active`, manter a possibilidade de contato: o dono pode ainda não ter percebido a perda. Após enviar, distinguir “Mensagem registrada” de “Dono respondeu”; não afirmar que um aviso foi visto ou que alguém está a caminho sem evidência.

**Dependências.** Estado já disponível na API, conteúdo público e os estados reais de envio. Notificação externa só deve aparecer como opção quando a proposta 5 estiver disponível.

**Métrica proposta.** Em 10 leituras de cenário, pelo menos 9 participantes identificam corretamente se a perda foi declarada e qual é a próxima ação, sem interpretar a página como rastreamento.

**Aceite.** Mudar ativo/perdido altera a página pública sem trocar o QR; ambos permitem aviso; pausa continua impedindo novos avisos; nenhum telefone, e-mail ou anotação particular passa a aparecer. Recompensa continua descrita como promessa, sem selo de pagamento ou propriedade verificada.

**5. Avisar o dono fora do aplicativo**

**Problema observável.** O painel consulta a API a cada seis segundos enquanto está montado ([Dashboard.tsx](../../../src/Dashboard.tsx#L15)); o README declara ausência de push e e-mail. O finder pode enviar uma mensagem válida e o dono só descobri-la quando decidir abrir o app.

**Comportamento proposto.** Começar com um canal: e-mail opcional do dono, verificado e habilitado após preparar a primeira etiqueta. Enviar alerta curto de nova conversa ou resposta, sem conteúdo privado na prévia. O link leva à conversa depois da autenticação necessária. Agrupar mensagens próximas e parar lembretes após leitura ou encerramento. Push nativo pode ser a etapa seguinte, se o piloto mostrar necessidade.

**Dependências.** Origem pública, serviço de envio, verificação do endereço, preferências, fila persistente com tentativas e deduplicação, além do estado de leitura da proposta 3. O endereço coletado no cadastro atual não deve ser tratado como verificado. A configuração e o funcionamento precisam ser testados com o app fechado; falhas de envio devem ser visíveis à operação.

**Métrica proposta.** Hipótese para piloto com consentimento: ao menos 80% dos avisos legítimos recebem primeira resposta do dono em 24 horas. Separar aviso gravado, envio aceito pelo serviço, conversa aberta e resposta; aceitação do serviço não equivale a leitura.

**Aceite.** Com app e navegador fechados, um aviso gera o e-mail e o dono chega à conversa correta após entrar; falha temporária pode ser recuperada sem perder o aviso ou gerar duplicatas visíveis; sair da conta não perde o destino pretendido; desativar alertas funciona; nenhuma credencial de finder ou mensagem privada vai para o e-mail.

**6. Reencontrar a conversa sem ter o objeto em mãos**

**Problema observável.** As credenciais do finder já persistem por 30 dias no navegador, mas a orientação é voltar ao link ou escanear novamente ([storage.ts](../../../src/platform/storage.ts#L1), [Conversation.tsx](../../../src/Conversation.tsx#L17)). Não há uma lista pública de conversas salvas neste aparelho. Depois de guardar ou entregar o objeto, o finder pode não ter o QR à mão.

**Comportamento proposto.** Preservar o salvamento automático existente. Após o primeiro aviso, informar “Acesso salvo neste aparelho” e oferecer “Minhas conversas”, sem exigir uma etapa adicional para guardar o acesso. A entrada “Encontrei um objeto” também passa a mostrar essas conversas quando houver acesso salvo. A lista usa somente conversas já autorizadas localmente; remover um acesso permanece uma opção da pessoa. Copiar o endereço deve explicar que ele funciona com o acesso salvo no mesmo navegador; não apresentá-lo como chave transferível para qualquer aparelho.

**Dependências.** Índice local das capacidades existentes, validação e expiração consistentes, remoção explícita do acesso. Manter o finder sem cadastro. Uma eventual recuperação em outro dispositivo exige um desenho próprio e fica adiada.

**Métrica proposta.** Em 10 tarefas, pelo menos 9 finders retornam à conversa em até 30 segundos após fechar e reabrir o navegador, sem o objeto e sem ajuda. Testar separadamente o caso de dados apagados, que não permite prometer recuperação.

**Aceite.** A mesma instalação lista apenas acessos válidos daquele navegador/app; navegador novo não lê conversa por conhecer seu identificador; acesso expirado ou apagado recebe orientação honesta; “Remover deste aparelho” elimina o acesso e o item da lista; não tornar permanente a retenção de 30 dias por acidente.

**7. Encerrar um aviso sem declarar uma devolução**

**Problema observável.** A interface oferece confirmação de devolução como encerramento, e a API marca todas as conversas abertas do objeto como resolvidas e incrementa `recovery_count` ([Conversation.tsx](../../../src/Conversation.tsx#L21), [server/app.js](../../../server/app.js#L376)). Não há saída equivalente para engano, contato abusivo ou pessoa que não está com o objeto. Conversas abertas também impedem transferência da etiqueta.

**Comportamento proposto.** Manter “Recebi meu objeto” como conclusão principal e adicionar “Encerrar este aviso”, com motivos curtos: engano, sem devolução ou contato indesejado. A ação fecha somente aquela conversa, não altera o estado físico declarado do objeto e não aumenta reencontros. No caso de contato indesejado, impedir novas mensagens naquela conversa e oferecer orientação; não prometer bloquear definitivamente uma pessoa anônima que pode abrir outro navegador.

**Dependências.** Motivo de encerramento separado de devolução, permissões por participante, regras para mensagens posteriores e ajuste da restrição de transferência. Os limites de requisição atuais continuam úteis, mas não substituem essa saída na interface.

**Métrica proposta.** Em 10 cenários de encerramento, pelo menos 9 pessoas escolhem a opção correspondente ao que ocorreu. Meta de integridade: nenhum aviso encerrado sem devolução aumenta a contagem de reencontros.

**Aceite.** Com duas conversas abertas sobre um objeto, encerrar uma por engano preserva a outra; o histórico distingue os resultados; somente confirmação de recebimento incrementa o contador, uma única vez; encerrar contato indesejado não pausa o QR inteiro nem publica identidade de ninguém.

**Como avaliar sem desviar do objetivo**

Conduzir um piloto curto com donos e finders em celulares físicos, incluindo uma devolução combinada fora da LAN. Registrar consentimento e apenas os eventos necessários, sem corpo de mensagens, localização ou credenciais na medição. A medida principal é a proporção de avisos legítimos que chegam a uma devolução confirmada pelo dono, acompanhada de tempo até primeira resposta. Separar confirmação declarada de comprovação independente. Instalações, abertura de QR, uso diário e conexões de carteira são indicadores auxiliares; não demonstram, sozinhos, uma devolução.

Para o primeiro incremento, combinar o fluxo curto de criação/preparo com caixa de entrada clara. A distribuição de etiquetas para uso real exige a origem estável da proposta 1 e uma forma confiável de descobrir avisos, tratada na proposta 5. As demais mudanças podem entrar conforme os impedimentos observados no piloto.

**O que adiar para manter simplicidade**

- Escrow, taxas sobre recompensas, USDC/SKR, alias `.skr`, SGT e provas de propriedade. A carteira atual é uma conexão local opcional ([WalletPanel.tsx](../../../src/platform/WalletPanel.tsx#L22)); não há benefício demonstrado em colocá-la antes da primeira etiqueta. Recompensa permanece opcional e declarada como promessa.
- Fabricação ou estoque próprio de etiquetas, catálogo amplo de formatos, cobertura familiar paga e assinatura anual. Primeiro verificar quais objetos as pessoas realmente etiquetam e quais modelos sobrevivem ao uso.
- Mapa, GPS, Bluetooth, ranking de finders, pontos e incentivo a escaneamentos. A etiqueta é passiva e o resultado procurado é a devolução.
- Recibos públicos de leitura, presença online, recuperação de chat entre dispositivos e múltiplos canais de notificação simultâneos. Exigem decisões extras de privacidade e suporte; começar com estados verificáveis e um canal.

Como referência secundária, a [documentação da tela de swap do Uniswap](https://support.uniswap.org/hc/en-us/articles/39862756339341-Uniswap-Web-App-The-Swap-Screen) mostra detalhes recolhíveis, e o [anúncio de 4 de junho de 2026](https://blog.uniswap.org/in-app-wallet-and-more-UX-improvements) descreve a redução de etapas entre ações. A aplicação proposta ao SeekerTag é uma hipótese de design: tarefa principal curta, opções secundárias depois e resultado final explícito. Esses materiais não fornecem resultados de conversão para o SeekerTag.
