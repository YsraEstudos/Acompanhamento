# Relatorio de Investigacao - KM Acompanhamento

Atualizado em: 2026-04-13 11:24:07 -03:00

## Resumo executivo

Este documento registra a investigacao sobre o problema em que o painel `KM Acompanhamento` funcionava no Google Chrome, mas exibia acompanhamento incorreto no Microsoft Edge.

Pontos centrais observados durante a conversa:

- No Chrome, a injecao do script aparecia correta.
- No Edge, o popup nativo de `Acompanhamento` estava correto, mas a injecao do script na tela principal estava errada.
- Segundo o relato do usuario, a versao `1.0.7` funcionava e a `1.0.10` nao estava funcionando corretamente nesse fluxo.
- Depois da correcao local, a release `1.0.11` foi gerada e enviada ao Git remoto, mas o link publico ainda servia `1.0.10`.

## Contexto funcional

Tela analisada:

- `ITEM_Edita.aspx?IdItem=300993&IdSIN=84560`

Comportamento esperado:

- O painel injetado pelo userscript deve reproduzir o mesmo acompanhamento exibido pelo popup nativo aberto pelo link `Acompanhamento`.

Comportamento observado:

- Edge: popup nativo correto, painel injetado incorreto.
- Chrome: painel injetado correto.

## Linha do tempo da investigacao

### 2026-04-13 08:30:55 -03:00

Log do robô mostrou:

- `Nao foi possivel criar/atualizar pasta da sessao ao parar: Failed to fetch`

Interpretacao:

- Erro interno do robô/script auxiliar.
- Nao provava erro do Klassmatt nem do HTML do acompanhamento.

### 2026-04-13 10:31:49 -03:00

Log do robô mostrou:

- `Botao Prosseguir nao encontrado na pagina`
- `Nao foi possivel criar/atualizar pasta da sessao ao parar: Failed to fetch`

Interpretacao:

- Outro erro do robô auxiliar.
- Tambem nao explicava diretamente a divergencia do acompanhamento entre Chrome e Edge.

### 2026-04-13 10:55 a 11:07 -03:00

Inspecoes de pagina e snippets no console mostraram:

- A pagina `ITEM_Edita.aspx` estava carregando normalmente.
- Nao havia pagina de login no Edge naquele momento.
- Existia exatamente um `.kl-view`.
- Existia exatamente um link de `Acompanhamento`.
- O link correto era:
  `javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=84560&SomenteLeitura=1', 680, 500, 1)}`

Conclusao:

- O problema nao era duplicidade de root no DOM.
- O problema nao era o script capturando o link errado por haver dois `hlkObs`.

### 2026-04-13 11:09 -03:00

Analise do JavaScript nativo do Klassmatt (`km_main_v04.js`) revelou:

- A funcao `OpenWindowsWHR(...)` nao abre a URL bruta do `href`.
- Antes de abrir o popup, o Klassmatt adiciona o parametro de seguranca `k` usando o `k` da URL atual.

Trecho funcional identificado:

- `url = addQueryString(url, 'k', getQueryStringValue(window.location.href, 'k'));`

Conclusao:

- O popup nativo e o userscript nao estavam usando a mesma URL.
- O popup nativo buscava `Historico.aspx?...&k=...`.
- O userscript em `1.0.10` buscava apenas `Historico.aspx?...` quando o `href` nao trazia `k`.
- Isso explica por que o popup estava correto e o painel do Edge estava errado.

### 2026-04-13 11:09 a 11:11 -03:00

Correcao aplicada localmente:

- O userscript passou a completar a URL do historico com o `k` atual da pagina quando o `href` nativo nao trouxer esse parametro.

Arquivos alterados:

- [src/url.ts](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\src\url.ts)
- [tests/url.test.ts](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\tests\url.test.ts)

Validacao executada:

- `npm test -- tests/url.test.ts`
- `npm run build`

Resultado:

- A correcao local passou nos testes e gerou a versao `1.0.11`.

