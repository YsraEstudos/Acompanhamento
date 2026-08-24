// ==UserScript==
// @name         KM Acompanhamento
// @namespace    http://tampermonkey.net/
// @version      1.0.17
// @author       Ysrael Xavier
// @description  Exibe o KM Acompanhamento inline na pagina do item do Klassmatt.
// @downloadURL  https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/1.0.17/sin-inline.user.js
// @updateURL    https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.meta.js
// @match        https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://*.klassmatt.com.br/*ITEM_Edita.aspx*
// @match        https://klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://klassmatt.com.br/*ITEM_Edita.aspx*
// @connect      *.klassmatt.com.br
// @connect      klassmatt.com.br
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
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
  function resolveAbsoluteUrl(rawUrl, fallbackUrl) {
    return new URL(rawUrl || fallbackUrl, fallbackUrl);
  }
  function isNetworkFetchError(error) {
    if (!(error instanceof Error)) return false;
    return /failed to fetch|networkerror|network request failed/i.test(error.message);
  }
  function getAbortError() {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  function parseTampermonkeyHeaders(rawHeaders = "") {
    const headers = new Headers();
    for (const line of rawHeaders.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return headers;
  }
  function fetchWithTampermonkey(requestedUrl, signal) {
    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (signal?.aborted) {
      return Promise.reject(getAbortError());
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let request = null;
      let handleAbort = () => void 0;
      const cleanup = () => {
        signal?.removeEventListener("abort", handleAbort);
      };
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      handleAbort = () => {
        if (settled) return;
        request?.abort();
        settle(() => reject(getAbortError()));
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        request = GM_xmlhttpRequest({
          method: "GET",
          url: requestedUrl.toString(),
          responseType: "arraybuffer",
          timeout: 3e4,
          onload: (response) => {
            settle(() => {
              try {
                const responseUrl = response.finalUrl || requestedUrl.toString();
                resolve({
                  response: new Response(response.response, {
                    status: response.status,
                    headers: parseTampermonkeyHeaders(response.responseHeaders)
                  }),
                  responseUrl,
                  wasRedirected: responseUrl !== requestedUrl.toString()
                });
              } catch (error) {
                reject(error);
              }
            });
          },
          onerror: () => settle(() => reject(new TypeError("Failed to fetch"))),
          ontimeout: () => settle(() => reject(new Error("Network timeout"))),
          onabort: () => settle(() => reject(getAbortError()))
        });
        if (signal?.aborted) handleAbort();
      } catch (error) {
        settle(() => reject(error));
      }
    });
  }
  async function fetchResponse(requestedUrl, signal) {
    try {
      const response = await fetch(requestedUrl.toString(), {
        credentials: "include",
        cache: "no-store",
        signal
      });
      return {
        response,
        responseUrl: response.url || requestedUrl.toString(),
        wasRedirected: response.redirected
      };
    } catch (error) {
      if (isAbortError$1(error)) throw error;
      const pageOrigin = new URL(window.location.href).origin;
      if (!isNetworkFetchError(error) || requestedUrl.origin !== pageOrigin) {
        throw error;
      }
      return fetchWithTampermonkey(requestedUrl, signal);
    }
  }
  async function fetchHtml(url, signal) {
    const requestedUrl = resolveAbsoluteUrl(url, window.location.href);
    try {
      const transport = await fetchResponse(requestedUrl, signal);
      const response = transport.response;
      if (!response.ok) {
        throw new Error(`Falha HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!isHtmlContentType(contentType)) {
        throw new Error(`Response inesperado: content-type ${contentType || "vazio"}`);
      }
      const buffer = await response.arrayBuffer();
      const html = decodeHttpText(buffer, contentType);
      const responseUrl = resolveAbsoluteUrl(
        transport.responseUrl || requestedUrl.toString(),
        requestedUrl.toString()
      );
      if (responseUrl.origin !== requestedUrl.origin) {
        throw new Error(`Redirecionamento bloqueado para origem inesperada: ${responseUrl.origin}`);
      }
      return {
        html,
        responseUrl: responseUrl.toString(),
        wasRedirected: transport.wasRedirected || responseUrl.toString() !== requestedUrl.toString(),
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
      const absolute = new URL(input, base);
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
    if (expected.origin.toLowerCase() !== actual.origin.toLowerCase()) {
      reasons.push(`Origem divergente: esperado ${expected.origin}, recebido ${actual.origin}.`);
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
  const VALID_NCM_PREFIXES = [
    "0101",
    "0102",
    "0103",
    "0104",
    "0105",
    "0106",
    "0201",
    "0202",
    "0203",
    "0204",
    "0205",
    "0206",
    "0207",
    "0208",
    "0209",
    "0210",
    "0301",
    "0302",
    "0303",
    "0304",
    "0305",
    "0306",
    "0307",
    "0308",
    "0309",
    "0401",
    "0402",
    "0403",
    "0404",
    "0405",
    "0406",
    "0407",
    "0408",
    "0409",
    "0410",
    "0501",
    "0502",
    "0504",
    "0505",
    "0506",
    "0507",
    "0508",
    "0510",
    "0511",
    "0601",
    "0602",
    "0603",
    "0604",
    "0701",
    "0702",
    "0703",
    "0704",
    "0705",
    "0706",
    "0707",
    "0708",
    "0709",
    "0710",
    "0711",
    "0712",
    "0713",
    "0714",
    "0801",
    "0802",
    "0803",
    "0804",
    "0805",
    "0806",
    "0807",
    "0808",
    "0809",
    "0810",
    "0811",
    "0812",
    "0813",
    "0814",
    "0901",
    "0902",
    "0903",
    "0904",
    "0905",
    "0906",
    "0907",
    "0908",
    "0909",
    "0910",
    "1001",
    "1002",
    "1003",
    "1004",
    "1005",
    "1006",
    "1007",
    "1008",
    "1101",
    "1102",
    "1103",
    "1104",
    "1105",
    "1106",
    "1107",
    "1108",
    "1109",
    "1201",
    "1202",
    "1203",
    "1204",
    "1205",
    "1206",
    "1207",
    "1208",
    "1209",
    "1210",
    "1211",
    "1212",
    "1213",
    "1214",
    "1301",
    "1302",
    "1401",
    "1404",
    "1501",
    "1502",
    "1503",
    "1504",
    "1505",
    "1506",
    "1507",
    "1508",
    "1509",
    "1510",
    "1511",
    "1512",
    "1513",
    "1514",
    "1515",
    "1516",
    "1517",
    "1518",
    "1520",
    "1521",
    "1522",
    "1601",
    "1602",
    "1603",
    "1604",
    "1605",
    "1701",
    "1702",
    "1703",
    "1704",
    "1801",
    "1802",
    "1803",
    "1804",
    "1805",
    "1806",
    "1901",
    "1902",
    "1903",
    "1904",
    "1905",
    "2001",
    "2002",
    "2003",
    "2004",
    "2005",
    "2006",
    "2007",
    "2008",
    "2009",
    "2101",
    "2102",
    "2103",
    "2104",
    "2105",
    "2106",
    "2201",
    "2202",
    "2203",
    "2204",
    "2205",
    "2206",
    "2207",
    "2208",
    "2209",
    "2301",
    "2302",
    "2303",
    "2304",
    "2305",
    "2306",
    "2307",
    "2308",
    "2309",
    "2401",
    "2402",
    "2403",
    "2404",
    "2501",
    "2502",
    "2503",
    "2504",
    "2505",
    "2506",
    "2507",
    "2508",
    "2509",
    "2510",
    "2511",
    "2512",
    "2513",
    "2514",
    "2515",
    "2516",
    "2517",
    "2518",
    "2519",
    "2520",
    "2521",
    "2522",
    "2523",
    "2524",
    "2525",
    "2526",
    "2528",
    "2529",
    "2530",
    "2601",
    "2602",
    "2603",
    "2604",
    "2605",
    "2606",
    "2607",
    "2608",
    "2609",
    "2610",
    "2611",
    "2612",
    "2613",
    "2614",
    "2615",
    "2616",
    "2617",
    "2618",
    "2619",
    "2620",
    "2621",
    "2701",
    "2702",
    "2703",
    "2704",
    "2705",
    "2706",
    "2707",
    "2708",
    "2709",
    "2710",
    "2711",
    "2712",
    "2713",
    "2714",
    "2715",
    "2716",
    "2801",
    "2802",
    "2803",
    "2804",
    "2805",
    "2806",
    "2807",
    "2808",
    "2809",
    "2810",
    "2811",
    "2812",
    "2813",
    "2814",
    "2815",
    "2816",
    "2817",
    "2818",
    "2819",
    "2820",
    "2821",
    "2822",
    "2823",
    "2824",
    "2825",
    "2826",
    "2827",
    "2828",
    "2829",
    "2830",
    "2831",
    "2832",
    "2833",
    "2834",
    "2835",
    "2836",
    "2837",
    "2839",
    "2840",
    "2841",
    "2842",
    "2843",
    "2844",
    "2845",
    "2846",
    "2847",
    "2849",
    "2850",
    "2852",
    "2853",
    "2901",
    "2902",
    "2903",
    "2904",
    "2905",
    "2906",
    "2907",
    "2908",
    "2909",
    "2910",
    "2911",
    "2912",
    "2913",
    "2914",
    "2915",
    "2916",
    "2917",
    "2918",
    "2919",
    "2920",
    "2921",
    "2922",
    "2923",
    "2924",
    "2925",
    "2926",
    "2927",
    "2928",
    "2929",
    "2930",
    "2931",
    "2932",
    "2933",
    "2934",
    "2935",
    "2936",
    "2937",
    "2938",
    "2939",
    "2940",
    "2941",
    "2942",
    "3001",
    "3002",
    "3003",
    "3004",
    "3005",
    "3006",
    "3101",
    "3102",
    "3103",
    "3104",
    "3105",
    "3201",
    "3202",
    "3203",
    "3204",
    "3205",
    "3206",
    "3207",
    "3208",
    "3209",
    "3210",
    "3211",
    "3212",
    "3213",
    "3214",
    "3215",
    "3301",
    "3302",
    "3303",
    "3304",
    "3305",
    "3306",
    "3307",
    "3401",
    "3402",
    "3403",
    "3404",
    "3405",
    "3406",
    "3407",
    "3501",
    "3502",
    "3503",
    "3504",
    "3505",
    "3506",
    "3507",
    "3601",
    "3602",
    "3603",
    "3604",
    "3605",
    "3606",
    "3701",
    "3702",
    "3703",
    "3704",
    "3705",
    "3706",
    "3707",
    "3801",
    "3802",
    "3803",
    "3804",
    "3805",
    "3806",
    "3807",
    "3808",
    "3809",
    "3810",
    "3811",
    "3812",
    "3813",
    "3814",
    "3815",
    "3816",
    "3817",
    "3818",
    "3819",
    "3820",
    "3821",
    "3822",
    "3823",
    "3824",
    "3825",
    "3826",
    "3827",
    "3901",
    "3902",
    "3903",
    "3904",
    "3905",
    "3906",
    "3907",
    "3908",
    "3909",
    "3910",
    "3911",
    "3912",
    "3913",
    "3914",
    "3915",
    "3916",
    "3917",
    "3918",
    "3919",
    "3920",
    "3921",
    "3922",
    "3923",
    "3924",
    "3925",
    "3926",
    "4001",
    "4002",
    "4003",
    "4004",
    "4005",
    "4006",
    "4007",
    "4008",
    "4009",
    "4010",
    "4011",
    "4012",
    "4013",
    "4014",
    "4015",
    "4016",
    "4017",
    "4101",
    "4102",
    "4103",
    "4104",
    "4105",
    "4106",
    "4107",
    "4112",
    "4113",
    "4114",
    "4115",
    "4201",
    "4202",
    "4203",
    "4205",
    "4206",
    "4301",
    "4302",
    "4303",
    "4304",
    "4401",
    "4402",
    "4403",
    "4404",
    "4405",
    "4406",
    "4407",
    "4408",
    "4409",
    "4410",
    "4411",
    "4412",
    "4413",
    "4414",
    "4415",
    "4416",
    "4417",
    "4418",
    "4419",
    "4420",
    "4421",
    "4501",
    "4502",
    "4503",
    "4504",
    "4601",
    "4602",
    "4701",
    "4702",
    "4703",
    "4704",
    "4705",
    "4706",
    "4707",
    "4801",
    "4802",
    "4803",
    "4804",
    "4805",
    "4806",
    "4807",
    "4808",
    "4809",
    "4810",
    "4811",
    "4812",
    "4813",
    "4814",
    "4816",
    "4817",
    "4818",
    "4819",
    "4820",
    "4821",
    "4822",
    "4823",
    "4901",
    "4902",
    "4903",
    "4904",
    "4905",
    "4906",
    "4907",
    "4908",
    "4909",
    "4910",
    "4911",
    "5001",
    "5002",
    "5003",
    "5004",
    "5005",
    "5006",
    "5007",
    "5101",
    "5102",
    "5103",
    "5104",
    "5105",
    "5106",
    "5107",
    "5108",
    "5109",
    "5110",
    "5111",
    "5112",
    "5113",
    "5201",
    "5202",
    "5203",
    "5204",
    "5205",
    "5206",
    "5207",
    "5208",
    "5209",
    "5210",
    "5211",
    "5212",
    "5301",
    "5302",
    "5303",
    "5305",
    "5306",
    "5307",
    "5308",
    "5309",
    "5310",
    "5311",
    "5401",
    "5402",
    "5403",
    "5404",
    "5405",
    "5406",
    "5407",
    "5408",
    "5501",
    "5502",
    "5503",
    "5504",
    "5505",
    "5506",
    "5507",
    "5508",
    "5509",
    "5510",
    "5511",
    "5512",
    "5513",
    "5514",
    "5515",
    "5516",
    "5601",
    "5602",
    "5603",
    "5604",
    "5605",
    "5606",
    "5607",
    "5608",
    "5609",
    "5701",
    "5702",
    "5703",
    "5704",
    "5705",
    "5801",
    "5802",
    "5803",
    "5804",
    "5805",
    "5806",
    "5807",
    "5808",
    "5809",
    "5810",
    "5811",
    "5901",
    "5902",
    "5903",
    "5904",
    "5905",
    "5906",
    "5907",
    "5908",
    "5909",
    "5910",
    "5911",
    "6001",
    "6002",
    "6003",
    "6004",
    "6005",
    "6006",
    "6101",
    "6102",
    "6103",
    "6104",
    "6105",
    "6106",
    "6107",
    "6108",
    "6109",
    "6110",
    "6111",
    "6112",
    "6113",
    "6114",
    "6115",
    "6116",
    "6117",
    "6201",
    "6202",
    "6203",
    "6204",
    "6205",
    "6206",
    "6207",
    "6208",
    "6209",
    "6210",
    "6211",
    "6212",
    "6213",
    "6214",
    "6215",
    "6216",
    "6217",
    "6301",
    "6302",
    "6303",
    "6304",
    "6305",
    "6306",
    "6307",
    "6308",
    "6309",
    "6310",
    "6401",
    "6402",
    "6403",
    "6404",
    "6405",
    "6406",
    "6501",
    "6502",
    "6504",
    "6505",
    "6506",
    "6507",
    "6601",
    "6602",
    "6603",
    "6701",
    "6702",
    "6703",
    "6704",
    "6801",
    "6802",
    "6803",
    "6804",
    "6805",
    "6806",
    "6807",
    "6808",
    "6809",
    "6810",
    "6811",
    "6812",
    "6813",
    "6814",
    "6815",
    "6901",
    "6902",
    "6903",
    "6904",
    "6905",
    "6906",
    "6907",
    "6909",
    "6910",
    "6911",
    "6912",
    "6913",
    "6914",
    "7001",
    "7002",
    "7003",
    "7004",
    "7005",
    "7006",
    "7007",
    "7008",
    "7009",
    "7010",
    "7011",
    "7013",
    "7014",
    "7015",
    "7016",
    "7017",
    "7018",
    "7019",
    "7020",
    "7101",
    "7102",
    "7103",
    "7104",
    "7105",
    "7106",
    "7107",
    "7108",
    "7109",
    "7110",
    "7111",
    "7112",
    "7113",
    "7114",
    "7115",
    "7116",
    "7117",
    "7118",
    "7201",
    "7202",
    "7203",
    "7204",
    "7205",
    "7206",
    "7207",
    "7208",
    "7209",
    "7210",
    "7211",
    "7212",
    "7213",
    "7214",
    "7215",
    "7216",
    "7217",
    "7218",
    "7219",
    "7220",
    "7221",
    "7222",
    "7223",
    "7224",
    "7225",
    "7226",
    "7227",
    "7228",
    "7229",
    "7301",
    "7302",
    "7303",
    "7304",
    "7305",
    "7306",
    "7307",
    "7308",
    "7309",
    "7310",
    "7311",
    "7312",
    "7313",
    "7314",
    "7315",
    "7316",
    "7317",
    "7318",
    "7319",
    "7320",
    "7321",
    "7322",
    "7323",
    "7324",
    "7325",
    "7326",
    "7401",
    "7402",
    "7403",
    "7404",
    "7405",
    "7406",
    "7407",
    "7408",
    "7409",
    "7410",
    "7411",
    "7412",
    "7413",
    "7415",
    "7418",
    "7419",
    "7501",
    "7502",
    "7503",
    "7504",
    "7505",
    "7506",
    "7507",
    "7508",
    "7601",
    "7602",
    "7603",
    "7604",
    "7605",
    "7606",
    "7607",
    "7608",
    "7609",
    "7610",
    "7611",
    "7612",
    "7613",
    "7614",
    "7615",
    "7616",
    "7801",
    "7802",
    "7804",
    "7806",
    "7901",
    "7902",
    "7903",
    "7904",
    "7905",
    "7907",
    "8001",
    "8002",
    "8003",
    "8007",
    "8101",
    "8102",
    "8103",
    "8104",
    "8105",
    "8106",
    "8108",
    "8109",
    "8110",
    "8111",
    "8112",
    "8113",
    "8201",
    "8202",
    "8203",
    "8204",
    "8205",
    "8206",
    "8207",
    "8208",
    "8209",
    "8210",
    "8211",
    "8212",
    "8213",
    "8214",
    "8215",
    "8301",
    "8302",
    "8303",
    "8304",
    "8305",
    "8306",
    "8307",
    "8308",
    "8309",
    "8310",
    "8311",
    "8401",
    "8402",
    "8403",
    "8404",
    "8405",
    "8406",
    "8407",
    "8408",
    "8409",
    "8410",
    "8411",
    "8412",
    "8413",
    "8414",
    "8415",
    "8416",
    "8417",
    "8418",
    "8419",
    "8420",
    "8421",
    "8422",
    "8423",
    "8424",
    "8425",
    "8426",
    "8427",
    "8428",
    "8429",
    "8430",
    "8431",
    "8432",
    "8433",
    "8434",
    "8435",
    "8436",
    "8437",
    "8438",
    "8439",
    "8440",
    "8441",
    "8442",
    "8443",
    "8444",
    "8445",
    "8446",
    "8447",
    "8448",
    "8449",
    "8450",
    "8451",
    "8452",
    "8453",
    "8454",
    "8455",
    "8456",
    "8457",
    "8458",
    "8459",
    "8460",
    "8461",
    "8462",
    "8463",
    "8464",
    "8465",
    "8466",
    "8467",
    "8468",
    "8470",
    "8471",
    "8472",
    "8473",
    "8474",
    "8475",
    "8476",
    "8477",
    "8478",
    "8479",
    "8480",
    "8481",
    "8482",
    "8483",
    "8484",
    "8485",
    "8486",
    "8487",
    "8501",
    "8502",
    "8503",
    "8504",
    "8505",
    "8506",
    "8507",
    "8508",
    "8509",
    "8510",
    "8511",
    "8512",
    "8513",
    "8514",
    "8515",
    "8516",
    "8517",
    "8518",
    "8519",
    "8521",
    "8522",
    "8523",
    "8524",
    "8525",
    "8526",
    "8527",
    "8528",
    "8529",
    "8530",
    "8531",
    "8532",
    "8533",
    "8534",
    "8535",
    "8536",
    "8537",
    "8538",
    "8539",
    "8540",
    "8541",
    "8542",
    "8543",
    "8544",
    "8545",
    "8546",
    "8547",
    "8548",
    "8549",
    "8601",
    "8602",
    "8603",
    "8604",
    "8605",
    "8606",
    "8607",
    "8608",
    "8609",
    "8701",
    "8702",
    "8703",
    "8704",
    "8705",
    "8706",
    "8707",
    "8708",
    "8709",
    "8710",
    "8711",
    "8712",
    "8713",
    "8714",
    "8715",
    "8716",
    "8801",
    "8802",
    "8804",
    "8805",
    "8806",
    "8807",
    "8901",
    "8902",
    "8903",
    "8904",
    "8905",
    "8906",
    "8907",
    "8908",
    "9001",
    "9002",
    "9003",
    "9004",
    "9005",
    "9006",
    "9007",
    "9008",
    "9010",
    "9011",
    "9012",
    "9013",
    "9014",
    "9015",
    "9016",
    "9017",
    "9018",
    "9019",
    "9020",
    "9021",
    "9022",
    "9023",
    "9024",
    "9025",
    "9026",
    "9027",
    "9028",
    "9029",
    "9030",
    "9031",
    "9032",
    "9033",
    "9101",
    "9102",
    "9103",
    "9104",
    "9105",
    "9106",
    "9107",
    "9108",
    "9109",
    "9110",
    "9111",
    "9112",
    "9113",
    "9114",
    "9201",
    "9202",
    "9205",
    "9206",
    "9207",
    "9208",
    "9209",
    "9301",
    "9302",
    "9303",
    "9304",
    "9305",
    "9306",
    "9307",
    "9401",
    "9402",
    "9403",
    "9404",
    "9405",
    "9406",
    "9503",
    "9504",
    "9505",
    "9506",
    "9507",
    "9508",
    "9601",
    "9602",
    "9603",
    "9604",
    "9605",
    "9606",
    "9607",
    "9608",
    "9609",
    "9610",
    "9611",
    "9612",
    "9613",
    "9614",
    "9615",
    "9616",
    "9617",
    "9618",
    "9619",
    "9620",
    "9701",
    "9702",
    "9703",
    "9704",
    "9705",
    "9706"
  ];
  const VALID_NBS_PREFIXES = [
    "10101",
    "10102",
    "10103",
    "10104",
    "10105",
    "10106",
    "10107",
    "10201",
    "10202",
    "10203",
    "10204",
    "10205",
    "10301",
    "10302",
    "10303",
    "10304",
    "10401",
    "10402",
    "10403",
    "10404",
    "10405",
    "10501",
    "10502",
    "10503",
    "10504",
    "10505",
    "10506",
    "10601",
    "10602",
    "10603",
    "10604",
    "10605",
    "10606",
    "10607",
    "10608",
    "10609",
    "10701",
    "10702",
    "10703",
    "10801",
    "10802",
    "10803",
    "10901",
    "10902",
    "10903",
    "10904",
    "10905",
    "10906",
    "10907",
    "10908",
    "10909",
    "10910",
    "10911",
    "11001",
    "11002",
    "11101",
    "11102",
    "11103",
    "11104",
    "11105",
    "11106",
    "11107",
    "11108",
    "11109",
    "11110",
    "11201",
    "11202",
    "11203",
    "11301",
    "11302",
    "11303",
    "11304",
    "11401",
    "11402",
    "11403",
    "11404",
    "11405",
    "11406",
    "11407",
    "11408",
    "11409",
    "11410",
    "11411",
    "11412",
    "11413",
    "11414",
    "11415",
    "11501",
    "11502",
    "11503",
    "11504",
    "11505",
    "11506",
    "11507",
    "11508",
    "11509",
    "11510",
    "11701",
    "11702",
    "11703",
    "11704",
    "11705",
    "11706",
    "11801",
    "11802",
    "11803",
    "11804",
    "11805",
    "11806",
    "11901",
    "11902",
    "11903",
    "12001",
    "12002",
    "12003",
    "12101",
    "12201",
    "12202",
    "12203",
    "12204",
    "12205",
    "12301",
    "12302",
    "12303",
    "12304",
    "12401",
    "12402",
    "12403",
    "12404",
    "12405",
    "12406",
    "12407",
    "12501",
    "12502",
    "12503",
    "12504",
    "12505",
    "12506",
    "12507",
    "12508",
    "12601",
    "12602",
    "12603",
    "12604",
    "12605",
    "12606"
  ];
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
  const VALID_NCM_PREFIX_SET = new Set(VALID_NCM_PREFIXES);
  const VALID_NBS_PREFIX_SET = new Set(VALID_NBS_PREFIXES);
  function normalizeCodeDigits(value) {
    return value.replace(/\D+/g, "");
  }
  function isValidNcmCandidate(value) {
    const digits = normalizeCodeDigits(value);
    if (digits.length < 8) return false;
    return VALID_NCM_PREFIX_SET.has(digits.slice(0, 4));
  }
  function isValidNbsCandidate(value) {
    const digits = normalizeCodeDigits(value);
    if (digits.length < 9) return false;
    if (digits[0] !== "1") return false;
    return VALID_NBS_PREFIX_SET.has(digits.slice(0, 5));
  }
  function hasCaseReferencePrefix(value, index) {
    const before = value.slice(Math.max(0, index - 4), index);
    return /ca\s*#$/i.test(before);
  }
  function detectStage(description) {
    const match = description.match(/Solicita[cç][aã]o enviada para\s+(.+)$/i) || description.match(/Solicita.*o enviada para\s+(.+)$/i);
    return match?.[1] ? normalizeSpaces(match[1]).toUpperCase() : null;
  }
  function detectAttentionMatches(description, yellowComments) {
    const combined = [description, ...yellowComments].join(" ");
    const normalizedCombined = normalizeTextNoAccent(combined);
    const rawCombined = normalizeSpaces(combined);
    const matches = new Set();
    for (const match of normalizedCombined.matchAll(/\blei\b/g)) {
      matches.add(match[0].toUpperCase());
    }
    for (const match of rawCombined.matchAll(/(ncm|nbs)?\s*[:=.-]?\s*(\d[\d.\s/-]{6,}\d)/gi)) {
      const rawCode = normalizeSpaces(match[2]);
      const label = normalizeSpaces(match[1] || "").toUpperCase();
      const codeIndex = match.index === void 0 ? -1 : match.index + match[0].indexOf(match[2]);
      if (!label && codeIndex >= 0 && hasCaseReferencePrefix(rawCombined, codeIndex)) {
        continue;
      }
      if (label === "NBS") {
        if (isValidNbsCandidate(rawCode)) {
          matches.add("NBS");
          matches.add(rawCode);
        }
        continue;
      }
      if (label === "NCM" || !label) {
        if (isValidNcmCandidate(rawCode)) {
          matches.add("NCM");
          matches.add(rawCode);
        }
      }
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
  function buildTimelineSummary(timeline) {
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
  function extractCreatedItemId(event) {
    const normalized = normalizeTextNoAccent(event.descricao);
    const match = normalized.match(/\bcriado\s+o\s+item\s+n\W*(\d{3,})\b/i);
    return match?.[1] || null;
  }
  function describeDetectedItemIds(itemIds, currentItemId) {
    const others = itemIds.filter((value) => value !== currentItemId);
    if (others.length === 0) return `item ${currentItemId}`;
    if (others.length === 1) return `item ${currentItemId} e ignorar o item ${others[0]}`;
    return `item ${currentItemId} e ignorar os itens ${others.join(", ")}`;
  }
  function scopeTimelineToItem(timeline, currentItemId) {
    const normalizedItemId = normalizeSpaces(currentItemId || "").match(/\d+/)?.[0] || "";
    const baseSummary = buildTimelineSummary(timeline);
    if (!normalizedItemId || timeline.length === 0) {
      return {
        status: "unscoped",
        timeline,
        summary: baseSummary,
        detectedItemIds: []
      };
    }
    const markers = timeline.map((event, index) => {
      const itemId = extractCreatedItemId(event);
      return itemId ? { index, itemId } : null;
    }).filter((value) => Boolean(value));
    const detectedItemIds = dedupeStrings(markers.map((marker) => marker.itemId));
    if (markers.length === 0) {
      return {
        status: "unscoped",
        timeline,
        summary: baseSummary,
        detectedItemIds
      };
    }
    const currentMarkers = markers.filter((marker) => marker.itemId === normalizedItemId);
    if (currentMarkers.length === 0) {
      return {
        status: "ambiguous",
        timeline,
        summary: baseSummary,
        detectedItemIds,
        diagnostic: `O historico da SIN menciona outros itens, mas nao confirmou o item ${normalizedItemId} com seguranca.`
      };
    }
    const bestSegment = timeline.filter((event, index) => {
      let nearestDistance = Number.POSITIVE_INFINITY;
      let nearestItemIds = [];
      for (const marker of markers) {
        const distance = Math.abs(marker.index - index);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestItemIds = [marker.itemId];
          continue;
        }
        if (distance === nearestDistance) {
          nearestItemIds.push(marker.itemId);
        }
      }
      const resolvedNearestItemIds = dedupeStrings(nearestItemIds);
      if (resolvedNearestItemIds.length !== 1) return false;
      return resolvedNearestItemIds[0] === normalizedItemId;
    });
    if (bestSegment.length === timeline.length) {
      return {
        status: "unscoped",
        timeline,
        summary: baseSummary,
        detectedItemIds
      };
    }
    return {
      status: "filtered",
      timeline: bestSegment,
      summary: buildTimelineSummary(bestSegment),
      detectedItemIds,
      diagnostic: `Historico da SIN filtrado para ${describeDetectedItemIds(detectedItemIds, normalizedItemId)}.`
    };
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
      descricao: normalizeSpaces(clone.textContent ?? ""),
      descricaoHtml: clone.innerHTML.trim(),
      yellowComments: dedupeStrings(yellowComments),
      warnings: dedupeStrings(warnings),
      anomalyCount
    };
  }
  function consolidate(events) {
    const timeline = [];
    for (const event of events) {
      const descricao = normalizeSpaces(event.descricao);
      const yellowComments = Array.isArray(event.yellowComments) ? event.yellowComments.map((item) => normalizeSpaces(item)).filter(Boolean) : [];
      if (!descricao && yellowComments.length === 0) continue;
      const stage = detectStage(descricao);
      const attentionMatches = detectAttentionMatches(descricao, yellowComments);
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
      summary: buildTimelineSummary(timeline),
      warnings: [],
      confidence: "low",
      documentIdentity: null,
      anomalyCount: 0,
      parserKind: "strict"
    };
  }
  function finalizeParse(doc, build, baseUrl = window.location.href) {
    const base = consolidate(build.events);
    const documentIdentity = extractHistoryIdentityFromDocument(doc, baseUrl);
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
  function parseHistoryStrict(doc, baseUrl = window.location.href) {
    return finalizeParse(doc, parseHistoryStrictBuild(doc), baseUrl);
  }
  const SETTINGS_KEY = "km_sin_sidebar_settings_v2";
  const LEGACY_SETTINGS_KEY = "km_sin_sidebar_settings_v1";
  const SETTINGS_CHANGED_EVENT = "km-sin-sidebar-settings-changed";
  const DEFAULT_SETTINGS = {
    alwaysOpen: false,
    timelineMode: "yellow-only"
  };
  function normalizeTimelineMode(value) {
    return value === "yellow-only" ? "yellow-only" : "all";
  }
  function getAlwaysOpenMenuLabel(alwaysOpen) {
    return alwaysOpen ? "Desativar acompanhamento sempre visivel" : "Ativar acompanhamento sempre visivel";
  }
  function getInlinePanelToggleLabel(panelOpen) {
    return panelOpen ? "Ocultar painel" : "Mostrar painel";
  }
  function parseStoredSettings(raw) {
    const parsed = JSON.parse(raw);
    return {
      alwaysOpen: parsed.alwaysOpen === true,
      timelineMode: normalizeTimelineMode(parsed.timelineMode)
    };
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return parseStoredSettings(raw);
      const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (!legacyRaw) return { ...DEFAULT_SETTINGS };
      const migratedSettings = {
        ...parseStoredSettings(legacyRaw),
        alwaysOpen: false
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migratedSettings));
      return migratedSettings;
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
  const INLINE_PASSTHROUGH_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "SPAN"]);
  const PLAIN_URL_PATTERN = /https?:\/\/[^\s<>()"']+/gi;
  const SNAPSHOT_PASSTHROUGH_TAGS = new Set([
    "ARTICLE",
    "B",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DIV",
    "EM",
    "FIELDSET",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "I",
    "LEGEND",
    "LI",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "SMALL",
    "SPAN",
    "STRONG",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
    "U",
    "UL"
  ]);
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }
  function resolveSafeLinkUrl(href, baseUrl) {
    try {
      const base = new URL(baseUrl, window.location.href);
      const url = new URL(href, base);
      const protocol = url.protocol.toLowerCase();
      if (protocol !== "https:" && protocol !== "http:") return null;
      return url;
    } catch {
      return null;
    }
  }
  function buildAnchor(url, text) {
    const anchor = document.createElement("a");
    anchor.href = url.toString();
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent = text;
    return anchor;
  }
  function sanitizeTextNode(text, baseUrl) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(PLAIN_URL_PATTERN)) {
      const index = match.index ?? 0;
      const rawUrl = match[0];
      if (index > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
      }
      const trailingPunctuation = rawUrl.match(/[.,;:!?]+$/)?.[0] || "";
      const urlText = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl;
      const url = resolveSafeLinkUrl(urlText, baseUrl);
      fragment.appendChild(url ? buildAnchor(url, urlText) : document.createTextNode(urlText));
      if (trailingPunctuation) fragment.appendChild(document.createTextNode(trailingPunctuation));
      cursor = index + rawUrl.length;
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }
    return fragment.childNodes.length === 1 ? fragment.firstChild : fragment;
  }
  function sanitizeNode(node, baseUrl, options) {
    if (node.nodeType === Node.TEXT_NODE) {
      return sanitizeTextNode(node.textContent ?? "", baseUrl);
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
      const url = resolveSafeLinkUrl(href, baseUrl);
      if (!url) {
        return document.createTextNode(text);
      }
      return buildAnchor(url, text);
    }
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) {
      const sanitizedChild = sanitizeNode(child, baseUrl, options);
      if (sanitizedChild) fragment.appendChild(sanitizedChild);
    }
    if (!options.passthroughTags.has(tag)) {
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
      const container2 = document.createElement("div");
      container2.appendChild(sanitizeTextNode(input, baseUrl));
      return container2.innerHTML;
    }
    const template = document.createElement("template");
    template.innerHTML = input;
    const container = document.createElement("div");
    for (const child of template.content.childNodes) {
      const sanitized = sanitizeNode(child, baseUrl, {
        passthroughTags: INLINE_PASSTHROUGH_TAGS
      });
      if (sanitized) container.appendChild(sanitized);
    }
    return container.innerHTML;
  }
  function sanitizeSnapshotHtml(value, baseUrl = window.location.href) {
    const input = String(value ?? "").trim();
    if (!input) return "";
    const doc = new DOMParser().parseFromString(input, "text/html");
    const container = document.createElement("div");
    const root = doc.body ?? doc.documentElement;
    for (const child of root.childNodes) {
      const sanitized = sanitizeNode(child, baseUrl, {
        passthroughTags: SNAPSHOT_PASSTHROUGH_TAGS
      });
      if (sanitized) container.appendChild(sanitized);
    }
    return container.innerHTML;
  }
  const STYLE_ID = "km-sin-sidebar-style";
  const LAYOUT_SELECTOR = '.km-sin-layout[data-km-sin-root="1"]';
  function buildInlineSnapshotSrcdoc(rawHtml, baseUrl, historyUrl) {
    const snapshotHtml = rawHtml ? sanitizeSnapshotHtml(rawHtml, baseUrl) : `<p>Nenhum snapshot seguro estava disponivel para este historico.</p><p><a href="${escapeHtml(historyUrl)}" target="_blank" rel="noreferrer noopener">Abrir historico nativo em nova aba</a></p>`;
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
    <main class="km-sin-snapshot">${snapshotHtml || "<p>O historico nao trouxe conteudo visual seguro para exibir inline.</p>"}</main>
  </body>
</html>`;
  }
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = '.km-sin-inline-toggle{display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle}.km-sin-toggle{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;line-height:1.3;cursor:pointer;transition:background 120ms ease,border-color 120ms ease,color 120ms ease}.km-sin-toggle:hover{background:#f8fafc;border-color:#94a3b8}.km-sin-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,360px);gap:20px;align-items:start;margin-top:12px}.km-sin-layout.km-sin-collapsed{grid-template-columns:minmax(0,1fr)}.km-sin-main,.km-sin-aside{min-width:0;min-height:0}.km-sin-aside[hidden]{display:none!important}.km-sin-card{position:sticky;top:12px;display:flex;flex-direction:column;max-height:calc(100vh - 24px);background:#fff;border:1px solid #d4d8de;border-radius:12px;box-shadow:0 12px 28px rgba(15,23,42,.08);overflow:hidden}.km-sin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid #e7eaee;background:linear-gradient(180deg,#f8fafc 0,#fff 100%)}.km-sin-label{margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#52606d}.km-sin-title{margin:0;font-size:18px;line-height:1.2;color:#1f2937}.km-sin-meta,.km-sin-state{padding:0 16px;color:#52606d;font-size:12px}.km-sin-meta{padding-top:12px}.km-sin-state{padding-top:8px;padding-bottom:8px}.km-sin-state.is-error{color:#b42318}.km-sin-state.is-warning{color:#9a6700}.km-sin-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}.km-sin-link-btn,.km-sin-mode-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;transition:background 120ms ease,border-color 120ms ease,color 120ms ease}.km-sin-link-btn:hover,.km-sin-mode-btn:hover{background:#f8fafc;border-color:#94a3b8}.km-sin-link-btn:disabled{cursor:default;opacity:.65}.km-sin-mode-btn{border-color:#bfd7ff;color:#0f4c81;background:#eef6ff}.km-sin-mode-btn[data-mode="yellow-only"]{background:#fff4e5;border-color:#f5c67a;color:#8a4b08}.km-sin-body{flex:1 1 auto;min-height:0;padding:12px 16px 16px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable;touch-action:pan-y}.km-sin-empty{padding:14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;color:#52606d;font-size:13px}.km-sin-empty-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.km-sin-banner{margin-bottom:12px;padding:12px 14px;border-radius:10px;background:#fff4e5;border:1px solid #f5c67a;color:#8a4b08;font-size:13px}.km-sin-group+.km-sin-group{margin-top:16px}.km-sin-day{margin:0 0 10px;font-size:13px;font-weight:700;color:#334155}.km-sin-list,.km-sin-notes{display:grid;gap:10px}.km-sin-item{border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:12px}.km-sin-item.is-attention{border-color:#f1a4a4;background:linear-gradient(180deg,#fff6f6 0,#fffdfd 100%);box-shadow:inset 0 0 0 1px rgba(185,28,28,.08)}.km-sin-item-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;font-size:12px;color:#64748b}.km-sin-time{font-weight:700;color:#334155}.km-sin-stage,.km-sin-attention-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-weight:700;font-size:11px;text-transform:uppercase}.km-sin-stage{background:#e2e8f0;color:#334155}.km-sin-attention-chip{background:#fee2e2;color:#b42318;border:1px solid #f5b4b4}.km-sin-desc{color:#1f2937;font-size:13px;line-height:1.5;word-break:break-word}.km-sin-desc a{color:#0f4c81}.km-sin-notes{margin-top:10px;gap:8px}.km-sin-note{padding:9px 10px;border-radius:9px;background:#fff7bf;border:1px solid #e6d665;color:#6a5600;font-size:12px;line-height:1.45;font-weight:600}.km-sin-frame{width:100%;min-height:70vh;border:1px solid #d4d8de;border-radius:10px;background:#fff;color-scheme:light;forced-color-adjust:none}@media (max-width:1360px){.km-sin-layout{grid-template-columns:minmax(0,1fr)}.km-sin-card{position:relative;top:0;max-height:none}.km-sin-body{max-height:none}}';
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
    title.textContent = "KM Acompanhamento";
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
    const html = event.descricaoHtml ? sanitizeInlineHtml(event.descricaoHtml, historyUrl) : sanitizeInlineHtml(event.descricao, historyUrl);
    desc.innerHTML = html || escapeHtml(event.descricao);
    item.append(meta, desc);
    if (event.yellowComments.length > 0) {
      const notes = document.createElement("div");
      notes.className = "km-sin-notes";
      for (const comment of event.yellowComments) {
        const note = document.createElement("div");
        note.className = "km-sin-note";
        note.innerHTML = sanitizeInlineHtml(comment, historyUrl);
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
    empty.textContent = "Nao foi possivel interpretar o HTML deste historico. Se precisar, carregue uma visualizacao segura em modo somente leitura.";
    const actions = document.createElement("div");
    actions.className = "km-sin-empty-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "km-sin-link-btn";
    button.dataset.act = "load-fallback";
    button.textContent = "Carregar visualizacao segura";
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
    iframe.title = "KM Acompanhamento (isolado)";
    iframe.src = "about:blank";
    iframe.srcdoc = buildInlineSnapshotSrcdoc(rawHtml, baseUrl || url, url);
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
  function getSearchParamInsensitive(url, name) {
    const expected = name.toLowerCase();
    for (const [key, value] of url.searchParams.entries()) {
      if (key.toLowerCase() !== expected) continue;
      const normalized = normalizeSpaces(value);
      return normalized || null;
    }
    return null;
  }
  function withNativeSecurityToken(url) {
    const absoluteUrl = absolutizeUrl(url);
    if (!absoluteUrl) return null;
    try {
      const resolved = new URL(absoluteUrl);
      if (resolved.searchParams.has("k")) return resolved.toString();
      const currentUrl = new URL(window.location.href);
      const currentToken = getSearchParamInsensitive(currentUrl, "k");
      if (!currentToken) return resolved.toString();
      resolved.searchParams.set("k", currentToken);
      return resolved.toString();
    } catch {
      return absoluteUrl;
    }
  }
  function getCurrentLocationHints() {
    try {
      const url = new URL(window.location.href);
      return {
        itemId: getSearchParamInsensitive(url, "IdItem"),
        sinId: getSearchParamInsensitive(url, "IdSIN")
      };
    } catch {
      return {
        itemId: null,
        sinId: null
      };
    }
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
    return withNativeSecurityToken(
      extractUrlFromJsFunction(href, ["OpenWindowsWHR", "OpenWindowsWHRNS", "OpenNewTab"])
    );
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
  function findPrimaryItemField() {
    const locationHints = getCurrentLocationHints();
    const candidates = Array.from(document.querySelectorAll('#txtNumero, input[name$="txtNumero"]'));
    return pickBestElement(candidates, (input) => {
      let score = getCandidateScore(input);
      const value = normalizeSpaces(input.value);
      if (value) score += 20;
      if (locationHints.itemId && value === locationHints.itemId) score += 40;
      return score;
    });
  }
  function findBestViewRoot() {
    const locationHints = getCurrentLocationHints();
    const primaryItemField = findPrimaryItemField();
    const candidates = Array.from(document.querySelectorAll("#UpdatePanel1 .kl-view, .kl-view"));
    return pickBestElement(candidates, (element) => getCandidateScore(element, {
      hasLink: Boolean(element.querySelector("#hButAcompanhamentoSIN, #hlkObs")),
      hasSummaryLabel: Boolean(element.querySelector("#Label_infoSIN"))
    }) + (() => {
      let bonus = 0;
      const rootItemId = extractItemId(element);
      const rootSummary = element.querySelector("#DV_Resumo_sin");
      const rootSummarySinId = extractSinIdFromSummary(rootSummary);
      if (primaryItemField && element.contains(primaryItemField)) bonus += 80;
      if (rootItemId) bonus += 12;
      if (rootSummarySinId) bonus += 8;
      if (locationHints.itemId && rootItemId && rootItemId === locationHints.itemId) bonus += 40;
      if (locationHints.sinId && rootSummarySinId && rootSummarySinId === locationHints.sinId) bonus += 25;
      return bonus;
    })());
  }
  function findBestSummary(scope) {
    const candidates = Array.from(scope.querySelectorAll("#DV_Resumo_sin"));
    return pickBestElement(candidates, (element) => getCandidateScore(element, {
      hasLink: Boolean(findHistoryLink(element)),
      hasSummaryLabel: Boolean(element.querySelector("#Label_infoSIN"))
    }));
  }
  function findQuickViewRoot() {
    return findBestViewRoot();
  }
  function findQuickSummary(scope) {
    return findBestSummary(scope);
  }
  function findDirectHistoryLink(root) {
    return findHistoryLink(root);
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
    const itemId = extractItemId(scope);
    const summarySinId = extractSinIdFromSummary(summaryEl);
    const historyIdentity = linkEl ? extractHistoryIdentityFromHref(linkEl.getAttribute("href")) : null;
    return {
      itemId,
      historyUrl: historyIdentity?.absoluteUrl || null,
      historyIdentity,
      sinId: historyIdentity?.id || summarySinId,
      summarySinId,
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
  function isSecurityBlockedError(error) {
    if (!(error instanceof Error)) return false;
    return /origem inesperada|redirecionamento bloqueado/i.test(error.message);
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
          actionHint: "Use o botao Ver inline para abrir uma visualizacao segura do historico."
        };
      }
      if (/origem inesperada|redirecionamento bloqueado/i.test(msg)) {
        return {
          diagnostic: "O carregamento foi bloqueado porque o servidor tentou responder por uma origem inesperada.",
          actionHint: "Recarregue a pagina (F5) e confirme se o link nativo do historico ainda aponta para o Klassmatt."
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
    inlinePanelOverride = null;
    panelOpen = this.settings.alwaysOpen;
    currentContextKey = null;
    observedContextSignature = null;
    toggleHost = null;
    toggleButton = null;
    toggleParent = null;
    handleToggleClick = () => {
      const nextOpen = !this.panelOpen;
      this.inlinePanelOverride = nextOpen === this.settings.alwaysOpen ? null : nextOpen;
      this.panelOpen = nextOpen;
      this.syncInlineToggle(resolveQuickPageContext());
      if (!nextOpen) {
        this.closePanel();
        return;
      }
      void this.hydrate(true);
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
        setShellState(shell, "Exibindo visualizacao segura do historico...", "default");
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
      const quickContext = resolveQuickPageContext();
      this.observedContextSignature = this.captureContextSignature(quickContext);
      this.syncContextScope(quickContext);
      if (this.panelOpen) {
        void this.hydrate(true);
        return;
      }
      this.syncClosedState(quickContext);
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
      this.inlinePanelOverride = null;
      this.currentContext = null;
      this.currentContextKey = null;
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
      if (alwaysOpenChanged) {
        this.inlinePanelOverride = null;
      }
      this.syncPanelOpenState();
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
      this.syncContextScope(quickContext);
      this.syncInlineToggle(quickContext);
      if (!this.panelOpen) {
        this.hideCurrentSidebar();
        return;
      }
      const initialContext = resolvePageContext();
      const confirmedContext = await this.confirmTrustedContext(initialContext, serial);
      if (serial !== this.loadSerial || !this.panelOpen) return;
      const context = confirmedContext ?? initialContext;
      this.syncContextScope(context);
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
      renderEmpty(shell, "Buscando o conteudo de KM Acompanhamento...");
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
          setShellState(shell, "Carregando visualizacao segura...", "warning");
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
        setShellState(shell, "Formato nao reconhecido. Visualizacao segura disponivel sob demanda.", "warning");
        renderIframeFallbackPrompt(shell, result.diagnostic, () => {
          setShellState(shell, "Carregando visualizacao segura...", "warning");
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
          const parsed = parseHistoryStrict(doc, fetchResult.responseUrl);
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
          const scopedTimeline = context.itemId ? scopeTimelineToItem(parsed.timeline, context.itemId) : null;
          if (scopedTimeline?.status === "ambiguous") {
            return {
              mode: "blocked",
              timeline: [],
              diagnostic: scopedTimeline.diagnostic,
              actionHint: "Use o botao Ver inline para conferir o historico completo da SIN.",
              summary: parsed.summary,
              warnings: [...parsed.warnings, scopedTimeline.diagnostic || ""],
              confidence: "low",
              documentIdentity: parsed.documentIdentity,
              inlineHtml: fetchResult.html,
              inlineBaseUrl
            };
          }
          const effectiveTimeline = scopedTimeline?.status === "filtered" ? scopedTimeline.timeline : parsed.timeline;
          const effectiveSummary = scopedTimeline?.status === "filtered" ? scopedTimeline.summary : parsed.summary;
          const effectiveDiagnostic = scopedTimeline?.status === "filtered" ? scopedTimeline.diagnostic : void 0;
          const result = effectiveTimeline.length > 0 ? {
            mode: "parsed",
            timeline: effectiveTimeline,
            diagnostic: effectiveDiagnostic,
            summary: effectiveSummary,
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
            summary: effectiveSummary,
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
          if (isSecurityBlockedError(error)) {
            const classified2 = classifyErrorForUser(error);
            return {
              mode: "blocked",
              timeline: [],
              diagnostic: classified2.diagnostic,
              actionHint: classified2.actionHint
            };
          }
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
    syncPanelOpenState() {
      this.panelOpen = this.inlinePanelOverride ?? this.settings.alwaysOpen;
    }
    getContextScopeKey(context) {
      const identityScope = context.historyIdentity?.fingerprint || context.historyUrl || context.sinId || context.summarySinId || null;
      if (!identityScope && !context.itemId) return null;
      return [
        context.itemId || "sem-item",
        identityScope || "sem-contexto"
      ].join("|");
    }
    syncContextScope(context) {
      const nextContextKey = this.getContextScopeKey(context);
      if (!nextContextKey) return;
      if (this.currentContextKey && this.currentContextKey !== nextContextKey) {
        this.inlinePanelOverride = null;
      }
      this.currentContextKey = nextContextKey;
      this.syncPanelOpenState();
    }
    syncInlineToggle(_context = resolveQuickPageContext()) {
      const linkEl = _context.linkEl;
      const parent = linkEl?.parentElement;
      if (!linkEl || !parent) {
        this.removeInlineToggle();
        return;
      }
      const needsNewButton = !this.toggleHost || !this.toggleButton || !this.toggleHost.isConnected || this.toggleParent !== parent;
      if (needsNewButton) {
        this.removeInlineToggle();
        const host = document.createElement("span");
        host.className = "km-sin-inline-toggle";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "km-sin-toggle";
        button.addEventListener("click", this.handleToggleClick);
        host.appendChild(button);
        linkEl.insertAdjacentElement("afterend", host);
        this.toggleHost = host;
        this.toggleButton = button;
        this.toggleParent = parent;
      }
      const toggleHost = this.toggleHost;
      const toggleButton = this.toggleButton;
      if (!toggleHost || !toggleButton) return;
      if (toggleHost.previousElementSibling !== linkEl) {
        linkEl.insertAdjacentElement("afterend", toggleHost);
      }
      const label = getInlinePanelToggleLabel(this.panelOpen);
      toggleButton.textContent = label;
      toggleButton.title = label;
      toggleButton.setAttribute("aria-pressed", String(this.panelOpen));
    }
    removeInlineToggle() {
      if (this.toggleHost?.isConnected) {
        this.toggleHost.remove();
      }
      this.toggleHost = null;
      this.toggleButton = null;
      this.toggleParent = null;
    }
    syncModeButton(shell) {
      const mode = this.settings.timelineMode;
      shell.modeButton.dataset.mode = mode;
      shell.modeButton.textContent = mode === "all" ? "Amarelos" : "Tudo";
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
    captureContextSignature(context = resolveQuickPageContext()) {
      return [
        window.location.href,
        context.itemId || "sem-item",
        context.summarySinId || "sem-sin-resumo",
        context.historyIdentity?.fingerprint || context.historyUrl || context.sinId || "sem-historico"
      ].join("|");
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
    syncClosedState(context = resolveQuickPageContext()) {
      this.pruneDisconnectedShell();
      this.syncContextScope(context);
      this.syncInlineToggle(context);
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
      let disposed = false;
      let mutationObserver = null;
      let mutationTimer = 0;
      const observeRoot = document.body ?? document.documentElement;
      const timerHost = observeRoot.ownerDocument?.defaultView ?? window;
      const handleMutation = () => {
        if (disposed) return;
        mutationTimer = 0;
        const nextSignature = this.captureContextSignature();
        if (nextSignature === this.observedContextSignature) return;
        this.observedContextSignature = nextSignature;
        this.handlePageLifecycleEvent();
      };
      window.addEventListener("storage", this.handleStorageEvent);
      window.addEventListener("pageshow", this.handlePageLifecycleEvent);
      window.addEventListener("popstate", this.handlePageLifecycleEvent);
      window.addEventListener("hashchange", this.handlePageLifecycleEvent);
      if (observeRoot) {
        this.observedContextSignature = this.captureContextSignature();
        mutationObserver = new MutationObserver(() => {
          if (mutationTimer) return;
          mutationTimer = timerHost.setTimeout(handleMutation, 80);
        });
        mutationObserver.observe(observeRoot, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["href", "value", "style", "class", "hidden"]
        });
      }
      return () => {
        disposed = true;
        if (mutationTimer) {
          timerHost.clearTimeout(mutationTimer);
        }
        mutationObserver?.disconnect();
        window.removeEventListener("storage", this.handleStorageEvent);
        window.removeEventListener("pageshow", this.handlePageLifecycleEvent);
        window.removeEventListener("popstate", this.handlePageLifecycleEvent);
        window.removeEventListener("hashchange", this.handlePageLifecycleEvent);
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
      this.syncPanelOpenState();
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
  function shouldBootstrapSinSidebar(pathname = window.location.pathname, doc = document, protocol = window.location.protocol) {
    if (String(protocol || "").toLowerCase() !== "https:") return false;
    if (!isSupportedItemPath(pathname)) return false;
    return Boolean(doc.querySelector(CONTEXT_HINT_SELECTOR));
  }
  let app = null;
  let alwaysOpenMenuId = null;
  let bootstrapObserver = null;
  let bootstrapCleanupTimer = 0;
  const BOOTSTRAP_OBSERVER_TIMEOUT_MS = 15e3;
  function unregisterAlwaysOpenMenu() {
    if (alwaysOpenMenuId === null || typeof GM_unregisterMenuCommand !== "function") return;
    GM_unregisterMenuCommand(alwaysOpenMenuId);
    alwaysOpenMenuId = null;
  }
  function syncAlwaysOpenMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    unregisterAlwaysOpenMenu();
    const settings = loadSettings();
    const label = getAlwaysOpenMenuLabel(settings.alwaysOpen);
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
  function cleanupBootstrapObserver() {
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
    if (bootstrapCleanupTimer) {
      window.clearTimeout(bootstrapCleanupTimer);
      bootstrapCleanupTimer = 0;
    }
  }
  function scheduleBootstrapObserver() {
    if (app || bootstrapObserver) return;
    const observeRoot = document.body ?? document.documentElement;
    if (!observeRoot) return;
    bootstrapObserver = new MutationObserver(() => {
      start();
    });
    bootstrapObserver.observe(observeRoot, {
      childList: true,
      subtree: true
    });
    bootstrapCleanupTimer = window.setTimeout(() => {
      cleanupBootstrapObserver();
    }, BOOTSTRAP_OBSERVER_TIMEOUT_MS);
  }
  function start() {
    if (app) return;
    if (!shouldBootstrapSinSidebar()) {
      scheduleBootstrapObserver();
      return;
    }
    cleanupBootstrapObserver();
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
    cleanupBootstrapObserver();
    unregisterAlwaysOpenMenu();
    app?.destroy();
  }, { once: true });

})();