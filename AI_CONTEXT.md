# AI Context: KM Acompanhamento

## 1. Project identity

- Workspace root: `C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\Acompanhamento`
- Deliverable: standalone Tampermonkey userscript built with Vite and published through a private GitHub repo + GitHub Pages
- Runtime target: Klassmatt item pages on `https://*.klassmatt.com.br/*`
- Current release version: `1.0.10`
- Current output file: `dist/sin-inline.user.js`
- Public install URL: `https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js`
- Canonical GitHub remote: `https://github.com/YsraEstudos/km-sin-sidebar-userscript`
- Convenience build script: `build-userscript.bat`

This project is a focused extraction of one capability from a larger userscript ecosystem: showing the SIN acompanhamento inline on the item page, without opening the Klassmatt popup.

The current product decision is important:

- On a clean install, the script starts with `alwaysOpen=true` and `timelineMode='yellow-only'`.
- The Tampermonkey menu is the only persistent control for the global `alwaysOpen` preference.
- There is an inline item-level `Mostrar painel` / `Ocultar painel` toggle near the native link.
- When `alwaysOpen` is enabled, the panel auto-opens across supported item pages.
- When `alwaysOpen` is disabled, the panel stays closed by default until the user opens it locally for the current item.
- The inline toggle never persists its state; on item/context changes the behavior returns to `alwaysOpen`.
- Once opened, the panel shows the chosen timeline mode, either only yellow notes or the full acompanhamento.
- Events whose visible content is only a yellow note are still preserved and rendered.
- When a SIN history mixes multiple items, the parser now scopes the timeline to the current `IdItem` when it can confirm that item from explicit item markers in the history.
- Se o historico realmente estiver vazio (nenhum evento), exibe um empty state.
- During internal ASP.NET item switches, the panel must never reuse comments from the previous item.
- The active item root is now chosen by combining the current `IdItem`/`IdSIN` hints, the visible `#txtNumero`, and summary/link consistency, so a stale `#hlkObs` from a previous item loses to the live root.
- The runtime now watches DOM mutations plus `popstate`/`hashchange`, which lets it clear or refresh stale state even when Klassmatt swaps the item without a clean `endRequest`.
- Fetch of the history bypasses HTTP caching (`no-store`) to prevent stale UI state across items.
- The script must wait for a stable SIN context before fetching `Historico.aspx`.
- The raw popup remains available through the native site link, while the panel's `Ver inline` fallback now renders a sandboxed sanitized snapshot in read-only mode.
- On Chrome, Tampermonkey may require `Allow User Scripts` in the extension details page. If the userscript still does not inject after enabling it, restart Chrome completely and confirm that the installed script version is `1.0.10`.

## 2. Why this project exists

The Klassmatt item page exposes SIN history through a popup link such as:

```html
<a id="hButAcompanhamentoSIN" class="k-link" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&SomenteLeitura=1&Id=245373', 680, 500, 1);}">Acompanhamento da SIN</a>
```

or:

```html
<a id="hlkObs" class="txt-hyperlink" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1', 680, 500, 1)}">Acompanhamento</a>
```

The goal of this script is to fetch that same `Historico.aspx` content directly and render it inline in a persistent side panel next to the item content.

The user originally wanted yellow comments to be exclusively visible, but the current product supports both `Tudo` and `Amarelos`.
Another follow-up requirement added a red alert treatment for entries mentioning `ncm`, `nbs`, `lei`, or matching codes.

A further improvement round added resilience against Klassmatt session errors: the script now detects error pages (`Erro.aspx`), silent HTTP redirects, blocks cross-origin redirects, and recognizes expired session tokens (`k` parameter), showing actionable messages instead of cryptic parse failures. The current runtime intentionally favors low overhead: recovery paths are manual (`F5`, reopening the panel, `Ver inline`) instead of automatic retry/backoff or background token rescue. Cache controls ensure ghost comments do not bleed between requests.

## 3. External source of truth used to build this

This project reuses behavior and understanding from:

- Reference project root:
  `C:\Users\israe\OneDrive\Documentos\Projetos\Trabalho\FISCAL WEB\FISCAL 5.0`

Key reference files:

- `src/reporting/coletor-acompanhamento.ts`
  Purpose: locate the SIN acompanhamento link, derive `Historico.aspx`, fetch it, parse it.
- `src/reporting/parsers/historico-parser.ts`
  Purpose: parse strict Klassmatt history HTML and fallback loose fieldset HTML.
