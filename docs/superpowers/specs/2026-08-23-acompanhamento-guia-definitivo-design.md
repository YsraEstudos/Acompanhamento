# Acompanhamento: O Guia Definitivo - Especificacao editorial

Data: 2026-08-23

## Objetivo

Produzir um livro em PDF, em portugues, que conduza o leitor do nivel iniciante ao avancado e explique o codigo local atual do projeto Acompanhamento. O livro deve cobrir o funcionamento do userscript, seus modulos TypeScript, testes, configuracoes, scripts de build e publicacao. Cada um dos 15 capitulos deve terminar com tres exercicios, e todas as 45 respostas devem aparecer em um gabarito comentado ao final.

## Fonte tecnica autoritativa

- A fonte do conteudo e o estado local dos arquivos no momento em que a producao comecar, inclusive alteracoes ainda nao consolidadas na branch `main`.
- Antes da redacao, sera criado um manifesto interno com caminho, tamanho e SHA-256 dos arquivos consultados.
- O processo nao modificara o funcionamento nem os arquivos-fonte do Acompanhamento.
- Bundles, artefatos de release e arquivos gerados serao explicados pelo fluxo que os produz. Eles nao serao reproduzidos integralmente quando apenas repetirem o TypeScript fonte.
- Cada trecho de codigo publicado tera identificacao do arquivo de origem e, quando util, das linhas correspondentes ao snapshot.

## Referencia editorial

O arquivo `C:/Users/israe/Downloads/Telegram Desktop/JavaScript_The_Definitive_Guide.pdf` sera usado somente como referencia de organizacao didatica e linguagem visual: progressao do basico ao avancado, capitulos numerados, texto corrido, exemplos de codigo, resumos e hierarquia tipografica. O novo livro tera conteudo, identidade, capa, diagramas e redacao originais, sem copiar logotipos, capa ou elementos exclusivos da editora.

## Publico e progressao

O leitor inicial pode conhecer pouco de JavaScript, TypeScript, DOM, userscripts e testes. Os primeiros capitulos devem explicar o vocabulario e os mecanismos necessarios para acompanhar o projeto. Os capitulos intermediarios devem percorrer o fluxo real de dados. Os capitulos finais devem tratar de orquestracao, seguranca, automacao de interface, testes, build, releases e pontos de extensao.

Cada capitulo seguira este ciclo:

1. problema que o codigo resolve;
2. conceitos necessarios;
3. leitura comentada do codigo local;
4. fluxo de dados e dependencias;
5. decisoes, riscos e casos extremos;
6. resumo;
7. tres exercicios: compreensao, implementacao ou teste, e desafio avancado.

## Estrutura de capitulos

1. **Conhecendo o Acompanhamento** - proposito, fluxo visivel, arquitetura geral e como ler o projeto.
2. **JavaScript e TypeScript usados no projeto** - tipos, funcoes, modulos, DOM, eventos e assincronismo.
3. **Ambiente e empacotamento** - `package.json`, `tsconfig.json`, Vite, Vitest, `vite-plugin-monkey` e metadados do Tampermonkey.
4. **Texto, preferencias e protecao de execucao** - `src/text.ts`, `src/state.ts` e `src/runtime-guard.ts`.
5. **Descobrindo a pagina e construindo URLs** - `src/url.ts`, seletores, pontuacao de candidatos, parametros e token nativo.
6. **Identidade e seguranca do historico** - `src/history-identity.ts`, fingerprints, mascaramento e validacao.
7. **HTTP, codificacao e fallback Tampermonkey** - `src/http.ts`, charsets, abortos, redirects, erros do Klassmatt e `GM_xmlhttpRequest`.
8. **Transformando HTML em eventos** - estruturas e estrategias estrita e flexivel de `src/parse.ts`.
9. **NCM, NBS e isolamento por item** - `src/code-prefixes.ts` e as partes avancadas do parser para codigos fiscais, marcadores e recorte da timeline.
10. **Sanitizacao de HTML** - `src/html.ts`, texto, links permitidos, bloqueios e snapshots seguros.
11. **Construindo a interface** - `src/ui.ts`, shell, timeline, lotes de renderizacao, iframe e fallback sob demanda.
12. **O orquestrador central** - `src/app.ts`, contexto, cache, concorrencia, cancelamento, observadores, renderizacao e erros.
13. **Preenchimento rapido de UNSPSC** - `src/unspsc-quick-fill.ts`, descoberta do formulario, modal, postbacks, persistencia e retomada.
14. **Inicializacao e integracao completa** - `src/main.ts`, menus, sincronizacao de preferencias, bootstrap e fluxo ponta a ponta.
15. **Testes, build e publicacao** - todos os testes e fixtures, `vitest.config.ts`, scripts de build, checksums, metadados, releases e documentacao gerada.

