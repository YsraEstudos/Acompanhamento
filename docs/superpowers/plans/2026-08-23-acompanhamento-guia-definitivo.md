# Acompanhamento: O Guia Definitivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir um PDF editorial completo, em portugues, que explique o estado local atual do Acompanhamento do nivel iniciante ao avancado, com 15 capitulos, 45 exercicios e 45 respostas comentadas.

**Architecture:** Congelar primeiro um snapshot verificavel dos fontes e derivar dele um catalogo de simbolos e uma matriz de cobertura. Construir o livro com ReportLab a partir de modulos de conteudo independentes, componentes editoriais reutilizaveis e diagramas vetoriais; validar o contrato do conteudo antes de gerar, renderizar e inspecionar o PDF final.

**Tech Stack:** Python 3, uv, ReportLab, Pygments, pypdf, pdfplumber, Pillow, pytest, Poppler (`pdfinfo`, `pdftoppm`), TypeScript source inspection.

**Spec:** `docs/superpowers/specs/2026-08-23-acompanhamento-guia-definitivo-design.md`

## Global Constraints

- A fonte autoritativa e o estado local dos arquivos no inicio da execucao, inclusive mudancas nao consolidadas na `main`.
- Nao editar arquivos funcionais de `src/`, `tests/`, configuracoes, scripts, bundles ou releases.
- O livro deve ter exatamente 15 capitulos, 45 exercicios e 45 respostas comentadas.
- O texto deve ser original, em portugues, e apenas adaptar a sobriedade e a progressao editorial da referencia fornecida.
- O PDF final deve ser `output/pdf/acompanhamento-o-guia-definitivo.pdf` e sera o unico artefato final entregue.
- Intermediarios devem ficar sob `tmp/pdfs/acompanhamento_book/`.
- Usar somente hifens ASCII em texto gerado; manter corretamente os acentos da lingua portuguesa.
- Todo trecho de codigo deve vir do snapshot local ou ser identificado explicitamente como exemplo didatico.
- Bundles gerados e copias historicas de release serao explicados como produtos da cadeia, sem reproducao linha a linha.
- Nenhuma conclusao de qualidade, seguranca ou execucao pode exceder as evidencias observadas no snapshot e nos comandos realmente executados.

## File Structure

Arquivos de producao a criar sob `tmp/pdfs/acompanhamento_book/`:

- `pyproject.toml` e `uv.lock`: ambiente Python reproduzivel.
- `book/model.py`: dataclasses de livro, capitulo, secao, bloco de codigo, exercicio e resposta.
- `book/source_snapshot.py`: selecao de fontes, SHA-256, contagem de linhas, extracao de trechos e catalogo de simbolos.
- `book/styles.py`: fontes, cores, tamanhos, margens e estilos ReportLab.
- `book/components.py`: capa, sumario, cabecalhos, rodapes, caixas, blocos de codigo, exercicios e respostas.
- `book/diagrams.py`: diagramas vetoriais de arquitetura, HTTP, parser, renderizacao, bootstrap e UNSPSC.
- `book/content/frontmatter.py`: capa, creditos, prefacio, como usar e mapa inicial.
- `book/content/chapter_01.py` ate `chapter_15.py`: conteudo e tres exercicios de cada capitulo.
- `book/content/answers_01_05.py`, `answers_06_10.py`, `answers_11_15.py`: 45 respostas comentadas.
- `book/content/appendices.py`: glossario, mapa de modulos, matriz de cobertura e indice de funcoes.
- `book/catalog.py`: composicao ordenada de todo o conteudo.
- `book/build.py`: montagem do PDF, sumario, marcadores, numeracao e escrita atomica.
- `book/verify.py`: verificacoes estruturais, textuais e de cobertura do PDF.
- `tests/test_snapshot.py`: contrato do snapshot e dos trechos.
- `tests/conftest.py`: fixtures compartilhadas para raiz do projeto, snapshot, livro parcial, smoke PDF e PDF final.
- `tests/test_content_contract.py`: capitulos, exercicios, respostas e cobertura.
- `tests/test_components.py`: componentes editoriais e diagramas.
- `tests/test_build_smoke.py`: geracao reduzida e reabertura.
- `tests/test_final_pdf.py`: contrato do PDF completo.
- `runtime/source-manifest.json`: manifesto congelado.
- `runtime/source-catalog.json`: simbolos, intervalos e importacoes extraidos.
- `runtime/coverage-matrix.json`: arquivo para capitulo ou apendice.
- `runtime/qa-report.json`: resultados finais de verificacao.
- `rendered/`: PNGs de todas as paginas e folhas de contato para revisao.