- `src/core/aspnet-lifecycle.ts`
  Purpose: hook ASP.NET WebForms `PageRequestManager` endRequest.
- `fixtures/manual/no item em classificacoes.html`
  Purpose: real saved item page showing `#DV_Resumo_sin`, `#hlkObs`, and page layout.
- `fixtures/manual/Acompanhamento suspenso.html`
  Purpose: real saved history popup showing `fieldset.hist-fieldset`, `legend.hist-legend`, `#lblDescricao`, and yellow comments embedded as spans with yellow background.

This standalone project intentionally does not import code from `FISCAL 5.0` directly. It reimplements only the parts needed here, in shorter and simpler modules.

## 4. How the Klassmatt site behaves

### 4.1 Platform model

Klassmatt here behaves like an ASP.NET WebForms application.

Practical consequences:

- The page can update partially without full reload.
- `Sys.WebForms.PageRequestManager.getInstance().add_endRequest(...)` is the right lifecycle hook after server-side partial updates.
- DOM nodes can be replaced under the same URL, so the visible page content is often more trustworthy than `window.location` alone.

### 4.2 Item page layout

The working item screen commonly contains:

- `#UpdatePanel1`
- `.kl-view`
- `#DV_Resumo_sin`
- `#Label_infoSIN`
- `#hlkObs` or `#hButAcompanhamentoSIN`

Relevant structure observed in saved Klassmatt HTML:

- `#UpdatePanel1 .kl-view` is the best mount root for a two-column layout.
- `#DV_Resumo_sin` is the SIN summary block near the acompanhamento link.
- `#Label_infoSIN` contains visible SIN metadata and can be used as fallback for the SIN number.
- `#txtNumero` is the Klassmatt item ID, not the SIN number, and must not be used to build `Historico.aspx`.
- When multiple `.kl-view` blocks remain in the DOM during a partial update, prefer the visible root whose `#txtNumero` matches the current `IdItem` and whose summary data matches `IdSIN`.

### 4.3 Acompanhamento link behavior

The acompanhamento popup is usually triggered by a `javascript:` href calling one of:

- `OpenWindowsWHR(...)`
- `OpenWindowsWHRNS(...)`
- `OpenNewTab(...)`

The first argument is the useful part. It points to `Historico.aspx?...`.

### 4.4 Historico.aspx HTML shape

Strict structure:

- `fieldset.hist-fieldset`
- `legend.hist-legend`
- user rows containing `a#hlinkUsuario`
- result rows `.row.result`
- hour in `span#lblHora`
- description in `span#lblDescricao`

Yellow comments appear inside `#lblDescricao` as nested inline elements with `background-color: yellow`, for example:

```html
<span id="lblDescricao">
  Solicitação enviada para REAVALIACAO-APROV
  <br>
  <span style="color: black; background-color: yellow;">
    <strong>PREZADO, PARA CORRETA CLASSIFICAÇÃO...</strong>
  </span>
</span>
```

Real-world note from the live `ITEM_Edita.aspx` page for item `300878`:

- The visible item summary block is `#DV_Resumo_sin`.
- The SIN metadata lives in `#Label_infoSIN`.
- The acompanhamento link is `#hlkObs` with a `javascript:{OpenWindowsWHR('Historico.aspx?...')}` href.
- The live item page may omit the `k` token in the popup link, but any `k` present in the extracted history URL must be preserved.

Loose fallback structure:

- plain `fieldset`
- `legend`
- free text lines
- lines of form `HH:MM - texto...`

## 5. Current product behavior

### 5.1 UI behavior

When the panel is opened, the script reshapes `#UpdatePanel1 .kl-view` into:

- left column: original Klassmatt content
- right column: sticky SIN sidebar

On narrower layouts, CSS collapses to a single column so the panel stacks below rather than overlapping the page.

The native Klassmatt link remains untouched.

### 5.2 Panel behavior

The panel:

