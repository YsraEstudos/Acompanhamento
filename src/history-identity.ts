import { normalizeSpaces } from './text';

export interface HistoryIdentity {
  absoluteUrl: string;
  origin: string;
  pathname: string;
  source: string | null;
  id: string | null;
  somenteLeitura: string | null;
  k: string | null;
  fingerprint: string;
}

export interface HistoryIdentityValidation {
  isValid: boolean;
  reasons: string[];
}

function getParamInsensitive(url: URL, name: string): string | null {
  const expected = name.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase() !== expected) continue;
    const normalized = normalizeSpaces(value);
    return normalized || null;
  }

  return null;
}

function buildFingerprint(url: URL, source: string | null, id: string | null, somenteLeitura: string | null, k: string | null): string {
  return [
    url.origin.toLowerCase(),
    url.pathname.toLowerCase(),
    source || 'sem-source',
    id || 'sem-id',
    somenteLeitura || 'sem-somente-leitura',
    k || 'sem-k'
  ].join('|');
}

function maskSecurityToken(token: string | null): string | null {
  if (!token) return null;
  return '[redacted]';
}

export function extractHistoryIdentityFromUrl(rawUrl: string | null | undefined, baseUrl: string = window.location.href): HistoryIdentity | null {
  const input = String(rawUrl ?? '').trim();
  if (!input) return null;

  try {
    const base = new URL(baseUrl, window.location.href);
    const absolute = new URL(input, base);
    if (!/\/Historico\.aspx$/i.test(absolute.pathname)) {
      return null;
    }
    if (absolute.origin !== base.origin) {
      return null;
    }

    const source = getParamInsensitive(absolute, 'source');
    const id = getParamInsensitive(absolute, 'Id');
    const somenteLeitura = getParamInsensitive(absolute, 'SomenteLeitura');
    const k = getParamInsensitive(absolute, 'k');

    return {
      absoluteUrl: absolute.toString(),
      origin: absolute.origin,
      pathname: absolute.pathname,
      source,
      id,
      somenteLeitura,
      k,
      fingerprint: buildFingerprint(absolute, source, id, somenteLeitura, k)
    };
  } catch {
    return null;
  }
}

export function extractHistoryIdentityFromDocument(doc: Document, baseUrl: string = window.location.href): HistoryIdentity | null {
  for (const form of doc.querySelectorAll('form[action]')) {
    const action = form.getAttribute('action');
    const identity = extractHistoryIdentityFromUrl(action, baseUrl);
    if (identity) return identity;
  }

  return null;
}

export function formatHistoryIdentity(identity: HistoryIdentity | null | undefined): string {
  if (!identity) return 'sem-identidade';

  const parts = [
    identity.source ? `source=${identity.source}` : null,
    identity.id ? `Id=${identity.id}` : null,
    identity.somenteLeitura ? `SomenteLeitura=${identity.somenteLeitura}` : null,
    identity.k ? `k=${maskSecurityToken(identity.k)}` : null
  ].filter(Boolean);

  return parts.join(', ') || identity.absoluteUrl;
}

export function validateHistoryIdentity(expected: HistoryIdentity | null, actual: HistoryIdentity | null): HistoryIdentityValidation {
  const reasons: string[] = [];

  if (!expected) {
    reasons.push('O contexto atual nao expoe um link nativo confiavel para o acompanhamento.');
    return { isValid: false, reasons };
  }

  if (!actual) {
    reasons.push('A resposta do historico nao trouxe um form[action] validavel para conferenca.');
    return { isValid: false, reasons };
  }

  if (expected.pathname.toLowerCase() !== actual.pathname.toLowerCase()) {
    reasons.push(`Caminho inesperado no retorno: esperado ${expected.pathname}, recebido ${actual.pathname}.`);
  }

  if (expected.origin.toLowerCase() !== actual.origin.toLowerCase()) {
    reasons.push(`Origem divergente: esperado ${expected.origin}, recebido ${actual.origin}.`);
  }

  if (!actual.id) {
    reasons.push('A resposta do historico nao informa o Id da SIN no form[action].');
  } else if (!expected.id) {
    reasons.push('O link nativo do acompanhamento nao informa o Id da SIN.');
  } else if (expected.id !== actual.id) {
    reasons.push(`Id divergente: esperado ${expected.id}, recebido ${actual.id}.`);
  }

  if (expected.source && !actual.source) {
    reasons.push(`A resposta do historico nao informa source=${expected.source}.`);
  } else if (expected.source && actual.source && expected.source.toLowerCase() !== actual.source.toLowerCase()) {
    reasons.push(`Source divergente: esperado ${expected.source}, recebido ${actual.source}.`);
  }

  if (expected.somenteLeitura && !actual.somenteLeitura) {
    reasons.push(`A resposta do historico nao informa SomenteLeitura=${expected.somenteLeitura}.`);
  } else if (
    expected.somenteLeitura
    && actual.somenteLeitura
    && expected.somenteLeitura !== actual.somenteLeitura
  ) {
    reasons.push(`SomenteLeitura divergente: esperado ${expected.somenteLeitura}, recebido ${actual.somenteLeitura}.`);
  }

  if (expected.k && !actual.k) {
    reasons.push('A resposta do historico perdeu o parametro de seguranca k.');
  } else if (expected.k && actual.k && expected.k !== actual.k) {
    reasons.push('O parametro de seguranca k retornou diferente do link nativo.');
  }

  return {
    isValid: reasons.length === 0,
    reasons
  };
}
