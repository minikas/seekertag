# E2E devnet — etiqueta, QR, conversa e recompensa

Este roteiro testa o fluxo completo no Android Seeker contra a API pública de devnet:

```text
https://api-seeker.viralizai.co/api
```

Ele não usa saldo real. Não registre, renove ou transfira domínios durante o teste.

## Participantes

| Papel | Carteira | O que assina |
| --- | --- | --- |
| Dono | A carteira Solana usada para criar a etiqueta | Login, depósito e pagamento da recompensa |
| Quem encontrou | Carteira `testuser` no Seeker | Confirmação de que receberá a recompensa |
| Treasury | `C2LWNDXdnh3X8fSgJ8iCe8YueMrHie8vpo4n3d7xA9SJ` | Recebe a comissão; nunca assina no teste |

Preencha antes de iniciar:

```text
Endereço público da testuser: ________________________________
Nome da etiqueta: E2E recompensa devnet — <data-hora>
Valor: 0,01 SOL
Prazo: 1 hora
```

O dono e a `testuser` precisam ser carteiras diferentes. A `testuser` não paga nenhuma taxa neste roteiro: ela assina somente uma mensagem para confirmar o endereço. O dono precisa ter SOL de devnet suficiente para `0,01 SOL` mais a taxa de rede e o aluguel mostrado na revisão.

## 1. Verificar o ambiente

1. Instale e abra o build conectado à mesma API pública do roteiro. Para uma
   compilação de desenvolvimento, inicie o Metro com esta variável (ela também
   precisa estar presente ao reinstalar o app):

   ```sh
   EXPO_PUBLIC_API_URL=https://api-seeker.viralizai.co/api npm run start --workspace=@seekertag/mobile -- --lan
   ```

   Não use um Metro iniciado sem essa variável: nesse caso o app tenta acessar
   `http://<IP-do-computador>:4318/api`. Se não houver uma API local nessa
   porta, o botão **Continuar com Seeker / Solana** mostra “Não foi possível
   conectar” antes de abrir a carteira.
2. Abra o SeekerTag e, em **Minha conta → Rede**, confirme **devnet**.
3. Verifique que a API responde em um navegador ou terminal:

   ```sh
   curl https://api-seeker.viralizai.co/api/health
   ```

4. Entre com a carteira do **dono** em **Continuar com Seeker / Solana**.
5. Na Seed Vault Wallet, confirme que a carteira selecionada é a do dono, e não `testuser` nem a treasury.

**Aprovado:** a resposta da API contém `"ok":true` e o app indica devnet.

## 2. Criar a etiqueta e bloquear a recompensa

1. No app do dono, toque em **Adicionar objeto**.
2. Preencha nome, categoria e a mensagem pública `Teste E2E: encontre-me pelo chat.`
3. Toque em **Recompensa (Opcional)**.
4. Selecione **SOL**, informe `0,01` e escolha **1 Hora**. Confirme que o
   próprio campo de período mostra `1` e a unidade **Hora** antes de avançar:
   ele começa em **30 dias** por padrão. Não prossiga se a revisão ainda
   mostrar 30 dias; voltar depois do depósito não altera o bloqueio já criado.
5. Toque em **Salvar e revisar depósito**.
6. Na revisão, confira antes de assinar:
   - aviso **Devnet: apenas tokens de teste**;
   - valor de `0,01 SOL`;
   - prazo de uma hora;
   - carteira do depósito igual à do dono;
   - comissão SeekerTag de `5%`;
   - taxa de rede e custo de criação apresentados separadamente.
7. Toque em **Assinar na carteira** e aprove a transação somente depois de conferir esses dados na Seed Vault Wallet.
8. Aguarde a confirmação. O resumo da etiqueta deve mostrar recompensa reservada, sem o estado **Aguardando confirmação**.

**Aprovado:** existe uma única reserva em devnet. O valor é `0,01 SOL`, o pagador é o dono e a treasury é `C2L…A9SJ`.

## 3. Salvar o QR e sair da conta do dono

1. Abra os detalhes da etiqueta criada.
2. Na área do QR, salve uma captura de tela no Seeker. Nome sugerido:

   ```text
   e2e-seekertag-<data-hora>.png
   ```

3. Registre também o código e a URL pública exibida nos detalhes:

   ```text
   Código: ________________________________
   URL: ___________________________________
   ```

4. Em **Minha conta**, escolha **Sair**.
5. Confirme que não é possível abrir a lista privada de etiquetas sem entrar novamente.

**Aprovado:** o QR abre a mesma etiqueta e a sessão do dono foi removida do app.

## 4. Encontrar o objeto como visitante

1. Na tela inicial deslogada, toque em **Encontrei um objeto** e leia o QR salvo. Também pode abrir a URL pública pelo QR.
2. Confirme que aparecem o nome, categoria, mensagem pública e a recompensa de `0,01 SOL`.
3. Informe um nome de teste, por exemplo `Pessoa testuser`.
4. Envie a mensagem:

   ```text
   Encontrei a etiqueta do teste E2E. Posso devolver o objeto em local combinado.
   ```

