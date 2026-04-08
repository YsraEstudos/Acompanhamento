export function normalizeSpaces(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripDiacritics(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeTextNoAccent(value: string | null | undefined): string {
  return normalizeSpaces(stripDiacritics(value)).toLowerCase();
}