- starts open on a clean install because `alwaysOpen` defaults to true
- starts in `Amarelos` on a clean install because `timelineMode` defaults to `yellow-only`
- injects an item-level show/hide toggle near the native link
- keeps the Tampermonkey menu responsible for `Ativar acompanhamento sempre visivel` / `Desativar acompanhamento sempre visivel`
- keeps the Tampermonkey menu synchronized with the same global state
- resolves the `Historico.aspx` URL only when the user opens the panel and the SIN context is stable
- fetches and parses the popup HTML on demand
- renders the parsed timeline grouped by day, without filtering out normal events
- exposes a persistent `Tudo` / `Amarelos` mode button for the history view
- highlights matching entries in red when they mention `ncm`, `nbs`, `lei`, or NCM/NBS-like codes
- extracts yellow-note text from the main event description into a distinct yellow note card
- includes a `Ver inline` button that renders a sandboxed sanitized snapshot of the fetched HTML (as a safety net)
- renders long timelines in fixed batches with `Carregar mais`

During ASP.NET partial updates:

- if the panel is closed, the app only re-injects the lightweight toggle when necessary
- local inline open/close overrides are cleared when the item/context changes
- if the panel is open, the app treats the page as unstable if the SIN link/summary are missing or inconsistent
- the panel clears previous comments instead of keeping stale results on screen
- fetches from the previous item are aborted and ignored if they resolve late
- confirmTrustedContext uses a single short revalidation instead of progressive retries
- the current context key now includes `itemId`, `summarySinId`, and the history identity, which means switching to a different item clears local open/close overrides
- a `MutationObserver` now retriggers hydration when Klassmatt swaps the item DOM in place, even if the page does not emit a clean `endRequest`

If the timeline is empty (0 events):

- the panel stays active
- it shows an empty state warning

If fetch or parsing fails:

- the panel falls back to a sandboxed sanitized snapshot when possible

If session has expired or access is denied:

- fetch detects Klassmatt error pages (`Erro.aspx`, `d-error` div) in the response body
- fetch detects silent HTTP redirects to login or error pages
- fetch blocks redirected responses that try to land on another origin
- if the session is fully disconnected, the panel gracefully degrades to `mode: 'session-error'` with actionable messages (`Recarregue a pagina (F5)` / reopen the panel)
- stale cache entries for the same item but different `k` tokens are purged

If fetch encounters transient errors (network, 5xx, timeout):

- no automatic retry is attempted; the user can reopen the panel or recarregar a pagina when quiser

### 5.3 Persistence

User preference is stored in localStorage:

- key: `km_sin_sidebar_settings_v1`
- shape:

```json
{ "alwaysOpen": true, "timelineMode": "yellow-only" }
```

- `alwaysOpen` is the global always-visible mode controlled only by the Tampermonkey menu.
- `timelineMode` remains independent and only controls whether the timeline shows `Tudo` or only `Amarelos`.

## 6. Source layout and file responsibilities

### Root files

- `package.json`
  Build/test scripts and dev dependencies
- `vite.config.ts`
  Vite + `vite-plugin-monkey` userscript config
- `vitest.config.ts`
  Test runner config with jsdom URL set to a Klassmatt-like origin
- `build-userscript.bat`
  Windows helper that installs deps deterministically with `npm ci` if needed, builds, validates `dist/sin-inline.user.js` and `dist/sin-inline.meta.js`, and copies the built userscript to clipboard

### Runtime source files

- `src/main.ts`
  Entry point. Instantiates `SinSidebarApp`, starts on DOM ready, destroys on `beforeunload`.

- `src/app.ts`
  Main orchestration layer.
  Responsibilities:
  - lightweight toggle injection
  - on-demand page hydration
  - ASP.NET endRequest integration
  - fetch lifecycle
  - caching
  - panel open/close state driven by the persistent global `alwaysOpen` preference
  - context-stability protection against stale item data
  - batched timeline rendering with yellow-note and attention-state summaries

  Important behavior:
  - The inline button only toggles the current item view, so it changes between `Mostrar painel` and `Ocultar painel`.
  - The Tampermonkey menu is the only place that changes the persistent `alwaysOpen` setting.
  - When `alwaysOpen` is enabled, the panel opens automatically on supported pages unless the user locally hides it for the current item.
  - When `alwaysOpen` is disabled, the panel stays closed by default unless the user locally opens it for the current item.
  - `renderResult()` applies the persistent `Tudo` / `Amarelos` mode before calling `renderTimeline()`.
  - `abortActiveFetch()` and the cache-key logic prevent old item fetches from overwriting the current item.
  - Large timelines are rendered in fixed batches with `Carregar mais`.
  - If future behavior should filter or regroup the history, this file is the primary place to change.

