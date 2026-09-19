# Estudo de interações do SeekerTag

Protótipo independente de navegação, com comparação sincronizada do comportamento derivado do código e da proposta. Interface e análise em português. Não altera nem importa `apps/mobile`, não acessa APIs e não realiza login, pagamentos, NFC ou compartilhamentos reais.

## Abrir

Na raiz do repositório:

```sh
python3 -m http.server 4179 --bind 127.0.0.1 --directory docs/interaction-review
```

Abra <http://localhost:4179>. Não precisa instalar dependências.

## Usar

- Escolha um percurso à esquerda. Os casos abrem em uma etapa que evidencia a diferença.
- Use **Reiniciar** para começar do início; clique na ação dentro de qualquer celular para avançar os dois lados.
- As etapas e setas externas percorrem a comparação; o botão de voltar dentro do celular segue o retorno da tarefa.
- No percurso **Conversa → ver objeto**, digite uma mensagem, abra o objeto e volte. O rascunho atual é perdido, reproduzindo a desmontagem encontrada no código; o proposto permanece.
- **Mapa de interações** contém inventário pesquisável com evidência e decisão. Clique numa interação para abrir seu percurso relacionado.
- **Critérios e referências** contém as fontes primárias consultadas, incluindo o código da versão instalada do Gorhom.
- A URL identifica seção, percurso e etapa para compartilhar um estado. Os rascunhos ficam apenas em memória.

## Arquivos

- `index.html`, `styles.css`: apresentação estática, responsiva e sem animações.
- `data.js`: percursos, inventário e referências.
- `app.js`: navegação guiada e representação das camadas.
- `AUDIT.md`: análise, prioridades, limitações e critérios de aceitação para implementação futura.
- `IMPLEMENTATION.md`: implementação posterior no aplicativo e verificações Android.

## Limite da evidência

O lado atual é uma reconstrução esquemática por leitura estática, não uma gravação do app. Dimensões, scrims e textos são simplificados. A navegação React Native, os gestos, o botão Voltar físico, o teclado e o TalkBack não são executados aqui. Os testes deste protótipo verificam apenas o site e seus percursos.

O estudo inicial não alterou `apps/mobile`. A implementação posterior está documentada em `IMPLEMENTATION.md` e inclui o rebuild e a reinstalação Android definidos em `AGENTS.md`.

## Validação realizada

Em 19/09/2026, com Chromium via Playwright:

- 17 percursos, 70 etapas renderizadas e suas ações de avanço exercitadas.
- Uma camada ativa por celular e ações principais dentro da área visível em todas as etapas.
- Rascunho de conversa: vazio no retorno atual; texto digitado preservado no proposto.
- Campos do formulário preservados ao gerenciar categorias em ambos os lados, respeitando o que o código atual já faz.
- 46 linhas no inventário; busca por carteira, filtro de correções e oito referências verificadas.
- Layout sem overflow horizontal em 390 e 768 px; inspeção visual em 390 e 1440 px.
- Nenhum erro ou warning no console; nenhuma falha de carregamento observada.

Capturas de QA ficam em `qa/artifacts/interaction-review/`, ignorado pelo Git. Esses resultados validam o protótipo web, não o comportamento do APK.
