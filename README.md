# KM Acompanhamento

Userscript para Klassmatt que mostra o KM Acompanhamento inline na pagina do item.

## Instalar e testar

Use este link para instalar ou atualizar o script no Tampermonkey:

- https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js

Instale uma vez. Depois disso, o Tampermonkey passa a checar atualizacoes automaticamente.
Depois da instalacao, as checagens de update usam a metadata publicada em `sin-inline.meta.js` e baixam a versao nova do release versionado correspondente.

Na primeira instalacao, o script ja entra com:

- acompanhamento sempre visivel ativado
- visualizacao de apenas comentarios amarelos ativada

Se o usuario ja tinha configurado o script antes, a preferencia salva continua valendo.

## O que mudou no uso

- O menu do Tampermonkey controla a preferencia global `alwaysOpen`.
- O botao inline da pagina so controla o item atual, alternando entre `Mostrar painel` e `Ocultar painel`.
- Fechar o painel pela pagina nao desativa o `alwaysOpen` global.
- O modo `Tudo` / `Amarelos` continua separado e continua persistente.

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