- `src/url.ts`
  Site integration helpers.
  Responsibilities:
  - detect `#hButAcompanhamentoSIN` / `#hlkObs`
  - extract URL from `OpenWindowsWHR(...)`
  - resolve `itemId` separately from `sinId`
  - score the active item root using `IdItem`, `IdSIN`, `#txtNumero`, and visible summary/link consistency so stale copies lose to the live item
  - resolve SIN ID from the acompanhamento link or `#Label_infoSIN`
  - detect whether the page context is stable enough to fetch
  - return `SinPageContext`

  Important precedence:
  - first use explicit popup URL from the anchor
  - then prefer visible page SIN data
  - only use current URL parameters as an unstable fallback for detection, not for fetching

  This precedence matters because ASP.NET partial updates can swap the visible item without changing the browser URL.

- `src/http.ts`
  HTTP, decoding, and error detection logic.
  Responsibilities:
  - fetch with `credentials: include`
  - decode HTML safely using charset detection
  - handle `windows-1252`, `iso-8859-1`, and utf-8
  - detect Klassmatt error pages (`detectKlassmattErrorPage`)
  - detect silent HTTP redirects (`wasRedirected`, `responseUrl`)
  - block redirected responses that land on another origin
  - validate response content-type

- `src/parse.ts`
  History parser.
  Responsibilities:
  - strict parser for real Klassmatt history DOM
  - loose parser fallback for less structured HTML
  - stage detection
  - extraction of yellow comments from `#lblDescricao`
  - attention-highlight detection for `ncm`, `nbs`, `lei`, and code-like matches

  Important parser detail:
  - yellow comments are removed from the cloned text before stage detection and before `descricaoHtml` is persisted, so the stage string and rendered description do not get polluted by the yellow note text.

- `src/ui.ts`
  DOM rendering and CSS injection.
  Responsibilities:
  - inject styles
  - create or reuse the two-column shell
  - render grouped timeline
  - render note cards for yellow comments
  - render red attention styling for flagged entries
  - render empty state
  - render the sandboxed secure snapshot fallback

- `src/html.ts`
  Safe HTML helpers.
  Responsibilities:
  - `escapeHtml`
  - limited sanitization for inline history HTML
  - only same-origin `https` anchors remain clickable in the main panel
  - snapshot sanitization strips scripts, forms, images, and other active content before inline fallback rendering

- `src/text.ts`
  Normalization helpers used across modules.

- `src/state.ts`
  Toggle settings persistence, storing the persistent `alwaysOpen` preference and the `Tudo` / `Amarelos` history mode.

## 7. Current data model

### Runtime context

```ts
interface SinPageContext {
  itemId: string | null;
  historyUrl: string | null;
  sinId: string | null;
  isStable: boolean;
  viewRoot: HTMLElement | null;
  summaryEl: HTMLElement | null;
  linkEl: HTMLAnchorElement | null;
}
```

### Parsed event

```ts
interface TimelineEvent {
  dia: string;
  hora: string;
  usuario: string | null;
  descricao: string;
  descricaoHtml: string;
  stage: string | null;
  yellowComments: string[];
  hasAttentionHighlight: boolean;
  attentionMatches: string[];
}
```

### Rendered fetch result

```ts
interface SinHistoryResult {
  mode: 'parsed' | 'iframe' | 'error' | 'empty' | 'blocked' | 'session-error';
  timeline: TimelineEvent[];
  diagnostic?: string;
  actionHint?: string;
  summary?: {
    totalEventos: number;
    totalTransicoes: number;
  };
}
```

## 8. Build and test workflow

Commands:

- Install deps:
  `npm ci`
- Run tests:
  `npm test`
- Build:
  `npm run build`
- Windows helper:
  `build-userscript.bat`

Expected built artifact:

- `dist/sin-inline.user.js`

### 8.1 Release and distribution

The project now uses a private GitHub repo plus GitHub Pages as the distribution channel.
The canonical remote is `https://github.com/YsraEstudos/km-sin-sidebar-userscript` and GitHub redirected from the older lowercase URL.
GitHub Pages serves the root copies of `sin-inline.user.js`, `sin-inline.meta.js`, `latest.json`, and `releases/<version>/...`; `dist/` remains the local build mirror.

- Source repo: `https://github.com/YsraEstudos/km-sin-sidebar-userscript`
- Public install URL: `https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js`

Release flow:

