/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderMarkdown } from '../src/ui/markdown';

/**
 * Session #2 E2E Tests: Markdown Rendering in Chat
 * 
 * These tests validate markdown rendering in the context of the chat UI,
 * including:
 * - Multi-turn conversations with markdown responses
 * - Various LLM response formats
 * - Visual integrity of rendered markdown
 * - Performance with complex responses
 */

describe('Session #2 E2E: Markdown Rendering in Chat', () => {
  let chatContainer: HTMLDivElement;
  let messageContainer: HTMLElement;

  beforeEach(() => {
    // Setup DOM structure similar to panel.html
    document.body.innerHTML = `
      <div id="chat-container">
        <div id="messages" style="display: flex; flex-direction: column; gap: 8px;"></div>
        <div id="input-area"></div>
      </div>
    `;
    chatContainer = document.getElementById('chat-container') as HTMLDivElement;
    messageContainer = document.getElementById('messages') as HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('LLM Response Rendering', () => {
    it('should render basic text response', () => {
      const response = 'This is a basic response from the LLM.';
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      expect(msgDiv.textContent).toContain(response);
      expect(msgDiv.innerHTML).toContain('md-paragraph');
    });

    it('should render response with code example', () => {
      const response = `To install the package, run:

\`\`\`bash
npm install example-package
\`\`\`

Then import it in your code.`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      expect(msgDiv.textContent).toContain('npm install');
      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
      expect(msgDiv.textContent).toContain('Then import');
    });

    it('should render instructions with numbered steps as list', () => {
      const response = `Steps to configure:
- Access the settings panel
- Enter your API key
- Click save to apply changes
- Verify in the logs`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      const list = msgDiv.querySelector('.md-list');
      expect(list).toBeTruthy();
      expect(msgDiv.querySelectorAll('li')).toHaveLength(4);
    });

    it('should render response with links to resources', () => {
      const response = `For more information, check these resources:
- [API Documentation](https://example.com/api)
- [Getting Started Guide](https://example.com/guide)
- [FAQ](https://example.com/faq)`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      const links = msgDiv.querySelectorAll('a.md-link');
      expect(links.length).toBeGreaterThanOrEqual(3);
      links.forEach((link) => {
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('href')).toBeTruthy();
      });
    });

    it('should render response with code block in multiple languages', () => {
      const response = `Examples in different languages:

**TypeScript:**
\`\`\`typescript
const response = await fetch('http://localhost:1234/');
const data = await response.json();
\`\`\`

**Python:**
\`\`\`python
import requests
response = requests.get('http://localhost:1234/')
data = response.json()
\`\`\`

**Bash:**
\`\`\`bash
curl http://localhost:1234/ | json_pp
\`\`\``;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
      expect(msgDiv.textContent).toContain('TypeScript');
      expect(msgDiv.textContent).toContain('Python');
      expect(msgDiv.textContent).toContain('Bash');
    });

    it('should render response with highlighted important information', () => {
      const response = `## Important Configuration

> **Warning:** This setting affects all workspaces. Make sure you have admin access before proceeding.

The key parameter is **api_token**. Do not share this value with anyone.

Use \`npm config set\` to set it:
\`\`\`bash
npm config set example:api_token=your-token
\`\`\``;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);
      expect(msgDiv.querySelector('.md-h2')).toBeTruthy();
      expect(msgDiv.querySelector('.md-quote')).toBeTruthy();
      expect(msgDiv.querySelector('.md-bold')).toBeTruthy();
      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
    });

    it('should render technical documentation response', () => {
      const response = `# API Reference

## Authentication

The API requires an \`Authorization\` header:

\`\`\`
Authorization: Bearer YOUR_ACCESS_TOKEN
\`\`\`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/pages | GET | List all pages |
| /api/pages | POST | Create new page |
| /api/pages/{id} | GET | Get page by ID |
| /api/pages/{id} | PUT | Update page |

## Error Handling

> Always check the response status code before parsing the response body.

Common error codes:
- \`401\`: Unauthorized - Invalid or missing token
- \`403\`: Forbidden - Insufficient permissions
- \`404\`: Not Found - Page does not exist
- \`429\`: Rate Limited - Too many requests`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      expect(msgDiv.querySelector('.md-h1')).toBeTruthy();
      expect(msgDiv.querySelector('.md-h2')).toBeTruthy();
      expect(msgDiv.querySelector('.md-code-inline')).toBeTruthy();
      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
      expect(msgDiv.querySelector('.md-table')).toBeTruthy();
      expect(msgDiv.querySelector('.md-quote')).toBeTruthy();
      expect(msgDiv.querySelector('.md-list')).toBeTruthy();
    });
  });

  describe('Multi-turn Conversation', () => {
    it('should render conversation with alternating user and assistant messages', () => {
      const conversation = [
        {
          role: 'user',
          content: 'How do I configure the API client?',
          html: false,
        },
        {
          role: 'assistant',
          content: `Here's how to configure the API client:

1. Install the package: \`npm install @api/client\`
2. Import it: \`import { Client } from '@api/client';\`
3. Configure: \`const client = new Client({ token: 'your-token' });\`

That's it!`,
          html: true,
        },
        {
          role: 'user',
          content: 'What about authentication?',
          html: false,
        },
        {
          role: 'assistant',
          content: `**Authentication** uses OAuth 2.0:

\`\`\`typescript
const client = new Client({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
});

await client.authenticate();
\`\`\`

See [the auth guide](https://example.com/auth) for details.`,
          html: true,
        },
      ];

      conversation.forEach((msg, idx) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;
        msg.role === 'assistant' && messageContainer.appendChild(msgDiv);

        if (msg.html && msg.role === 'assistant') {
          renderMarkdown(msgDiv, msg.content);
        } else {
          msgDiv.textContent = msg.content;
        }
      });

      const assistantMessages = messageContainer.querySelectorAll('.assistant');
      expect(assistantMessages.length).toBeGreaterThan(0);

      // Check first assistant message has markdown
      const firstAssistant = assistantMessages[0];
      expect(firstAssistant.querySelector('.md-code-inline')).toBeTruthy();

      // Check second assistant message has markdown table/code
      const secondAssistant = assistantMessages[1];
      expect(secondAssistant.querySelector('.md-bold')).toBeTruthy();
      expect(secondAssistant.querySelector('.md-code-block')).toBeTruthy();
      expect(secondAssistant.querySelector('.md-link')).toBeTruthy();
    });

    it('should maintain visual separation between messages', () => {
      for (let i = 0; i < 5; i++) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${i % 2 === 0 ? 'user' : 'assistant'}`;
        renderMarkdown(msgDiv, `Message ${i}`);
        messageContainer.appendChild(msgDiv);
      }

      const allMessages = messageContainer.querySelectorAll('.message');
      expect(allMessages).toHaveLength(5);
      allMessages.forEach((msg) => {
        expect(msg.textContent).toMatch(/Message \d/);
      });
    });
  });

  describe('Complex Response Scenarios', () => {
    it('should handle response with mixed formatting levels', () => {
      const response = `# Advanced Configuration

## Database Setup

### PostgreSQL Connection

\`\`\`typescript
const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'admin',
  password: process.env.DB_PASSWORD,
};
\`\`\`

**Important:** Keep your password in environment variables, not in code.

\`\`\`bash
export DB_PASSWORD=secure_password_123
\`\`\`

See [database docs](https://example.com/db).`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      expect(msgDiv.querySelector('.md-h1')).toBeTruthy();
      expect(msgDiv.querySelector('.md-h2')).toBeTruthy();
      expect(msgDiv.querySelector('.md-h3')).toBeTruthy();
      expect(msgDiv.querySelectorAll('.md-code-block')).toHaveLength(2);
      expect(msgDiv.querySelector('.md-bold')).toBeTruthy();
      expect(msgDiv.querySelector('.md-link')).toBeTruthy();
    });

    it('should render response with inline code mixed with bold/italic', () => {
      const response = 'The **`npm install`** command is *essential* for setup. Use `npm -v` to verify.';

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      expect(msgDiv.querySelector('.md-bold')).toBeTruthy();
      expect(msgDiv.querySelector('.md-italic')).toBeTruthy();
      expect(msgDiv.querySelectorAll('.md-code-inline')).toHaveLength(2);
    });

    it('should escape HTML patterns in user query responses', () => {
      const response =
        'The <Component /> JSX syntax requires React. Use <img /> for images.';

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      // Should not render actual HTML elements
      expect(msgDiv.querySelector('img')).toBeNull();
      // Should show escaped HTML
      expect(msgDiv.textContent).toContain('<Component />');
      expect(msgDiv.textContent).toContain('<img />');
    });

    it('should handle response with changelog/version history', () => {
      const response = `# Release Notes v2.0

## New Features

- **Real-time sync** across devices
- *Offline mode* support with auto-sync
- \`Enhanced search\` with filters

## Bug Fixes

| Issue | Status |
|-------|--------|
| Password reset | ✓ Fixed |
| Upload timeout | ✓ Fixed |
| Cache clearing | ✓ Fixed |

> **Note:** Upgrade is recommended for all users.`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      expect(msgDiv.querySelector('.md-h1')).toBeTruthy();
      expect(msgDiv.querySelector('.md-list')).toBeTruthy();
      expect(msgDiv.querySelector('.md-table')).toBeTruthy();
      expect(msgDiv.querySelector('.md-quote')).toBeTruthy();
    });
  });

  describe('Performance and Scale', () => {
    it('should handle large response efficiently', () => {
      const largeMd = Array(50)
        .fill(0)
        .map(
          (_, i) => `
## Section ${i}

This is content for section ${i}.

\`\`\`typescript
const item = { id: ${i}, timestamp: Date.now() };
\`\`\`

- Point 1
- Point 2
- Point 3
`,
        )
        .join('\n');

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      const startTime = performance.now();
      renderMarkdown(msgDiv, largeMd);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1s
      expect(msgDiv.querySelector('.md-h2')).toBeTruthy();
      expect(msgDiv.querySelectorAll('.md-code-block').length).toBeGreaterThan(10);
    });

    it('should handle response with many links without degradation', () => {
      const linksArray = Array(20)
        .fill(0)
        .map((_, i) => `[Link ${i}](https://example.com/page/${i})`)
        .join('\n');

      const response = `Resources:\n${linksArray}`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      const links = msgDiv.querySelectorAll('a.md-link');
      expect(links.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Plaintext Fallback', () => {
    it('should gracefully handle plaintext response when markdown fails', () => {
      const plaintext = 'This is a simple plaintext response with no special formatting.';

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, plaintext);
      expect(msgDiv.textContent).toContain(plaintext);
    });

    it('should render simple text responses without markdown elements', () => {
      const responses = [
        'Yes',
        'No',
        'The answer is 42.',
        'I am ready to help.',
      ];

      responses.forEach((res) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message assistant';
        messageContainer.appendChild(msgDiv);

        renderMarkdown(msgDiv, res);
        expect(msgDiv.textContent).toContain(res);
      });
    });
  });

  describe('Accessibility', () => {
    it('should render semantic HTML for accessibility', () => {
      const response = `# Heading

A paragraph with **bold** text.

- List item 1
- List item 2

\`\`\`
code block
\`\`\``;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      // Check semantic elements exist
      expect(msgDiv.querySelector('h1')).toBeTruthy();
      expect(msgDiv.querySelector('ul')).toBeTruthy();
      expect(msgDiv.querySelector('li')).toBeTruthy();
      expect(msgDiv.querySelector('pre')).toBeTruthy();
      expect(msgDiv.querySelector('code')).toBeTruthy();
    });

    it('should preserve text content for screen readers', () => {
      const response = 'Visit [our docs](https://example.com) for more info.';

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      // Text should be accessible
      expect(msgDiv.textContent).toContain('Visit');
      expect(msgDiv.textContent).toContain('our docs');
      expect(msgDiv.textContent).toContain('for more info');
    });
  });

  describe('Integration with LM Studio Responses', () => {
    it('should render typical qwen/qwen3-4b response format', () => {
      const llmResponse = `To install the package:

\`\`\`bash
npm install example-api
\`\`\`

Key features:
- Fast and lightweight
- Full REST API support
- Offline caching enabled

See the [documentation](https://docs.example.com) for more.`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, llmResponse);

      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
      expect(msgDiv.querySelector('.md-list')).toBeTruthy();
      expect(msgDiv.querySelector('.md-link')).toBeTruthy();
      expect(msgDiv.textContent).toContain('npm install');
    });

    it('should handle JSON response with markdown', () => {
      const response = `The API returns JSON:

\`\`\`json
{
  "status": "success",
  "data": {
    "pages": [
      { "id": 1, "title": "Getting Started" },
      { "id": 2, "title": "API Reference" }
    ]
  }
}
\`\`\`

Each page has **id** and **title** fields.`;

      const msgDiv = document.createElement('div');
      msgDiv.className = 'message assistant';
      messageContainer.appendChild(msgDiv);

      renderMarkdown(msgDiv, response);

      expect(msgDiv.querySelector('.md-code-block')).toBeTruthy();
      expect(msgDiv.textContent).toContain('status');
      expect(msgDiv.querySelector('.md-bold')).toBeTruthy();
    });
  });
});
