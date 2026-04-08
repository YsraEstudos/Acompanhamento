import type { TimelineEvent } from './parse';
import { sanitizeInlineHtml, sanitizeSnapshotHtml, escapeHtml } from './html';

const STYLE_ID = 'km-sin-sidebar-style';
const LAYOUT_SELECTOR = '.km-sin-layout[data-km-sin-root="1"]';

export interface ShellRefs {
  layoutEl: HTMLElement;
  mainEl: HTMLElement;
  asideEl: HTMLElement;
  metaEl: HTMLElement;
  stateEl: HTMLElement;
  bodyEl: HTMLElement;
  inlineButton: HTMLButtonElement;
  modeButton: HTMLButtonElement;
}

export interface TimelineViewModel {
  historyUrl: string;
  diagnostic?: string;
  timeline: TimelineEvent[];
  loadedCount?: number;
  totalCount?: number;
  onLoadMore?: (() => void) | null;
}

function buildInlineSnapshotSrcdoc(rawHtml: string | undefined, baseUrl: string, historyUrl: string): string {
  const snapshotHtml = rawHtml
    ? sanitizeSnapshotHtml(rawHtml, baseUrl)
    : `<p>Nenhum snapshot seguro estava disponivel para este historico.</p><p><a href="${escapeHtml(historyUrl)}" target="_blank" rel="noreferrer noopener">Abrir historico nativo em nova aba</a></p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light only">
    <meta name="darkreader-lock">
    <style>
      :root { color-scheme: light only !important; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff !important;
        color: #111827 !important;
        font: 14px/1.55 Segoe UI, Arial, sans-serif;
      }
      body {
        padding: 16px;
      }
      .km-sin-snapshot-note {
        margin: 0 0 16px;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #334155;
        font-size: 13px;
      }
      .km-sin-snapshot {
        display: grid;
        gap: 12px;
        word-break: break-word;
      }
      .km-sin-snapshot a {
        color: #0f4c81;
      }
      .km-sin-snapshot table {
        width: 100%;
        border-collapse: collapse;
      }
      .km-sin-snapshot td,
      .km-sin-snapshot th {
        border: 1px solid #d4d8de;
        padding: 6px 8px;
        vertical-align: top;
      }
      .km-sin-snapshot fieldset {
        border: 1px solid #d4d8de;
        border-radius: 10px;
        padding: 12px;
      }
      .km-sin-snapshot pre,
      .km-sin-snapshot code {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="km-sin-snapshot-note">Visualizacao segura em modo somente leitura. Scripts, formularios, imagens e recursos externos do HTML original foram removidos.</div>
    <main class="km-sin-snapshot">${snapshotHtml || '<p>O historico nao trouxe conteudo visual seguro para exibir inline.</p>'}</main>
  </body>
</html>`;
}

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = '.km-sin-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,360px);gap:20px;align-items:start;margin-top:12px}.km-sin-layout.km-sin-collapsed{grid-template-columns:minmax(0,1fr)}.km-sin-main,.km-sin-aside{min-width:0;min-height:0}.km-sin-aside[hidden]{display:none!important}.km-sin-card{position:sticky;top:12px;display:flex;flex-direction:column;max-height:calc(100vh - 24px);background:#fff;border:1px solid #d4d8de;border-radius:12px;box-shadow:0 12px 28px rgba(15,23,42,.08);overflow:hidden}.km-sin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid #e7eaee;background:linear-gradient(180deg,#f8fafc 0,#fff 100%)}.km-sin-label{margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#52606d}.km-sin-title{margin:0;font-size:18px;line-height:1.2;color:#1f2937}.km-sin-meta,.km-sin-state{padding:0 16px;color:#52606d;font-size:12px}.km-sin-meta{padding-top:12px}.km-sin-state{padding-top:8px;padding-bottom:8px}.km-sin-state.is-error{color:#b42318}.km-sin-state.is-warning{color:#9a6700}.km-sin-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}.km-sin-link-btn,.km-sin-toggle,.km-sin-mode-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;transition:background 120ms ease,border-color 120ms ease,color 120ms ease}.km-sin-link-btn:hover,.km-sin-toggle:hover,.km-sin-mode-btn:hover{background:#f8fafc;border-color:#94a3b8}.km-sin-link-btn:disabled{cursor:default;opacity:.65}.km-sin-mode-btn{border-color:#bfd7ff;color:#0f4c81;background:#eef6ff}.km-sin-mode-btn[data-mode="yellow-only"]{background:#fff4e5;border-color:#f5c67a;color:#8a4b08}.km-sin-body{flex:1 1 auto;min-height:0;padding:12px 16px 16px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable;touch-action:pan-y}.km-sin-empty{padding:14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;color:#52606d;font-size:13px}.km-sin-empty-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.km-sin-banner{margin-bottom:12px;padding:12px 14px;border-radius:10px;background:#fff4e5;border:1px solid #f5c67a;color:#8a4b08;font-size:13px}.km-sin-group+.km-sin-group{margin-top:16px}.km-sin-day{margin:0 0 10px;font-size:13px;font-weight:700;color:#334155}.km-sin-list,.km-sin-notes{display:grid;gap:10px}.km-sin-item{border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:12px}.km-sin-item.is-attention{border-color:#f1a4a4;background:linear-gradient(180deg,#fff6f6 0,#fffdfd 100%);box-shadow:inset 0 0 0 1px rgba(185,28,28,.08)}.km-sin-item-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;font-size:12px;color:#64748b}.km-sin-time{font-weight:700;color:#334155}.km-sin-stage,.km-sin-attention-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-weight:700;font-size:11px;text-transform:uppercase}.km-sin-stage{background:#e2e8f0;color:#334155}.km-sin-attention-chip{background:#fee2e2;color:#b42318;border:1px solid #f5b4b4}.km-sin-desc{color:#1f2937;font-size:13px;line-height:1.5;word-break:break-word}.km-sin-desc a{color:#0f4c81}.km-sin-notes{margin-top:10px;gap:8px}.km-sin-note{padding:9px 10px;border-radius:9px;background:#fff7bf;border:1px solid #e6d665;color:#6a5600;font-size:12px;line-height:1.45;font-weight:600}.km-sin-frame{width:100%;min-height:70vh;border:1px solid #d4d8de;border-radius:10px;background:#fff;color-scheme:light;forced-color-adjust:none}.km-sin-inline-toggle{display:inline-flex;align-items:center;margin-left:8px}.km-sin-toggle[aria-pressed=true]{background:#0f4c81;border-color:#0f4c81;color:#fff}@media (max-width:1360px){.km-sin-layout{grid-template-columns:minmax(0,1fr)}.km-sin-card{position:relative;top:0;max-height:none}.km-sin-body{max-height:none}}';
  document.head.appendChild(style);
}