1. Update the code and verify locally.
2. Bump the userscript `@version` in `vite.config.ts`.
3. Run `npm run build`.
4. Publish the generated GitHub Pages bundle:
   - `sin-inline.user.js`
   - `sin-inline.meta.js`
   - `latest.json`
   - `releases/<version>/sin-inline.user.js`
   - `releases/<version>/SHA256SUMS.txt`
   - `dist/sin-inline.user.js`
   - `dist/sin-inline.meta.js`
   - `dist/latest.json`
   - `dist/releases/<version>/sin-inline.user.js`
   - `dist/releases/<version>/SHA256SUMS.txt`
5. Tampermonkey checks `sin-inline.meta.js` and downloads the immutable versioned artifact from `releases/<version>/`.

## 9. Test suite overview

Tests live in:

- `tests/url.test.ts`
- `tests/parse.test.ts`
- `tests/http.test.ts`
- `tests/state.test.ts`
- `tests/app.test.ts`

Fixtures live in:

- `tests/fixtures/item.html`
- `tests/fixtures/hist-strict.html`
- `tests/fixtures/hist-loose.html`
- `tests/fixtures/hist-real-84429.html`
- `tests/fixtures/error-page.html`

What is covered:

- popup URL extraction from `OpenWindowsWHR(...)`
- page context resolution from real-like item DOM
- not using `#txtNumero` as SIN fallback
- unstable-context detection when link/summary are missing or inconsistent
- preferring the visible current item root when stale copies remain in the DOM
- strict history parsing
- loose history parsing
- attention-highlight detection for `ncm`, `nbs`, `lei`, and code-like values
- windows-1252 text decoding
- localStorage persistence for the timeline mode
- global `alwaysOpen` toggle behavior and label changes
- on-demand panel opening when `alwaysOpen` is disabled
- auto-open when `alwaysOpen` is enabled
- clean-install defaults of `alwaysOpen=true` and `timelineMode='yellow-only'`
- current default behavior of showing the full timeline with yellow-note cards once the panel is opened
- full timeline rendering even when there are no yellow comments
- preservation of events whose visible description is only a yellow note
- persistent `Tudo` / `Amarelos` mode button behavior
- clearing stale comments during internal item switches
- ignoring late results from aborted fetches of the previous item
- clearing stale comments when the DOM switches to a different item without a trusted link yet
- refreshing the open panel when the item changes via DOM mutation only
- UI rendering without duplicating yellow-note text in the main description
- detection of Klassmatt error pages (`Erro.aspx`) in the response body
- detection of `d-error` divs with authorization/exception messages
- session error handling when fetch returns an error page
- redirect detection when fetch is silently redirected away from `Historico.aspx`
- actionable error messages for network failures

## 10. Important UX and styling decisions

- The sidebar should feel integrated with Klassmatt, not like a floating overlay.
- Layout uses a real grid, not a fixed overlay panel.
- The panel is sticky on wide screens.
- The yellow comments are rendered in note cards using a yellow palette.
- Entries with `ncm`, `nbs`, `lei`, or matching codes get a red card-level highlight to stand out quickly.
- The title is always "KM Acompanhamento".
- The panel includes:
- `Ver inline` (forces a sandboxed sanitized snapshot render of the fetched history HTML right inside the side panel)
- inline item-level panel toggle near the native link, with labels that switch between `Mostrar painel` and `Ocultar painel`

## 11. Constraints and assumptions

- This is a client-side userscript only. No server change is required.
- Same-origin fetch is required because `Historico.aspx` must be served from the same Klassmatt domain/session; cross-origin history URLs are rejected as unsafe.
- ASP.NET WebForms partial updates are expected and explicitly handled.
- The project is intentionally standalone, but it mirrors patterns from `FISCAL 5.0`.
- The parser is intentionally tolerant but not meant to perfectly replicate every branch of the bigger `FISCAL 5.0` reporting pipeline.

## 12. Known risks and edge cases

