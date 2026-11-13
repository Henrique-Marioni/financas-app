# Minhas Finanças (PWA offline)

App de celular feito em HTML/JS. Não tem servidor nem banco de dados: os lançamentos
ficam salvos no próprio celular (armazenamento do navegador). O site só entrega o código.

## Colocar no celular (grátis, via GitHub Pages)

A pasta do app é um repositório git ligado a
https://github.com/Henrique-Marioni/financas-app (o arquivo `.nojekyll`, vazio, faz parte
da publicação).

1. No repositório: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
2. Abra o endereço do Pages no **Chrome do Android**.
3. Menu ⋮ → **Adicionar à tela inicial / Instalar app**.

Depois de instalado, funciona sem internet.

## Uso

- **Lançar**: botão **+**. Saída (Avulso / Conta), Entrada (Extra / Salário / Outra) ou
  Transferência. Em Extra, o valor é sugerido pelo dia da semana (qui/sex/sáb).
- **Realizado**: toque no círculo do lançamento para marcar que já entrou/saiu da conta.
- **Copiar mês**: gera o próximo mês com as mesmas contas/salários (na mesma conta) e os
  extras de qui/sex/sáb. Transferências não são copiadas.
- **Backup**: Ajustes → Salvar backup (.json). Faça de vez em quando — limpar os dados do
  Chrome apaga os lançamentos.

## Contas e transferências

- **Cadastrar contas**: Ajustes → Minhas contas. Cada conta tem nome (único), tipo (banco ou
  dinheiro físico) e **saldo inicial** próprio (pode ser negativo). A soma dos saldos de todas
  as contas é o "Saldo real atual".
- **Lançamentos**: todo lançamento tem uma conta (o app sugere a última usada).
- **Transferência** (ex.: sacar dinheiro, Pix entre suas contas): escolha **De** e **Para**.
  Move o dinheiro entre as contas sem alterar o total, e não conta como entrada nem saída.
- **Arquivar vs excluir**: conta com lançamentos não pode ser excluída; arquive. Conta
  arquivada some dos seletores, mas continua somando no total. A última conta ativa não pode
  ser arquivada nem excluída.
- **Filtro por conta**: na lista do mês, filtre para ver só os lançamentos e o saldo de
  uma conta.
- **Cartão "Onde está meu dinheiro"**: saldo real e previsto (fim do mês) de cada conta.
  Cartão de crédito ainda não é tratado.

## Importar e exportar planilha

- **Importar**: Ajustes → Importar planilha. Lê abas com colunas Data, Tipo, Descrição, Entrada, Saída,
  Realizado? e o bloco de Gastos Avulsos. Colunas **Conta** (ou Banco/Carteira) e
  **Conta destino** são reconhecidas. Contas novas são listadas antes de confirmar; linhas sem
  conta vão para a conta escolhida no diálogo. Os meses presentes no arquivo são substituídos;
  lançamentos feitos à mão em outros meses são mantidos.
- **Exportar**: cada mês traz Conta e Conta destino, e a aba Resumo traz a tabela de Contas.
  **Atenção:** a transferência sai na coluna **Saída**. Quem somar a coluna Saída na planilha
  vai contar as transferências como gasto.
- **Reimportar a planilha exportada**: marque **"Atualizar premissas"** para trazer os saldos
  iniciais das contas. Sem isso, num app vazio, os saldos iniciais não voltam.

## Atualizar o app (importante: backup antes)

Esta versão (5) muda o formato dos dados. **Antes de atualizar, faça o backup** (Ajustes →
Salvar backup). Ao abrir, o app migra sozinho: cria a conta **"Conta principal"** com o saldo
inicial antigo e liga todos os lançamentos a ela. Uma cópia dos dados antigos fica guardada no
navegador.

Para publicar uma mudança, na pasta do app:

```
git add -A
git commit -m "descrição da mudança"
git push
```

Antes, aumente `CACHE` em `sw.js` (ex.: `financas-v6`) e `APP_VERSION` em `app.js`; senão o
celular continua com a versão antiga.

## Testar no PC

```
python -m http.server 5173
```
e abra http://localhost:5173