export function ensureShell(viewRoot: HTMLElement): ShellRefs {
  let existing: HTMLElement | null = null;
  for (const child of viewRoot.children) {
    if (
      child instanceof HTMLElement
      && child.matches(LAYOUT_SELECTOR)
    ) {
      existing = child;
      break;
    }
  }

  if (existing) {
    const mainEl = existing.querySelector<HTMLElement>('.km-sin-main');
    const asideEl = existing.querySelector<HTMLElement>('.km-sin-aside');
    const metaEl = existing.querySelector<HTMLElement>('.km-sin-meta');
    const stateEl = existing.querySelector<HTMLElement>('.km-sin-state');
    const bodyEl = existing.querySelector<HTMLElement>('.km-sin-body');
    const inlineButton = existing.querySelector<HTMLButtonElement>('[data-role="inline"]');
    const modeButton = existing.querySelector<HTMLButtonElement>('[data-role="mode"]');

    if (mainEl && asideEl && metaEl && stateEl && bodyEl && inlineButton && modeButton) {
      return { layoutEl: existing, mainEl, asideEl, metaEl, stateEl, bodyEl, inlineButton, modeButton };
    }

    existing.remove();
  }

  const layoutEl = document.createElement('div');
  layoutEl.className = 'km-sin-layout';
  layoutEl.dataset.kmSinRoot = '1';

  const mainEl = document.createElement('div');
  mainEl.className = 'km-sin-main';
  const asideEl = document.createElement('aside');
  asideEl.className = 'km-sin-aside';

  const card = document.createElement('section');
  card.className = 'km-sin-card';

  const head = document.createElement('div');
  head.className = 'km-sin-head';

  const titleWrap = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'km-sin-label';
  label.textContent = 'Klassmatt';
  const title = document.createElement('h2');
  title.className = 'km-sin-title';
  title.textContent = 'KM Acompanhamento';
  titleWrap.append(label, title);

  const actions = document.createElement('div');
  actions.className = 'km-sin-actions';

  const inlineButton = document.createElement('button');
  inlineButton.type = 'button';
  inlineButton.className = 'km-sin-link-btn';
  inlineButton.dataset.role = 'inline';
  inlineButton.textContent = 'Ver inline';

  const modeButton = document.createElement('button');
  modeButton.type = 'button';
  modeButton.className = 'km-sin-mode-btn';
  modeButton.dataset.role = 'mode';
  modeButton.textContent = 'Tudo';

  actions.append(inlineButton, modeButton);
  head.append(titleWrap, actions);

  const metaEl = document.createElement('div');
  metaEl.className = 'km-sin-meta';

  const stateEl = document.createElement('div');
  stateEl.className = 'km-sin-state';

  const bodyEl = document.createElement('div');
  bodyEl.className = 'km-sin-body';
  bodyEl.tabIndex = 0;

  card.append(head, metaEl, stateEl, bodyEl);
  asideEl.appendChild(card);

  while (viewRoot.firstChild) {
    const node = viewRoot.firstChild;
    mainEl.appendChild(node);
  }

  layoutEl.append(mainEl, asideEl);
  viewRoot.appendChild(layoutEl);

  return { layoutEl, mainEl, asideEl, metaEl, stateEl, bodyEl, inlineButton, modeButton };
}