- Some Klassmatt variants may render yellow comments with different inline styles. The current selector is broad enough for known yellow variants, but unusual markup could still escape detection.
- Attention-highlight code matching is intentionally broad for 8+ digit code-like values, so unusual numeric text could still be flagged if it resembles an NCM/NBS code.
- If `Historico.aspx` markup changes substantially, parsing may fail and the project will fallback to the sanitized read-only snapshot.
- If the page has no valid SIN link and no visible SIN metadata, the panel will wait in an unstable state instead of guessing from item fields.
- If Klassmatt renames or removes `IdItem`, `IdSIN`, `#txtNumero`, `#Label_infoSIN`, or the native acompanhamento link IDs, the context scorer will need an update; it intentionally prefers the visible live root over stale hidden copies.
- The parser now preserves events whose visible description is only a yellow note. Avoid reintroducing any filter that drops those rows because the plain description text is empty.
- When the Klassmatt session expires or the `k` token becomes invalid, the server often returns HTTP 200 with an `Erro.aspx` body instead of HTTP 401/403. The script detects this and surfaces a `session-error` state with actionable recovery guidance; the user still needs to recarregar a pagina or reopen the panel.
- Silent HTTP redirects (to `Login.aspx`, `Erro.aspx`, etc.) are also detected via `response.redirected` and `response.url`, and cross-origin redirects are blocked before parsing.
- Transient errors (network, 5xx, timeout) do not auto-retry; the user can reopen the panel or recarregar a pagina when quiser.

## 13. Guidance for future AI edits

If you are another AI entering this project, use this order of inspection:

1. Read `src/app.ts`
2. Read `src/url.ts`
3. Read `src/parse.ts`
4. Read `src/ui.ts`
5. Run `npm test`

Common requested changes and where to make them:

- Show or regroup the full timeline:
  change the rendering flow in `src/app.ts`
- Change or expand the red attention-highlight keywords/code rules:
  update detection in `src/parse.ts` and corresponding styling in `src/ui.ts`
- Support new Klassmatt link IDs:
  update detection in `src/url.ts`
- Support new history DOM structures:
  update `src/parse.ts`
- Preserve yellow-only history rows:
  keep the `extractYellowNotes()` and `consolidate()` behavior that accepts rows where the description is empty but `yellowComments` exists
- Change build output metadata:
  update `vite.config.ts`

## 14. Short summary for fast onboarding

This project is a small, tested Vite/Tampermonkey userscript that attaches only to supported `https://` Klassmatt item pages, starts with the persistent global `alwaysOpen` preference enabled on a clean install, and also injects an item-level `Mostrar painel` / `Ocultar painel` toggle near the native link. Clean installs also default to `Amarelos`, so the first run shows only yellow comments unless the user switches to the full timeline. The Tampermonkey menu owns the persistent `alwaysOpen` setting, while the inline toggle is only a temporary override for the current item. When opened, it waits for a stable SIN context, resolves the active item root using the current `IdItem`/`IdSIN` hints plus the visible `#txtNumero`, fetches same-origin `Historico.aspx`, parses the strict timeline, and renders the acompanhamento inline in a right-side panel. Yellow notes are shown as dedicated note cards, rows mentioning `ncm`, `nbs`, `lei`, or matching codes are additionally highlighted in red, and rows whose only visible content is a yellow note are preserved. The current implementation explicitly protects against stale comments from a previously opened item during internal ASP.NET page switches, including DOM-only item swaps, blocks cross-origin redirects before parsing, strips external links from the normal panel, redacts `k` from user-facing diagnostics, and uses manual recovery (`F5`, reopening the panel, `Ver inline`) instead of heavyweight automatic retry or background token refresh. The inline fallback now uses a sandboxed sanitized snapshot rather than the raw remote page, and the build pipeline emits metadata, immutable release artifacts, and SHA-256 checksums for controlled GitHub Pages publication. The canonical repo remote moved to `https://github.com/YsraEstudos/km-sin-sidebar-userscript`, and the published assets live at the Pages root with `dist/` kept as the local build mirror. It was derived from the bigger `FISCAL 5.0` userscript, but reduced to the minimal architecture needed for this one feature.

## 15. Recent investigation notes

- The reported production bug was a stale-context issue, not a parser bug in the `Historico.aspx` HTML itself.
- On the inspected live item page, `IdItem=244350` and `IdSIN=24475` were both present, and `#txtNumero` held the item ID (`244350`), not the SIN. That field is only a selection hint for the active root.
- The new resolver scoring intentionally prefers the visible live `.kl-view` whose item field and summary data match the current page hints, so hidden or stale copies from the previous item no longer win.
- The runtime now rehydrates or clears stale state when the DOM changes in place via `MutationObserver`, `popstate`, or `hashchange`, which covers Klassmatt item swaps that do not emit a clean `endRequest`.
- The repo was pushed successfully to the moved remote, and the repository URL now resolves through the uppercase `YsraEstudos` location.
