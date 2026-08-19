# KM Acompanhamento

Userscript para Klassmatt que mostra o KM Acompanhamento inline na pagina do item.

## Instalar e testar

Versao atual: `1.0.19`.

Use este link para instalar ou atualizar o script no Tampermonkey:

- https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js

Instale uma vez. Depois disso, o Tampermonkey passa a checar atualizacoes automaticamente.
Depois da instalacao, as checagens de update usam a metadata publicada em `sin-inline.meta.js` e baixam a versao nova do release versionado correspondente.

Se voce estiver no Chrome e o script nao aparecer na pagina, faca este ajuste no navegador:

1. Abra `chrome://extensions/`
2. Abra os detalhes do `Tampermonkey`
3. Ative `Allow User Scripts`
4. Feche o Chrome completamente e abra de novo
5. Volte ao item do Klassmatt e recarregue a pagina

Se a versao instalada no Tampermonkey nao for `1.0.19`, atualize o userscript pelo link acima.

## UNSPSC rapido

Na aba `Classificacoes`, o script adiciona um campo `Codigo rapido` acima do campo UNSPSC nativo.

- Digite ou cole os 8 digitos do codigo UNSPSC.
- Ao completar o codigo, o script pesquisa e seleciona a correspondencia exata usando o fluxo nativo do Klassmatt.
- UNSPSC, Segmento, Familia, Classe e Mercadoria sao atualizados pelo proprio sistema.
- A lupa original continua disponivel caso a pesquisa automatica falhe.
- Se a tela ja possuir o campo nativo `Codigo UNSPSC`, o campo rapido nao e exibido.
- O recurso nao clica em `Salvar`, `Prosseguir` ou `Reavaliar`.

Na primeira instalacao, o script ja entra com:

- acompanhamento fechado por padrao; clique em `Mostrar painel` para abrir
- visualizacao de apenas comentarios amarelos ativada

Se o usuario ja tinha configurado o script antes, o modo `Tudo` / `Amarelos` continua salvo; a antiga preferencia de sempre visivel e migrada para fechado para nao travar a pagina.

## O que mudou no uso

- O menu do Tampermonkey controla a preferencia global `alwaysOpen`.
- O botao inline ao lado do link nativo agora alterna apenas `Mostrar painel` / `Ocultar painel` para o item atual.
- Esse botao inline nao persiste a preferencia global e nao altera `alwaysOpen`.
- Ao trocar de item, recarregar o contexto ou abrir outro item, o comportamento volta a seguir `alwaysOpen`.
- O modo `Tudo` / `Amarelos` continua separado e continua persistente.
- Quando o historico da SIN vier misturando mais de um item, o painel tenta filtrar o acompanhamento do `IdItem` atual para evitar reaproveitar eventos do item anterior.

## Hardening de seguranca

- O userscript agora so roda em paginas `https://*.klassmatt.com.br/...`.
- O fetch do historico bloqueia respostas que tentem mudar de origem durante redirect.
- O botao `Ver inline` nao injeta mais o HTML remoto bruto; ele abre uma visualizacao segura e somente leitura.
- Scripts, formularios, imagens e outros recursos externos do HTML original sao removidos dessa visualizacao.
- Links externos vindos do historico deixam de ser clicaveis no painel; apenas links `https` do mesmo host do Klassmatt continuam como ancora.

## Desenvolvimento local

- `npm ci`
- `npm test`
- `npm run build`

O build gera:

- `dist/sin-inline.user.js`
- `dist/sin-inline.meta.js`
- `dist/latest.json`
- `dist/releases/<versao>/sin-inline.user.js`
- `dist/releases/<versao>/SHA256SUMS.txt`

## Publicacao

Fluxo seguro para nova versao:

1. Alterar o codigo e testar localmente.
2. Atualizar a versao em `vite.config.ts`.
3. Rodar `npm run build`.
4. Publicar no GitHub Pages:
   `sin-inline.user.js`
   `sin-inline.meta.js`
   `latest.json`
   `releases/<versao>/sin-inline.user.js`
   `releases/<versao>/SHA256SUMS.txt`
5. Conferir se o `SHA256SUMS.txt` bate com o artefato versionado publicado.

Repo privado de origem:

- https://github.com/YsraEstudos/km-sin-sidebar-userscript

## Observacoes

- O arquivo publicado e servido publicamente pelo GitHub Pages, mesmo com o repo de origem privado.
- `@updateURL` aponta para `sin-inline.meta.js`.
- `@downloadURL` aponta para o artefato versionado e imutavel em `releases/<versao>/`.
- O link publico e a forma mais simples de distribuir atualizacoes sem pedir para o pessoal colar o arquivo inteiro de novo.
