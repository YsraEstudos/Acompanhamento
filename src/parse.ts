import {
  extractHistoryIdentityFromDocument,
  type HistoryIdentity
} from './history-identity';
import { normalizeSpaces, normalizeTextNoAccent } from './text';
import { VALID_NCM_PREFIXES, VALID_NBS_PREFIXES } from './code-prefixes';

export type ParseConfidence = 'high' | 'low';

export interface TimelineEvent {
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

export interface ParseHistoryResult {
  timeline: TimelineEvent[];
  summary: {
    totalEventos: number;
    totalTransicoes: number;
    totalYellowEvents: number;
  };
  warnings: string[];
  confidence: ParseConfidence;
  documentIdentity: HistoryIdentity | null;
  anomalyCount: number;
  parserKind: 'strict' | 'loose';
}

export interface ItemScopedTimelineResult {
  status: 'unscoped' | 'filtered' | 'ambiguous';
  timeline: TimelineEvent[];
  summary: ParseHistoryResult['summary'];
  detectedItemIds: string[];
  diagnostic?: string;
}

export interface ItemMarker {
  index: number;
  itemId: string;
}

interface RawEvent {
  dia: string;
  hora: string;
  usuario: string | null;
  descricao: string;
  descricaoHtml?: string;
  yellowComments?: string[];
}

interface ParserBuild {
  events: RawEvent[];
  warnings: string[];
  anomalyCount: number;
  parserKind: 'strict' | 'loose';
}

interface YellowNoteExtraction {
  descricao: string;
  descricaoHtml: string;
  yellowComments: string[];
  warnings: string[];
  anomalyCount: number;
}

const YELLOW_STYLE_PATTERNS = [
  /\byellow\b/i,
  /#(?:ffff00|ff0)\b/i,
  /rgb\s*\(\s*255\s*[, ]\s*255\s*[, ]\s*0\s*\)/i,
  /rgba\s*\(\s*255\s*[, ]\s*255\s*[, ]\s*0\s*[,/]\s*(?:1|1(?:\.0+)?)\s*\)/i,
  /darkreader-[^"' ;]*ffff00/i,
  /#fff7bf\b/i,
  /#e6d665\b/i,
  /#999900\b/i
];

const VALID_NCM_PREFIX_SET: ReadonlySet<string> = new Set(VALID_NCM_PREFIXES);
const VALID_NBS_PREFIX_SET: ReadonlySet<string> = new Set(VALID_NBS_PREFIXES);

function normalizeCodeDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

function isValidNcmCandidate(value: string): boolean {
  const digits = normalizeCodeDigits(value);
  if (digits.length < 8) return false;
  return VALID_NCM_PREFIX_SET.has(digits.slice(0, 4));
}

function isValidNbsCandidate(value: string): boolean {
  const digits = normalizeCodeDigits(value);
  if (digits.length < 9) return false;
  if (digits[0] !== '1') return false;
  return VALID_NBS_PREFIX_SET.has(digits.slice(0, 5));
}

function hasCaseReferencePrefix(value: string, index: number): boolean {
  const before = value.slice(Math.max(0, index - 4), index);
  return /ca\s*#$/i.test(before);
}

function detectStage(description: string): string | null {
  const match = description.match(/Solicita[cç][aã]o enviada para\s+(.+)$/i)
    || description.match(/Solicita.*o enviada para\s+(.+)$/i);
  return match?.[1] ? normalizeSpaces(match[1]).toUpperCase() : null;
}

function detectAttentionMatches(description: string, yellowComments: string[]): string[] {
  const combined = [description, ...yellowComments].join(' ');
  const normalizedCombined = normalizeTextNoAccent(combined);
  const rawCombined = normalizeSpaces(combined);
  const matches = new Set<string>();

  for (const match of normalizedCombined.matchAll(/\blei\b/g)) {
    matches.add(match[0].toUpperCase());
  }

  for (const match of rawCombined.matchAll(/(ncm|nbs)?\s*[:=.-]?\s*(\d[\d.\s/-]{6,}\d)/gi)) {
    const rawCode = normalizeSpaces(match[2]);
    const label = normalizeSpaces(match[1] || '').toUpperCase();
    const codeIndex = match.index === undefined ? -1 : match.index + match[0].indexOf(match[2]);

    if (!label && codeIndex >= 0 && hasCaseReferencePrefix(rawCombined, codeIndex)) {
      continue;
    }

    if (label === 'NBS') {
      if (isValidNbsCandidate(rawCode)) {
        matches.add('NBS');
        matches.add(rawCode);
      }
      continue;
    }

    if (label === 'NCM' || !label) {
      if (isValidNcmCandidate(rawCode)) {
        matches.add('NCM');
        matches.add(rawCode);
      }
    }
  }

  return Array.from(matches);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeSpaces(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export function resolveNearestItemIds(markers: readonly ItemMarker[], timelineLength: number): string[][] {
  if (timelineLength <= 0) return [];

  const markerByIndex = new Map<number, ItemMarker>();
  for (const marker of markers) {
    if (marker.index >= 0 && marker.index < timelineLength) {
      markerByIndex.set(marker.index, marker);
    }
  }

  const nearestLeft: Array<ItemMarker | undefined> = Array(timelineLength);
  let leftMarker: ItemMarker | undefined;
  for (let index = 0; index < timelineLength; index++) {
    const marker = markerByIndex.get(index);
    if (marker) leftMarker = marker;
    nearestLeft[index] = leftMarker;
  }

  const nearestRight: Array<ItemMarker | undefined> = Array(timelineLength);
  let rightMarker: ItemMarker | undefined;
  for (let index = timelineLength - 1; index >= 0; index--) {
    const marker = markerByIndex.get(index);
    if (marker) rightMarker = marker;
    nearestRight[index] = rightMarker;
  }

  return Array.from({ length: timelineLength }, (_, index) => {
    const left = nearestLeft[index];
    const right = nearestRight[index];
    if (!left && !right) return [];
    if (!left) return [right!.itemId];
    if (!right) return [left.itemId];

    const leftDistance = index - left.index;
    const rightDistance = right.index - index;
    if (leftDistance < rightDistance) return [left.itemId];
    if (rightDistance < leftDistance) return [right.itemId];
    return dedupeStrings([left.itemId, right.itemId]);
  });
}

function buildTimelineSummary(timeline: TimelineEvent[]): ParseHistoryResult['summary'] {
  let transitions = 0;
  let yellowEvents = 0;

  for (const event of timeline) {
    if (event.stage) transitions++;
    if (event.yellowComments.length > 0) yellowEvents++;
  }

  return {
    totalEventos: timeline.length,
    totalTransicoes: transitions,
    totalYellowEvents: yellowEvents
  };
}

function extractCreatedItemId(event: Pick<TimelineEvent, 'descricao'>): string | null {
  const normalized = normalizeTextNoAccent(event.descricao);
  const match = normalized.match(/\bcriado\s+o\s+item\s+n\W*(\d{3,})\b/i);
  return match?.[1] || null;
}

function describeDetectedItemIds(itemIds: string[], currentItemId: string): string {
  const others = itemIds.filter((value) => value !== currentItemId);
  if (others.length === 0) return `item ${currentItemId}`;
  if (others.length === 1) return `item ${currentItemId} e ignorar o item ${others[0]}`;
  return `item ${currentItemId} e ignorar os itens ${others.join(', ')}`;
}

export function scopeTimelineToItem(
  timeline: TimelineEvent[],
  currentItemId: string | null | undefined
): ItemScopedTimelineResult {
  const normalizedItemId = normalizeSpaces(currentItemId || '').match(/\d+/)?.[0] || '';
  const baseSummary = buildTimelineSummary(timeline);
  if (!normalizedItemId || timeline.length === 0) {
    return {
      status: 'unscoped',
      timeline,
      summary: baseSummary,
      detectedItemIds: []
    };
  }

  const markers = timeline
    .map((event, index) => {
      const itemId = extractCreatedItemId(event);
      return itemId ? { index, itemId } : null;
    })
    .filter((value): value is { index: number; itemId: string } => Boolean(value));

  const detectedItemIds = dedupeStrings(markers.map((marker) => marker.itemId));
  if (markers.length === 0) {
    return {
      status: 'unscoped',
      timeline,
      summary: baseSummary,
      detectedItemIds
    };
  }

  const currentMarkers = markers.filter((marker) => marker.itemId === normalizedItemId);
  if (currentMarkers.length === 0) {
    return {
      status: 'ambiguous',
      timeline,
      summary: baseSummary,
      detectedItemIds,
      diagnostic: `O historico da SIN menciona outros itens, mas nao confirmou o item ${normalizedItemId} com seguranca.`
    };
  }

  const nearestItemIdsByIndex = resolveNearestItemIds(markers, timeline.length);
  const bestSegment = timeline.filter((event, index) => {
    const resolvedNearestItemIds = nearestItemIdsByIndex[index] || [];
    if (resolvedNearestItemIds.length !== 1) return false;
    return resolvedNearestItemIds[0] === normalizedItemId;
  });

  if (bestSegment.length === timeline.length) {
    return {
      status: 'unscoped',
      timeline,
      summary: baseSummary,
      detectedItemIds
    };
  }

  return {
    status: 'filtered',
    timeline: bestSegment,
    summary: buildTimelineSummary(bestSegment),
    detectedItemIds,
    diagnostic: `Historico da SIN filtrado para ${describeDetectedItemIds(detectedItemIds, normalizedItemId)}.`
  };
}

function getStyleSources(element: Element): string[] {
  return [
    element.getAttribute('style') || '',
    element.getAttribute('data-darkreader-inline-bgcolor') || '',
    element.getAttribute('data-darkreader-inline-bg') || '',
    element.getAttribute('data-darkreader-inline-bgimage') || ''
  ].map((value) => normalizeSpaces(value)).filter(Boolean);
}

function isYellowHighlightElement(element: Element): boolean {
  return getStyleSources(element).some((value) => YELLOW_STYLE_PATTERNS.some((pattern) => pattern.test(value)));
}

function isSignificantNode(node: Node | null): boolean {
  if (!node) return false;
  if (node instanceof HTMLBRElement) return true;
  if (node.nodeType === Node.TEXT_NODE) {
    return Boolean(normalizeSpaces(node.textContent || ''));
  }
  if (node instanceof Element) {
    return Boolean(normalizeSpaces(node.textContent || ''));
  }
  return false;
}

function getPreviousSignificantNode(nodes: Node[], index: number): Node | null {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (isSignificantNode(nodes[cursor])) return nodes[cursor];
  }
  return null;
}

function getNextSignificantNode(nodes: Node[], index: number): Node | null {
  for (let cursor = index + 1; cursor < nodes.length; cursor++) {
    if (isSignificantNode(nodes[cursor])) return nodes[cursor];
  }
  return null;
}

function hasLeadContent(nodes: Node[], index: number): boolean {
  for (let cursor = 0; cursor < index; cursor++) {
    const node = nodes[cursor];
    if (node instanceof HTMLBRElement) continue;
    if (node.nodeType === Node.TEXT_NODE && normalizeSpaces(node.textContent || '')) return true;
    if (node instanceof Element && normalizeSpaces(node.textContent || '')) return true;
  }
  return false;
}

function getTopLevelYellowHighlights(root: Element): Element[] {
  const highlights = Array.from(root.querySelectorAll('*')).filter((element) => {
    return isYellowHighlightElement(element) && Boolean(normalizeSpaces(element.textContent || ''));
  });

  return highlights.filter((candidate) => {
    return !highlights.some((other) => other !== candidate && other.contains(candidate));
  });
}

function resolveYellowNoteContainer(element: Element): Element | null {
  const text = normalizeSpaces(element.textContent || '');
  if (!text) return null;

  if (isYellowHighlightElement(element)) {
    return element;
  }

  const nestedHighlights = getTopLevelYellowHighlights(element);
  if (nestedHighlights.length !== 1) return null;

  const nestedText = normalizeSpaces(nestedHighlights[0].textContent || '');
  if (!nestedText || nestedText !== text) return null;

  return element;
}

function removeAcceptedNotes(root: HTMLElement, acceptedNotes: Element[]): void {
  const unique = Array.from(new Set(acceptedNotes));
  for (const node of unique) {
    node.remove();
  }

  while (root.firstChild instanceof HTMLBRElement) {
    root.firstChild.remove();
  }

  while (root.lastChild instanceof HTMLBRElement) {
    root.lastChild.remove();
  }
}

function extractYellowNotes(descriptionEl: HTMLElement | null): YellowNoteExtraction {
  if (!descriptionEl) {
    return {
      descricao: '',
      descricaoHtml: '',
      yellowComments: [],
      warnings: ['Evento sem span#lblDescricao; nenhuma descricao foi extraida.'],
      anomalyCount: 1
    };
  }

  const clone = descriptionEl.cloneNode(true) as HTMLElement;
  const nodes = Array.from(clone.childNodes);
  const acceptedNotes: Element[] = [];
  const yellowComments: string[] = [];
  const warnings: string[] = [];
  let anomalyCount = 0;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!(node instanceof Element) || node instanceof HTMLBRElement) continue;

    const container = resolveYellowNoteContainer(node);
    if (!container) continue;

    const noteText = normalizeSpaces(container.textContent || '');
    if (!noteText) continue;

    const previous = getPreviousSignificantNode(nodes, index);
    const next = getNextSignificantNode(nodes, index);
    const hasBreakBefore = previous instanceof HTMLBRElement;
    const isTail = next === null;
    const isOnlyContent = previous === null && next === null && !hasLeadContent(nodes, index);

    if (hasBreakBefore || (isTail && hasLeadContent(nodes, index)) || isOnlyContent) {
      acceptedNotes.push(container);
      yellowComments.push(noteText);
      continue;
    }

    warnings.push(`Comentario amarelo ambiguo ignorado: "${noteText.slice(0, 120)}".`);
    anomalyCount++;
  }

  const unmatchedHighlights = getTopLevelYellowHighlights(clone).filter((highlight) => {
    return !acceptedNotes.some((accepted) => accepted === highlight || accepted.contains(highlight));
  });

  if (unmatchedHighlights.length > 0) {
    warnings.push('Foram encontrados destaques com fundo colorido fora do padrao seguro de comentario amarelo.');
    anomalyCount += unmatchedHighlights.length;
  }

  removeAcceptedNotes(clone, acceptedNotes);

  return {
    descricao: normalizeSpaces(clone.textContent ?? ''),
    descricaoHtml: clone.innerHTML.trim(),
    yellowComments: dedupeStrings(yellowComments),
    warnings: dedupeStrings(warnings),
    anomalyCount
  };
}

function consolidate(events: RawEvent[]): ParseHistoryResult {
  const timeline: TimelineEvent[] = [];

  for (const event of events) {
    const descricao = normalizeSpaces(event.descricao);
    const yellowComments = Array.isArray(event.yellowComments)
      ? event.yellowComments.map((item) => normalizeSpaces(item)).filter(Boolean)
      : [];

    if (!descricao && yellowComments.length === 0) continue;

    const stage = detectStage(descricao);
    const attentionMatches = detectAttentionMatches(descricao, yellowComments);

    timeline.push({
      dia: normalizeSpaces(event.dia),
      hora: normalizeSpaces(event.hora),
      usuario: normalizeSpaces(event.usuario || '') || null,
      descricao,
      descricaoHtml: String(event.descricaoHtml || '').trim(),
      stage,
      yellowComments,
      hasAttentionHighlight: attentionMatches.length > 0,
      attentionMatches
    });
  }

  return {
    timeline,
    summary: buildTimelineSummary(timeline),
    warnings: [],
    confidence: 'low',
    documentIdentity: null,
    anomalyCount: 0,
    parserKind: 'strict'
  };
}

function finalizeParse(doc: Document, build: ParserBuild, baseUrl: string = window.location.href): ParseHistoryResult {
  const base = consolidate(build.events);
  const documentIdentity = extractHistoryIdentityFromDocument(doc, baseUrl);
  const warnings = [...build.warnings];
  let anomalyCount = build.anomalyCount;

  if (!documentIdentity?.id) {
    warnings.push('O historico retornado nao expôs um form[action] confiavel com Id da SIN.');
    anomalyCount++;
  }

  return {
    ...base,
    warnings: dedupeStrings(warnings),
    confidence: build.parserKind === 'strict' && anomalyCount === 0 ? 'high' : 'low',
    documentIdentity,
    anomalyCount,
    parserKind: build.parserKind
  };
}

function parseHistoryStrictBuild(doc: Document): ParserBuild {
  const events: RawEvent[] = [];
  const warnings: string[] = [];
  let anomalyCount = 0;

  for (const fieldset of doc.querySelectorAll('fieldset.hist-fieldset')) {
    const dia = normalizeSpaces(fieldset.querySelector('legend.hist-legend')?.textContent || '');
    if (!dia) {
      warnings.push('Um fieldset do historico nao possui legend.hist-legend identificavel.');
      anomalyCount++;
    }
    let currentUser: string | null = null;

    for (const row of fieldset.querySelectorAll('.row')) {
      if (!row.classList.contains('result')) {
        const userLink = row.querySelector('a#hlinkUsuario, a[href*="USUARIO_show"]');
        if (userLink) {
          currentUser = normalizeSpaces(userLink.textContent || '').replace(/\*+$/, '');
        }
        continue;
      }

      const hour = normalizeSpaces(row.querySelector('span[id="lblHora"]')?.textContent || '');
      const descriptionEl = row.querySelector('span[id="lblDescricao"]');
      if (!hour) {
        warnings.push(`Evento do historico sem hora identificavel em ${dia || 'dia desconhecido'}.`);
        anomalyCount++;
      }

      const extracted = extractYellowNotes(descriptionEl instanceof HTMLElement ? descriptionEl : null);
      warnings.push(...extracted.warnings);
      anomalyCount += extracted.anomalyCount;

      if (!descriptionEl) {
        continue;
      }

      events.push({
        dia,
        hora: hour,
        usuario: currentUser,
        descricao: extracted.descricao,
        descricaoHtml: extracted.descricaoHtml,
        yellowComments: extracted.yellowComments
      });
    }
  }

  return {
    events,
    warnings,
    anomalyCount,
    parserKind: 'strict'
  };
}

export function parseHistoryStrict(doc: Document, baseUrl: string = window.location.href): ParseHistoryResult {
  return finalizeParse(doc, parseHistoryStrictBuild(doc), baseUrl);
}

function parseHistoryLooseBuild(doc: Document): ParserBuild {
  const events: RawEvent[] = [];
  const warnings: string[] = ['HTML fora da estrutura hist-fieldset; parser tolerante ativado em modo de baixa confianca.'];
  let anomalyCount = 1;

  for (const fieldset of doc.querySelectorAll('fieldset')) {
    const dia = normalizeSpaces(fieldset.querySelector('legend')?.textContent || '');
    const text = String((fieldset as HTMLElement).innerText || fieldset.textContent || '');
    const lines = text
      .split(/\r?\n+/)
      .map((line) => normalizeSpaces(line))
      .filter(Boolean);

    let currentUser: string | null = null;
    let currentEvent: RawEvent | null = null;

    for (const line of lines) {
      if (dia && line === dia) continue;

      const candidateUser = line.replace(/\*+$/, '');
      if (
        /^[a-zA-Z0-9._-]{3,}$/.test(candidateUser) &&
        !/\s/.test(candidateUser) &&
        !/solicita[cç][aã]o|retorn|aprov|catalog|revis/i.test(candidateUser)
      ) {
        if (currentEvent) {
          events.push(currentEvent);
          currentEvent = null;
        }
        currentUser = candidateUser;
        continue;
      }

      const hourMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-–]\s*|\s+)(.+)$/);
      if (hourMatch?.[2]) {
        if (currentEvent) events.push(currentEvent);
        currentEvent = {
          dia,
          hora: hourMatch[1],
          usuario: currentUser,
          descricao: normalizeSpaces(hourMatch[2]),
          descricaoHtml: '',
          yellowComments: []
        };
      } else if (currentEvent) {
        currentEvent.descricao = `${currentEvent.descricao} ${line}`.trim();
      } else {
        events.push({
          dia,
          hora: '',
          usuario: currentUser,
          descricao: line,
          descricaoHtml: '',
          yellowComments: []
        });
      }
    }

    if (currentEvent) events.push(currentEvent);
  }

  return {
    events,
    warnings,
    anomalyCount,
    parserKind: 'loose'
  };
}

export function parseHistoryLoose(doc: Document, baseUrl: string = window.location.href): ParseHistoryResult {
  return finalizeParse(doc, parseHistoryLooseBuild(doc), baseUrl);
}

export function parseHistory(doc: Document, baseUrl: string = window.location.href): ParseHistoryResult {
  const strictBuild = parseHistoryStrictBuild(doc);
  if (strictBuild.events.length > 0) {
    return finalizeParse(doc, strictBuild, baseUrl);
  }

  return finalizeParse(doc, parseHistoryLooseBuild(doc), baseUrl);
}
