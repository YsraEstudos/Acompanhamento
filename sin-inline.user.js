// ==UserScript==
// @name         KM SIN Sidebar
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @author       OpenAI Codex
// @description  Exibe o Acompanhamento da SIN inline na página do item do Klassmatt.
// @downloadURL  https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js
// @updateURL    https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js
// @match        *://*.klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        *://*.klassmatt.com.br/*ITEM_Edita.aspx*
// @match        *://klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        *://klassmatt.com.br/*ITEM_Edita.aspx*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  function extractCharsetContentType(contentType = "") {
    const match = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i);
    return match?.[1] ? match[1].trim().toLowerCase() : "";
  }
  function extractCharsetMeta(bytes) {
    try {
      const head = bytes.slice(0, 8192);
      const ascii = new TextDecoder("ascii").decode(head);
      const charsetMeta = ascii.match(/<meta[^>]*charset=["']?\s*([a-z0-9._-]+)/i);
      if (charsetMeta?.[1]) return charsetMeta[1].trim().toLowerCase();
      const equivMeta = ascii.match(/<meta[^>]*http-equiv=["']content-type["'][^>]*content=["'][^"']*charset=([a-z0-9._-]+)/i);
      if (equivMeta?.[1]) return equivMeta[1].trim().toLowerCase();
    } catch {
    }
    return "";
  }
  function normalizeCharsetLabel(charset = "") {
    const value = String(charset || "").toLowerCase();
    if (!value) return "";
    if (value === "latin1") return "iso-8859-1";
    if (value === "cp1252" || value === "windows1252") return "windows-1252";
    return value;
  }
  function decodedTextScore(value = "") {
    const invalid = (value.match(/\uFFFD/g) || []).length;
    const mojibake = (value.match(/Ã.|Â.|â€|â€œ|â€/g) || []).length;
    return invalid * 10 + mojibake;
  }
  function decodeWithCharset(bytes, charset) {
    try {
      const text = new TextDecoder(charset, { fatal: false }).decode(bytes);
      return {
        text,
        score: decodedTextScore(text)
      };
    } catch {
      return null;
    }
  }
  function decodeHttpText(buffer, contentType = "") {
    const bytes = new Uint8Array(buffer);
    const headerCharset = normalizeCharsetLabel(extractCharsetContentType(contentType));
    const metaCharset = normalizeCharsetLabel(extractCharsetMeta(bytes));
    const candidates = Array.from(new Set([
      headerCharset,
      metaCharset,
      "utf-8",
      "windows-1252",
      "iso-8859-1"
    ].filter(Boolean)));
    const [primaryCharset = "utf-8", ...fallbacks] = candidates;
    const primary = decodeWithCharset(bytes, primaryCharset);
    if (!primary) {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    if (primary.score === 0 || fallbacks.length === 0) {
      return primary.text;
    }
    let bestText = primary.text;
    let bestScore = primary.score;
    for (const charset of fallbacks) {
      const decoded = decodeWithCharset(bytes, charset);
      if (!decoded) continue;
      if (decoded.score < bestScore) {
        bestScore = decoded.score;
        bestText = decoded.text;
      }
      if (bestScore === 0) break;
    }
    return bestText || new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  function detectKlassmattErrorPage(doc) {
    const formAction = doc.querySelector("form")?.getAttribute("action") || "";
    if (/Erro\.aspx/i.test(formAction)) {
      const descriptionEl = doc.querySelector("#DivDescricao");
      const descriptionText = descriptionEl?.textContent?.trim() || null;
      const idMatch = descriptionText?.match(/\bID:\s*(\S+)/i);
      return {
        isError: true,
        errorMessage: descriptionText ? descriptionText.slice(0, 500) : "Pagina de erro do Klassmatt.",
        errorId: idMatch?.[1] || null
      };
    }
    const errorDiv = doc.querySelector(".d-error");
    if (errorDiv) {
      const text = errorDiv.textContent || "";
      if (/ACESSO\s+N[ÃA]O\s+AUTORIZADO|exce[çc][ãa]o\s+durante|exception/i.test(text)) {
        return {
          isError: true,
          errorMessage: text.trim().slice(0, 500),
          errorId: null
        };
      }
    }
    return { isError: false, errorMessage: null, errorId: null };
  }
  function isAbortError$1(error) {
    return error instanceof Error && error.name === "AbortError";
  }
  function isHtmlContentType(contentType) {
    if (!contentType) return true;
    return /text\/html|application\/xhtml/i.test(contentType);
  }
  async function fetchHtml(url, signal) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        signal
      });
      if (!response.ok) {
        throw new Error(`Falha HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!isHtmlContentType(contentType)) {
        throw new Error(`Response inesperado: content-type ${contentType || "vazio"}`);
      }
      const buffer = await response.arrayBuffer();
      const html = decodeHttpText(buffer, contentType);
      return {
        html,
        responseUrl: response.url,
        wasRedirected: response.redirected || Boolean(response.url) && response.url !== url,
        contentType
      };
    } catch (error) {
      if (isAbortError$1(error)) throw error;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  function normalizeSpaces(value) {
    return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function stripDiacritics(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function normalizeTextNoAccent(value) {
    return normalizeSpaces(stripDiacritics(value)).toLowerCase();
  }
  function getParamInsensitive(url, name) {
    const expected = name.toLowerCase();
    for (const [key, value] of url.searchParams.entries()) {
      if (key.toLowerCase() !== expected) continue;
      const normalized = normalizeSpaces(value);
      return normalized || null;
    }
    return null;
  }
  function buildFingerprint(url, source, id, somenteLeitura, k) {
    return [
      url.origin.toLowerCase(),
      url.pathname.toLowerCase(),
      source || "sem-source",
      id || "sem-id",
      somenteLeitura || "sem-somente-leitura",
      k || "sem-k"
    ].join("|");
  }
  function maskSecurityToken(token) {
    if (!token) return null;
    return "[redacted]";
  }
  function extractHistoryIdentityFromUrl(rawUrl, baseUrl = window.location.href) {
    const input = String(rawUrl ?? "").trim();
    if (!input) return null;
    try {
      const base = new URL(baseUrl, window.location.href);
      const absolute = new URL(input, baseUrl);
      if (!/\/Historico\.aspx$/i.test(absolute.pathname)) {
        return null;
      }
      if (absolute.origin !== base.origin) {
        return null;
      }
      const source = getParamInsensitive(absolute, "source");
      const id = getParamInsensitive(absolute, "Id");
      const somenteLeitura = getParamInsensitive(absolute, "SomenteLeitura");
      const k = getParamInsensitive(absolute, "k");
      return {
        absoluteUrl: absolute.toString(),
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
  function extractHistoryIdentityFromDocument(doc, baseUrl = window.location.href) {
    for (const form of doc.querySelectorAll("form[action]")) {
      const action = form.getAttribute("action");
      const identity = extractHistoryIdentityFromUrl(action, baseUrl);
      if (identity) return identity;
    }
    return null;
  }
  function formatHistoryIdentity(identity) {
    if (!identity) return "sem-identidade";
    const parts = [
      identity.source ? `source=${identity.source}` : null,
      identity.id ? `Id=${identity.id}` : null,
      identity.somenteLeitura ? `SomenteLeitura=${identity.somenteLeitura}` : null,
      identity.k ? `k=${maskSecurityToken(identity.k)}` : null
    ].filter(Boolean);
    return parts.join(", ") || identity.absoluteUrl;
  }
  function validateHistoryIdentity(expected, actual) {
    const reasons = [];
    if (!expected) {
      reasons.push("O contexto atual nao expoe um link nativo confiavel para o acompanhamento.");
      return { isValid: false, reasons };
    }
    if (!actual) {
      reasons.push("A resposta do historico nao trouxe um form[action] validavel para conferenca.");
      return { isValid: false, reasons };
    }
    if (expected.pathname.toLowerCase() !== actual.pathname.toLowerCase()) {
      reasons.push(`Caminho inesperado no retorno: esperado ${expected.pathname}, recebido ${actual.pathname}.`);
    }
    if (!actual.id) {
      reasons.push("A resposta do historico nao informa o Id da SIN no form[action].");
    } else if (!expected.id) {
      reasons.push("O link nativo do acompanhamento nao informa o Id da SIN.");
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
    } else if (expected.somenteLeitura && actual.somenteLeitura && expected.somenteLeitura !== actual.somenteLeitura) {
      reasons.push(`SomenteLeitura divergente: esperado ${expected.somenteLeitura}, recebido ${actual.somenteLeitura}.`);
    }
    if (expected.k && !actual.k) {
      reasons.push("A resposta do historico perdeu o parametro de seguranca k.");
    } else if (expected.k && actual.k && expected.k !== actual.k) {
      reasons.push("O parametro de seguranca k retornou diferente do link nativo.");
    }
    return {
      isValid: reasons.length === 0,
      reasons
    };
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
  function detectStage(description) {
    const match = description.match(/Solicita[cç][aã]o enviada para\s+(.+)$/i) || description.match(/Solicita.*o enviada para\s+(.+)$/i);
    return match?.[1] ? normalizeSpaces(match[1]).toUpperCase() : null;
  }
  function detectAttentionMatches(description, yellowComments) {
    const combined = [description, ...yellowComments].join(" ");
    const normalizedCombined = normalizeTextNoAccent(combined);
    const rawCombined = normalizeSpaces(combined);
    const matches = new Set();
    for (const match of normalizedCombined.matchAll(/\b(?:ncm|nbs|lei)\b/g)) {
      matches.add(match[0].toUpperCase());
    }
    for (const match of rawCombined.matchAll(new RegExp("(?<!\\d)(?:\\d{4}(?:\\.\\d{2}){2}(?:\\.\\d{2})?|\\d{8,10})(?!\\d)", "g"))) {
      matches.add(match[0]);
    }
    return Array.from(matches);
  }
  function dedupeStrings(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
      const normalized = normalizeSpaces(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  }
  function getStyleSources(element) {
    return [
      element.getAttribute("style") || "",
      element.getAttribute("data-darkreader-inline-bgcolor") || "",
      element.getAttribute("data-darkreader-inline-bg") || "",
      element.getAttribute("data-darkreader-inline-bgimage") || ""
    ].map((value) => normalizeSpaces(value)).filter(Boolean);
  }
  function isYellowHighlightElement(element) {
    return getStyleSources(element).some((value) => YELLOW_STYLE_PATTERNS.some((pattern) => pattern.test(value)));
  }
  function isSignificantNode(node) {
    if (!node) return false;
    if (node instanceof HTMLBRElement) return true;
    if (node.nodeType === Node.TEXT_NODE) {
      return Boolean(normalizeSpaces(node.textContent || ""));
    }
    if (node instanceof Element) {
      return Boolean(normalizeSpaces(node.textContent || ""));
    }
    return false;
  }
  function getPreviousSignificantNode(nodes, index) {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (isSignificantNode(nodes[cursor])) return nodes[cursor];
    }
    return null;
  }
  function getNextSignificantNode(nodes, index) {
    for (let cursor = index + 1; cursor < nodes.length; cursor++) {
      if (isSignificantNode(nodes[cursor])) return nodes[cursor];
    }
    return null;
  }
  function hasLeadContent(nodes, index) {
    for (let cursor = 0; cursor < index; cursor++) {
      const node = nodes[cursor];
      if (node instanceof HTMLBRElement) continue;
      if (node.nodeType === Node.TEXT_NODE && normalizeSpaces(node.textContent || "")) return true;
      if (node instanceof Element && normalizeSpaces(node.textContent || "")) return true;
    }
    return false;
  }
  function getTopLevelYellowHighlights(root) {
    const highlights = Array.from(root.querySelectorAll("*")).filter((element) => {
      return isYellowHighlightElement(element) && Boolean(normalizeSpaces(element.textContent || ""));
    });
    return highlights.filter((candidate) => {
      return !highlights.some((other) => other !== candidate && other.contains(candidate));
    });
  }
  function resolveYellowNoteContainer(element) {
    const text = normalizeSpaces(element.textContent || "");
    if (!text) return null;
    if (isYellowHighlightElement(element)) {
      return element;
    }
    const nestedHighlights = getTopLevelYellowHighlights(element);
    if (nestedHighlights.length !== 1) return null;
    const nestedText = normalizeSpaces(nestedHighlights[0].textContent || "");
    if (!nestedText || nestedText !== text) return null;
    return element;
  }
  function removeAcceptedNotes(root, acceptedNotes) {
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
  function extractYellowNotes(descriptionEl) {
    if (!descriptionEl) {
      return {
        descricao: "",
        descricaoHtml: "",
        yellowComments: [],
        warnings: ["Evento sem span#lblDescricao; nenhuma descricao foi extraida."],
        anomalyCount: 1
      };
    }
    const clone = descriptionEl.cloneNode(true);
    const nodes = Array.from(clone.childNodes);
    const acceptedNotes = [];
    const yellowComments = [];
    const warnings = [];
    let anomalyCount = 0;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (!(node instanceof Element) || node instanceof HTMLBRElement) continue;
      const container = resolveYellowNoteContainer(node);
      if (!container) continue;
      const noteText = normalizeSpaces(container.textContent || "");
      if (!noteText) continue;
      const previous = getPreviousSignificantNode(nodes, index);
      const next = getNextSignificantNode(nodes, index);
      const hasBreakBefore = previous instanceof HTMLBRElement;
      const isTail = next === null;
      const isOnlyContent = previous === null && next === null && !hasLeadContent(nodes, index);
      if (hasBreakBefore || isTail && hasLeadContent(nodes, index) || isOnlyContent) {
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
      warnings.push("Foram encontrados destaques com fundo colorido fora do padrao seguro de comentario amarelo.");
      anomalyCount += unmatchedHighlights.length;
    }
    removeAcceptedNotes(clone, acceptedNotes);
    return {
      descricao: normalizeSpaces(clone.textContent || descriptionEl.textContent || ""),
      descricaoHtml: clone.innerHTML.trim(),
      yellowComments: dedupeStrings(yellowComments),
      warnings: dedupeStrings(warnings),
      anomalyCount
    };
  }
  function consolidate(events) {
    const timeline = [];
    let transitions = 0;
    let yellowEvents = 0;
    for (const event of events) {
      const descricao = normalizeSpaces(event.descricao);
      const yellowComments = Array.isArray(event.yellowComments) ? event.yellowComments.map((item) => normalizeSpaces(item)).filter(Boolean) : [];
      if (!descricao && yellowComments.length === 0) continue;
      const stage = detectStage(descricao);
      const attentionMatches = detectAttentionMatches(descricao, yellowComments);
      if (stage) transitions++;
      if (yellowComments.length > 0) yellowEvents++;
      timeline.push({
        dia: normalizeSpaces(event.dia),
        hora: normalizeSpaces(event.hora),
        usuario: normalizeSpaces(event.usuario || "") || null,
        descricao,
        descricaoHtml: String(event.descricaoHtml || "").trim(),
        stage,
        yellowComments,
        hasAttentionHighlight: attentionMatches.length > 0,
        attentionMatches
      });
    }
    return {
      timeline,
      summary: {
        totalEventos: timeline.length,
        totalTransicoes: transitions,
        totalYellowEvents: yellowEvents
      },
      warnings: [],
      confidence: "low",
      documentIdentity: null,
      anomalyCount: 0,
      parserKind: "strict"
    };
  }
  function finalizeParse(doc, build) {
    const base = consolidate(build.events);
    const documentIdentity = extractHistoryIdentityFromDocument(doc);
    const warnings = [...build.warnings];
    let anomalyCount = build.anomalyCount;
    if (!documentIdentity?.id) {
      warnings.push("O historico retornado nao expôs um form[action] confiavel com Id da SIN.");
      anomalyCount++;
    }
    return {
      ...base,
      warnings: dedupeStrings(warnings),
      confidence: build.parserKind === "strict" && anomalyCount === 0 ? "high" : "low",
      documentIdentity,
      anomalyCount,
      parserKind: build.parserKind
    };
  }
  function parseHistoryStrictBuild(doc) {
    const events = [];
    const warnings = [];
    let anomalyCount = 0;
    for (const fieldset of doc.querySelectorAll("fieldset.hist-fieldset")) {
      const dia = normalizeSpaces(fieldset.querySelector("legend.hist-legend")?.textContent || "");
      if (!dia) {
        warnings.push("Um fieldset do historico nao possui legend.hist-legend identificavel.");
        anomalyCount++;
      }
      let currentUser = null;
      for (const row of fieldset.querySelectorAll(".row")) {
        if (!row.classList.contains("result")) {
          const userLink = row.querySelector('a#hlinkUsuario, a[href*="USUARIO_show"]');
          if (userLink) {
            currentUser = normalizeSpaces(userLink.textContent || "").replace(/\*+$/, "");
          }
          continue;
        }
        const hour = normalizeSpaces(row.querySelector('span[id="lblHora"]')?.textContent || "");
        const descriptionEl = row.querySelector('span[id="lblDescricao"]');
        if (!hour) {
          warnings.push(`Evento do historico sem hora identificavel em ${dia || "dia desconhecido"}.`);
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
      parserKind: "strict"
    };
  }
  function parseHistoryStrict(doc) {
    return finalizeParse(doc, parseHistoryStrictBuild(doc));
  }
  const SETTINGS_KEY = "km_sin_sidebar_settings_v1";
  const SETTINGS_CHANGED_EVENT = "km-sin-sidebar-settings-changed";
  const DEFAULT_SETTINGS = {
    alwaysOpen: true,
    timelineMode: "yellow-only"
  };
  function normalizeTimelineMode(value) {
    return value === "yellow-only" ? "yellow-only" : "all";
  }
  function getAlwaysOpenToggleLabel(alwaysOpen) {
    return alwaysOpen ? "Desativar acompanhamento sempre visivel" : "Ativar acompanhamento sempre visivel";
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return {
        alwaysOpen: parsed.alwaysOpen === true,
        timelineMode: normalizeTimelineMode(parsed.timelineMode)
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    globalThis.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {
      detail: settings
    }));
  }
  const PASSTHROUGH_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "SPAN"]);
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }
  function sanitizeNode(node, baseUrl) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent ?? "");
    }
    if (!(node instanceof Element)) {
      return null;
    }
    const tag = node.tagName.toUpperCase();
    if (tag === "A") {
      const text = normalizeSpaces(node.textContent || "");
      const href = node.getAttribute("href") || "";
      if (!text) return null;
      if (!href || /^javascript:/i.test(href)) {
        return document.createTextNode(text);
      }
      try {
        const url = new URL(href, baseUrl);
        if (!/^https?:$/i.test(url.protocol)) {
          return document.createTextNode(text);
        }
        const anchor = document.createElement("a");
        anchor.href = url.toString();
        anchor.target = "_blank";
        anchor.rel = "noreferrer noopener";
        anchor.textContent = text;
        return anchor;
      } catch {
        return document.createTextNode(text);
      }
    }
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) {
      const sanitizedChild = sanitizeNode(child, baseUrl);
      if (sanitizedChild) fragment.appendChild(sanitizedChild);
    }
    if (!PASSTHROUGH_TAGS.has(tag)) {
      return fragment;
    }
    if (tag === "BR") {
      return document.createElement("br");
    }
    const safeEl = document.createElement(tag.toLowerCase());
    safeEl.appendChild(fragment);
    return safeEl;
  }
  function sanitizeInlineHtml(value, baseUrl = window.location.href) {
    const input = String(value ?? "");
    if (!input.includes("<")) {
      return escapeHtml(input);
    }
    const template = document.createElement("template");
    template.innerHTML = input;
    const container = document.createElement("div");
    for (const child of template.content.childNodes) {
      const sanitized = sanitizeNode(child, baseUrl);
      if (sanitized) container.appendChild(sanitized);
    }
    return container.innerHTML;
  }
  const STYLE_ID = "km-sin-sidebar-style";
  const LAYOUT_SELECTOR = '.km-sin-layout[data-km-sin-root="1"]';
  function ensureHead(doc) {
    if (doc.head) return doc.head;
    const head = doc.createElement("head");
    if (doc.documentElement.firstChild) {
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    } else {
      doc.documentElement.appendChild(head);
    }
    return head;
  }
  function buildInlineSnapshotSrcdoc(rawHtml, baseUrl) {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const head = ensureHead(doc);
    head.querySelector("base")?.remove();
    if (!head.querySelector("meta[charset]")) {
      const charsetMeta = doc.createElement("meta");
      charsetMeta.setAttribute("charset", "utf-8");
      head.prepend(charsetMeta);
    }
    const base = doc.createElement("base");
    base.href = baseUrl;
    head.prepend(base);
    const colorScheme = doc.createElement("meta");
    colorScheme.name = "color-scheme";
    colorScheme.content = "light only";
    head.prepend(colorScheme);
    const darkReaderLock = doc.createElement("meta");
    darkReaderLock.name = "darkreader-lock";
    head.prepend(darkReaderLock);
    const style = doc.createElement("style");
    style.textContent = `
    :root {
      color-scheme: light only !important;
    }

    html, body {
      background: #ffffff !important;
      color: #111827 !important;
    }
  `;
    head.prepend(style);
    return `<!DOCTYPE html>
${doc.documentElement.outerHTML}`;
  }
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = '.km-sin-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,360px);gap:20px;align-items:start;margin-top:12px}.km-sin-layout.km-sin-collapsed{grid-template-columns:minmax(0,1fr)}.km-sin-main,.km-sin-aside{min-width:0;min-height:0}.km-sin-aside[hidden]{display:none!important}.km-sin-card{position:sticky;top:12px;display:flex;flex-direction:column;max-height:calc(100vh - 24px);background:#fff;border:1px solid #d4d8de;border-radius:12px;box-shadow:0 12px 28px rgba(15,23,42,.08);overflow:hidden}.km-sin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid #e7eaee;background:linear-gradient(180deg,#f8fafc 0,#fff 100%)}.km-sin-label{margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#52606d}.km-sin-title{margin:0;font-size:18px;line-height:1.2;color:#1f2937}.km-sin-meta,.km-sin-state{padding:0 16px;color:#52606d;font-size:12px}.km-sin-meta{padding-top:12px}.km-sin-state{padding-top:8px;padding-bottom:8px}.km-sin-state.is-error{color:#b42318}.km-sin-state.is-warning{color:#9a6700}.km-sin-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}.km-sin-link-btn,.km-sin-toggle,.km-sin-mode-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;transition:background 120ms ease,border-color 120ms ease,color 120ms ease}.km-sin-link-btn:hover,.km-sin-toggle:hover,.km-sin-mode-btn:hover{background:#f8fafc;border-color:#94a3b8}.km-sin-link-btn:disabled{cursor:default;opacity:.65}.km-sin-mode-btn{border-color:#bfd7ff;color:#0f4c81;background:#eef6ff}.km-sin-mode-btn[data-mode="yellow-only"]{background:#fff4e5;border-color:#f5c67a;color:#8a4b08}.km-sin-body{flex:1 1 auto;min-height:0;padding:12px 16px 16px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable;touch-action:pan-y}.km-sin-empty{padding:14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;color:#52606d;font-size:13px}.km-sin-empty-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.km-sin-banner{margin-bottom:12px;padding:12px 14px;border-radius:10px;background:#fff4e5;border:1px solid #f5c67a;color:#8a4b08;font-size:13px}.km-sin-group+.km-sin-group{margin-top:16px}.km-sin-day{margin:0 0 10px;font-size:13px;font-weight:700;color:#334155}.km-sin-list,.km-sin-notes{display:grid;gap:10px}.km-sin-item{border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:12px}.km-sin-item.is-attention{border-color:#f1a4a4;background:linear-gradient(180deg,#fff6f6 0,#fffdfd 100%);box-shadow:inset 0 0 0 1px rgba(185,28,28,.08)}.km-sin-item-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;font-size:12px;color:#64748b}.km-sin-time{font-weight:700;color:#334155}.km-sin-stage,.km-sin-attention-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-weight:700;font-size:11px;text-transform:uppercase}.km-sin-stage{background:#e2e8f0;color:#334155}.km-sin-attention-chip{background:#fee2e2;color:#b42318;border:1px solid #f5b4b4}.km-sin-desc{color:#1f2937;font-size:13px;line-height:1.5;word-break:break-word}.km-sin-desc a{color:#0f4c81}.km-sin-notes{margin-top:10px;gap:8px}.km-sin-note{padding:9px 10px;border-radius:9px;background:#fff7bf;border:1px solid #e6d665;color:#6a5600;font-size:12px;line-height:1.45;font-weight:600}.km-sin-frame{width:100%;min-height:70vh;border:1px solid #d4d8de;border-radius:10px;background:#fff;color-scheme:light;forced-color-adjust:none}.km-sin-inline-toggle{display:inline-flex;align-items:center;margin-left:8px}.km-sin-toggle[aria-pressed=true]{background:#0f4c81;border-color:#0f4c81;color:#fff}@media (max-width:1360px){.km-sin-layout{grid-template-columns:minmax(0,1fr)}.km-sin-card{position:relative;top:0;max-height:none}.km-sin-body{max-height:none}}';
    document.head.appendChild(style);
  }
  function ensureShell(viewRoot) {
    let existing = null;
    for (const child of viewRoot.children) {
      if (child instanceof HTMLElement && child.matches(LAYOUT_SELECTOR)) {
        existing = child;
        break;
      }
    }
    if (existing) {
      const mainEl2 = existing.querySelector(".km-sin-main");
      const asideEl2 = existing.querySelector(".km-sin-aside");
      const metaEl2 = existing.querySelector(".km-sin-meta");
      const stateEl2 = existing.querySelector(".km-sin-state");
      const bodyEl2 = existing.querySelector(".km-sin-body");
      const inlineButton2 = existing.querySelector('[data-role="inline"]');
      const modeButton2 = existing.querySelector('[data-role="mode"]');
      if (mainEl2 && asideEl2 && metaEl2 && stateEl2 && bodyEl2 && inlineButton2 && modeButton2) {
        return { layoutEl: existing, mainEl: mainEl2, asideEl: asideEl2, metaEl: metaEl2, stateEl: stateEl2, bodyEl: bodyEl2, inlineButton: inlineButton2, modeButton: modeButton2 };
      }
      existing.remove();
    }
    const layoutEl = document.createElement("div");
    layoutEl.className = "km-sin-layout";
    layoutEl.dataset.kmSinRoot = "1";
    const mainEl = document.createElement("div");
    mainEl.className = "km-sin-main";
    const asideEl = document.createElement("aside");
    asideEl.className = "km-sin-aside";
    const card = document.createElement("section");
    card.className = "km-sin-card";
    const head = document.createElement("div");
    head.className = "km-sin-head";
    const titleWrap = document.createElement("div");
    const label = document.createElement("p");
    label.className = "km-sin-label";
    label.textContent = "Klassmatt";
    const title = document.createElement("h2");
    title.className = "km-sin-title";
    title.textContent = "Acompanhamento da SIN";
    titleWrap.append(label, title);
    const actions = document.createElement("div");
    actions.className = "km-sin-actions";
    const inlineButton = document.createElement("button");
    inlineButton.type = "button";
    inlineButton.className = "km-sin-link-btn";
    inlineButton.dataset.role = "inline";
    inlineButton.textContent = "Ver inline";
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.className = "km-sin-mode-btn";
    modeButton.dataset.role = "mode";
    modeButton.textContent = "Tudo";
    actions.append(inlineButton, modeButton);
    head.append(titleWrap, actions);
    const metaEl = document.createElement("div");
    metaEl.className = "km-sin-meta";
    const stateEl = document.createElement("div");
    stateEl.className = "km-sin-state";
    const bodyEl = document.createElement("div");
    bodyEl.className = "km-sin-body";
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
  function renderEmpty(shell, message) {
    const node = document.createElement("div");
    node.className = "km-sin-empty";
    node.textContent = message;
    shell.bodyEl.replaceChildren(node);
  }
  function setShellState(shell, text, tone = "default") {
    shell.stateEl.textContent = text;
    shell.stateEl.classList.remove("is-warning", "is-error");
    if (tone === "warning") shell.stateEl.classList.add("is-warning");
    if (tone === "error") shell.stateEl.classList.add("is-error");
  }
  function setShellMeta(shell, text) {
    shell.metaEl.textContent = text;
  }
  function buildEventNode(event, historyUrl) {
    const item = document.createElement("article");
    item.className = "km-sin-item";
    if (event.hasAttentionHighlight) item.classList.add("is-attention");
    const meta = document.createElement("div");
    meta.className = "km-sin-item-meta";
    meta.innerHTML = `
    <span class="km-sin-time">${escapeHtml(event.hora || "Sem hora")}</span>
    <span>${escapeHtml(event.usuario || "Usuário não identificado")}</span>
    ${event.stage ? `<span class="km-sin-stage">${escapeHtml(event.stage)}</span>` : ""}
    ${event.hasAttentionHighlight ? `<span class="km-sin-attention-chip">Destaque</span>` : ""}
  `;
    const desc = document.createElement("div");
    desc.className = "km-sin-desc";
    const html = event.descricaoHtml ? sanitizeInlineHtml(event.descricaoHtml, historyUrl) : escapeHtml(event.descricao);
    desc.innerHTML = html || escapeHtml(event.descricao);
    item.append(meta, desc);
    if (event.yellowComments.length > 0) {
      const notes = document.createElement("div");
      notes.className = "km-sin-notes";
      for (const comment of event.yellowComments) {
        const note = document.createElement("div");
        note.className = "km-sin-note";
        note.textContent = comment;
        notes.appendChild(note);
      }
      item.appendChild(notes);
    }
    return item;
  }
  function renderTimeline(shell, model) {
    const fragment = document.createDocumentFragment();
    if (model.diagnostic) {
      const banner = document.createElement("div");
      banner.className = "km-sin-banner";
      banner.textContent = model.diagnostic;
      fragment.appendChild(banner);
    }
    let currentDay = "";
    let list = null;
    for (const event of model.timeline) {
      if (event.dia !== currentDay) {
        currentDay = event.dia;
        const section = document.createElement("section");
        section.className = "km-sin-group";
        const heading = document.createElement("h3");
        heading.className = "km-sin-day";
        heading.textContent = currentDay || "Sem data";
        list = document.createElement("div");
        list.className = "km-sin-list";
        section.append(heading, list);
        fragment.appendChild(section);
      }
      list?.appendChild(buildEventNode(event, model.historyUrl));
    }
    if (model.onLoadMore && typeof model.totalCount === "number" && model.timeline.length < model.totalCount) {
      const actions = document.createElement("div");
      actions.className = "km-sin-empty-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "km-sin-link-btn";
      button.dataset.act = "load-more";
      button.textContent = `Carregar mais (${model.timeline.length}/${model.totalCount})`;
      button.onclick = model.onLoadMore;
      actions.appendChild(button);
      fragment.appendChild(actions);
    }
    shell.bodyEl.replaceChildren(fragment);
  }
  function renderIframeFallbackPrompt(shell, diagnostic, onDemandLoad) {
    const fragment = document.createDocumentFragment();
    if (diagnostic) {
      const banner = document.createElement("div");
      banner.className = "km-sin-banner";
      banner.textContent = diagnostic;
      fragment.appendChild(banner);
    }
    const empty = document.createElement("div");
    empty.className = "km-sin-empty";
    empty.textContent = "Nao foi possivel interpretar o HTML deste historico. Se precisar, carregue o fallback inline manualmente.";
    const actions = document.createElement("div");
    actions.className = "km-sin-empty-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "km-sin-link-btn";
    button.dataset.act = "load-fallback";
    button.textContent = "Carregar fallback inline";
    button.onclick = () => {
      button.disabled = true;
      onDemandLoad();
    };
    actions.appendChild(button);
    empty.appendChild(actions);
    fragment.appendChild(empty);
    shell.bodyEl.replaceChildren(fragment);
  }
  function renderIframeFallback(shell, url, diagnostic, rawHtml, baseUrl) {
    const fragment = document.createDocumentFragment();
    if (diagnostic) {
      const banner = document.createElement("div");
      banner.className = "km-sin-banner";
      banner.textContent = diagnostic;
      fragment.appendChild(banner);
    }
    const iframe = document.createElement("iframe");
    iframe.className = "km-sin-frame";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute("sandbox", "");
    iframe.setAttribute("data-darkreader-ignore", "");
    iframe.setAttribute("data-darkreader-skip", "");
    iframe.title = "Historico da SIN (isolado)";
    if (rawHtml) {
      iframe.src = "about:blank";
      iframe.srcdoc = buildInlineSnapshotSrcdoc(rawHtml, baseUrl || url);
    } else {
      iframe.src = url;
    }
    fragment.appendChild(iframe);
    shell.bodyEl.replaceChildren(fragment);
  }
  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return false;
    const style = (element.getAttribute("style") || "").toLowerCase();
    if (/\bdisplay\s*:\s*none\b/.test(style)) return false;
    if (/\bvisibility\s*:\s*hidden\b/.test(style)) return false;
    return true;
  }
  function getCandidateScore(element, extras = {}) {
    let score = 0;
    if (isElementVisible(element)) score += 100;
    if (extras.hasLink) score += 30;
    if (extras.hasSummaryLabel) score += 20;
    if (element.closest(".km-sin-main")) score += 10;
    return score;
  }
  function pickBestElement(candidates, scorer) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      const score = scorer(candidate) + index / 1e3;
      if (score >= bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }
  function absolutizeUrl(url) {
    try {
      return new URL(String(url ?? ""), window.location.href).toString();
    } catch {
      return null;
    }
  }
  function extractUrlFromJsFunction(href, functionNames) {
    const raw = String(href ?? "");
    if (!raw) return null;
    for (const name of functionNames) {
      const matcher = new RegExp(`${name}\\s*\\(\\s*['"]([^'"]+)['"]`, "i");
      const match = raw.match(matcher);
      if (match?.[1]) {
        return absolutizeUrl(match[1]);
      }
    }
    const genericOpen = raw.match(/open[\w]*\s*\(\s*['"]([^'"]+)['"]/i);
    if (genericOpen?.[1]) return absolutizeUrl(genericOpen[1]);
    return null;
  }
  function extractHistoryUrlFromHref(href) {
    return extractUrlFromJsFunction(href, ["OpenWindowsWHR", "OpenWindowsWHRNS", "OpenNewTab"]);
  }
  function extractHistoryIdentityFromHref(href) {
    const url = extractHistoryUrlFromHref(href);
    return extractHistoryIdentityFromUrl(url);
  }
  function findHistoryLink(root) {
    const directCandidates = Array.from(root.querySelectorAll("#hButAcompanhamentoSIN, #hlkObs"));
    const direct = pickBestElement(directCandidates, (anchor) => getCandidateScore(anchor, { hasLink: true }));
    if (direct) return direct;
    const namedCandidates = [];
    for (const anchor of root.querySelectorAll("a")) {
      if (normalizeTextNoAccent(anchor.textContent).includes("acompanhamento")) {
        namedCandidates.push(anchor);
      }
    }
    return pickBestElement(namedCandidates, (anchor) => getCandidateScore(anchor, { hasLink: true }));
  }
  function extractItemId(root) {
    const candidates = Array.from(root.querySelectorAll('#txtNumero, input[name$="txtNumero"]'));
    const fromField = pickBestElement(candidates, (input) => getCandidateScore(input));
    return fromField?.value ? normalizeSpaces(fromField.value) : null;
  }
  function extractSinIdFromSummary(summaryEl) {
    if (!summaryEl) return null;
    const infoText = summaryEl.querySelector("#Label_infoSIN")?.textContent || "";
    const infoMatch = infoText.match(/\bSIN:\s*(\d+)/i);
    return infoMatch?.[1] ? infoMatch[1] : null;
  }
  function findBestViewRoot() {
    const candidates = Array.from(document.querySelectorAll("#UpdatePanel1 .kl-view, .kl-view"));
    return pickBestElement(candidates, (element) => getCandidateScore(element, {
      hasLink: Boolean(element.querySelector("#hButAcompanhamentoSIN, #hlkObs")),
      hasSummaryLabel: Boolean(element.querySelector("#Label_infoSIN"))
    }));
  }
  function findBestSummary(scope) {
    const candidates = Array.from(scope.querySelectorAll("#DV_Resumo_sin"));
    return pickBestElement(candidates, (element) => getCandidateScore(element, {
      hasLink: Boolean(findHistoryLink(element)),
      hasSummaryLabel: Boolean(element.querySelector("#Label_infoSIN"))
    }));
  }
  function findQuickViewRoot() {
    return document.querySelector("#UpdatePanel1 .kl-view, .kl-view");
  }
  function findQuickSummary(scope) {
    return scope.querySelector("#DV_Resumo_sin");
  }
  function findDirectHistoryLink(root) {
    return root.querySelector("#hButAcompanhamentoSIN, #hlkObs");
  }
  function resolvePageContext() {
    const viewRoot = findBestViewRoot();
    const scope = viewRoot ?? document;
    const summaryEl = findBestSummary(scope);
    const linkEl = summaryEl ? findHistoryLink(summaryEl) || findHistoryLink(scope) : findHistoryLink(scope);
    const itemId = extractItemId(scope);
    const historyIdentity = linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute("href")) : null;
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
  function resolveQuickPageContext() {
    const viewRoot = findQuickViewRoot();
    const scope = viewRoot ?? document;
    const summaryEl = findQuickSummary(scope);
    const linkEl = summaryEl ? findDirectHistoryLink(summaryEl) || findDirectHistoryLink(scope) : findDirectHistoryLink(scope);
    const historyIdentity = linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute("href")) : null;
    return {
      historyUrl: historyIdentity?.absoluteUrl || null,
      historyIdentity,
      sinId: historyIdentity?.id || extractSinIdFromSummary(summaryEl),
      viewRoot,
      summaryEl,
      linkEl
    };
  }
  const RENDER_BATCH_SIZE = 30;
  function resolveRefreshMode(options) {
    return options.refreshMode ?? "manual";
  }
  function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
  }
  function getPageWindow() {
    return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  }
  function getSafeHistoryUrl(rawUrl) {
    return extractHistoryIdentityFromUrl(rawUrl)?.absoluteUrl || null;
  }
  function buildBlockedDiagnostic(title, reasons, expectedIdentity, actualIdentity) {
    const parts = [
      title,
      ...reasons,
      expectedIdentity ? `Esperado: ${formatHistoryIdentity(expectedIdentity)}.` : "",
      actualIdentity ? `Retornado: ${formatHistoryIdentity(actualIdentity)}.` : ""
    ].filter(Boolean);
    return parts.join(" ");
  }
  function classifyErrorForUser(error, wasRedirected) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (/falha http 401|falha http 403/i.test(msg)) {
        return {
          diagnostic: "O Klassmatt recusou o acesso ao historico.",
          actionHint: "Recarregue a pagina (F5) para renovar a sessao."
        };
      }
      if (/falha http 5\d\d/i.test(msg)) {
        return {
          diagnostic: "O servidor do Klassmatt retornou um erro interno.",
          actionHint: "Recarregue a pagina (F5) ou feche e abra o painel novamente quando quiser tentar."
        };
      }
      if (/network|fetch|econnreset|econnrefused|socket/i.test(msg)) {
        return {
          diagnostic: "Falha de conexao com o servidor.",
          actionHint: "Verifique sua rede e, depois, reabra o painel ou recarregue a pagina (F5)."
        };
      }
      if (/timeout/i.test(msg)) {
        return {
          diagnostic: "O servidor demorou demais para responder.",
          actionHint: "Feche e abra o painel novamente para tentar de novo."
        };
      }
      if (/content-type/i.test(msg)) {
        return {
          diagnostic: "O servidor retornou um conteudo inesperado (nao HTML).",
          actionHint: "Use o botao Ver inline para abrir o historico em iframe."
        };
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostic: `Falha ao buscar ou interpretar o historico: ${message}`,
      actionHint: "Feche e abra o painel novamente para tentar de novo."
    };
  }
  class SinSidebarApp {
    options;
    cache = new Map();
    inflight = new Map();
    settings = loadSettings();
    destroyAspNet = null;
    destroyContextEvents = null;
    loadSerial = 0;
    activeFetch = null;
    activeFetchKey = null;
    currentShell = null;
    currentViewRoot = null;
    currentContext = null;
    latestParsed = null;
    latestResult = null;
    renderedCount = 0;
    panelOpen = this.settings.alwaysOpen;
    toggleHost = null;
    toggleButton = null;
    toggleParent = null;
    handleToggleClick = () => {
      const nextSettings = {
        ...this.settings,
        alwaysOpen: !this.settings.alwaysOpen
      };
      saveSettings(nextSettings);
      this.applySettings(nextSettings);
    };
    handleModeToggleClick = () => {
      this.settings = {
        ...this.settings,
        timelineMode: this.settings.timelineMode === "all" ? "yellow-only" : "all"
      };
      saveSettings(this.settings);
      if (!this.currentShell) return;
      this.syncModeButton(this.currentShell);
      this.renderedCount = 0;
      this.renderStoredTimeline(this.currentShell);
    };
    handleInlineRender = () => {
      const context = this.currentContext ?? resolvePageContext();
      const shell = this.currentShell;
      const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl);
      if (shell && safeHistoryUrl) {
        this.abortActiveFetch();
        setShellState(shell, "Exibindo historico nativo (iframe)...", "default");
        renderIframeFallback(
          shell,
          safeHistoryUrl,
          void 0,
          this.latestResult?.inlineHtml,
          this.latestResult?.inlineBaseUrl
        );
        return;
      }
      if (shell) {
        setShellState(shell, "Historico bloqueado por origem inesperada.", "warning");
        renderEmpty(shell, "O link do historico foi bloqueado por seguranca porque aponta para uma origem inesperada.");
      }
    };
    handleLoadMoreClick = () => {
      const shell = this.resolveConnectedShell();
      if (!shell || !this.latestParsed) return;
      const visibleTimeline = this.getVisibleTimeline();
      this.renderedCount = Math.min(this.renderedCount + RENDER_BATCH_SIZE, visibleTimeline.length);
      this.renderStoredTimeline(shell);
    };
    handleStorageEvent = (event) => {
      const storageEvent = event;
      if (storageEvent.key !== null && storageEvent.key !== SETTINGS_KEY) return;
      this.applySettings(loadSettings());
    };
    handlePageLifecycleEvent = (event) => {
      if (event?.type === "pageshow") {
        const pageShowEvent = event;
        if (!pageShowEvent.persisted) {
          return;
        }
      }
      this.syncSettingsFromStorage();
      if (this.panelOpen) {
        void this.hydrate(true);
        return;
      }
      this.syncClosedState();
    };
    constructor(options = {}) {
      this.options = {
        refreshMode: resolveRefreshMode(options),
        hookAspNet: options.hookAspNet ?? true
      };
    }
    init() {
      injectStyles();
      this.destroyContextEvents = this.bindContextEvents();
      if (this.options.hookAspNet) this.destroyAspNet = this.bindAspNetEndRequest();
      if (this.panelOpen) {
        void this.hydrate(true);
        return;
      }
      this.syncClosedState();
    }
    destroy() {
      this.loadSerial++;
      this.panelOpen = false;
      this.currentContext = null;
      if (this.destroyAspNet) this.destroyAspNet();
      if (this.destroyContextEvents) this.destroyContextEvents();
      this.abortActiveFetch();
      this.removeInlineToggle();
      this.clearParsedState();
    }
    applySettings(nextSettings) {
      const alwaysOpenChanged = nextSettings.alwaysOpen !== this.settings.alwaysOpen;
      const modeChanged = nextSettings.timelineMode !== this.settings.timelineMode;
      if (!alwaysOpenChanged && !modeChanged) return;
      const wasOpen = this.panelOpen;
      this.settings = nextSettings;
      this.panelOpen = nextSettings.alwaysOpen;
      this.syncInlineToggle(resolveQuickPageContext());
      if (!this.panelOpen) {
        if (wasOpen) {
          this.closePanel();
          return;
        }
        this.syncClosedState();
        return;
      }
      if (!wasOpen) {
        void this.hydrate(true);
        return;
      }
      if (!this.currentShell) {
        void this.hydrate(true);
        return;
      }
      this.syncModeButton(this.currentShell);
      if (modeChanged && this.latestParsed) {
        this.renderedCount = 0;
        this.renderStoredTimeline(this.currentShell);
      }
    }
    async hydrate(force = false) {
      const serial = ++this.loadSerial;
      this.syncSettingsFromStorage();
      this.pruneDisconnectedShell();
      const quickContext = resolveQuickPageContext();
      this.syncInlineToggle(quickContext);
      if (!this.panelOpen) {
        this.hideCurrentSidebar();
        return;
      }
      const initialContext = resolvePageContext();
      const confirmedContext = await this.confirmTrustedContext(initialContext, serial);
      if (serial !== this.loadSerial || !this.panelOpen) return;
      const context = confirmedContext ?? initialContext;
      if (!context.viewRoot) {
        this.hideCurrentSidebar();
        return;
      }
      const shell = this.ensureCurrentShell(context.viewRoot);
      this.bindShellActions(shell);
      this.syncModeButton(shell);
      this.setAsideVisible(shell, true);
      if (!context.summaryEl) {
        this.abortActiveFetch();
        this.clearParsedState();
        shell.inlineButton.disabled = true;
        setShellMeta(shell, "Aguardando area de resumo da SIN");
        setShellState(shell, "A tela ainda nao expôs o resumo da SIN nesta atualizacao.", "warning");
        renderEmpty(shell, "Espere a pagina terminar de atualizar e, se precisar, feche e abra o painel quando o resumo reaparecer.");
        return;
      }
      const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl);
      shell.inlineButton.disabled = !Boolean(safeHistoryUrl);
      if (!context.historyIdentity?.absoluteUrl) {
        this.abortActiveFetch();
        this.clearParsedState();
        setShellMeta(
          shell,
          context.itemId ? `Item ${context.itemId} • aguardando link nativo` : "Aguardando link nativo do acompanhamento"
        );
        setShellState(shell, "Modo leve: sem link nativo confiavel.", "warning");
        renderEmpty(shell, "O painel so busca o acompanhamento quando o link nativo estiver visivel nesta tela.");
        return;
      }
      if (!confirmedContext || !context.isStable) {
        this.abortActiveFetch();
        this.clearParsedState();
        setShellMeta(
          shell,
          context.sinId ? `SIN ${context.sinId} • aguardando consistencia` : "Aguardando consistencia da SIN"
        );
        setShellState(shell, "O contexto ainda nao ficou consistente nesta atualizacao.", "warning");
        renderEmpty(shell, "Aguarde o proximo refresh da pagina ou feche e abra o painel quando a tela estabilizar.");
        return;
      }
      this.currentContext = confirmedContext;
      setShellMeta(
        shell,
        confirmedContext.sinId ? `SIN ${confirmedContext.sinId} • historico sob demanda` : "Historico do item carregado sob demanda"
      );
      setShellState(shell, "Carregando historico...", "default");
      renderEmpty(shell, "Buscando o conteudo de Acompanhamento da SIN...");
      let result;
      try {
        result = await this.getHistoryResult(confirmedContext, force);
      } catch (error) {
        if (serial !== this.loadSerial || isAbortError(error)) return;
        const message = error instanceof Error ? error.message : String(error);
        result = {
          mode: "error",
          timeline: [],
          diagnostic: `Falha ao buscar ou interpretar o historico: ${message}`
        };
      }
      if (serial !== this.loadSerial || !this.panelOpen) return;
      this.renderResult(shell, confirmedContext, result);
    }
    renderResult(shell, context, result) {
      const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl) || window.location.href;
      this.latestResult = result;
      if (result.mode === "parsed" && result.summary) {
        const parsedResult = result;
        this.latestParsed = {
          allTimeline: parsedResult.timeline,
          yellowTimeline: parsedResult.timeline.filter((event) => event.yellowComments.length > 0),
          historyUrl: safeHistoryUrl,
          result: parsedResult
        };
        this.renderedCount = 0;
        this.renderStoredTimeline(shell);
        return;
      }
      this.clearParsedState();
      if (result.mode === "session-error") {
        setShellState(shell, "Sessao expirada ou acesso negado.", "error");
        const message = [result.diagnostic, result.actionHint].filter(Boolean).join(" ");
        renderEmpty(shell, message || "A sessao do Klassmatt expirou. Recarregue a pagina (F5).");
        return;
      }
      if (result.mode === "blocked" && getSafeHistoryUrl(context.historyUrl)) {
        setShellState(shell, "Historico bloqueado por seguranca.", "warning");
        renderIframeFallbackPrompt(shell, result.diagnostic, () => {
          setShellState(shell, "Carregando fallback inline...", "warning");
          renderIframeFallback(
            shell,
            safeHistoryUrl,
            result.diagnostic,
            result.inlineHtml,
            result.inlineBaseUrl
          );
        });
        return;
      }
      if (result.mode === "empty") {
        setShellState(shell, "Nenhum evento encontrado no historico.", "warning");
        renderEmpty(shell, result.diagnostic || "O historico nao trouxe eventos para este item.");
        return;
      }
      if (result.mode === "iframe" && getSafeHistoryUrl(context.historyUrl)) {
        setShellState(shell, "Formato nao reconhecido. Fallback disponivel sob demanda.", "warning");
        renderIframeFallbackPrompt(shell, result.diagnostic, () => {
          setShellState(shell, "Carregando fallback inline...", "warning");
          renderIframeFallback(
            shell,
            safeHistoryUrl,
            result.diagnostic,
            result.inlineHtml,
            result.inlineBaseUrl
          );
        });
        return;
      }
      const displayMsg = [result.diagnostic, result.actionHint].filter(Boolean).join(" ");
      setShellState(shell, result.diagnostic || "Falha ao carregar o historico.", "error");
      renderEmpty(shell, displayMsg || "Nao foi possivel renderizar o acompanhamento.");
    }
    renderStoredTimeline(shell) {
      if (!this.latestParsed) return;
      const visibleTimeline = this.getVisibleTimeline();
      if (visibleTimeline.length === 0) {
        setShellState(shell, "Nenhum comentario amarelo encontrado.", "warning");
        renderEmpty(shell, "Ative o modo Tudo para ver o acompanhamento completo deste item.");
        return;
      }
      if (this.renderedCount === 0) {
        this.renderedCount = Math.min(RENDER_BATCH_SIZE, visibleTimeline.length);
      } else {
        this.renderedCount = Math.min(this.renderedCount, visibleTimeline.length);
      }
      const renderedTimeline = visibleTimeline.slice(0, this.renderedCount);
      setShellState(shell, this.buildTimelineSummary(renderedTimeline.length, visibleTimeline.length), "default");
      renderTimeline(shell, {
        historyUrl: this.latestParsed.historyUrl,
        diagnostic: this.latestParsed.result.diagnostic,
        timeline: renderedTimeline,
        loadedCount: renderedTimeline.length,
        totalCount: visibleTimeline.length,
        onLoadMore: renderedTimeline.length < visibleTimeline.length ? this.handleLoadMoreClick : null
      });
    }
    async getHistoryResult(context, force = false) {
      const historyUrl = getSafeHistoryUrl(context.historyUrl);
      if (!historyUrl) {
        return {
          mode: "blocked",
          timeline: [],
          diagnostic: "O link do historico aponta para uma origem inesperada ou nao confiavel.",
          actionHint: "Recarregue a pagina (F5) e confirme que o link nativo da SIN esta correto."
        };
      }
      const cacheKey = this.getHistoryCacheKey(context);
      if (force) {
        this.cache.delete(cacheKey);
        this.purgeStaleCacheEntries(context.itemId, cacheKey);
      }
      if (!force && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
      if (!force && this.inflight.has(cacheKey)) {
        return this.inflight.get(cacheKey);
      }
      const task = (async () => {
        try {
          if (this.activeFetch && (force || this.activeFetchKey !== cacheKey)) {
            this.abortActiveFetch();
          }
          this.activeFetch = new AbortController();
          this.activeFetchKey = cacheKey;
          const fetchResult = await fetchHtml(historyUrl, this.activeFetch.signal);
          if (fetchResult.wasRedirected && !/Historico\.aspx/i.test(fetchResult.responseUrl)) {
            this.cache.delete(cacheKey);
            return {
              mode: "session-error",
              timeline: [],
              diagnostic: /Erro\.aspx|Login\.aspx|default\.aspx/i.test(fetchResult.responseUrl) ? "O Klassmatt redirecionou para uma pagina de erro ou login." : `O servidor redirecionou para ${fetchResult.responseUrl}.`,
              actionHint: "A sessao pode ter expirado. Recarregue a pagina (F5)."
            };
          }
          const doc = new DOMParser().parseFromString(fetchResult.html, "text/html");
          const errorCheck = detectKlassmattErrorPage(doc);
          if (errorCheck.isError) {
            this.cache.delete(cacheKey);
            return {
              mode: "session-error",
              timeline: [],
              diagnostic: /ACESSO\s+N[ÃA]O\s+AUTORIZADO/i.test(errorCheck.errorMessage || "") ? "Acesso nao autorizado ao historico." : `O Klassmatt retornou uma pagina de erro: ${(errorCheck.errorMessage || "Erro desconhecido").slice(0, 200)}`,
              actionHint: "Recarregue a pagina (F5) ou feche e abra o painel novamente quando quiser tentar de novo."
            };
          }
          const parsed = parseHistoryStrict(doc);
          const inlineBaseUrl = fetchResult.responseUrl || historyUrl;
          const identityValidation = validateHistoryIdentity(context.historyIdentity, parsed.documentIdentity);
          if (!identityValidation.isValid) {
            return {
              mode: "blocked",
              timeline: [],
              diagnostic: buildBlockedDiagnostic(
                "Historico bloqueado por divergencia entre o link nativo e o HTML retornado.",
                identityValidation.reasons,
                context.historyIdentity,
                parsed.documentIdentity || null
              ),
              actionHint: "Use o botao Ver inline para conferir a pagina nativa.",
              summary: parsed.summary,
              warnings: [...identityValidation.reasons, ...parsed.warnings],
              confidence: "low",
              documentIdentity: parsed.documentIdentity,
              inlineHtml: fetchResult.html,
              inlineBaseUrl
            };
          }
          if (parsed.confidence !== "high") {
            return {
              mode: "blocked",
              timeline: [],
              diagnostic: buildBlockedDiagnostic(
                "Historico bloqueado por baixa confianca do parser estrito.",
                parsed.warnings,
                context.historyIdentity,
                parsed.documentIdentity || null
              ),
              actionHint: "O formato do historico pode ter mudado. Use o botao Ver inline.",
              summary: parsed.summary,
              warnings: parsed.warnings,
              confidence: parsed.confidence,
              documentIdentity: parsed.documentIdentity,
              inlineHtml: fetchResult.html,
              inlineBaseUrl
            };
          }
          const result = parsed.timeline.length > 0 ? {
            mode: "parsed",
            timeline: parsed.timeline,
            summary: parsed.summary,
            warnings: parsed.warnings,
            confidence: parsed.confidence,
            documentIdentity: parsed.documentIdentity,
            inlineHtml: fetchResult.html,
            inlineBaseUrl
          } : {
            mode: "empty",
            timeline: [],
            diagnostic: "O popup foi carregado, mas nao continha eventos reconheciveis.",
            actionHint: "Use o botao Ver inline para verificar.",
            summary: parsed.summary,
            warnings: parsed.warnings,
            confidence: parsed.confidence,
            documentIdentity: parsed.documentIdentity,
            inlineHtml: fetchResult.html,
            inlineBaseUrl
          };
          this.cache.set(cacheKey, result);
          this.purgeStaleCacheEntries(context.itemId, cacheKey);
          return result;
        } catch (error) {
          if (isAbortError(error)) throw error;
          const classified = classifyErrorForUser(error);
          return {
            mode: historyUrl ? "iframe" : "error",
            timeline: [],
            diagnostic: classified.diagnostic,
            actionHint: classified.actionHint
          };
        } finally {
          if (this.activeFetchKey === cacheKey) {
            this.activeFetch = null;
            this.activeFetchKey = null;
          }
          this.inflight.delete(cacheKey);
        }
      })();
      this.inflight.set(cacheKey, task);
      return task;
    }
    ensureCurrentShell(viewRoot) {
      if (this.currentShell && this.currentViewRoot === viewRoot && this.currentShell.layoutEl.isConnected) {
        return this.currentShell;
      }
      this.currentShell = ensureShell(viewRoot);
      this.currentViewRoot = viewRoot;
      return this.currentShell;
    }
    resolveConnectedShell() {
      this.pruneDisconnectedShell();
      if (this.currentShell?.layoutEl.isConnected) {
        return this.currentShell;
      }
      const viewRoot = this.currentContext?.viewRoot?.isConnected ? this.currentContext.viewRoot : resolvePageContext().viewRoot;
      if (!viewRoot) return null;
      return this.ensureCurrentShell(viewRoot);
    }
    bindShellActions(shell) {
      shell.inlineButton.onclick = this.handleInlineRender;
      shell.modeButton.onclick = this.handleModeToggleClick;
    }
    syncModeButton(shell) {
      const mode = this.settings.timelineMode;
      shell.modeButton.dataset.mode = mode;
      shell.modeButton.textContent = mode === "all" ? "Tudo" : "Amarelos";
      shell.modeButton.title = mode === "all" ? "Clique para mostrar somente os comentarios amarelos" : "Clique para mostrar todo o acompanhamento";
    }
    setAsideVisible(shell, visible) {
      shell.asideEl.hidden = !visible;
      shell.layoutEl.classList.toggle("km-sin-collapsed", !visible);
    }
    abortActiveFetch() {
      if (this.activeFetch) {
        this.activeFetch.abort();
      }
      this.activeFetch = null;
      this.activeFetchKey = null;
    }
    async confirmTrustedContext(context, serial) {
      if (context.isStable && context.historyIdentity?.fingerprint) {
        return context;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, 140);
      });
      if (serial !== this.loadSerial || !this.panelOpen) return null;
      const secondRead = resolvePageContext();
      return secondRead.isStable && Boolean(secondRead.historyIdentity?.fingerprint) ? secondRead : null;
    }
    syncInlineToggle(context = resolveQuickPageContext()) {
      const parent = context.linkEl?.parentElement ?? null;
      if (!parent || !context.linkEl) {
        this.removeInlineToggle();
        return;
      }
      if (this.toggleHost && (!this.toggleHost.isConnected || this.toggleParent !== parent)) {
        this.removeInlineToggle();
      }
      if (!this.toggleHost || !this.toggleButton) {
        this.toggleHost = document.createElement("span");
        this.toggleHost.className = "km-sin-inline-toggle";
        this.toggleButton = document.createElement("button");
        this.toggleButton.type = "button";
        this.toggleButton.className = "km-sin-toggle";
        this.toggleButton.addEventListener("click", this.handleToggleClick);
        this.toggleHost.appendChild(this.toggleButton);
      }
      this.toggleParent = parent;
      if (this.toggleHost.previousElementSibling !== context.linkEl || this.toggleHost.parentElement !== parent) {
        context.linkEl.insertAdjacentElement("afterend", this.toggleHost);
      }
      const label = getAlwaysOpenToggleLabel(this.settings.alwaysOpen);
      this.toggleButton.textContent = label;
      this.toggleButton.setAttribute("aria-pressed", this.settings.alwaysOpen ? "true" : "false");
      this.toggleButton.title = label;
    }
    removeInlineToggle() {
      if (this.toggleHost?.isConnected) {
        this.toggleHost.remove();
      }
      this.toggleHost = null;
      this.toggleButton = null;
      this.toggleParent = null;
    }
    syncClosedState() {
      this.pruneDisconnectedShell();
      this.syncInlineToggle(resolveQuickPageContext());
      if (!this.panelOpen) {
        this.hideCurrentSidebar();
      }
    }
    closePanel() {
      this.panelOpen = false;
      this.loadSerial++;
      this.abortActiveFetch();
      this.clearParsedState();
      this.currentContext = null;
      this.hideCurrentSidebar(true);
      this.syncInlineToggle(resolveQuickPageContext());
    }
    hideCurrentSidebar(clearBody = false) {
      if (this.currentShell?.layoutEl.isConnected) {
        if (clearBody) {
          this.currentShell.bodyEl.replaceChildren();
        }
        this.currentShell.inlineButton.disabled = true;
        this.currentShell.asideEl.hidden = true;
        this.currentShell.layoutEl.classList.add("km-sin-collapsed");
      }
      if (this.currentShell && !this.currentShell.layoutEl.isConnected) {
        this.currentShell = null;
        this.currentViewRoot = null;
      }
    }
    pruneDisconnectedShell() {
      if (this.currentShell && !this.currentShell.layoutEl.isConnected) {
        this.currentShell = null;
        this.currentViewRoot = null;
        this.currentContext = null;
      }
    }
    bindContextEvents() {
      window.addEventListener("storage", this.handleStorageEvent);
      window.addEventListener("pageshow", this.handlePageLifecycleEvent);
      return () => {
        window.removeEventListener("storage", this.handleStorageEvent);
        window.removeEventListener("pageshow", this.handlePageLifecycleEvent);
      };
    }
    bindAspNetEndRequest() {
      let disposed = false;
      let intervalId = 0;
      let handler = null;
      let manager = null;
      const deadline = Date.now() + 8e3;
      intervalId = window.setInterval(() => {
        if (disposed || Date.now() > deadline) {
          window.clearInterval(intervalId);
          return;
        }
        const maybeManager = getPageWindow().Sys?.WebForms?.PageRequestManager?.getInstance?.();
        if (!maybeManager) return;
        window.clearInterval(intervalId);
        manager = maybeManager;
        handler = this.handlePageLifecycleEvent;
        manager.add_endRequest(handler);
      }, 250);
      return () => {
        disposed = true;
        if (intervalId) window.clearInterval(intervalId);
        if (manager && handler) {
          try {
            manager.remove_endRequest(handler);
          } catch {
          }
        }
      };
    }
    getHistoryCacheKey(context) {
      return [
        context.itemId || "sem-item",
        context.historyIdentity?.fingerprint || context.historyUrl || "sem-historico"
      ].join("|");
    }
    syncSettingsFromStorage() {
      const storedSettings = loadSettings();
      this.settings = storedSettings;
      this.panelOpen = storedSettings.alwaysOpen;
    }
    clearParsedState() {
      this.latestParsed = null;
      this.latestResult = null;
      this.renderedCount = 0;
    }
    getVisibleTimeline() {
      if (!this.latestParsed) return [];
      return this.settings.timelineMode === "yellow-only" ? this.latestParsed.yellowTimeline : this.latestParsed.allTimeline;
    }
    buildTimelineSummary(loadedCount, totalVisible) {
      if (!this.latestParsed) return "Historico carregado.";
      if (this.settings.timelineMode === "yellow-only") {
        return loadedCount < totalVisible ? `Exibindo ${loadedCount} de ${totalVisible} evento(s) com comentario amarelo` : `Exibindo ${totalVisible} evento(s) com comentario amarelo`;
      }
      const totalEventos = this.latestParsed.result.summary.totalEventos;
      const totalYellowEvents = this.latestParsed.result.summary.totalYellowEvents;
      if (loadedCount < totalVisible) {
        return totalYellowEvents > 0 ? `Exibindo ${loadedCount} de ${totalEventos} evento(s) (${totalYellowEvents} com amarelo)` : `Exibindo ${loadedCount} de ${totalEventos} evento(s) da SIN`;
      }
      return totalYellowEvents > 0 ? `Exibindo ${totalEventos} evento(s) (${totalYellowEvents} com amarelo)` : `Exibindo todos os ${totalEventos} evento(s) da SIN`;
    }
    purgeStaleCacheEntries(itemId, keepKey) {
      if (!itemId) return;
      const prefix = `${itemId}|`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix) && key !== keepKey) {
          this.cache.delete(key);
        }
      }
    }
  }
  const SUPPORTED_ITEM_PATHS = [
    /\/SIN_Item_Edita\.aspx$/i,
    /\/ITEM_Edita\.aspx$/i
  ];
  const CONTEXT_HINT_SELECTOR = "#UpdatePanel1, .kl-view, #DV_Resumo_sin, #hlkObs, #hButAcompanhamentoSIN";
  function isSupportedItemPath(pathname) {
    return SUPPORTED_ITEM_PATHS.some((pattern) => pattern.test(String(pathname || "")));
  }
  function shouldBootstrapSinSidebar(pathname = window.location.pathname, doc = document) {
    if (!isSupportedItemPath(pathname)) return false;
    return Boolean(doc.querySelector(CONTEXT_HINT_SELECTOR));
  }
  let app = null;
  let alwaysOpenMenuId = null;
  function unregisterAlwaysOpenMenu() {
    if (alwaysOpenMenuId === null || typeof GM_unregisterMenuCommand !== "function") return;
    GM_unregisterMenuCommand(alwaysOpenMenuId);
    alwaysOpenMenuId = null;
  }
  function syncAlwaysOpenMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    unregisterAlwaysOpenMenu();
    const settings = loadSettings();
    const label = getAlwaysOpenToggleLabel(settings.alwaysOpen);
    alwaysOpenMenuId = GM_registerMenuCommand(label, () => {
      const currentSettings = loadSettings();
      const nextSettings = {
        ...currentSettings,
        alwaysOpen: !currentSettings.alwaysOpen
      };
      saveSettings(nextSettings);
      app?.applySettings(nextSettings);
      syncAlwaysOpenMenu();
    });
  }
  function handleStorageEvent(event) {
    const storageEvent = event;
    if (storageEvent.key !== null && storageEvent.key !== SETTINGS_KEY) return;
    syncAlwaysOpenMenu();
  }
  function handleSettingsChanged() {
    syncAlwaysOpenMenu();
  }
  function start() {
    if (!shouldBootstrapSinSidebar()) return;
    app = new SinSidebarApp();
    app.init();
  }
  syncAlwaysOpenMenu();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  globalThis.addEventListener("storage", handleStorageEvent);
  globalThis.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  globalThis.addEventListener("beforeunload", () => {
    globalThis.removeEventListener("storage", handleStorageEvent);
    globalThis.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    unregisterAlwaysOpenMenu();
    app?.destroy();
  }, { once: true });

})();