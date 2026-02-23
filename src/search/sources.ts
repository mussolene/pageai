/**
 * Source Links Parser & Manager
 *
 * Handles extraction, parsing, and management of source citations from LLM responses.
 * Supports both inline citations [1], [2] and footer source lists.
 */

/**
 * Represents a single source/citation
 */
export interface Source {
  id: number; // Citation number [1], [2], etc.
  title: string; // Page title
  url: string; // Full page URL
  excerpt?: string; // Optional: excerpt from the page
}

/**
 * Result of parsing an LLM response with sources
 */
export interface ParsedResponse {
  content: string; // Main LLM response, may include citation numbers [1], [2]
  sources: Source[]; // Extracted sources
  hasFooterSection: boolean; // Whether response had a "Источники:" section
}

/**
 * Parse a response string to extract markdown-style links [text](url)
 * Used for extracting inline source references
 *
 * Example: "See [Getting Started](https://example.com) for details."
 * Returns: [{ text: "Getting Started", url: "https://example.com" }]
 */
function extractMarkdownLinks(text: string): Array<{ text: string; url: string }> {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: Array<{ text: string; url: string }> = [];
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
    });
  }

  return links;
}

/**
 * Parse footer section with sources
 * Expects format:
 * ---
 * Источники:
 * 1. [Title](URL)
 * 2. [Title](URL)
 */
function parseSourcesSection(text: string): Source[] {
  // Look for "Источники:" or "Sources:" section
  const sourcesRegex = /(?:Источники|Sources):\s*\n([\s\S]+?)(?:\n\n|$)/i;
  const match = text.match(sourcesRegex);

  if (!match) return [];

  const sourcesText = match[1];
  const sources: Source[] = [];

  // Parse each line like "1. [Title](URL)"
  const lineRegex = /^\s*(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)/gm;
  let lineMatch;

  while ((lineMatch = lineRegex.exec(sourcesText)) !== null) {
    sources.push({
      id: parseInt(lineMatch[1], 10),
      title: lineMatch[2],
      url: lineMatch[3],
    });
  }

  return sources;
}

/**
 * Extract inline citations like [1], [2], [3]
 * Used to replace with superscript or footnote references
 */
function extractInlineCitations(text: string): Array<{ number: number; position: number }> {
  const citationRegex = /\[(\d+)\]/g;
  const citations: Array<{ number: number; position: number }> = [];
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    citations.push({
      number: parseInt(match[1], 10),
      position: match.index,
    });
  }

  return citations;
}

/**
 * Main function: Parse LLM response for sources and citations
 *
 * Splits response by "---" separator and extracts sources from footer section.
 * Returns main content and extracted sources.
 *
 * Usage:
 * const response = `Here's the answer...\n---\nИсточники:\n1. [Getting Started](url)`;
 * const { content, sources } = parseLlmResponse(response);
 */
export function parseLlmResponse(response: string): ParsedResponse {
  // Split by "---" separator to extract footer section
  const parts = response.split(/\n\s*---\s*\n/);
  const mainContent = parts[0];
  const footerSection = parts.length > 1 ? parts.slice(1).join('\n---\n') : '';

  // Parse sources from footer section if present
  const footerSources = footerSection ? parseSourcesSection(footerSection) : [];
  const hasFooterSection = footerSources.length > 0;

  // If no footer sources, try to extract from markdown links in main content
  const sources = footerSources.length > 0 
    ? footerSources 
    : extractMarkdownLinks(mainContent)
        .map((link, idx) => ({
          id: idx + 1,
          title: link.text,
          url: link.url,
        }));

  return {
    content: mainContent.trim(),
    sources,
    hasFooterSection,
  };
}

/**
 * Format sources for display in UI
 * Returns HTML-safe formatted string
 *
 * Usage:
 * const formatted = formatSourcesForDisplay(sources);
 * // Returns: "1. Getting Started\n2. API Guide\n"
 */
export function formatSourcesForDisplay(sources: Source[]): string {
  if (sources.length === 0) return '';

  return sources
    .sort((a, b) => a.id - b.id)
    .map((source) => `${source.id}. ${source.title}`)
    .join('\n');
}

/**
 * Create clickable source list for HTML
 * Returns array of source items with click handlers
 *
 * Usage:
 * const items = createSourceListItems(sources);
 * items.forEach(item => { container.appendChild(item.element); });
 */
export function createSourceListItems(
  sources: Source[]
): Array<{ number: number; title: string; url: string; element: HTMLElement }> {
  return sources.map((source) => {
    const li = document.createElement('li');
    const a = document.createElement('a');

    a.href = source.url;
    a.textContent = source.title;
    a.className = 'source-link';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    li.appendChild(a);

    return {
      number: source.id,
      title: source.title,
      url: source.url,
      element: li,
    };
  });
}

/**
 * Replace inline citations [1], [2] with superscript references
 * 
 * Example:
 * Input: "According to docs [1], the API [2] is complex."
 * Output: "According to docs <sup class='citation'>[1]</sup>, the API <sup class='citation'>[2]</sup> is complex."
 */
/** Match [1], [2], ... but not [0] (e.g. array index). */
export function highlightInlineCitations(text: string): string {
  return text.replace(
    /\[([1-9]\d*)\]/g,
    '<sup class="citation" data-source-id="$1">[$1]</sup>'
  );
}

/**
 * Extract sources referenced in inline citations
 * Returns only those sources that are actually cited in the text
 *
 * Usage:
 * const referencedSources = getReferencedSources(content, allSources);
 */
export function getReferencedSources(content: string, allSources: Source[]): Source[] {
  const citations = extractInlineCitations(content);
  const citedIds = new Set(citations.map((c) => c.number));

  return allSources.filter((s) => citedIds.has(s.id));
}

/**
 * Validate sources - check URLs are valid
 */
export function validateSources(sources: Source[]): { valid: Source[]; invalid: Source[] } {
  const valid: Source[] = [];
  const invalid: Source[] = [];

  sources.forEach((source) => {
    try {
      new URL(source.url);
      valid.push(source);
    } catch {
      invalid.push(source);
    }
  });

  return { valid, invalid };
}

/**
 * Merge sources, removing duplicates by URL
 */
export function mergeSources(...sourceLists: Source[][]): Source[] {
  const seen = new Set<string>();
  const merged: Source[] = [];
  let nextId = 1;

  sourceLists.forEach((sources) => {
    sources.forEach((source) => {
      if (!seen.has(source.url)) {
        seen.add(source.url);
        merged.push({ ...source, id: nextId++ });
      }
    });
  });

  return merged;
}