5. Para retomar em outro celular, toque em **Criar conta ou entrar** e use
   Seeker / Solana, Google ou Apple antes de avisar o dono. A conversa será
   salva nessa conta. Quem já enviou um aviso anônimo pode abrir a conversa no
   aparelho original e usar **Salvar conversa na conta**.
6. A conversa é apenas para mensagens. Toque no ícone de **etiqueta** no cabeçalho
   para abrir o objeto e então toque em **Confirmar carteira de recebimento**.
   Ao voltar dos detalhes, o app deve reabrir a mesma conversa, e não a lista de
   conversas.
7. Na Seed Vault Wallet, escolha **testuser** e toque em **Iniciar sessão** se
   a carteira pedir essa autorização inicial. Confirme a autenticação da Seed
   Vault e volte ao aplicativo. Toque novamente em **Confirmar carteira de
   recebimento** se o app ainda a exibir.
8. Confira que a solicitação é uma confirmação de mensagem, sem valor, sem
   taxa e sem instrução de transferência. Assine somente então.
9. Volte aos detalhes do objeto e confirme que **Sua carteira de recebimento** mostra o endereço de `testuser`.

**Aprovado:** a conversa fica aberta, a mensagem aparece para os dois lados e a carteira de recebimento é exatamente a `testuser`.

## 5. Conversar e liberar a recompensa como dono

1. Saia da sessão de visitante, entre novamente como o **dono** e abra **Conversas**.
2. Abra a conversa da etiqueta E2E e responda:

   ```text
   Obrigado. Teste E2E confirmado; vou liberar a recompensa.
   ```

3. Após simular a devolução, toque no ícone de **etiqueta** no cabeçalho da
   conversa e, nos detalhes do objeto, toque em **Finalizar devolução**. A ação
   seguinte confirma a devolução e faz o pagamento da recompensa. Não confirme
   antes de o objeto estar realmente com o dono.
4. Confira antes de assinar:
   - destinatário igual ao endereço anotado da `testuser`;
   - `Quem encontrou recebe` igual a `0,0095 SOL`;
   - `Taxa SeekerTag (5%)` igual a `0,0005 SOL`;
   - carteira do depósito igual à carteira do dono;
   - aviso de que o pagamento é definitivo.
5. Toque em **Confirmar devolução e pagar** e então em **Assinar na carteira**.
6. Na Seed Vault Wallet, aprove a transação apenas se os dados conferirem com a revisão.
7. Espere a confirmação final e não repita a assinatura caso o app mostre **Verificar transação**; use essa ação para consultar a mesma operação.

**Aprovado:** a conversa muda para resolvida e a recompensa muda para `released`/paga. Não deve permanecer uma reserva aberta para a etiqueta.

## 6. Verificar o recebimento

1. Volte à conversa como visitante pelo mesmo QR ou pela conversa preservada no app.
2. Confirme a mensagem **Devolução confirmada**.
3. Abra a Seed Vault Wallet na carteira `testuser` e atualize o saldo de devnet.
4. Confirme o crédito de `0,0095 SOL` menos somente variações externas já existentes; a `testuser` não paga a taxa deste fluxo.
5. Na carteira `SeekerTag`, confira o crédito da comissão de `0,0005 SOL` na devnet.

## Registro do resultado

| Evidência | Resultado |
| --- | --- |
| Captura do QR | caminho/arquivo: ________________________________ |
| Código da etiqueta | ________________________________ |
| Endereço `testuser` confirmado | ________________________________ |
| Assinatura do depósito | ________________________________ |
| Assinatura do pagamento | ________________________________ |
| Valor recebido por `testuser` | ________________________________ |
| Comissão recebida pela treasury | ________________________________ |
| Data e hora | ________________________________ |
| Resultado | aprovado / falhou |

## Notas de execução no Android Seeker

- Depois de sair da conta do dono, abra o QR/URL HTTPS original da etiqueta.
  Para abrir manualmente no app, o deep link precisa preservar a origem:
  `seekertag:///found/<codigo>?origin=https%3A%2F%2Fapi-seeker.viralizai.co`.
  O formato abreviado `seekertag://found/<codigo>` é rejeitado corretamente
  como link de outra instalação, pois não traz a origem canônica.
- Arquive a captura do QR e a URL antes do logout. Com a conversa salva em uma
  conta, entre com o mesmo Seeker / Solana, Google ou Apple em outro celular e
  abra o QR/URL para retomá-la. Sem conta, o token local ainda permite retomar
  apenas no aparelho original; não limpe os dados antes de usar **Salvar conversa
  na conta**.

## Critérios de falha

O teste falha se qualquer um destes ocorrer:

- a carteira `testuser` for igual à carteira do dono;
- a confirmação da carteira do visitante pedir transferência ou taxa;
- o pagamento apontar para um endereço diferente da `testuser`;
- a divisão não for `95%` para a pessoa que encontrou e `5%` para a treasury;
- a conversa não encerrar após pagamento confirmado;
- houver duas transações de depósito ou pagamento para a mesma ação;
- qualquer etapa mostrar mainnet ou saldo real.