### 2026-04-13 11:11 -03:00

Release local criada:

- Versao `1.0.11`
- Commit local: `ee81645`

Push realizado:

- `main -> origin/main`

## Tentativas de solucao realizadas

### 1. Verificacao de erro de login, redirecionamento ou sessao

Foi verificado se a pagina retornava login, erro 401/403/500 ou redirecionamento incorreto.

Resultado:

- Nao explicou o caso especifico do Edge, porque o item principal estava abrindo normalmente.

### 2. Verificacao do DOM da tela principal

Foi inspecionado se havia:

- mais de um `.kl-view`
- mais de um link `hlkObs`
- root antigo permanecendo visivel

Resultado:

- Havia apenas um root relevante e apenas um link de acompanhamento.

### 3. Verificacao da diferenca entre popup nativo e painel injetado

Foi confirmada a diferenca funcional:

- popup correto
- painel do Edge incorreto

Resultado:

- Isso descartou o parser como unica causa inicial.
- Levou a investigacao para a URL realmente usada no fetch.

### 4. Analise do `OpenWindowsWHR`

Foi comparado o `href` do link com o comportamento real da funcao nativa do Klassmatt.

Resultado:

- Identificada a divergencia do parametro `k`.

### 5. Correcao do userscript

Foi alterada a extracao da URL do historico para reaproveitar o `k` da pagina atual quando necessario.

Resultado:

- A versao local `1.0.11` ficou alinhada com a URL real usada pelo popup nativo.

## Diagnostico final do problema Edge x Chrome

A causa principal identificada foi:

- a versao `1.0.10` do userscript nao reproduzia exatamente a URL aberta pelo Klassmatt no popup nativo quando o `href` do `Acompanhamento` vinha sem `k`

Consequencia pratica:

- no Edge, o fetch do painel podia carregar um acompanhamento diferente do exibido no popup correto

Hipotese consistente com o relato do usuario:

- a `1.0.7` funcionava no fluxo observado
- a `1.0.10` introduziu uma regressao ou endurecimento de contexto sem replicar a adicao nativa do `k`

## Por que o link publico ainda estava em 1.0.10

Depois do push da `1.0.11`, foi verificado o conteudo publicado em:

- `https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js`
- `https://ysraestudos.github.io/km-sin-sidebar-userscript/latest.json`

Resultado observado:

- ambos ainda serviam `1.0.10`

Causa encontrada:

- o pipeline de build gerava os artefatos novos apenas dentro de `dist/`
- o GitHub Pages estava servindo os arquivos publicados na raiz do repositorio
- os arquivos de publicacao na raiz ainda estavam em `1.0.10`

Arquivos que permaneceram desatualizados na raiz:

- [sin-inline.user.js](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\sin-inline.user.js)
- [sin-inline.meta.js](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\sin-inline.meta.js)
- [latest.json](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\latest.json)
- pasta [releases](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\releases)

## Acao corretiva adicional

Para evitar repeticao do problema de publicacao:

- o script [postbuild.mjs](C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento\scripts\postbuild.mjs) foi ajustado para sincronizar os artefatos tanto em `dist/` quanto na raiz publicada pelo GitHub Pages

Objetivo:

- garantir que uma nova release atualize ao mesmo tempo:
  - `dist/`
  - raiz do repositorio
  - `releases/<versao>/`

## Estado esperado apos a correcao de publicacao

Depois de rebuildar e publicar corretamente, o esperado e:

- `sin-inline.user.js` publico com `@version 1.0.11`
- `sin-inline.meta.js` publico com `@version 1.0.11`
- `latest.json` publico com `version: 1.0.11`
- `releases/1.0.11/sin-inline.user.js` acessivel publicamente

## Proxima verificacao recomendada

Confirmar apos a publicacao:

- se o link publico passou a servir `1.0.11`
- se o Tampermonkey no Edge instala ou atualiza para `1.0.11`
- se o painel do `KM Acompanhamento` no Edge agora coincide com o popup nativo do Klassmatt