export function renderEmpty(shell: ShellRefs, message: string): void {
  const node = document.createElement('div');
  node.className = 'km-sin-empty';
  node.textContent = message;
  shell.bodyEl.replaceChildren(node);
}

export function setShellState(shell: ShellRefs, text: string, tone: 'default' | 'warning' | 'error' = 'default'): void {
  shell.stateEl.textContent = text;
  shell.stateEl.classList.remove('is-warning', 'is-error');
  if (tone === 'warning') shell.stateEl.classList.add('is-warning');
  if (tone === 'error') shell.stateEl.classList.add('is-error');
}

export function setShellMeta(shell: ShellRefs, text: string): void {
  shell.metaEl.textContent = text;
}

function buildEventNode(event: TimelineEvent, historyUrl: string): HTMLElement {
  const item = document.createElement('article');
  item.className = 'km-sin-item';
  if (event.hasAttentionHighlight) item.classList.add('is-attention');

  const meta = document.createElement('div');
  meta.className = 'km-sin-item-meta';
  meta.innerHTML = `
    <span class="km-sin-time">${escapeHtml(event.hora || 'Sem hora')}</span>
    <span>${escapeHtml(event.usuario || 'Usuário não identificado')}</span>
    ${event.stage ? `<span class="km-sin-stage">${escapeHtml(event.stage)}</span>` : ''}
    ${event.hasAttentionHighlight ? `<span class="km-sin-attention-chip">Destaque</span>` : ''}
  `;

  const desc = document.createElement('div');
  desc.className = 'km-sin-desc';
  const html = event.descricaoHtml
    ? sanitizeInlineHtml(event.descricaoHtml, historyUrl)
    : escapeHtml(event.descricao);
  desc.innerHTML = html || escapeHtml(event.descricao);

  item.append(meta, desc);

  if (event.yellowComments.length > 0) {
    const notes = document.createElement('div');
    notes.className = 'km-sin-notes';
    for (const comment of event.yellowComments) {
      const note = document.createElement('div');
      note.className = 'km-sin-note';
      note.textContent = comment;
      notes.appendChild(note);
    }
    item.appendChild(notes);
  }

  return item;
}

