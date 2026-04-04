/**
 * Локальный «агентский» веб-поиск без открытия вкладок: HTML-выдача → загрузка страниц → выбор ссылок по релевантности.
 * Без стороннего search API; хрупкость разбора SERP компенсируется fallback-сообщением для модели.
 */

import { tokenize } from "./keyword";
import { wrapUntrustedToolPayload } from "../agent/untrusted-content";

const BLOCKED_HOST_SUBSTRINGS = [
  "duckduckgo.com",
  "google.com/search",
  "bing.com/search",
  "yandex.ru/search",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "doubleclick.net",
  "googlesyndication.com"
];

export type WebResearchInput = {
  query: string;
  /** 0 = только страницы из выдачи; 1+ = ещё по релевантным ссылкам с этих страниц */
  maxDepth: number;
  /** Жёсткий предел загруженных документов */
  maxPages: number;
  /** Сколько ссылок брать из выдачи */
  serpLimit: number;
  /** Сколько исходящих ссылок добавлять с каждой загруженной страницы */
  maxFollowPerPage: number;
  maxCharsPerPage: number;
  maxTotalReportChars: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

const DEFAULT_INPUT: Omit<WebResearchInput, "query" | "fetchImpl"> = {
  maxDepth: 1,
  maxPages: 10,
  serpLimit: 6,
  maxFollowPerPage: 5,
  maxCharsPerPage: 14_000,
  maxTotalReportChars: 28_000,
  timeoutMs: 14_000
};

export function normalizeUrlKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    let s = u.href;
    if (s.endsWith("/") && u.pathname.length > 1) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

/** Разворачивает редиректы DuckDuckGo /l/?uddg=… в целевой URL. */
export function resolveDuckRedirect(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) {
      try {
        return normalizeUrlKey(decodeURIComponent(uddg));
      } catch {
        return null;
      }
    }
    return normalizeUrlKey(u.href);
  } catch {
    return null;
  }
}

function isBlockedHost(urlStr: string): boolean {
  const low = urlStr.toLowerCase();
  return BLOCKED_HOST_SUBSTRINGS.some((s) => low.includes(s));
}

/** Годы вида 1999–2099 из запроса — для приоритизации свежих/релевантных сниппетов в выдаче и отрывках. */
export function extractLikelyYearsFromQuery(query: string): string[] {
  const m = query.match(/\b(19|20)\d{2}\b/g);
  return m != null ? [...new Set(m)] : [];
}

/** Поднимает вверх ссылки SERP, в title/url которых есть год из запроса (часто даёт более актуальные страницы). */
export function prioritizeSerpHitsByYearInQuery(
  hits: { title: string; url: string }[],
  query: string
): { title: string; url: string }[] {
  const years = extractLikelyYearsFromQuery(query);
  if (years.length === 0) return hits;
  const lowYears = years.map((y) => y.toLowerCase());
  const score = (h: { title: string; url: string }) => {
    const t = `${h.title} ${h.url}`.toLowerCase();
    let s = 0;
    for (const y of lowYears) {
      if (t.includes(y)) s += 3;
    }
    return s;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

/**
 * Извлекает пары (title, url) из HTML-выдачи DuckDuckGo (html.duckduckgo.com).
 */
export function parseDuckDuckGoSerpHtml(html: string): { title: string; url: string }[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();

  const anchors = doc.querySelectorAll("a.result__a");
  for (const a of anchors) {
    const href = a.getAttribute("href")?.trim();
    if (!href) continue;
    let resolved: string | null;
    try {
      const abs = new URL(href, "https://html.duckduckgo.com/html/").href;
      if (abs.includes("uddg=") || abs.includes("/l/?")) {
        resolved = resolveDuckRedirect(abs);
      } else {
        resolved = normalizeUrlKey(abs);
      }
    } catch {
      continue;
    }
    if (!resolved || isBlockedHost(resolved)) continue;
    const title = (a.textContent ?? "").trim() || resolved;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ title, url: resolved });
  }

  return out;
}

