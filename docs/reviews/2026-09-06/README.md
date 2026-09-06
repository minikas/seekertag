# SeekerTag — auditoria e proposta de simplificação

6 de setembro de 2026 · Base examinada: `b7ee44d` · Três frentes: técnica, produto e UX.

**Minha recomendação é tornar o caminho até uma etiqueta utilizável curto e a conversa confiável.** Primeiro, corrigir as falhas de envio e sessão encontradas na auditoria. Em seguida, reduzir a criação ao nome do objeto e a uma categoria, deixar as opções extras recolhidas e dar a quem encontrou acesso direto ao aviso e às conversas salvas.

Esta entrega reúne diagnóstico e propostas. As mudanças descritas abaixo ainda não foram aplicadas ao aplicativo.

## O que as três frentes encontraram

| Frente | Conclusão | Relatório |
| --- | --- | --- |
| Auditoria técnica | Seis falhas reproduzidas: uma de severidade alta e cinco médias. Incluem duplicação, perda de rascunho e estados de sessão/navegação inconsistentes. | [Evidências e correções propostas](auditoria-tecnica.md) |
| Produto | Criar um QR é só uma etapa. O ciclo precisa chegar à etiqueta fixada, ao aviso percebido pelo dono e à devolução combinada. | [Sete propostas de produto](melhorias-produto.md) |
| UX | No celular, ações importantes aparecem depois de textos, contadores e campos opcionais. A hierarquia pode facilitar bastante os percursos já existentes. | [Oito propostas de UX](melhorias-ux.md) |

A revisão anterior registrou 68 testes de lógica/API/navegadores e três fluxos nativos aprovados. A auditoria atual acrescentou cenários que aquela suíte não cobria; os resultados anteriores continuam delimitados aos casos executados. Não houve pesquisa com usuários finais nesta rodada. As expectativas de facilidade e as metas de tempo são hipóteses a validar.

## O que aproveitar do Uniswap

