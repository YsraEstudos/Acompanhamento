import {
  extractHistoryIdentityFromUrl,
  type HistoryIdentity
} from './history-identity';
import { normalizeTextNoAccent, normalizeSpaces } from './text';

export interface SinPageContext {
  itemId: string | null;
  historyUrl: string | null;
  historyIdentity: HistoryIdentity | null;
  sinId: string | null;
  summarySinId: string | null;
  isStable: boolean;
  viewRoot: HTMLElement | null;
  summaryEl: HTMLElement | null;
  linkEl: HTMLAnchorElement | null;
}

export interface QuickSinPageContext {
  historyUrl: string | null;
  historyIdentity: HistoryIdentity | null;
  sinId: string | null;
  viewRoot: HTMLElement | null;
  summaryEl: HTMLElement | null;
  linkEl: HTMLAnchorElement | null;
}

function isElementVisible(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden) return false;

  const style = (element.getAttribute('style') || '').toLowerCase();
  if (/\bdisplay\s*:\s*none\b/.test(style)) return false;
  if (/\bvisibility\s*:\s*hidden\b/.test(style)) return false;

  return true;
}

function getCandidateScore(element: HTMLElement, extras: { hasLink?: boolean; hasSummaryLabel?: boolean } = {}): number {
  let score = 0;
  if (isElementVisible(element)) score += 100;
  if (extras.hasLink) score += 30;
  if (extras.hasSummaryLabel) score += 20;
  if (element.closest('.km-sin-main')) score += 10;
  return score;
}