export type ExtractedPage = {
  url: string;
  title: string;
  text: string;
  links: { href: string; anchor: string }[];
};

export function extractReadablePage(html: string, pageUrl: string): ExtractedPage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, iframe").forEach((el) => el.remove());
  const title =
    doc.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title?.trim() ||
    pageUrl;

  const base = new URL(pageUrl);
  const links: { href: string; anchor: string }[] = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href")?.trim();
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    let abs: string;
    try {
      abs = new URL(href, base).href;
    } catch {
      continue;
    }
    const norm = normalizeUrlKey(abs);
    if (!norm || isBlockedHost(norm)) continue;
    const anchor = (a.textContent ?? "").trim().slice(0, 200);
    links.push({ href: norm, anchor });
  }

  const main =
    doc.querySelector("main, article, [role='main'], .content, #content, #mw-content-text") ?? doc.body;
  let text = (main?.textContent ?? "").replace(/\s+/g, " ").trim();

  if (text.length < 80) {
    text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  return { url: pageUrl, title, text, links };
}

function scoreLinkAgainstQuery(
  link: { href: string; anchor: string },
  queryTokens: Set<string>,
  yearHints: string[]
): number {
  const path = (() => {
    try {
      return new URL(link.href).pathname + " " + new URL(link.href).search;
    } catch {
      return link.href;
    }
  })();
  const toks = tokenize(`${link.anchor} ${path}`);
  let s = 0;
  for (const t of toks) {
    if (queryTokens.has(t)) s += 1;
  }
  const hay = `${link.anchor} ${link.href}`.toLowerCase();
  for (const y of yearHints) {
    if (hay.includes(y.toLowerCase())) s += 2;
  }
  return s;
}

function pickFollowLinks(page: ExtractedPage, query: string, maxN: number, yearHints: string[]): string[] {
  const q = new Set(tokenize(query));
  if (q.size === 0 && yearHints.length === 0) return [];
  const scored = page.links.map((l) => ({ href: l.href, s: scoreLinkAgainstQuery(l, q, yearHints) }));
  scored.sort((a, b) => b.s - a.s);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { href, s } of scored) {
    if (s < 1) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= maxN) break;
  }
  return out;
}

function excerptForQuery(text: string, query: string, maxLen: number, yearHints: string[]): string {
  const q = new Set(tokenize(query));
  const slice = text.slice(0, Math.min(text.length, maxLen * 4));
  if (q.size === 0 && yearHints.length === 0) return slice.slice(0, maxLen);
  const paras = slice
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 35);
  const lowYears = yearHints.map((y) => y.toLowerCase());
  const scored = paras.map((p) => {
    const pl = p.toLowerCase();
    let ys = 0;
    for (const y of lowYears) if (pl.includes(y)) ys += 3;
    return {
      p,
      s: tokenize(p).filter((t) => q.has(t)).length + ys
    };
  });
  scored.sort((a, b) => b.s - a.s);
  let out = "";
  for (const { p } of scored) {
    if (out.length + p.length + 2 > maxLen) break;
    out += (out ? "\n\n" : "") + p;
  }
  if (out.length < 120) return slice.slice(0, maxLen);
  return out.slice(0, maxLen);
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "PageAI/1.0 (local research; +https://github.com/mussolene/pageai)"
      }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    if (html.length > 2_500_000) return { ok: false, error: "response too large" };
    return { ok: true, html };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("abort") ? "timeout" : msg };
  } finally {
    clearTimeout(t);
  }
}

