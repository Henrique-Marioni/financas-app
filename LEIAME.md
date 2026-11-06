# Minhas Finanças (PWA offline)

App de celular feito em HTML/JS. Não tem servidor nem banco de dados: os lançamentos
ficam salvos no próprio celular (armazenamento do navegador). O site só entrega o código.

## Colocar no celular (grátis, via GitHub Pages)

1. Crie um repositório no GitHub (ex.: `financas-app`) e envie **o conteúdo desta pasta**
   (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `vendor/`).
2. No repositório: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
3. Abra o endereço `https://SEU-USUARIO.github.io/financas-app/` no **Chrome do Android**.
4. Menu ⋮ → **Adicionar à tela inicial / Instalar app**.

Depois de instalado, funciona sem internet.

## Uso

- **Importar planilha**: Ajustes → Importar. Lê abas com colunas Data, Tipo, Descrição,
  Entrada, Saída, Realizado? e o bloco de Gastos Avulsos (Data, Descrição, Categoria, Valor).
  Os meses presentes no arquivo são substituídos; lançamentos feitos à mão no app são mantidos.
- **Lançar**: botão **+**. Saída (Avulso / Conta) ou Entrada (Extra / Salário / Outra).
  Em Extra, o valor é sugerido pelo dia da semana (qui/sex/sáb).
- **Realizado**: toque no círculo do lançamento para marcar que já entrou/saiu da conta.
- **Copiar mês**: gera o próximo mês com as mesmas contas/salários e os extras de qui/sex/sáb.
- **Backup**: Ajustes → Salvar backup (.json). Faça de vez em quando — limpar os dados do
  Chrome apaga os lançamentos.

## Testar no PC

```
python -m http.server 5173
```
e abra http://localhost:5173

## Atualizar o app

Ao mudar algum arquivo, aumente `CACHE` em `sw.js` (ex.: `financas-v2`) e envie de novo.