export function renderTimeline(shell: ShellRefs, model: TimelineViewModel): void {
  const fragment = document.createDocumentFragment();

  if (model.diagnostic) {
    const banner = document.createElement('div');
    banner.className = 'km-sin-banner';
    banner.textContent = model.diagnostic;
    fragment.appendChild(banner);
  }

  let currentDay = '';
  let list: HTMLElement | null = null;

  for (const event of model.timeline) {
    if (event.dia !== currentDay) {
      currentDay = event.dia;
      const section = document.createElement('section');
      section.className = 'km-sin-group';

      const heading = document.createElement('h3');
      heading.className = 'km-sin-day';
      heading.textContent = currentDay || 'Sem data';

      list = document.createElement('div');
      list.className = 'km-sin-list';
      section.append(heading, list);
      fragment.appendChild(section);
    }

    list?.appendChild(buildEventNode(event, model.historyUrl));
  }

  if (
    model.onLoadMore
    && typeof model.totalCount === 'number'
    && model.timeline.length < model.totalCount
  ) {
    const actions = document.createElement('div');
    actions.className = 'km-sin-empty-actions';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'km-sin-link-btn';
    button.dataset.act = 'load-more';
    button.textContent = `Carregar mais (${model.timeline.length}/${model.totalCount})`;
    button.onclick = model.onLoadMore;

    actions.appendChild(button);
    fragment.appendChild(actions);
  }

  shell.bodyEl.replaceChildren(fragment);
}

export function renderIframeFallbackPrompt(shell: ShellRefs, diagnostic: string | undefined, onDemandLoad: () => void): void {
  const fragment = document.createDocumentFragment();

  if (diagnostic) {
    const banner = document.createElement('div');
    banner.className = 'km-sin-banner';
    banner.textContent = diagnostic;
    fragment.appendChild(banner);
  }

  const empty = document.createElement('div');
  empty.className = 'km-sin-empty';
  empty.textContent = 'Nao foi possivel interpretar o HTML deste historico. Se precisar, carregue uma visualizacao segura em modo somente leitura.';

  const actions = document.createElement('div');
  actions.className = 'km-sin-empty-actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'km-sin-link-btn';
  button.dataset.act = 'load-fallback';
  button.textContent = 'Carregar visualizacao segura';
  button.onclick = () => {
    button.disabled = true;
    onDemandLoad();
  };

  actions.appendChild(button);
  empty.appendChild(actions);
  fragment.appendChild(empty);
  shell.bodyEl.replaceChildren(fragment);
}

export function renderIframeFallback(
  shell: ShellRefs,
  url: string,
  diagnostic?: string,
  rawHtml?: string,
  baseUrl?: string
): void {
  const fragment = document.createDocumentFragment();

  if (diagnostic) {
    const banner = document.createElement('div');
    banner.className = 'km-sin-banner';
    banner.textContent = diagnostic;
    fragment.appendChild(banner);
  }

  const iframe = document.createElement('iframe');
  iframe.className = 'km-sin-frame';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('sandbox', '');
  iframe.setAttribute('data-darkreader-ignore', '');
  iframe.setAttribute('data-darkreader-skip', '');
  iframe.title = 'KM Acompanhamento (isolado)';
  iframe.src = 'about:blank';
  iframe.srcdoc = buildInlineSnapshotSrcdoc(rawHtml, baseUrl || url, url);

  fragment.appendChild(iframe);
  shell.bodyEl.replaceChildren(fragment);
}