export async function runWebResearch(
  query: string,
  fetchImpl: typeof fetch,
  overrides: Partial<Omit<WebResearchInput, "query" | "fetchImpl">> = {}
): Promise<string> {
  const q = query.trim();
  if (!q) return "Error: empty query.";

  const opt: WebResearchInput = {
    query: q,
    fetchImpl,
    ...DEFAULT_INPUT,
    ...overrides
  };

  const serpUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const serpRes = await fetchText(fetchImpl, serpUrl, opt.timeoutMs);
  if (!serpRes.ok) {
    return (
      `Could not load search results (${serpRes.error}). ` +
      `You can use open_search_tab to open results in a browser tab, or ask the user to try again later.`
    );
  }

  let serpHits: { title: string; url: string }[];
  try {
    const parsed = parseDuckDuckGoSerpHtml(serpRes.html);
    serpHits = prioritizeSerpHitsByYearInQuery(parsed, q).slice(0, opt.serpLimit);
  } catch {
    return (
      "Could not parse search results HTML (format may have changed). " +
      "Use open_search_tab to open DuckDuckGo in a tab for the user."
    );
  }

  if (serpHits.length === 0) {
    return "No result links parsed from the search page. Try a simpler query or use open_search_tab to open results in a browser tab.";
  }

  const yearHints = extractLikelyYearsFromQuery(q);

  type Job = { url: string; depth: number; via: string | null };
  const reportParts: string[] = [];
  let totalChars = 0;

  const queued = new Set<string>();
  const queue: Job[] = [];
  for (const h of serpHits) {
    const k = normalizeUrlKey(h.url);
    if (!k || queued.has(k)) continue;
    queued.add(k);
    queue.push({ url: h.url, depth: 0, via: null });
  }

  const header =
    `# Web research (local fetch, no tabs opened)\n` +
    `Query: ${q}\n` +
    `Plan: up to ${opt.maxPages} page(s), depth ≤ ${opt.maxDepth} (depth 0 = SERP hits; deeper = cross-links scored by query terms).\n\n`;

  totalChars += header.length;

  const finished = new Set<string>();
  while (queue.length > 0 && finished.size < opt.maxPages) {
    const job = queue.shift()!;
    const nk = normalizeUrlKey(job.url);
    if (!nk) continue;
    if (finished.has(nk)) continue;
    finished.add(nk);

    const pageRes = await fetchText(opt.fetchImpl, job.url, opt.timeoutMs);
    if (!pageRes.ok) {
      const line = `## Fetch failed\nURL: ${job.url}\nDepth: ${job.depth}\nError: ${pageRes.error}\n\n`;
      if (totalChars + line.length > opt.maxTotalReportChars) break;
      reportParts.push(line);
      totalChars += line.length;
      continue;
    }

    let extracted: ExtractedPage;
    try {
      extracted = extractReadablePage(pageRes.html, job.url);
    } catch {
      const line = `## Parse failed\nURL: ${job.url}\nDepth: ${job.depth}\n\n`;
      if (totalChars + line.length > opt.maxTotalReportChars) break;
      reportParts.push(line);
      totalChars += line.length;
      continue;
    }

    const ex = excerptForQuery(extracted.text, q, Math.min(3500, opt.maxCharsPerPage), yearHints);
    const viaLine = job.via ? `Cross-link from: ${job.via}\n` : "";
    const block =
      `## ${extracted.title}\n` +
      `URL: ${extracted.url}\n` +
      `Depth: ${job.depth}\n` +
      viaLine +
      `Excerpt:\n${ex}\n\n`;

    if (totalChars + block.length > opt.maxTotalReportChars) break;
    reportParts.push(block);
    totalChars += block.length;

    if (job.depth < opt.maxDepth && finished.size < opt.maxPages) {
      const follow = pickFollowLinks(extracted, q, opt.maxFollowPerPage, yearHints);
      for (const u of follow) {
        const fk = normalizeUrlKey(u);
        if (!fk || queued.has(fk)) continue;
        queued.add(fk);
        queue.push({ url: u, depth: job.depth + 1, via: extracted.url });
      }
    }
  }

  return wrapUntrustedToolPayload("web_research (fetched HTML pages)", header + reportParts.join(""));
}
