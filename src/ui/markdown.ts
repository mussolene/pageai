/**
 * Lightweight Markdown Parser for Session #2
 * NO dependencies - pure TypeScript
 * 
 * Supports:
 * - **bold**, *italic*, `code`
 * - # ## ### headings
 * - Lists: -, *, +
 * - Code blocks with language
 * - Tables (basic)
 * - Links [text](url)
 * - Quotes: > text
 * - Line breaks
 */

export interface MarkdownElements {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link?: { text: string; url: string };
  heading?: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Allow only http: and https: for link href to prevent XSS (javascript:, data:, etc.). */
function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse inline markdown (bold, italic, code, links). Escapes HTML in text for XSS safety.
 * Links with non-http(s) URLs are rendered as plain text.
 */
function parseInlineMarkdown(text: string): string {
  let result = escapeHtml(text);

  // Links: [text](url) — only http/https URLs become clickable
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, linkText: string, url: string) => {
      if (isSafeLinkUrl(url)) {
        // url may already be HTML-escaped (e.g. & → &amp;) when parsed from escapeHtml(text); use as-is to avoid double escape
        const safeHref = url;
        return `<a href="${safeHref}" class="md-link" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      }
      return linkText;
    }
  );

  // Bold: **text** or __text__
  result = result.replace(
    /\*\*([^\*]+)\*\*|__([^_]+)__/g,
    '<strong class="md-bold">$1$2</strong>'
  );

  // Italic: *text* or _text_
  result = result.replace(
    /\*([^\*]+)\*|_([^_]+)_/g,
    '<em class="md-italic">$1$2</em>'
  );

  // Inline code: `text`
  result = result.replace(
    /`([^`]+)`/g,
    '<code class="md-code-inline">$1</code>'
  );

  return result;
}

/**
 * Parse code blocks with optional language. Supports ```code``` without trailing newline.
 */
function parseCodeBlock(text: string): string {
  let result = text;

  // ```lang?\n?code\n?``` — optional newline after open and before close
  result = result.replace(
    /```([a-z0-9]*)\n?([\s\S]*?)```/g,
    (_match, lang, code) => {
      const langClass = lang ? ` class="language-${lang}"` : "";
      const escaped = escapeHtml(code.trimEnd()).replace(/\n/g, "&#10;");
      return `<pre class="md-code-block"><code${langClass}>${escaped}</code></pre>`;
    }
  );

  return result;
}

/**
 * Parse headings: # H1, ## H2, ### H3
 */
function parseHeadings(text: string): string {
  let result = text;

  // H1–H4 (escape heading text for XSS)
  result = result.replace(/^# ([^\n]+)/gm, (_, t) => `<h1 class="md-h1">${escapeHtml(t)}</h1>`);
  result = result.replace(/^## ([^\n]+)/gm, (_, t) => `<h2 class="md-h2">${escapeHtml(t)}</h2>`);
  result = result.replace(/^### ([^\n]+)/gm, (_, t) => `<h3 class="md-h3">${escapeHtml(t)}</h3>`);
  result = result.replace(/^#### ([^\n]+)/gm, (_, t) => `<h4 class="md-h4">${escapeHtml(t)}</h4>`);

  return result;
}

/**
 * Parse lists: - * + (unordered) and 1. 2. (ordered)
 */
function parseLists(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inUL = false;
  let inOL = false;

  for (const line of lines) {
    const ulMatch = line.match(/^(\s*)[-*+]\s(.+)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);

    if (ulMatch) {
      if (inOL) {
        output.push("</ol>");
        inOL = false;
      }
      if (!inUL) {
        output.push('<ul class="md-list">');
        inUL = true;
      }
      output.push(`<li>${parseInlineMarkdown(ulMatch[2])}</li>`);
    } else if (olMatch) {
      if (inUL) {
        output.push("</ul>");
        inUL = false;
      }
      if (!inOL) {
        output.push('<ol class="md-list md-list-ordered">');
        inOL = true;
      }
      output.push(`<li>${parseInlineMarkdown(olMatch[2])}</li>`);
    } else {
      if (inUL) {
        output.push("</ul>");
        inUL = false;
      }
      if (inOL) {
        output.push("</ol>");
        inOL = false;
      }
      output.push(line);
    }
  }
  if (inUL) output.push("</ul>");
  if (inOL) output.push("</ol>");

  return output.join("\n");
}

/**
 * Parse block quotes: > text
 */
function parseQuotes(text: string): string {
  let result = text;

  // Block quotes: > text (escape for XSS)
  result = result.replace(
    /^> (.+)$/gm,
    (_, t) => `<blockquote class="md-quote"><p>${escapeHtml(t)}</p></blockquote>`
  );

  // Multi-line quotes
  result = result.replace(
    /<blockquote class="md-quote"><p>(.+?)<\/p><\/blockquote>(\n<blockquote class="md-quote"><p>(.+?)<\/p><\/blockquote>)+/g,
    (match) => {
      const lines = match.split('</p></blockquote>\n<blockquote class="md-quote"><p>');
      return (
        '<blockquote class="md-quote"><p>' +
        lines.join('</p><p>') +
        '</p></blockquote>'
      );
    }
  );

  return result;
}

/**
 * Parse tables (simple markdown tables)
 * | Header 1 | Header 2 |
 * |----------|----------|
 * | Cell 1   | Cell 2   |
 */
function parseTables(text: string): string {
  let result = text;

  // Find table patterns
  const tablePattern = /\|(.+)\n\|\s*[-:\s|]+\n((?:\|.+\n?)*)/g;

  result = result.replace(tablePattern, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 3) return match;

    const headerLine = lines[0];
    const bodyLines = lines.slice(2);

    const headers = headerLine
      .split('|')
      .map((h) => h.trim())
      .filter((h) => h);
    const rows = bodyLines.map((line) =>
      line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c)
    );

    let table = '<table class="md-table"><thead><tr>';
    headers.forEach((header) => {
      table += `<th>${parseInlineMarkdown(header)}</th>`;
    });
    table += '</tr></thead><tbody>';

    rows.forEach((cells) => {
      table += '<tr>';
      cells.forEach((cell) => {
        table += `<td>${parseInlineMarkdown(cell)}</td>`;
      });
      table += '</tr>';
    });

    table += '</tbody></table>';

    return table;
  });

  return result;
}

/**
 * Parse horizontal rule: ---, ***, ___
 */
function parseHorizontalRules(text: string): string {
  let result = text;

  result = result.replace(/^(\-\-\-|\*\*\*|_{3,})$/gm, '<hr class="md-hr">');

  return result;
}

/**
 * Parse paragraphs (wrap non-empty lines in <p>)
 */
function parseParagraphs(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inParagraph = false;
  let paragraphLines: string[] = [];

  for (const line of lines) {
    // Skip if line is already a block element or list item
    if (
      line.match(/^<(h[1-4]|pre|blockquote|ul|ol|li|table|hr|\/ul|\/ol|\/li)/) ||
      line.trim() === ""
    ) {
      // Flush paragraph
      if (inParagraph && paragraphLines.length > 0) {
        output.push('<p class="md-paragraph">' + paragraphLines.join(" ") + "</p>");
        paragraphLines = [];
        inParagraph = false;
      }

      if (line.trim() !== "") {
        output.push(line);
      }
    } else {
      paragraphLines.push(parseInlineMarkdown(line));
      inParagraph = true;
    }
  }
  if (inParagraph && paragraphLines.length > 0) {
    output.push('<p class="md-paragraph">' + paragraphLines.join(" ") + "</p>");
  }

  return output.join('\n');
}

/**
 * Main markdown parser. Order: block elements first, then lists and paragraphs.
 * User text is escaped in parseInlineMarkdown, parseHeadings, parseQuotes, parseCodeBlock.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }
  let html = markdown;
  html = parseHeadings(html);
  html = parseCodeBlock(html);
  html = parseHorizontalRules(html);
  html = parseTables(html);
  html = parseQuotes(html);
  html = parseLists(html);
  html = parseParagraphs(html);
  return html.trim();
}

/**
 * Safe render markdown to DOM element
 */
export function renderMarkdown(container: HTMLElement, markdown: string): void {
  const html = markdownToHtml(markdown);

  // Use textContent for safety, then parse HTML selectively
  container.innerHTML = '';

  // Create a temporary div to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Copy all children
  while (temp.firstChild) {
    container.appendChild(temp.firstChild);
  }

  // Add event listeners to links for safety
  container.querySelectorAll('a.md-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (!link.getAttribute('target')) {
        e.preventDefault();
        const url = link.getAttribute('href');
        if (url) {
          window.open(url, '_blank');
        }
      }
    });
  });
}

/**
 * Get plain text from markdown (for previews, etc.)
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,4}\s*/g, '')
    .replace(/[-*+]\s/g, '• ')
    .replace(/>\s/g, '');
}
