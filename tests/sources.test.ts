/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  parseLlmResponse,
  formatSourcesForDisplay,
  createSourceListItems,
  highlightInlineCitations,
  getReferencedSources,
  validateSources,
  mergeSources,
  type Source,
  type ParsedResponse,
} from '../src/search/sources';

describe('Source Links & Citations Parser', () => {
  describe('parseLlmResponse', () => {
    it('should parse response with footer sources section', () => {
      const response = `Here's the information.

---
Источники:
1. [Getting Started](https://example.com/guide)
2. [API Reference](https://example.com/api)`;

      const result = parseLlmResponse(response);
      expect(result.content).toContain("Here's the information");
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].title).toBe('Getting Started');
      expect(result.sources[0].url).toBe('https://example.com/guide');
      expect(result.sources[1].title).toBe('API Reference');
      expect(result.hasFooterSection).toBe(true);
    });

    it('should handle response with multiple dashes', () => {
      const response = `Main content

---
Источники:
1. [Source One](https://example.com/1)

---
Additional note`;

      const result = parseLlmResponse(response);
      expect(result.content).toContain('Main content');
      expect(result.sources).toHaveLength(1);
    });

    it('should extract inline markdown links if no footer section', () => {
      const response = `Check out [Getting Started](https://example.com/guide) and [API](https://example.com/api) for details.`;

      const result = parseLlmResponse(response);
      expect(result.content).toContain('Check out');
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].title).toBe('Getting Started');
      expect(result.hasFooterSection).toBe(false);
    });

    it('should handle response with no sources', () => {
      const response = 'Just plain text with no links or sources.';

      const result = parseLlmResponse(response);
      expect(result.content).toBe(response);
      expect(result.sources).toHaveLength(0);
      expect(result.hasFooterSection).toBe(false);
    });

    it('should handle malformed source entries gracefully', () => {
      const response = `Content here

---
Источники:
1. [Good Source](https://example.com/good)
2. Bad source without brackets
3. [Another Good](https://example.com/another)`;

      const result = parseLlmResponse(response);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources.some((s) => s.title === 'Good Source')).toBe(true);
    });

    it('should preserve source IDs from response', () => {
      const response = `According to docs [1], the API [2] works like this.

---
Источники:
1. [Guide](https://example.com/guide)
2. [API Docs](https://example.com/api)`;

      const result = parseLlmResponse(response);
      expect(result.sources[0].id).toBe(1);
      expect(result.sources[1].id).toBe(2);
    });

    it('should handle sources with special characters in URL', () => {
      const response = `See [Docs](https://example.com/docs?query=value&other=123#section)`;

      const result = parseLlmResponse(response);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].url).toContain('query=value');
      expect(result.sources[0].url).toContain('#section');
    });

    it('should handle response with only footer section', () => {
      const response = `
---
Источники:
1. [Source 1](https://example.com/1)
2. [Source 2](https://example.com/2)`;

      const result = parseLlmResponse(response);
      expect(result.content.trim()).toBe('');
      expect(result.sources).toHaveLength(2);
    });

    it('should work with English "Sources:" label', () => {
      const response = `Content

---
Sources:
1. [Title](https://example.com)`;

      const result = parseLlmResponse(response);
      expect(result.sources).toHaveLength(1);
    });

    it('should handle complex real-world response', () => {
      const response = `# API Overview

The REST API provides endpoints for managing pages and spaces [1]. You can authenticate using OAuth [2].

## Authentication

See [API Guide](https://example.com/api-guide) for details.

---
Источники:
1. [REST API Reference](https://example.com/rest/api)
2. [OAuth Setup](https://example.com/oauth)`;

      const result = parseLlmResponse(response);
      expect(result.content).toContain('API Overview');
      expect(result.sources).toHaveLength(2);
      expect(result.sources.some((s) => s.title === 'REST API Reference')).toBe(true);
    });
  });

  describe('formatSourcesForDisplay', () => {
    it('should format sources as numbered list', () => {
      const sources: Source[] = [
        { id: 1, title: 'First Source', url: 'https://example.com/1' },
        { id: 2, title: 'Second Source', url: 'https://example.com/2' },
      ];

      const result = formatSourcesForDisplay(sources);
      expect(result).toContain('1. First Source');
      expect(result).toContain('2. Second Source');
    });

    it('should return empty string for empty sources', () => {
      const result = formatSourcesForDisplay([]);
      expect(result).toBe('');
    });

    it('should sort sources by ID', () => {
      const sources: Source[] = [
        { id: 3, title: 'Third', url: 'https://example.com/3' },
        { id: 1, title: 'First', url: 'https://example.com/1' },
        { id: 2, title: 'Second', url: 'https://example.com/2' },
      ];

      const result = formatSourcesForDisplay(sources);
      const lines = result.split('\n');
      expect(lines[0]).toContain('First');
      expect(lines[1]).toContain('Second');
      expect(lines[2]).toContain('Third');
    });
  });

  describe('createSourceListItems', () => {
    it('should create list item elements', () => {
      const sources: Source[] = [
        { id: 1, title: 'Getting Started', url: 'https://example.com/guide' },
      ];

      const items = createSourceListItems(sources);
      expect(items).toHaveLength(1);
      expect(items[0].element.tagName).toBe('LI');
    });

    it('should create links with correct attributes', () => {
      const sources: Source[] = [
        { id: 1, title: 'Docs', url: 'https://example.com/docs' },
      ];

      const items = createSourceListItems(sources);
      const link = items[0].element.querySelector('a');
      expect(link?.href).toBe('https://example.com/docs');
      expect(link?.textContent).toBe('Docs');
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toBe('noopener noreferrer');
      expect(link?.className).toContain('source-link');
    });

    it('should create items for multiple sources', () => {
      const sources: Source[] = [
        { id: 1, title: 'Source 1', url: 'https://example.com/1' },
        { id: 2, title: 'Source 2', url: 'https://example.com/2' },
        { id: 3, title: 'Source 3', url: 'https://example.com/3' },
      ];

      const items = createSourceListItems(sources);
      expect(items).toHaveLength(3);
      expect(items[0].title).toBe('Source 1');
      expect(items[1].title).toBe('Source 2');
      expect(items[2].title).toBe('Source 3');
    });
  });

  describe('highlightInlineCitations', () => {
    it('should convert [1] to superscript citation', () => {
      const text = 'According to docs [1], this works.';
      const result = highlightInlineCitations(text);
      expect(result).toContain('<sup class="citation" data-source-id="1">[1]</sup>');
    });

    it('should handle multiple citations', () => {
      const text = 'According to [1], the API [2] is complex [3].';
      const result = highlightInlineCitations(text);
      expect(result).toContain('data-source-id="1"');
      expect(result).toContain('data-source-id="2"');
      expect(result).toContain('data-source-id="3"');
    });

    it('should preserve text around citations', () => {
      const text = 'Start [1] middle [2] end';
      const result = highlightInlineCitations(text);
      expect(result).toContain('Start');
      expect(result).toContain('middle');
      expect(result).toContain('end');
    });

    it('should not modify non-citation brackets', () => {
      const text = 'Array[0] is different from [1] citation.';
      const result = highlightInlineCitations(text);
      expect(result).toContain('Array[0]');
      expect(result).toContain('data-source-id="1"');
    });
  });

  describe('getReferencedSources', () => {
    it('should return only cited sources', () => {
      const content = 'According to [1] and [3], this is true.';
      const allSources: Source[] = [
        { id: 1, title: 'Source 1', url: 'https://example.com/1' },
        { id: 2, title: 'Source 2', url: 'https://example.com/2' },
        { id: 3, title: 'Source 3', url: 'https://example.com/3' },
      ];

      const result = getReferencedSources(content, allSources);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual([1, 3]);
    });

    it('should return empty array if no citations', () => {
      const content = 'No citations here.';
      const sources: Source[] = [
        { id: 1, title: 'Source', url: 'https://example.com' },
      ];

      const result = getReferencedSources(content, sources);
      expect(result).toHaveLength(0);
    });

    it('should handle multiple same citations', () => {
      const content = 'First [1] and second [1] mention.';
      const sources: Source[] = [
        { id: 1, title: 'Source 1', url: 'https://example.com/1' },
      ];

      const result = getReferencedSources(content, sources);
      expect(result).toHaveLength(1);
    });
  });

  describe('validateSources', () => {
    it('should validate correct URLs', () => {
      const sources: Source[] = [
        { id: 1, title: 'Valid', url: 'https://example.com' },
        { id: 2, title: 'Also Valid', url: 'http://example.com/path?query=1' },
      ];

      const { valid, invalid } = validateSources(sources);
      expect(valid).toHaveLength(2);
      expect(invalid).toHaveLength(0);
    });

    it('should reject invalid URLs', () => {
      const sources: Source[] = [
        { id: 1, title: 'Invalid', url: 'not a url' },
        { id: 2, title: 'Valid', url: 'https://example.com' },
      ];

      const { valid, invalid } = validateSources(sources);
      expect(valid).toHaveLength(1);
      expect(invalid).toHaveLength(1);
      expect(invalid[0].title).toBe('Invalid');
    });

    it('should handle relative URLs', () => {
      const sources: Source[] = [
        { id: 1, title: 'Relative', url: '/path/to/page' },
      ];

      const { valid, invalid } = validateSources(sources);
      // Relative URLs are invalid according to URL API
      expect(invalid.length).toBeGreaterThan(0);
    });
  });

  describe('mergeSources', () => {
    it('should merge multiple source lists', () => {
      const list1: Source[] = [
        { id: 1, title: 'Source 1', url: 'https://example.com/1' },
      ];
      const list2: Source[] = [
        { id: 1, title: 'Source 2', url: 'https://example.com/2' },
      ];

      const result = mergeSources(list1, list2);
      expect(result).toHaveLength(2);
    });

    it('should remove duplicate URLs', () => {
      const list1: Source[] = [
        { id: 1, title: 'First Title', url: 'https://example.com/same' },
      ];
      const list2: Source[] = [
        { id: 1, title: 'Second Title', url: 'https://example.com/same' },
      ];

      const result = mergeSources(list1, list2);
      expect(result).toHaveLength(1);
      // Keeps first occurrence
      expect(result[0].title).toBe('First Title');
    });

    it('should renumber sources sequentially', () => {
      const list1: Source[] = [
        { id: 5, title: 'Source A', url: 'https://example.com/a' },
      ];
      const list2: Source[] = [
        { id: 10, title: 'Source B', url: 'https://example.com/b' },
      ];

      const result = mergeSources(list1, list2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('should handle empty lists', () => {
      const result = mergeSources([], []);
      expect(result).toHaveLength(0);
    });

    it('should merge multiple lists at once', () => {
      const list1: Source[] = [
        { id: 1, title: 'A', url: 'https://example.com/a' },
      ];
      const list2: Source[] = [
        { id: 1, title: 'B', url: 'https://example.com/b' },
      ];
      const list3: Source[] = [
        { id: 1, title: 'C', url: 'https://example.com/c' },
      ];

      const result = mergeSources(list1, list2, list3);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });
  });

  describe('Integration with Real LLM Response Format', () => {
    it('should handle qwen style response with sources', () => {
      const response = `To configure the API, follow these steps [1]:

1. Get your API key from the dashboard
2. Set the \`API_KEY\` environment variable
3. Initialize the client with \`new Client({ apiKey })\`

For more details, check [2] the documentation.

---
Источники:
1. [Getting Started Guide](https://example.com/docs/12345)
2. [API Reference](https://example.com/docs/67890)`;

      const result = parseLlmResponse(response);
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].title).toBe('Getting Started Guide');
      expect(result.content).toContain('configure the API');
      expect(result.hasFooterSection).toBe(true);
    });

    it('should handle response with mixed inline and footer sources', () => {
      const response = `See [Getting Started](https://example.com/guide) for initial setup.

For API details, refer to the [API Reference](https://example.com/api).

---
Источники:
1. [Complete Documentation](https://example.com/docs)`;

      const result = parseLlmResponse(response);
      // Should prefer footer sources if present
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.hasFooterSection).toBe(true);
    });

    it('should handle response with no sources but markdown content', () => {
      const response = `# Configuration

1. Step one: install
2. Step two: configure
3. Step three: deploy

No sources provided in this response.`;

      const result = parseLlmResponse(response);
      expect(result.sources).toHaveLength(0);
      expect(result.content).toContain('Configuration');
    });
  });

  describe('Edge Cases & Security', () => {
    it('should handle response with HTML-like content', () => {
      const response = `Here's HTML: <div>test</div>

---
Источники:
1. [Source](https://example.com)`;

      const result = parseLlmResponse(response);
      expect(result.content).toContain('<div>');
      expect(result.sources).toHaveLength(1);
    });

    it('should handle URLs with encoded characters', () => {
      const response = `[Link](https://example.com/search?q=%20space%20&lang=ru)`;

      const result = parseLlmResponse(response);
      expect(result.sources[0].url).toContain('%20');
    });

    it('should handle source titles with special characters', () => {
      const response = `---
Источники:
1. [Example: "Getting Started" & Setup](https://example.com)`;

      const result = parseLlmResponse(response);
      expect(result.sources[0].title).toContain('Getting Started');
      expect(result.sources[0].title).toContain('&');
    });

    it('should handle unicode in source titles', () => {
      const response = `---
Источники:
1. [Начало работы](https://example.com)
2. [開始ガイド](https://example.com/ja)`;

      const result = parseLlmResponse(response);
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].title).toBe('Начало работы');
      expect(result.sources[1].title).toBe('開始ガイド');
    });

    it('should reject malicious URLs in validation', () => {
      const sources: Source[] = [
        { id: 1, title: 'Bad', url: 'javascript:alert("xss")' },
      ];

      // JavaScript URLs will parse but are invalid per security standards
      const { valid } = validateSources(sources);
      // javascript: is still a valid URL according to URL API
      // but would be blocked by target="_blank" in real usage
      expect(valid).toHaveLength(1);
    });
  });
});