---

### Task 1: Congelar o snapshot e o ambiente de autoria

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/pyproject.toml`
- Create: `tmp/pdfs/acompanhamento_book/uv.lock`
- Create: `tmp/pdfs/acompanhamento_book/book/__init__.py`
- Create: `tmp/pdfs/acompanhamento_book/book/source_snapshot.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/conftest.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/test_snapshot.py`
- Create: `tmp/pdfs/acompanhamento_book/runtime/source-manifest.json`
- Create: `tmp/pdfs/acompanhamento_book/runtime/source-catalog.json`

**Interfaces:**
- Consumes: raiz do repositorio e a lista de caminhos obrigatorios da especificacao.
- Produces: `build_snapshot(project_root: Path, output_dir: Path) -> Snapshot`; `Snapshot.snippet(path: str, start: int, end: int) -> str`; manifestos JSON imutaveis durante a edicao.

- [ ] **Step 1: Criar o projeto Python temporario**

Criar `pyproject.toml` com Python `>=3.12` e dependencias `reportlab>=4.4,<5`, `pygments>=2.19,<3`, `pypdf>=6.10,<7`, `pdfplumber>=0.11,<1`, `pillow>=12,<13` e `pytest>=8,<10`. Executar:

```powershell
uv lock --project tmp/pdfs/acompanhamento_book
```

Expected: `uv.lock` criado sem alterar `package.json` ou `package-lock.json`.

- [ ] **Step 2: Escrever primeiro o teste do snapshot**

Criar em `conftest.py` uma fixture `project_root` que sobe a partir do arquivo de teste ate encontrar simultaneamente `package.json`, `src/app.ts` e `.git`, sem depender do diretorio atual. O teste deve exigir que o manifesto inclua todos os `src/*.ts`, todos os `tests/*.ts`, fixtures HTML, cinco arquivos de configuracao JSON/TS, tres scripts de release/build, `build-userscript.bat`, `README.md`, `latest.json` e os metadados do userscript. Tambem deve confirmar SHA-256 hexadecimal de 64 caracteres, tamanho, linhas e rejeicao de caminhos fora da raiz.

```python
def test_snapshot_covers_authored_sources(project_root, tmp_path):
    snapshot = build_snapshot(project_root, tmp_path)
    paths = {entry.path for entry in snapshot.entries}
    assert set(project_root.glob("src/*.ts"))
    assert "src/app.ts" in paths
    assert "tests/fixtures/hist-real-84429.html" in paths
    assert all(len(entry.sha256) == 64 for entry in snapshot.entries)
```

- [ ] **Step 3: Executar o teste e confirmar a falha inicial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_snapshot.py -v
```

Expected: FAIL porque `build_snapshot` ainda nao existe.

- [ ] **Step 4: Implementar snapshot, catalogo e extracao segura**

Selecionar caminhos explicitamente, ordenar por caminho relativo, calcular hash e catalogar imports, exports, interfaces, classes, funcoes e metodos com numero de linha. Nao percorrer `node_modules`, `.git`, caches ou todas as versoes de release. Incluir apenas cabecalhos e manifestos necessarios para explicar a cadeia de artefatos.

- [ ] **Step 5: Gerar os dois JSONs e validar estabilidade**

Executar o snapshot duas vezes e comparar bytes dos JSONs.

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_snapshot.py -v
```

Expected: PASS e JSONs identicos quando os fontes nao mudam.

- [ ] **Step 6: Registrar o ponto de congelamento**

Salvar no manifesto o commit `HEAD`, a branch, a data ISO-8601, a indicacao `workingTreeIncluded: true` e o hash agregado das entradas. A partir daqui, qualquer divergencia de hash deve interromper a geracao em vez de misturar versoes.

### Task 2: Definir o modelo editorial e o contrato de conteudo

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/model.py`
- Create: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/conftest.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`
- Create: `tmp/pdfs/acompanhamento_book/runtime/coverage-matrix.json`

**Interfaces:**
- Consumes: `Snapshot` e catalogo de simbolos da Task 1.
- Produces: `Book`, `Chapter`, `Section`, `CodeBlock`, `Exercise`, `Answer`, `SourceRef`; `validate_book_contract(book, snapshot) -> list[str]`.

- [ ] **Step 1: Escrever testes do modelo e das invariantes globais**

```python
def test_book_contract(book, snapshot):
    assert [chapter.number for chapter in book.chapters] == list(range(1, 16))
    assert sum(len(chapter.exercises) for chapter in book.chapters) == 45
    assert len(book.answers) == 45
    assert {answer.exercise_id for answer in book.answers} == {
        exercise.id for chapter in book.chapters for exercise in chapter.exercises
    }
    assert validate_book_contract(book, snapshot) == []
```

O teste tambem deve exigir IDs `1.1` a `15.3`, niveis `iniciante`, `intermediario`, `avancado`, ao menos um resumo por capitulo e referencias apenas a trechos existentes no snapshot.

- [ ] **Step 2: Executar e confirmar a falha inicial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: FAIL por ausencia dos modelos.

- [ ] **Step 3: Implementar dataclasses imutaveis e validadores**

Os modelos devem diferenciar texto autoral de `CodeBlock(source=SourceRef(...))` e `CodeBlock(example=True)`. O validador deve impedir exercicio sem resposta, fonte fora do manifesto, secao vazia, numeracao duplicada e arquivo obrigatorio sem entrada na matriz de cobertura. Adicionar fixtures `snapshot` e `book` em `conftest.py`; `book` deve aceitar o modo parcial durante a autoria e o modo completo nos testes finais.

- [ ] **Step 4: Criar a matriz inicial de cobertura**

Mapear todos os arquivos obrigatorios aos capitulos definidos na especificacao. `src/parse.ts` deve aparecer nos capitulos 8 e 9; `src/app.ts` no 12; `src/unspsc-quick-fill.ts` no 13; testes e cadeia de release no 15. Apendices devem receber `package-lock.json`, indice de simbolos e detalhes repetitivos que nao pertencem ao fluxo principal.

- [ ] **Step 5: Rodar os testes do contrato**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: PASS para o catalogo vazio permitido apenas no modo de construcao e FAIL deliberado para livros completos com lacunas.

### Task 3: Construir o sistema visual e um PDF de fumaca

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/styles.py`
- Create: `tmp/pdfs/acompanhamento_book/book/components.py`
- Create: `tmp/pdfs/acompanhamento_book/book/diagrams.py`
- Create: `tmp/pdfs/acompanhamento_book/book/build.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/conftest.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/test_components.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/test_build_smoke.py`

**Interfaces:**
- Consumes: modelos da Task 2.
- Produces: `build_pdf(book: Book, output_path: Path, snapshot: Snapshot) -> BuildResult`; flowables para capa, capitulo, secao, codigo, caixas, diagramas, exercicios e respostas.

- [ ] **Step 1: Marcar o inicio da operacao de PDF exatamente uma vez**

Imediatamente antes do primeiro comando que gerar PDF, executar com o Node.js do runtime disponibilizado:

```powershell
node container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format pdf
```

Expected: sucesso. Nao repetir esse comando durante a mesma operacao.

- [ ] **Step 2: Escrever testes dos componentes e do PDF reduzido**

Exigir A4, margens minimas de 18 mm, corpo serifado, titulos sem serifa, codigo monoespacado, vermelho-escuro para secoes, fundo cinza-claro para codigo, cabecalho/rodape e bookmarks. O smoke book deve ter capa, sumario, uma abertura, uma pagina de codigo, tres exercicios e tres respostas. A fixture `smoke_pdf` em `conftest.py` deve gerar esse documento em `tmp_path` por meio da mesma funcao `build_pdf` usada no produto final.

```python
def test_smoke_pdf_reopens(smoke_pdf):
    reader = PdfReader(smoke_pdf)
    assert len(reader.pages) >= 8
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Acompanhamento: O Guia Definitivo" in text
    assert "Exercicio 1.1" in text
    assert "Resposta 1.1" in text
```

- [ ] **Step 3: Implementar fontes, paleta e componentes**

Usar fontes Unicode instaladas com licenca de redistribuicao ou as familias DejaVu/Liberation disponiveis no sistema. Definir corpo entre 9,5 e 10,5 pt, codigo nunca menor que 7,4 pt, entrelinha confortavel, vermelho-escuro consistente e estilos que mantenham titulo junto ao primeiro paragrafo.

- [ ] **Step 4: Implementar diagramas vetoriais**

Criar funcoes para seis diagramas: arquitetura geral, requisicao HTTP com fallback, pipeline do parser, renderizacao incremental, bootstrap e maquina de estados UNSPSC. Usar formas e texto vetoriais; nao rasterizar codigo ou diagramas.

- [ ] **Step 5: Gerar e verificar o smoke PDF**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_components.py tmp/pdfs/acompanhamento_book/tests/test_build_smoke.py -v
```

Expected: PASS. Renderizar o smoke PDF com `pdftoppm`, inspecionar capa, codigo, exercicios e respostas e corrigir qualquer corte antes de continuar.

### Task 4: Escrever front matter e capitulos 1 a 3

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/__init__.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/frontmatter.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_01.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_02.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_03.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: modelos, snapshot, blocos de codigo e diagrama de arquitetura.
- Produces: capa aprovada, prefacio, como usar, capitulos 1-3 e exercicios `1.1`-`3.3`.

- [ ] **Step 1: Adicionar testes de cobertura dos capitulos 1 a 3**

Exigir os titulos aprovados, referencias a `README.md`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/main.ts` e o mapa dos 13 modulos de `src`. Exigir definicao previa de userscript, DOM, TypeScript, modulo, evento, Promise e async/await.

- [ ] **Step 2: Redigir front matter**

Incluir capa, autor Ysrael Xavier, nota de escopo do snapshot local, prefacio, como usar o livro, convencoes de codigo e sumario. Nao atribuir a Ysrael textos ou credenciais que nao estejam no pedido; identificar o livro como documentacao tecnica do projeto.

- [ ] **Step 3: Redigir o Capitulo 1**

Explicar o problema, a experiencia do usuario, as duas capacidades principais - timeline e UNSPSC - e o fluxo `main -> app -> url/http/parse/ui`. Exercicios: `1.1` reconstruir o fluxo de dados; `1.2` rastrear a abertura de um item; `1.3` propor o limite de um novo recurso sem acoplar parser e UI.

- [ ] **Step 4: Redigir o Capitulo 2**

Ensinar apenas JavaScript/TypeScript usado pelo projeto: `const`/`let`, tipos, interfaces, unions, null narrowing, funcoes, classes, DOM, eventos, Promises, async/await, AbortController e imports. Exercicios: `2.1` interpretar uma interface; `2.2` criar e testar um normalizador tipado; `2.3` analisar cancelamento em um fluxo assincrono.

- [ ] **Step 5: Redigir o Capitulo 3**

Explicar scripts npm, strict TypeScript, bundler resolution, jsdom, Vite, Vitest, metadata Tampermonkey, `@match`, `@grant`, `@connect`, `updateURL` e `downloadURL`. Exercicios: `3.1` ordenar o pipeline de validacao; `3.2` planejar uma mudanca segura de metadata; `3.3` desenhar um gate de integridade de release.

- [ ] **Step 6: Validar conteudo parcial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: capitulos 1-3 passam seus contratos; o modo parcial informa claramente que 4-15 ainda nao foram carregados.

### Task 5: Escrever capitulos 4 a 6

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_04.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_05.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_06.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: snapshot e conceitos dos capitulos 1-3.
- Produces: capitulos 4-6 e exercicios `4.1`-`6.3`.

- [ ] **Step 1: Adicionar contratos de fontes e simbolos**

Exigir cobertura de todas as funcoes de `src/text.ts`, todas as chaves e migracoes de `src/state.ts`, as rotas de `src/runtime-guard.ts`, interfaces e funcoes exportadas de `src/url.ts` e todas as funcoes exportadas de `src/history-identity.ts`.

- [ ] **Step 2: Redigir o Capitulo 4**

Explicar normalizacao de espacos/acentos, defaults seguros, migracao v1-v2, eventos de sincronizacao e guardas de rota/contexto. Exercicios: `4.1` prever normalizacoes; `4.2` escrever um teste de migracao; `4.3` reduzir falsos positivos do bootstrap sem bloquear paginas validas.

- [ ] **Step 3: Redigir o Capitulo 5**

Percorrer pontuacao de elementos, visibilidade, escolha do root/resumo atual, extracao de JavaScript em href, absolutizacao, token `k`, `resolvePageContext`, `resolveQuickPageContext` e instabilidade por divergencia. Exercicios: `5.1` rastrear uma URL; `5.2` criar fixture para o scorer; `5.3` resolver DOM com copias obsoletas e hostis.

- [ ] **Step 4: Redigir o Capitulo 6**

Explicar `HistoryIdentity`, parametros case-insensitive, fingerprint, mascaramento de token, extracao por URL/documento, formatacao diagnostica e politica de validacao. Exercicios: `6.1` comparar fingerprints; `6.2` testar redacao de segredo; `6.3` formular uma politica de confianca para redirect e identidade.

- [ ] **Step 5: Rodar o contrato parcial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: capitulos 1-6 e 18 exercicios validos.

### Task 6: Escrever capitulos 7 a 9

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_07.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_08.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_09.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: snapshot, contextos e identidade dos capitulos anteriores.
- Produces: capitulos 7-9 e exercicios `7.1`-`9.3`.

- [ ] **Step 1: Adicionar contratos de HTTP e parser**

Exigir cobertura de `decodeHttpText`, `detectKlassmattErrorPage`, transporte nativo, fallback `GM_xmlhttpRequest`, abortos, content type e origem final. Para o parser, exigir tipos exportados, marcadores, scoping, notas amarelas, consolidacao, parse estrito, parse flexivel e fixtures reais.

- [ ] **Step 2: Redigir o Capitulo 7**

Explicar deteccao de charset em header/meta, pontuacao de decodificacao, windows-1252, HTML esperado, erros Klassmatt, redirect, mesma origem, fallback Tampermonkey e AbortSignal. Exercicios: `7.1` diagnosticar mojibake; `7.2` testar aborto durante fallback; `7.3` analisar ataques por redirect e resposta final.

- [ ] **Step 3: Redigir o Capitulo 8**

Explicar modelos de evento, construcao estrita/flexivel, descricao multilinha, deteccao de etapa/atencao, notas amarelas, consolidacao e resumo. Usar fixtures sem reproduzir dados sensiveis alem do necessario. Exercicios: `8.1` comparar parsers; `8.2` criar fixture de nota amarela; `8.3` fortalecer resiliencia sem inventar eventos.

- [ ] **Step 4: Redigir o Capitulo 9**

Explicar allowlists NCM/NBS, normalizacao de digitos, contexto de referencias legais, marcadores de item, passe linear, empates e `scopeTimelineToItem`. Exercicios: `9.1` classificar candidatos fiscais; `9.2` calcular o recorte de marcadores; `9.3` discutir recall versus falsos positivos.

- [ ] **Step 5: Rodar o contrato parcial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: capitulos 1-9 e 27 exercicios validos.

### Task 7: Escrever capitulos 10 a 12

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_10.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_11.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_12.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: eventos parseados e referencias de fonte.
- Produces: capitulos 10-12 e exercicios `10.1`-`12.3`.

- [ ] **Step 1: Adicionar contratos de sanitizacao, UI e app**

Exigir todas as funcoes exportadas de `src/html.ts` e `src/ui.ts`, os tipos publicos de `src/app.ts`, metodos publicos da classe e grupos de metodos privados: hydrate/fetch, renderizacao, shell, contexto, cache, preferencias, observadores e erros.

- [ ] **Step 2: Redigir o Capitulo 10**

Explicar allowlists de tags, conversao de URL em link, bloqueio de protocolos, clonagem recursiva, diferenca entre inline e snapshot, iframe sandbox e vetores ativos. Exercicios: `10.1` decidir o destino de links; `10.2` criar teste com HTML malicioso; `10.3` produzir um mini threat model do snapshot.

- [ ] **Step 3: Redigir o Capitulo 11**

Explicar `ShellRefs`, `TimelineViewModel`, CSS injetado, construcao de eventos, renderizacao inicial/incremental, metadados, botoes, fallback e carregamento sob demanda. Exercicios: `11.1` mapear evento para DOM; `11.2` dimensionar lotes de timeline; `11.3` melhorar acessibilidade preservando o contrato.

- [ ] **Step 4: Redigir o Capitulo 12**

Dividir `SinSidebarApp` por responsabilidades: ciclo de vida, `hydrate`, contexto confiavel, requisicao, parser estrito, filtro por item, cache limitado, abortos/serial, render em lotes, observadores ASP.NET/DOM, overrides locais e sincronizacao entre abas. Exercicios: `12.1` desenhar a sequencia de hydrate; `12.2` testar cache e mutacao; `12.3` analisar uma corrida entre troca de item e resposta HTTP.

- [ ] **Step 5: Rodar o contrato parcial**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: capitulos 1-12 e 36 exercicios validos.

### Task 8: Escrever capitulos 13 a 15

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_13.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_14.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/chapter_15.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: todos os conceitos e modulos anteriores.
- Produces: capitulos 13-15 e exercicios `13.1`-`15.3`.

- [ ] **Step 1: Adicionar contratos de UNSPSC, bootstrap, testes e release**

Exigir cobertura dos seletores, tipos, persistencia e todos os metodos de `UnspscQuickFillApp`; funcoes de bootstrap/menu/observer em `src/main.ts`; todos os 14 arquivos de teste/configuracao listados no snapshot; fixtures; `postbuild.mjs`, `release-artifacts.mjs`, declaracao de tipos, batch, metadata e manifestos.

- [ ] **Step 2: Redigir o Capitulo 13**

Explicar descoberta do campo nativo, normalizacao exata de oito digitos, injecao unica, maquina de estados persistida, abertura/pesquisa/selecao/fechamento do modal, postback, retomada, timeouts, cancelamento e observador estabilizado. Exercicios: `13.1` reconstruir a maquina de estados; `13.2` testar ausencia de resultado exato; `13.3` tornar um cenario de postback robusto sem clicar em salvar.

- [ ] **Step 3: Redigir o Capitulo 14**

Explicar ordem de startup, guardas, menus Tampermonkey, eventos de storage, observer temporario, bootstrap tardio, convivencia entre sidebar e UNSPSC e limpeza. Exercicios: `14.1` ordenar o bootstrap; `14.2` testar contexto que aparece depois; `14.3` analisar sincronizacao multiaba e override local.

- [ ] **Step 4: Redigir o Capitulo 15**

Explicar jsdom/setup/fixtures, piramide de testes real, contratos de seguranca e regressao, typecheck, build, postbuild, SHA-256, `latest.json`, metadata, artefato versionado, validacao de release, batch e limites do que nao foi verificado ao vivo. Exercicios: `15.1` classificar testes por responsabilidade; `15.2` diagnosticar manifest divergente; `15.3` desenhar um release gate completo e proporcional.

- [ ] **Step 5: Rodar o contrato completo sem respostas**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: 15 capitulos e 45 exercicios; somente o requisito de respostas permanece pendente no modo editorial.

### Task 9: Escrever as 45 respostas comentadas

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/answers_01_05.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/answers_06_10.py`
- Create: `tmp/pdfs/acompanhamento_book/book/content/answers_11_15.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: exercicios `1.1`-`15.3` e snapshot.
- Produces: uma `Answer` unica e ordenada para cada exercicio.

- [ ] **Step 1: Fortalecer o teste de pareamento**

Exigir correspondencia bijetiva entre exercicios e respostas, ordem numerica, ao menos dois paragrafos explicativos por resposta avancada e bloco de codigo ou estrategia de teste sempre que o enunciado pedir implementacao.

- [ ] **Step 2: Redigir respostas 1.1 a 5.3**

Responder com raciocinio, fluxo esperado e criterios de verificacao. Exemplos de codigo devem usar nomes existentes ou ser marcados como didaticos.

- [ ] **Step 3: Redigir respostas 6.1 a 10.3**

Dar enfase a identidade, redacao de token, transporte, parsing, allowlists, isolamento por item e sanitizacao. Incluir por que alternativas inseguras falham.

- [ ] **Step 4: Redigir respostas 11.1 a 15.3**

Cobrir DOM, batching, acessibilidade, corridas, maquina UNSPSC, bootstrap, testes e release. Diferenciar resultado deterministico de recomendacao arquitetural.

- [ ] **Step 5: Executar o contrato editorial completo**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: PASS com 15 capitulos, 45 exercicios, 45 respostas e cobertura integral.

### Task 10: Criar apendices, glossario e indices

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/book/content/appendices.py`
- Modify: `tmp/pdfs/acompanhamento_book/book/catalog.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/test_content_contract.py`

**Interfaces:**
- Consumes: source catalog, coverage matrix e indice dos capitulos.
- Produces: glossario, mapa de modulos, matriz de cobertura legivel e indice de funcoes/arquivos.

- [ ] **Step 1: Adicionar testes dos apendices**

Exigir definicoes para userscript, DOM, AST conceitual, parser, sanitizacao, iframe sandbox, fingerprint, AbortSignal, MutationObserver, postback, cache e checksum. Exigir uma linha de cobertura para cada entrada obrigatoria e uma entrada de indice para cada export publico.

- [ ] **Step 2: Gerar o mapa de modulos a partir do catalogo**

Mostrar importacoes principais e responsabilidades sem converter o grafo em uma tabela ilegivel. Destacar `main.ts` como entrada, `app.ts` como orquestrador e os modulos puros em volta.

- [ ] **Step 3: Gerar matriz e indice**

Ordenar matriz por caminho e indice por simbolo. Indicar capitulo/secoes, nao numeros de pagina estaticos; os numeros finais serao resolvidos pelo construtor apos a paginacao.

- [ ] **Step 4: Rodar o contrato completo**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_content_contract.py -v
```

Expected: PASS sem arquivo obrigatorio ou export publico ausente.

### Task 11: Montar e verificar o PDF integral

**Files:**
- Modify: `tmp/pdfs/acompanhamento_book/book/build.py`
- Create: `tmp/pdfs/acompanhamento_book/book/verify.py`
- Modify: `tmp/pdfs/acompanhamento_book/tests/conftest.py`
- Create: `tmp/pdfs/acompanhamento_book/tests/test_final_pdf.py`
- Create: `tmp/pdfs/acompanhamento_book/runtime/qa-report.json`
- Create: `output/pdf/acompanhamento-o-guia-definitivo.pdf`

**Interfaces:**
- Consumes: `Book` completo, snapshot e componentes.
- Produces: PDF final atomico e relatorio de QA.

- [ ] **Step 1: Escrever o teste final antes da geracao**

Adicionar a fixture `final_pdf` em `conftest.py` apontando para o caminho absoluto derivado de `project_root`. O teste deve abrir o PDF com pypdf/pdfplumber, exigir A4, faixa editorial de 140 a 190 paginas, 15 aberturas de capitulo, bookmarks, 45 marcadores `Exercicio N.N`, 45 `Resposta N.N`, sumario, glossario, matriz e indice. Tambem deve rejeitar U+FFFD, paginas internas sem texto/diagrama e referencias a caminhos inexistentes.

```python
def test_final_pdf_contract(final_pdf):
    reader = PdfReader(final_pdf)
    assert 140 <= len(reader.pages) <= 190
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert sum(text.count(f"Exercicio {c}.{e}") for c in range(1, 16) for e in range(1, 4)) == 45
    assert sum(text.count(f"Resposta {c}.{e}") for c in range(1, 16) for e in range(1, 4)) == 45
    assert "\ufffd" not in text
```

- [ ] **Step 2: Executar e confirmar a falha por ausencia do PDF**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests/test_final_pdf.py -v
```

Expected: FAIL porque o PDF final ainda nao existe.

- [ ] **Step 3: Gerar com escrita atomica**

Construir primeiro `tmp/pdfs/acompanhamento_book/runtime/acompanhamento.tmp.pdf`, reabrir, e somente entao substituir o caminho final. Se os hashes do snapshot tiverem mudado, abortar e informar os caminhos divergentes.

- [ ] **Step 4: Executar toda a suite de autoria**

```powershell
uv run --project tmp/pdfs/acompanhamento_book python -m pytest tmp/pdfs/acompanhamento_book/tests -v
```

Expected: PASS em snapshot, contrato, componentes, smoke e PDF final.

- [ ] **Step 5: Executar verificacoes nativas de PDF**

```powershell
pdfinfo output/pdf/acompanhamento-o-guia-definitivo.pdf
```

Expected: PDF valido, A4, numero de paginas dentro da faixa e metadados de titulo/autor corretos.

### Task 12: Renderizar todas as paginas e concluir a auditoria visual

**Files:**
- Create: `tmp/pdfs/acompanhamento_book/rendered/page-*.png`
- Create: `tmp/pdfs/acompanhamento_book/rendered/contact-sheet-*.png`
- Modify: `tmp/pdfs/acompanhamento_book/runtime/qa-report.json`
- Modify: `output/pdf/acompanhamento-o-guia-definitivo.pdf` somente se a revisao encontrar defeito.

**Interfaces:**
- Consumes: PDF integral da Task 11.
- Produces: evidencia visual de todas as paginas e PDF final aprovado.

- [ ] **Step 1: Renderizar todas as paginas**

```powershell
pdftoppm -png -r 110 output/pdf/acompanhamento-o-guia-definitivo.pdf tmp/pdfs/acompanhamento_book/rendered/page
```

Expected: um PNG por pagina, sem erro do Poppler.

- [ ] **Step 2: Criar folhas de contato completas**

Usar Pillow para montar grupos de 16 paginas, com numero legivel sob cada miniatura. O teste deve confirmar que a soma de miniaturas coincide com o numero informado por pypdf.

- [ ] **Step 3: Inspecionar visualmente toda a obra**

Revisar todas as folhas de contato e abrir em resolucao original: capa, sumario, primeira e ultima pagina de cada capitulo, paginas de codigo denso, seis diagramas, todos os blocos de exercicios, transicoes do gabarito, matriz e indice. Registrar no QA cada pagina revisada e cada correcao.

- [ ] **Step 4: Corrigir e repetir a renderizacao quando necessario**

Qualquer texto cortado, titulo orfao, bloco dividido de forma ilegivel, sobreposicao, caractere quebrado, pagina inesperadamente vazia ou contraste insuficiente exige regeneracao, nova execucao dos testes e nova renderizacao das paginas afetadas e das folhas de contato.

- [ ] **Step 5: Executar a auditoria final requisito por requisito**

Confirmar no estado atual: fonte local congelada; 15 capitulos; 45 exercicios; 45 respostas; todos os caminhos da matriz; progressao iniciante-avancado; cabecalhos/rodapes; metadados; paginas sem defeitos; arquivo final no caminho combinado; nenhum arquivo funcional do Acompanhamento alterado pela producao.

- [ ] **Step 6: Verificar o escopo Git antes da entrega**

```powershell
git status --short
git diff -- src tests package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts scripts
```

Expected: o segundo comando nao mostra alteracao causada pela autoria; mudancas preexistentes permanecem intocadas.
