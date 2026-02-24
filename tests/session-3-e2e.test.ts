/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseLlmResponse, highlightInlineCitations, createSourceListItems } from '../src/search/sources';
import type { Source } from '../src/search/sources';

/**
 * Session #3 E2E Tests: Source Links & Citations in Chat
 * 
 * These tests validate:
 * - Source extraction from LLM responses
 * - Citation rendering in chat UI
 * - Source list display
 * - Integration with markdown rendering
 */

describe('Session #3 E2E: Source Links & Citations', () => {
  let chatContainer: HTMLDivElement;
  let messageContainer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-container">
        <div id="messages" style="display: flex; flex-direction: column; gap: 8px;"></div>
      </div>
    `;
    chatContainer = document.getElementById('chat-container') as HTMLDivElement;
    messageContainer = document.getElementById('messages') as HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Response with Footer Sources', () => {
    it('should extract and display sources from footer section', () => {
      const response = `To get started, install the package:

\`\`\`bash
npm install example-client
\`\`\`

Configure your API key and you're ready [1].

---
Источники:
1. [Getting Started Guide](https://example.com/docs/12345)`;

      const { content, sources } = parseLlmResponse(response);

      expect(sources).toHaveLength(1);
      expect(sources[0].title).toBe('Getting Started Guide');
      expect(sources[0].url).toContain('example.com');
      expect(content).toContain('install the package');
      expect(content).not.toContain('---');
      expect(content).not.toContain('Источники:');
    });

    it('should render sources as clickable list in chat', () => {
      const sources: Source[] = [
        { id: 1, title: 'API Reference', url: 'https://example.com/api' },
        { id: 2, title: 'Getting Started', url: 'https://example.com/start' },
      ];

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';

      const sourcesContainer = document.createElement('div');
      sourcesContainer.className = 'message-sources-container';

      const sourcesList = document.createElement('ul');
      sourcesList.className = 'sources-list md-list';

      const sourceItems = createSourceListItems(sources);
      sourceItems.forEach((item) => {
        sourcesList.appendChild(item.element);
      });

      sourcesContainer.appendChild(sourcesList);
      msgDiv.appendChild(sourcesContainer);
      messageContainer.appendChild(msgDiv);

      // Validate rendered sources
      const links = msgDiv.querySelectorAll('.source-link');
      expect(links).toHaveLength(2);
      expect(links[0].textContent).toBe('API Reference');
      expect(links[1].textContent).toBe('Getting Started');
      expect((links[0] as HTMLAnchorElement).href).toContain('example.com/api');
      expect((links[1] as HTMLAnchorElement).href).toContain('example.com/start');
    });

    it('should display sources in order with correct numbering', () => {
      const response = `The system consists of:
1. Backend service [1]
2. Frontend application [2]  
3. Database layer [3]

---
Источники:
1. [Backend Docs](https://example.com/backend)
2. [Frontend Guide](https://example.com/frontend)
3. [Database Schema](https://example.com/db)`;

      const { sources } = parseLlmResponse(response);

      expect(sources[0].id).toBe(1);
      expect(sources[1].id).toBe(2);
      expect(sources[2].id).toBe(3);
    });
  });

  describe('Inline Citations in Content', () => {
    it('should highlight inline citations [1], [2] in content', () => {
      const content = 'According to the docs [1], the API [2] supports webhooks [3].';
      const highlighted = highlightInlineCitations(content);

      expect(highlighted).toContain('<sup class="citation" data-source-id="1">[1]</sup>');
      expect(highlighted).toContain('<sup class="citation" data-source-id="2">[2]</sup>');
      expect(highlighted).toContain('<sup class="citation" data-source-id="3">[3]</sup>');
    });

    it('should render citations with hover effect in UI', () => {
      const content = 'Check [1] for details.';
      const highlighted = highlightInlineCitations(content);

      const msgDiv = document.createElement('div');
      msgDiv.innerHTML = highlighted;
      messageContainer.appendChild(msgDiv);

      const citation = msgDiv.querySelector('sup.citation');
      expect(citation).toBeTruthy();
      expect(citation?.getAttribute('data-source-id')).toBe('1');
    });

    it('should preserve text formatting around citations', () => {
      const content = 'This is **bold [1]** and *italic [2]*.';
      const highlighted = highlightInlineCitations(content);

      expect(highlighted).toContain('**bold');
      expect(highlighted).toContain('*italic');
      expect(highlighted).toContain('data-source-id="1"');
      expect(highlighted).toContain('data-source-id="2"');
    });
  });

  describe('Complex Multi-turn Conversations with Sources', () => {
    it('should render conversation with alternating sources', () => {
      const messages = [
        {
          role: 'user',
          content: 'How do I configure the API?',
        },
        {
          role: 'assistant',
          content: `First, get your API key [1].

---
Источники:
1. [Setup Guide](https://example.com/setup)`,
        },
        {
          role: 'user',
          content: 'What about authentication?',
        },
        {
          role: 'assistant',
          content: `Use OAuth 2.0 [1] or API tokens [2].

---
Источники:
1. [OAuth Documentation](https://example.com/oauth)
2. [Token Guide](https://example.com/tokens)`,
        },
      ];

      messages.forEach((msg) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;

        if (msg.role === 'assistant') {
          const { content, sources } = parseLlmResponse(msg.content);
          const msgContent = document.createElement('div');
          msgContent.textContent = content;
          msgDiv.appendChild(msgContent);

          if (sources.length > 0) {
            const sourcesContainer = document.createElement('div');
            sourcesContainer.className = 'message-sources-container';
            const sourcesList = document.createElement('ul');
            const sourceItems = createSourceListItems(sources);
            sourceItems.forEach((item) => {
              sourcesList.appendChild(item.element);
            });
            sourcesContainer.appendChild(sourcesList);
            msgDiv.appendChild(sourcesContainer);
          }
        } else {
          msgDiv.textContent = msg.content;
        }

        messageContainer.appendChild(msgDiv);
      });

      // Validate structure
      const assistantMessages = messageContainer.querySelectorAll('.message.assistant');
      expect(assistantMessages).toHaveLength(2);

      const sourceContainers = messageContainer.querySelectorAll('.message-sources-container');
      expect(sourceContainers).toHaveLength(2);

      // First assistant message should have 1 source
      const firstSources = assistantMessages[0].querySelectorAll('.source-link');
      expect(firstSources).toHaveLength(1);

      // Second assistant message should have 2 sources
      const secondSources = assistantMessages[1].querySelectorAll('.source-link');
      expect(secondSources).toHaveLength(2);
    });
  });

  describe('Integration with API response format', () => {
    it('should handle API response format with multiple sources', () => {
      const response = `The REST API provides access to resources [1].

Key features:
- CRUD operations
- Management endpoints
- Authentication [2]

---
Источники:
1. [REST API Documentation](https://example.com/api/pages)
2. [Authentication Guide](https://example.com/api/auth)`;

      const { sources } = parseLlmResponse(response);

      expect(sources).toHaveLength(2);
      expect(sources[0].url).toContain('example.com');
      expect(sources[1].title).toContain('Authentication');
    });

    it('should preserve URLs with complex query parameters', () => {
      const response = `See [Getting Started](https://example.com/docs?pageId=12345&spaceKey=DOC)`;

      const { sources } = parseLlmResponse(response);

      expect(sources[0].url).toContain('pageId=12345');
      expect(sources[0].url).toContain('spaceKey=DOC');
    });
  });

  describe('Edge Cases & Special Scenarios', () => {
    it('should handle response with no sources gracefully', () => {
      const response = 'This is a simple response with no sources or citations.';

      const { sources, content, hasFooterSection } = parseLlmResponse(response);

      expect(sources).toHaveLength(0);
      expect(content).toBe(response);
      expect(hasFooterSection).toBe(false);

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      msgDiv.textContent = content;
      messageContainer.appendChild(msgDiv);

      const sourcesContainer = msgDiv.querySelector('.message-sources-container');
      expect(sourcesContainer).toBeNull();
    });

    it('should handle very long source lists', () => {
      const sources: Source[] = Array(20)
        .fill(0)
        .map((_, i) => ({
          id: i + 1,
          title: `Reference ${i + 1}`,
          url: `https://example.com/ref/${i + 1}`,
        }));

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';

      const sourcesContainer = document.createElement('div');
      sourcesContainer.className = 'message-sources-container';
      const sourcesList = document.createElement('ul');
      const sourceItems = createSourceListItems(sources);
      sourceItems.forEach((item) => {
        sourcesList.appendChild(item.element);
      });
      sourcesContainer.appendChild(sourcesList);
      msgDiv.appendChild(sourcesContainer);
      messageContainer.appendChild(msgDiv);

      const links = msgDiv.querySelectorAll('.source-link');
      expect(links).toHaveLength(20);
    });

    it('should handle sources with special characters in titles', () => {
      const response = `---
Источники:
1. [API Reference: "REST & GraphQL"](https://example.com/api)
2. [Getting Started (v2.0)](https://example.com/start)
3. [FAQ/Troubleshooting](https://example.com/faq)`;

      const { sources } = parseLlmResponse(response);

      expect(sources).toHaveLength(3);
      expect(sources[0].title).toContain('REST & GraphQL');
      expect(sources[1].title).toContain('(v2.0)');
      expect(sources[2].title).toContain('Troubleshooting');
    });

    it('should render response with mixed markdown and citations', () => {
      const response = `# Configuration Guide

**Step 1:** Install the package [1]

\`\`\`bash
npm install package
\`\`\`

**Step 2:** Configure your API key [2]

> Important: Keep your API key secret!

**Step 3:** Test the connection [3]

---
Источники:
1. [Installation](https://example.com/install)
2. [Configuration](https://example.com/config)
3. [Testing](https://example.com/test)`;

      const { content, sources } = parseLlmResponse(response);

      expect(sources).toHaveLength(3);
      expect(content).toContain('Configuration Guide');
      expect(content).toContain('npm install');
      expect(content).toContain('Important');
    });

    it('should handle international content with sources', () => {
      const response = `关于API的说明书在这里[1]。
日本語のドキュメント[2]はここです。
Документация на русском языке[3].

---
Источники:
1. [中文文档](https://example.com/zh)
2. [日本語ドキュメント](https://example.com/ja)
3. [Русский документ](https://example.com/ru)`;

      const { sources } = parseLlmResponse(response);

      expect(sources).toHaveLength(3);
      expect(sources[0].title).toContain('中文');
      expect(sources[1].title).toContain('日本');
      expect(sources[2].title).toContain('Русский');
    });
  });

  describe('Performance & Scale', () => {
    it('should handle response with many inline citations efficiently', () => {
      const citations = Array(100)
        .fill(0)
        .map((_, i) => `fact [${i + 1}]`)
        .join(', ');

      const content = `Here are facts: ${citations}.`;
      const startTime = performance.now();
      const highlighted = highlightInlineCitations(content);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should be < 100ms
      expect(highlighted.match(/data-source-id="/g)).toHaveLength(100);
    });

    it('should render large source list without performance degradation', () => {
      const sources: Source[] = Array(50)
        .fill(0)
        .map((_, i) => ({
          id: i + 1,
          title: `Source ${i + 1} - Very Long Title That Takes Up Space To Simulate Real Data`,
          url: `https://example.com/source/${i + 1}`,
        }));

      const msgDiv = document.createElement('div');
      const sourcesContainer = document.createElement('div');
      const sourcesList = document.createElement('ul');

      const startTime = performance.now();
      const sourceItems = createSourceListItems(sources);
      sourceItems.forEach((item) => {
        sourcesList.appendChild(item.element);
      });
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(200); // Should be < 200ms
      expect(sourcesList.querySelectorAll('li')).toHaveLength(50);
    });
  });

  describe('Accessibility', () => {
    it('should maintain semantic HTML for source lists', () => {
      const sources: Source[] = [
        { id: 1, title: 'First', url: 'https://example.com/1' },
        { id: 2, title: 'Second', url: 'https://example.com/2' },
      ];

      const list = document.createElement('ul');
      list.className = 'sources-list';
      const sourceItems = createSourceListItems(sources);
      sourceItems.forEach((item) => {
        list.appendChild(item.element);
      });

      // Check semantic structure
      expect(list.querySelectorAll('li')).toHaveLength(2);
      expect(list.querySelectorAll('a')).toHaveLength(2);

      const links = list.querySelectorAll('a');
      links.forEach((link) => {
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      });
    });

    it('should preserve text content for screen readers', () => {
      const response = `Important information [1].

---
Источники:
1. [Documentation](https://example.com/docs)`;

      const { content, sources } = parseLlmResponse(response);
      const highlighted = highlightInlineCitations(content);

      const msgDiv = document.createElement('div');
      msgDiv.innerHTML = highlighted;

      // Text should still be readable
      expect(msgDiv.textContent).toContain('Important information');
      expect(msgDiv.textContent).toContain('[1]'); // Citation marker visible
    });
  });

  describe('Integration with Session #2 (Markdown Rendering)', () => {
    it('should render sources and markdown together', () => {
      const response = `# Using the API

To get started [1]:

1. **Install** the package
2. **Configure** your API key [2]
3. **Test** the connection

See the [documentation](https://example.com) for details.

---
Источники:
1. [Getting Started](https://example.com/start)
2. [Configuration Guide](https://example.com/config)`;

      const { content, sources } = parseLlmResponse(response);

      expect(content).toContain('Using the API');
      expect(sources).toHaveLength(2);

      // Both markdown formatting and sources should be present
      expect(content).toContain('**Install**');
      expect(content).toContain('[1]');
      expect(sources[0].title).toBe('Getting Started');
    });
  });
});
