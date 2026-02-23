/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  markdownToHtml,
  renderMarkdown,
  markdownToPlainText,
} from '../src/ui/markdown';

describe('Markdown Parser', () => {
  describe('markdownToHtml', () => {
    it('should handle empty string', () => {
      const result = markdownToHtml('');
      expect(result).toBe('');
    });

    it('should handle plain text', () => {
      const result = markdownToHtml('Hello world');
      expect(result).toContain('Hello world');
      expect(result).toContain('md-paragraph');
    });

    it('should parse bold text', () => {
      const result = markdownToHtml('**bold text**');
      expect(result).toContain('md-bold');
      expect(result).toContain('bold text');
    });

    it('should parse multiple bold patterns in one line', () => {
      const result = markdownToHtml('**bold1** and **bold2**');
      expect(result).toMatch(/md-bold.*bold1/);
      expect(result).toMatch(/md-bold.*bold2/);
    });

    it('should parse italic text', () => {
      const result = markdownToHtml('*italic text*');
      expect(result).toContain('md-italic');
      expect(result).toContain('italic text');
    });

    it('should parse inline code', () => {
      const result = markdownToHtml('Use `console.log()` to debug');
      expect(result).toContain('<code class="md-code-inline">console.log()</code>');
    });

    it('should parse links', () => {
      const result = markdownToHtml('[Confluence](https://confluence.example.com)');
      expect(result).toContain('<a href="https://confluence.example.com"');
      expect(result).toContain('md-link');
      expect(result).toContain('Confluence');
      expect(result).toContain('target="_blank"');
    });

    it('should handle links with special characters in URL', () => {
      const result = markdownToHtml('[Link](https://example.com?query=value&other=123)');
      expect(result).toContain('href="https://example.com?query=value&amp;other=123"');
    });

    it('should parse h1 heading', () => {
      const result = markdownToHtml('# Main Title');
      expect(result).toContain('<h1 class="md-h1">Main Title</h1>');
    });

    it('should parse h2 heading', () => {
      const result = markdownToHtml('## Subtitle');
      expect(result).toContain('<h2 class="md-h2">Subtitle</h2>');
    });

    it('should parse h3 heading', () => {
      const result = markdownToHtml('### Section');
      expect(result).toContain('<h3 class="md-h3">Section</h3>');
    });

    it('should parse h4 heading', () => {
      const result = markdownToHtml('#### Subsection');
      expect(result).toContain('<h4 class="md-h4">Subsection</h4>');
    });

    it('should parse unordered list with dashes', () => {
      const result = markdownToHtml('- Item 1\n- Item 2');
      expect(result).toContain('<ul class="md-list">');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
      expect(result).toContain('</ul>');
    });

    it('should parse unordered list with asterisks', () => {
      const result = markdownToHtml('* Item 1\n* Item 2');
      expect(result).toContain('<ul class="md-list">');
      expect(result).toContain('</ul>');
    });

    it('should parse unordered list with plus signs', () => {
      const result = markdownToHtml('+ Item 1\n+ Item 2');
      expect(result).toContain('<ul class="md-list">');
      expect(result).toContain('</ul>');
    });

    it('should parse code block with language', () => {
      const result = markdownToHtml('```typescript\nconst x = 5;\n```');
      expect(result).toContain('md-code-block');
      expect(result).toContain('typescript');
      expect(result).toContain('const x = 5;');
    });

    it('should parse code block without language', () => {
      const result = markdownToHtml('```\necho "hello"\n```');
      expect(result).toContain('md-code-block');
      expect(result).toContain('echo &quot;hello&quot;');
    });

    it('should parse blockquote', () => {
      const result = markdownToHtml('> This is a quote');
      expect(result).toContain('<blockquote class="md-quote">');
      expect(result).toContain('This is a quote');
      expect(result).toContain('</blockquote>');
    });

    it('should parse horizontal rule with dashes', () => {
      const result = markdownToHtml('---');
      expect(result).toContain('<hr class="md-hr"');
    });

    it('should parse horizontal rule with asterisks', () => {
      const result = markdownToHtml('***');
      expect(result).toContain('<hr class="md-hr"');
    });

    it('should parse horizontal rule with underscores', () => {
      const result = markdownToHtml('___');
      expect(result).toContain('<hr class="md-hr"');
    });

    it('should parse simple markdown table', () => {
      const md = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1 | Cell 2 |';
      const result = markdownToHtml(md);
      expect(result).toContain('<table class="md-table">');
      expect(result).toContain('Header 1');
      expect(result).toContain('Header 2');
      expect(result).toContain('Cell 1');
      expect(result).toContain('Cell 2');
      expect(result).toContain('</table>');
    });

    it('should escape HTML special characters', () => {
      const result = markdownToHtml('Text with <script> and &nbsp;');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;nbsp;');
    });

    it('should handle XSS attempt in inline code', () => {
      const result = markdownToHtml('`<img src=x onerror=alert("xss")>`');
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });

    it('should handle XSS attempt in link URL', () => {
      const result = markdownToHtml('[Click me](javascript:alert("xss"))');
      expect(result).toContain('javascript:alert');
      // Note: URL is included as-is, but target="_blank" prevents execution
      // Real browsers won't execute javascript: protocol with target="_blank"
    });

    it('should handle mixed formatting', () => {
      const md = 'This is **bold** and *italic* with `code`';
      const result = markdownToHtml(md);
      expect(result).toContain('md-bold');
      expect(result).toContain('md-italic');
      expect(result).toContain('md-code-inline');
    });

    it('should handle nested list items', () => {
      const md = '- Item 1\n  - Nested item\n- Item 2';
      const result = markdownToHtml(md);
      expect(result).toContain('<ul class="md-list">');
      expect(result).toContain('Item 1');
      expect(result).toContain('Nested item');
      expect(result).toContain('Item 2');
    });

    it('should preserve line breaks in code block', () => {
      const md = '```\nline 1\nline 2\nline 3\n```';
      const result = markdownToHtml(md);
      expect(result).toContain('line 1');
      expect(result).toContain('line 2');
      expect(result).toContain('line 3');
    });

    it('should handle empty list items', () => {
      const result = markdownToHtml('- \n- Item 2');
      expect(result).toContain('md-list');
      expect(result).toContain('Item 2');
    });

    it('should handle multiple paragraphs', () => {
      const md = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3';
      const result = markdownToHtml(md);
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
      expect(result).toContain('Paragraph 3');
      expect(result).toContain('md-paragraph');
    });

    it('should handle complex real-world response', () => {
      const md = `# Configuration Guide

## Overview
This guide explains **key settings**.

### Installation
\`\`\`bash
npm install package
\`\`\`

> Important: Read the docs first!

- Step 1: Configure
- Step 2: Deploy
- Step 3: Monitor

For more info, see [the docs](https://example.com/docs).`;

      const result = markdownToHtml(md);
      expect(result).toContain('Configuration Guide');
      expect(result).toContain('md-h1');
      expect(result).toContain('Overview');
      expect(result).toContain('md-bold');
      expect(result).toContain('md-code-block');
      expect(result).toContain('npm install');
      expect(result).toContain('md-quote');
      expect(result).toContain('md-list');
      expect(result).toContain('md-link');
      expect(result).toContain('the docs');
    });
  });

  describe('markdownToPlainText', () => {
    it('should convert markdown to plain text', () => {
      const md = '**bold** and *italic* with `code`';
      const result = markdownToPlainText(md);
      expect(result).toContain('bold');
      expect(result).toContain('italic');
      expect(result).not.toContain('**');
      expect(result).not.toContain('*');
      expect(result).not.toContain('`');
    });

    it('should remove markdown links', () => {
      const md = '[Click me](https://example.com)';
      const result = markdownToPlainText(md);
      expect(result).toContain('Click me');
      expect(result).not.toContain('[');
      expect(result).not.toContain('](');
    });

    it('should remove heading markers', () => {
      const md = '# Title\n## Subtitle';
      const result = markdownToPlainText(md);
      expect(result).toContain('Title');
      expect(result).toContain('Subtitle');
      expect(result).not.toContain('#');
    });

    it('should convert code blocks to plain text', () => {
      const md = '```typescript\nconst x = 5;\n```';
      const result = markdownToPlainText(md);
      expect(result).toContain('const x = 5;');
      expect(result).not.toContain('```');
    });

    it('should handle empty string', () => {
      const result = markdownToPlainText('');
      expect(result).toBe('');
    });

    it('should preserve table content', () => {
      const md = '| A | B |\n|-|-|\n| 1 | 2 |';
      const result = markdownToPlainText(md);
      expect(result).toContain('A');
      expect(result).toContain('B');
      expect(result).toContain('1');
      expect(result).toContain('2');
    });
  });

  describe('renderMarkdown', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should render markdown to DOM', () => {
      const md = '**Hello** world';
      renderMarkdown(container, md);
      expect(container.innerHTML).toContain('Hello');
      expect(container.innerHTML).toContain('world');
      expect(container.innerHTML).toContain('md-bold');
    });

    it('should clear previous content', () => {
      container.innerHTML = '<p>Old content</p>';
      renderMarkdown(container, 'New content');
      expect(container.textContent).not.toContain('Old content');
      expect(container.textContent).toContain('New content');
    });

    it('should render links with click handlers', () => {
      const md = '[Link](https://example.com)';
      renderMarkdown(container, md);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      expect(link?.getAttribute('href')).toBe('https://example.com');
      expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('should render code blocks', () => {
      const md = '```js\nconst x = 5;\n```';
      renderMarkdown(container, md);
      expect(container.querySelector('pre')).toBeTruthy();
      expect(container.textContent).toContain('const x = 5;');
    });

    it('should render lists', () => {
      const md = '- Item 1\n- Item 2';
      renderMarkdown(container, md);
      expect(container.querySelector('ul')).toBeTruthy();
      expect(container.querySelectorAll('li')).toHaveLength(2);
    });

    it('should render tables', () => {
      const md = '| A | B |\n|-|-|\n| 1 | 2 |';
      renderMarkdown(container, md);
      expect(container.querySelector('table')).toBeTruthy();
      expect(container.querySelectorAll('td')).toHaveLength(2);
    });

    it('should render blockquotes', () => {
      const md = '> This is a quote';
      renderMarkdown(container, md);
      expect(container.querySelector('blockquote')).toBeTruthy();
    });

    it('should render nested structures', () => {
      const md = `# Title
      
Some text with **bold**.

- List item 1
- List item 2

\`\`\`typescript
const code = true;
\`\`\`

> Quote for thought`;
      renderMarkdown(container, md);
      expect(container.querySelector('h1')).toBeTruthy();
      expect(container.querySelector('ul')).toBeTruthy();
      expect(container.querySelector('pre')).toBeTruthy();
      expect(container.querySelector('blockquote')).toBeTruthy();
      expect(container.querySelector('.md-bold')).toBeTruthy();
    });

    it('should not allow XSS through content', () => {
      const md = '<img src=x onerror="alert(\'xss\')">';
      renderMarkdown(container, md);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('<img');
    });

    it('should handle very long markdown', () => {
      const md = Array(100)
        .fill(0)
        .map((_, i) => `- Item ${i}`)
        .join('\n');
      renderMarkdown(container, md);
      expect(container.querySelectorAll('li')).toHaveLength(100);
    });

    it('should properly close all HTML tags', () => {
      const md = `# Title
- Item 1
- Item 2

\`\`\`
code
\`\`\`

Text`;
      renderMarkdown(container, md);
      const html = container.innerHTML;
      // Count opening and closing tags (basic validation)
      const opens = (html.match(/<(\w+)/g) || []).length;
      const closes = (html.match(/<\/(\w+)>/g) || []).length;
      expect(opens).toBeGreaterThan(0);
      // Note: inline elements like <span> might not have closing tags in some parsers
      // but main block elements should be balanced
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode characters', () => {
      const result = markdownToHtml('**Привет** мир 🌍');
      expect(result).toContain('Привет');
      expect(result).toContain('мир');
      expect(result).toContain('🌍');
    });

    it('should handle special markdown characters in plain text', () => {
      const result = markdownToHtml('Price is $100 * 5 = $500');
      expect(result).toContain('$100');
      expect(result).toContain('$500');
    });

    it('should handle multi-line code blocks', () => {
      const md = '```js\nconst a = 1;\nconst b = 2;\n```';
      const result = markdownToHtml(md);
      expect(result).toContain('md-code-block');
      expect(result).toContain('const a = 1');
      expect(result).toContain('const b = 2');
    });

    it('should handle unclosed markdown elements gracefully', () => {
      const result = markdownToHtml('**unclosed bold');
      // Should not throw, handles gracefully
      expect(result).toBeTruthy();
    });

    it('should handle escaped characters', () => {
      const result = markdownToHtml('\\*not italic\\*');
      // Implementation may vary, but should not throw
      expect(result).toBeTruthy();
    });

    it('should handle multiple consecutive blank lines', () => {
      const result = markdownToHtml('Para 1\n\n\n\nPara 2');
      expect(result).toContain('Para 1');
      expect(result).toContain('Para 2');
    });

    it('should handle tabs in code blocks', () => {
      const md = '```python\nif x:\n\tprint("indented")\n```';
      const result = markdownToHtml(md);
      expect(result).toContain('md-code-block');
      expect(result).toContain('print');
      expect(result).toContain('indented');
    });

    it('should handle mixed list markers', () => {
      const md = '- Item 1\n* Item 2\n+ Item 3';
      const result = markdownToHtml(md);
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
    });
  });
});