## Cobertura obrigatoria

O livro deve conter uma matriz de cobertura que relacione cada arquivo relevante a pelo menos um capitulo ou apendice. A matriz deve abranger:

- todos os arquivos `src/*.ts`;
- todos os arquivos de teste `tests/*.ts` e as fixtures HTML;
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts` e `vitest.config.ts`;
- `scripts/postbuild.mjs`, `scripts/release-artifacts.mjs` e sua declaracao de tipos;
- `build-userscript.bat`;
- `README.md`, `latest.json`, metadados e estrutura dos releases;
- o relacionamento entre fontes TypeScript, bundle do userscript e artefatos publicados.

Arquivos de dependencias em `node_modules`, caches internos e copias historicas de bundles nao precisam de explicacao linha a linha. Sua funcao no ambiente ou na cadeia de producao deve ser explicada quando relevante.

## Exercicios e gabarito

- Cada capitulo tera exatamente tres exercicios.
- O primeiro verificara compreensao do fluxo ou dos conceitos.
- O segundo pedira uma pequena implementacao, teste ou investigacao.
- O terceiro exigira raciocinio avancado sobre arquitetura, seguranca, concorrencia, parser, DOM ou manutencao.
- O enunciado nao exibira a resposta imediatamente.
- O gabarito final tera exatamente 45 respostas, na mesma numeracao dos exercicios.
- Cada resposta explicara o raciocinio, o resultado esperado e, quando aplicavel, uma solucao de codigo ou estrategia de teste.

## Projeto visual

- Formato A4, adequado para leitura digital e impressao.
- Fundo branco, margens amplas e uma coluna principal de leitura.
- Titulos de capitulo grandes em preto, com linha divisoria.
- Secoes numeradas em vermelho-escuro.
- Texto corrido em fonte serifada; titulos e navegacao em fonte sem serifa; codigo em fonte monoespacada.
- Blocos de codigo com fundo cinza-claro, sintaxe destacada e legenda de origem.
- Cabecalho discreto com o capitulo e rodape com numero da pagina.
- Caixas recorrentes para `Conceito`, `Atencao`, `Seguranca` e `Por dentro do codigo`.
- Diagramas vetoriais simples para arquitetura, HTTP, parsing, renderizacao, inicializacao e UNSPSC.
- Exercicios identificados visualmente como iniciante, intermediario e avancado.

## Capa

Titulo: **Acompanhamento: O Guia Definitivo**

Subtitulo: **Do primeiro contato a arquitetura avancada do userscript**

Autor: **Ysrael Xavier**

## Extensao e paginacao

A meta editorial e aproximadamente 145 a 165 paginas, mas o numero final pode aumentar se isso for necessario para manter codigo legivel e respostas completas. O conteudo, e nao um limite artificial de paginas, deve determinar a paginacao final.

A distribuicao prevista e:

- 6 a 8 paginas iniciais para capa, creditos, prefacio, como usar e sumario;
- aproximadamente 110 a 120 paginas para os 15 capitulos;
- aproximadamente 25 paginas para o gabarito comentado;
- 4 a 6 paginas para glossario, mapa de modulos, matriz de cobertura e indice de funcoes.

## Producao

- O PDF final sera `output/pdf/acompanhamento-o-guia-definitivo.pdf`.
- O PDF sera o unico artefato final solicitado.
- Arquivos intermediarios ficarao em `tmp/pdfs/` e serao removidos ou mantidos organizados apenas durante a producao.
- A geracao usara ferramentas capazes de manter tipografia, codigo, links, diagramas vetoriais, cabecalhos, rodapes e numeracao consistentes.
- A geracao deve ser reproduzivel a partir do snapshot registrado, sem editar os fontes explicados.

## Verificacao e criterios de conclusao

O trabalho so estara concluido quando as evidencias confirmarem todos os itens abaixo:

1. o PDF abre corretamente e todas as fontes necessarias estao incorporadas ou possuem substituicao segura;
2. existem exatamente 15 capitulos, 45 exercicios e 45 respostas comentadas;
3. a matriz de cobertura confirma todos os arquivos obrigatorios;
4. os trechos e explicacoes correspondem ao snapshot local registrado;
5. nao ha paginas inesperadamente vazias, titulos orfaos, blocos cortados, sobreposicoes ou caracteres quebrados;
6. capa, sumario, aberturas de capitulo, codigo, diagramas, exercicios, gabarito e paginas finais foram renderizados e revisados;
7. cabecalhos, rodapes, numeracao, cores e espacamentos sao consistentes;
8. o texto progride do iniciante ao avancado e define termos antes de usa-los;
9. os exercicios podem ser respondidos a partir do conteudo apresentado;
10. o PDF final esta no caminho combinado e nenhuma alteracao funcional foi feita no projeto.
