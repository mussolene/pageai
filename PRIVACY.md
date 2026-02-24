# Privacy Policy / Конфиденциальность

PageAI is a local-first browser extension. This document describes what data is stored, where it is sent, and what is not collected.

## Data stored on your device

- **Chat history**: Messages and assistant replies are stored in the browser’s IndexedDB (database name: `pageai_extension`). They are not sent to any server by the extension itself.
- **Page content**: When you ask about the current page, the extension may store a text extract of the page in the same IndexedDB for that session. This is used only for search/summary in the extension.
- **LLM cache**: Optional cache (e.g. LLM responses) is stored in IndexedDB with a TTL and is used only to speed up repeated requests locally.
- **Settings**: Non-sensitive settings (LLM endpoint URL, model name, MCP server URLs, theme, etc.) may be stored in Chrome’s synced storage if you have Chrome sync enabled. **Sensitive data** (LLM API key) is stored only in **local** storage and is **not** synced to your Google account.

## Where data is sent

- **Default setup**: If you use a local LLM (e.g. LM Studio at `http://localhost:1234`), all chat and page content is sent only to that local server on your machine. No data is sent to the internet by the extension.
- **Custom LLM endpoint**: If you configure an external LLM URL (not localhost), the extension will ask for confirmation once. After that, chat messages and (when you ask about the current page) page content are sent to that URL. We do not control that server or its privacy practices.
- **MCP servers**: If you add MCP servers in settings, the extension may send requests (e.g. tool calls) to those URLs. Any data sent is defined by the tools you use and the MCP server configuration.

## What we do not do

- We do not collect analytics, usage data, or telemetry.
- We do not send your data to our own servers (there is no backend for this extension).
- We do not sell or share your data with third parties.

## Open source

This extension’s source code is available so you can verify this behavior. Storage keys and network behavior are implemented as described in the repository.

## Changes

We may update this document to reflect changes in the extension. Significant changes will be noted in the project’s release notes or commit history.
