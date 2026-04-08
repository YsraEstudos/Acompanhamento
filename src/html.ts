import { normalizeSpaces } from './text';

const INLINE_PASSTHROUGH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN']);
const SNAPSHOT_PASSTHROUGH_TAGS = new Set([
  'ARTICLE',
  'B',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DIV',
  'EM',
  'FIELDSET',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'I',
  'LEGEND',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SMALL',
  'SPAN',
  'STRONG',
  'TABLE',
  'TBODY',
  'TD',
  'TH',
  'THEAD',
  'TR',
  'U',
  'UL'
]);

interface SanitizeOptions {
  passthroughTags: ReadonlySet<string>;
}

export function escapeHtml(value: string | null | undefined): string {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function resolveTrustedSameOriginUrl(href: string, baseUrl: string): URL | null {
  try {
    const base = new URL(baseUrl, window.location.href);
    const url = new URL(href, base);
    if (url.origin !== base.origin) return null;
    if (url.protocol.toLowerCase() !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function sanitizeNode(node: Node, baseUrl: string, options: SanitizeOptions): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }

  if (!(node instanceof Element)) {
    return null;
  }

  const tag = node.tagName.toUpperCase();

  if (tag === 'A') {
    const text = normalizeSpaces(node.textContent || '');
    const href = node.getAttribute('href') || '';
    if (!text) return null;
    if (!href || /^javascript:/i.test(href)) {
      return document.createTextNode(text);
    }

    const url = resolveTrustedSameOriginUrl(href, baseUrl);
    if (!url) {
      return document.createTextNode(text);
    }

    const anchor = document.createElement('a');
    anchor.href = url.toString();
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.textContent = text;
    return anchor;
  }

  const fragment = document.createDocumentFragment();
  for (const child of node.childNodes) {
    const sanitizedChild = sanitizeNode(child, baseUrl, options);
    if (sanitizedChild) fragment.appendChild(sanitizedChild);
  }

  if (!options.passthroughTags.has(tag)) {
    return fragment;
  }

  if (tag === 'BR') {
    return document.createElement('br');
  }

  const safeEl = document.createElement(tag.toLowerCase());
  safeEl.appendChild(fragment);
  return safeEl;
}

export function sanitizeInlineHtml(value: string | null | undefined, baseUrl: string = window.location.href): string {
  const input = String(value ?? '');
  if (!input.includes('<')) {
    return escapeHtml(input);
  }

  const template = document.createElement('template');
  template.innerHTML = input;
  const container = document.createElement('div');

  for (const child of template.content.childNodes) {
    const sanitized = sanitizeNode(child, baseUrl, {
      passthroughTags: INLINE_PASSTHROUGH_TAGS
    });
    if (sanitized) container.appendChild(sanitized);
  }

  return container.innerHTML;
}

export function sanitizeSnapshotHtml(value: string | null | undefined, baseUrl: string = window.location.href): string {
  const input = String(value ?? '').trim();
  if (!input) return '';

  const doc = new DOMParser().parseFromString(input, 'text/html');
  const container = document.createElement('div');
  const root = doc.body ?? doc.documentElement;

  for (const child of root.childNodes) {
    const sanitized = sanitizeNode(child, baseUrl, {
      passthroughTags: SNAPSHOT_PASSTHROUGH_TAGS
    });
    if (sanitized) container.appendChild(sanitized);
  }

  return container.innerHTML;
}