A documentação oficial mostra uma tarefa central com campos essenciais, detalhes que podem ser expandidos e configurações automáticas que a pessoa só personaliza quando precisa. O fluxo também distingue revisão, processamento e conclusão. [Tela de swap](https://support.uniswap.org/hc/en-us/articles/39862756339341-Uniswap-Web-App-The-Swap-Screen), [configurações](https://support.uniswap.org/hc/en-us/articles/8643879653261-How-to-change-slippage-on-the-Uniswap-Web-app) e [etapas da operação](https://support.uniswap.org/hc/en-us/articles/8370549680909-How-to-swap-tokens-with-the-Uniswap-web-app).

A aplicação desses princípios ao SeekerTag é uma proposta de design: **uma ação principal por etapa, bons valores iniciais, opções extras sob demanda e confirmação do que realmente aconteceu**. A base visual permanece a do Orkest: fundo `#090910`, superfícies escuras e lavanda `#C4A1FF`. Carteira continua opcional. Títulos devem nomear a tarefa: “Meus objetos”, “Nova etiqueta”, “Conversas”. A ação de criação deve manter o nome “Criar etiqueta” ao longo do percurso.

## Como simplificar os percursos

| Antes — observado | Depois — proposto | Por quê |
| --- | --- | --- |
| A entrada abre no cadastro. Em viewport de 390 × 664, “Encontrei um objeto” começa em y=770. | Deixar “Encontrei um objeto” visível na entrada, junto de um caminho claro para os próprios objetos. Um QR público continua abrindo diretamente o objeto. | Quem quer devolver precisa reconhecer a ação sem atravessar o cadastro. |
| O painel vazio mostra três contadores zerados, busca e filtros. | Mostrar “Criar etiqueta” e uma explicação curta; apresentar busca/filtros quando ajudarem a encontrar itens existentes. | A primeira tela passa a ajudar na primeira tarefa. |
| O formulário exibe anotação, mensagem pública, recompensa e três moedas antes de criar. O botão começa em y=984 no percurso medido. | Nome, categoria compacta e “Criar etiqueta”. Anotação, mensagem personalizada e recompensa em “Mais opções”, fechado por padrão. | Reduz a quantidade de decisões antes de obter o QR. |
| O objeto recém-criado aparece como “Protegido”, sem comprovação de fixação ou teste. | Mostrar “Etiqueta criada” e uma próxima ação clara: imprimir ou compartilhar. Oferecer teste e confirmação de fixação, identificada como declaração da pessoa. O QR permanece ativo, sem depender dessa confirmação. | Diferencia um arquivo gerado de uma etiqueta em uso. |
| PDF, NFC, página pública, link, status, edição e transferência estão na mesma ficha longa. | Dar destaque ao QR e à ação do momento. Colocar edição, pausa e transferência em “Mais opções”; manter avisos relevantes junto da ação afetada. | Facilita encontrar o próximo passo sem remover capacidades úteis. |
| No fluxo público medido, a mensagem começa em y=671 e “Avisar o dono” em y=795. | Objeto, mensagem e “Avisar o dono” próximos; nome opcional com menor peso. Resultado explícito: mensagem registrada, aguardando resposta. | Reduz a rolagem para ajudar e evita sugerir que o dono já leu. |
| O indicador usa conversas abertas; não distingue mensagens novas. | Separar “Novas mensagens” de devoluções em andamento e priorizar o que aguarda resposta. | Um indicador volta a significar que existe algo a fazer. |
| Reabrir o QR retoma a conversa, mas voltar ao início leva ao cadastro. | Mostrar “Minhas conversas neste aparelho” quando houver acessos válidos salvos. Manter o salvamento automático. | Quem encontrou consegue voltar sem estar com o QR em mãos. |

As coordenadas são observações do navegador no viewport indicado, sem teclado virtual. Não são medições em um iPhone físico. [Capturas da entrada](../../../artifacts/ux-review-2026-09-06/03-entry-mobile-664.png), [painel vazio](../../../artifacts/ux-review-2026-09-06/05-empty-mobile.png) e [formulário](../../../artifacts/ux-review-2026-09-06/08-create-mobile.png). As capturas são artefatos locais em `artifacts/`, ignorados pelo Git.

O percurso proposto do dono é **entrar → nomear objeto → criar etiqueta → obter e fixar → testar**. O de quem encontrou é **abrir QR → escrever aviso → acompanhar conversa**. Conta, credenciais de recuperação e permissões continuam nos momentos em que são necessárias; opções secundárias não devem criar novas etapas obrigatórias.

## Ordem recomendada de implementação

1. **Confiabilidade de envio e sessão.** Tratar repetição após perda de resposta, entrega do novo código de recuperação, preservação de rascunhos e respostas atrasadas após troca de tela ou conta. Aceite: reproduções da auditoria deixam de falhar, sem enfraquecer a autorização ou reutilizar indefinidamente um código de recuperação consumido.
2. **Entrada, criação e aviso no celular.** Simplificar essas telas e o painel vazio, mantendo a ação principal acessível com o teclado. Aceite: em 390 × 664, a intenção inicial e a criação simples ficam visíveis sem rolagem com o teclado fechado; com teclado, envio e erros permanecem acessíveis, preservando texto. Revalidar navegador e simuladores; reservar a verificação física para o piloto.
3. **Preparo e retorno à conversa.** Distinguir etiqueta criada de uso declarado, organizar a ficha do objeto, mostrar conversas salvas e separar mensagens novas de abertas. Aceite: a pessoa consegue retomar ambas as tarefas após fechar o app; conhecer um link sozinho continua sem dar acesso a conversas privadas.
4. **Piloto fora da rede local.** Preparar origem HTTPS permanente antes de distribuir etiquetas e um canal opcional para o dono descobrir avisos com o app fechado. O e-mail atual ainda precisa ser verificado antes de servir a alertas. Aceite: uma etiqueta impressa abre fora da LAN e o aviso chega ao destino correto; confirmar leitura óptica, impressão e comportamento real em celulares.

Formatos de impressão, exibição do estado perdido e encerramento de avisos sem falsa devolução estão detalhados na frente de produto. Podem ser priorizados dentro do piloto conforme o impedimento observado. Pagamentos, escrow, recompensas elaboradas, expansão de carteira e gamificação ficam para depois desse ciclo básico.

## Como saber se ficou mais fácil

Proponho um teste exploratório com cinco pessoas que não conheçam o app, usando objetos e celulares reais. Pedir três tarefas: criar e preparar a primeira etiqueta, avisar sobre um objeto encontrado e retomar a conversa depois de fechar o navegador. Observar conclusão sem ajuda, procura pelo botão, perda de texto e interpretações incorretas dos estados.

Como critério inicial proposto, pelo menos quatro das cinco pessoas devem concluir cada tarefa sem orientação do moderador. É um sinal exploratório, sem validade estatística para prever conversão. Medir o tempo do fluxo atual no mesmo cenário antes de comparar com a versão simplificada; não usar tempos da automação como tempos de pessoas.

A mudança estará bem encaminhada quando a pessoa identificar o que fazer, concluir a ação e compreender o resultado sem precisar conhecer NFC, carteiras ou detalhes da infraestrutura.