function pickBestElement<T extends HTMLElement>(candidates: T[], scorer: (element: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((candidate, index) => {
    const score = scorer(candidate) + (index / 1000);
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

export function absolutizeUrl(url: string | null | undefined): string | null {
  try {
    return new URL(String(url ?? ''), window.location.href).toString();
  } catch {
    return null;
  }
}

export function extractUrlFromJsFunction(href: string | null | undefined, functionNames: string[]): string | null {
  const raw = String(href ?? '');
  if (!raw) return null;

  for (const name of functionNames) {
    const matcher = new RegExp(`${name}\\s*\\(\\s*['"]([^'"]+)['"]`, 'i');
    const match = raw.match(matcher);
    if (match?.[1]) {
      return absolutizeUrl(match[1]);
    }
  }

  const genericOpen = raw.match(/open[\w]*\s*\(\s*['"]([^'"]+)['"]/i);
  if (genericOpen?.[1]) return absolutizeUrl(genericOpen[1]);

  return null;
}

export function extractHistoryUrlFromHref(href: string | null | undefined): string | null {
  return extractUrlFromJsFunction(href, ['OpenWindowsWHR', 'OpenWindowsWHRNS', 'OpenNewTab']);
}

export function extractHistoryIdentityFromHref(href: string | null | undefined): HistoryIdentity | null {
  const url = extractHistoryUrlFromHref(href);
  return extractHistoryIdentityFromUrl(url);
}

export function findHistoryLink(root: ParentNode): HTMLAnchorElement | null {
  const directCandidates = Array.from(root.querySelectorAll<HTMLAnchorElement>('#hButAcompanhamentoSIN, #hlkObs'));
  const direct = pickBestElement(directCandidates, (anchor) => getCandidateScore(anchor, { hasLink: true }));
  if (direct) return direct;

  const namedCandidates: HTMLAnchorElement[] = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a')) {
    if (normalizeTextNoAccent(anchor.textContent).includes('acompanhamento')) {
      namedCandidates.push(anchor);
    }
  }

  return pickBestElement(namedCandidates, (anchor) => getCandidateScore(anchor, { hasLink: true }));
}

function extractItemId(root: ParentNode): string | null {
  const candidates = Array.from(root.querySelectorAll<HTMLInputElement>('#txtNumero, input[name$="txtNumero"]'));
  const fromField = pickBestElement(candidates, (input) => getCandidateScore(input));
  return fromField?.value ? normalizeSpaces(fromField.value) : null;
}

function extractSinIdFromSummary(summaryEl: ParentNode | null): string | null {
  if (!summaryEl) return null;

  const infoText = summaryEl.querySelector('#Label_infoSIN')?.textContent || '';
  const infoMatch = infoText.match(/\bSIN:\s*(\d+)/i);
  return infoMatch?.[1] ? infoMatch[1] : null;
}

function findBestViewRoot(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('#UpdatePanel1 .kl-view, .kl-view'));
  return pickBestElement(candidates, (element) => getCandidateScore(element, {
    hasLink: Boolean(element.querySelector('#hButAcompanhamentoSIN, #hlkObs')),
    hasSummaryLabel: Boolean(element.querySelector('#Label_infoSIN'))
  }));
}

function findBestSummary(scope: ParentNode): HTMLElement | null {
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('#DV_Resumo_sin'));
  return pickBestElement(candidates, (element) => getCandidateScore(element, {
    hasLink: Boolean(findHistoryLink(element)),
    hasSummaryLabel: Boolean(element.querySelector('#Label_infoSIN'))
  }));
}

function findQuickViewRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#UpdatePanel1 .kl-view, .kl-view');
}

function findQuickSummary(scope: ParentNode): HTMLElement | null {
  return scope.querySelector<HTMLElement>('#DV_Resumo_sin');
}

function findDirectHistoryLink(root: ParentNode): HTMLAnchorElement | null {
  return root.querySelector<HTMLAnchorElement>('#hButAcompanhamentoSIN, #hlkObs');
}

export function resolvePageContext(): SinPageContext {
  const viewRoot = findBestViewRoot();
  const scope = viewRoot ?? document;
  const summaryEl = findBestSummary(scope);
  const linkEl = summaryEl
    ? (findHistoryLink(summaryEl) || findHistoryLink(scope))
    : findHistoryLink(scope);
  const itemId = extractItemId(scope);

  const historyIdentity = linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute('href')) : null;
  const directUrl = historyIdentity?.absoluteUrl || null;
  const sinIdFromLink = historyIdentity?.id || null;
  const sinIdFromSummary = extractSinIdFromSummary(summaryEl);

  const sinId = sinIdFromLink || sinIdFromSummary || null;
  const hasTrustedLink = Boolean(linkEl && historyIdentity?.absoluteUrl && historyIdentity?.id);
  const hasReliableSin = Boolean(sinIdFromLink || sinIdFromSummary);
  const isConsistent = !sinIdFromLink || !sinIdFromSummary || sinIdFromLink === sinIdFromSummary;
  const isStable = Boolean(viewRoot && summaryEl && hasTrustedLink && hasReliableSin && isConsistent);
  const historyUrl = isStable ? directUrl : null;

  return {
    itemId,
    historyUrl,
    historyIdentity,
    sinId,
    summarySinId: sinIdFromSummary,
    isStable,
    viewRoot,
    summaryEl,
    linkEl
  };
}

export function resolveQuickPageContext(): QuickSinPageContext {
  const viewRoot = findQuickViewRoot();
  const scope = viewRoot ?? document;
  const summaryEl = findQuickSummary(scope);
  const linkEl = summaryEl
    ? (findDirectHistoryLink(summaryEl) || findDirectHistoryLink(scope))
    : findDirectHistoryLink(scope);
  const historyIdentity = linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute('href')) : null;

  return {
    historyUrl: historyIdentity?.absoluteUrl || null,
    historyIdentity,
    sinId: historyIdentity?.id || extractSinIdFromSummary(summaryEl),
    viewRoot,
    summaryEl,
    linkEl
  };
}

export function resolveHistoryIdentityFromHtml(html: string): HistoryIdentity | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const viewRoot = pickBestElement(Array.from(doc.querySelectorAll<HTMLElement>('#UpdatePanel1 .kl-view, .kl-view')), (element) => getCandidateScore(element, {
      hasLink: Boolean(element.querySelector('#hButAcompanhamentoSIN, #hlkObs')),
      hasSummaryLabel: Boolean(element.querySelector('#Label_infoSIN'))
    }));
    const scope = viewRoot ?? doc;
    const summaryEl = findBestSummary(scope);
    const linkEl = summaryEl 
      ? (findHistoryLink(summaryEl) || findHistoryLink(scope))
      : findHistoryLink(scope);
    
    return linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute('href')) : null;
  } catch {
    return null;
  }
}
