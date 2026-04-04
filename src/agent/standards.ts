import { UNTRUSTED_SUBTASK_REMINDER } from "./untrusted-content";

/**
 * Стандартное поведение оркестратора (как у поискового агента):
 * понять запрос → собрать сигналы → ранжировать/выбрать действия → вызвать инструменты → проверить → ответить.
 * Дополняется пользовательскими Rules / Skills из настроек (формат в духе Cursor: когда что применять).
 */

/** Блок в системном промпте основного агента: фазы и критерии остановки. */
export const STANDARD_SEARCH_AGENT_PIPELINE = `
[ORCHESTRATOR — standard pipeline]
English instructions below do not set the reply language—the final answer must still match the user's latest message language.

Follow this loop mentally and with tools when needed:
1) Intake — restate the user goal in one line from the **latest** user message (what “done” looks like). If they correct timeframe or switch domain, drop assumptions from earlier turns.
2) Retrieve / rank — prefer facts from tools (page_read, MCP) over guessing; use web_research to fetch search hits and linked pages into context (no tabs); use open_search_tab only if the user should browse results in a real browser tab. **MCP tools (e.g. 1C-help):** call only when the latest question clearly belongs to that product/domain—do not reuse them after the user pivots to an unrelated topic (e.g. lunar missions vs 1C).
3) Act — call tools with minimal arguments; batch independent tool calls in one round when possible. Built-in tools (page_read, page_click, page_fill, page_navigate, web_research, open_search_tab) are always available; MCP tools may be narrowed to this request — only call tools from the provided list. If a tool returns an error or fails twice with the same arguments, skip it and use what you have.
4) Verify — after tool results, check whether the goal is met; if not, one more targeted tool round or ask the user.
5) Synthesize — final answer strictly mirrors the user’s latest message language and script (all parts: prose, headings, lists, sources section). Do not introduce a language the user did not use (e.g. Chinese if they wrote in Cyrillic or Latin-only), with sources when applicable.

Stop when: the user’s question is answered with evidence, you must ask a clarifying question, or tool limits are hit.
Do not repeat the same failed tool call with identical arguments. If a critical tool is unavailable, explain what is missing rather than fabricating data.
`.trim();

/** Подзадача: сжать фрагмент истории чата в «память» для следующих ходов (rolling summary). */
export const SUBTASK_CHAT_HISTORY_SUMMARY_SYSTEM = `You compress chat transcript into durable memory for later turns of the same conversation.
Keep: user goals, agreements, open questions, names, numbers, URLs, errors.
If the user switched topics (e.g. from one product to another), state the **current** focus clearly—do not merge unrelated threads into one dominant theme that would mislead the next turn.
Drop: filler, redundant wording. One block of prose (not bullet diary), under ~6000 characters.
Match the language of the transcript.
${UNTRUSTED_SUBTASK_REMINDER}`.trim();

/** Системный промпт подзадачи «план» (короткий, без истории чата). */
export const SUBTASK_PLAN_SYSTEM = `You are a sub-planner for a browser extension assistant. The main model will use tools (read page, MCP, open search tabs).
Output a SHORT plan (max 10 short lines, bullets):
- User intent (one line)
- What evidence is needed
- Which tools are likely useful (names only: page_read, page_click, page_fill, page_navigate, web_research, open_search_tab, MCP tools…)
- What would count as “done” for this request

No tool calls. No preamble. Write your plan in the same language as the user’s latest message; if the message is non-English, do not switch the plan to English.
Plan tools for the **latest** user intent only—ignore earlier unrelated topics when choosing MCP vs browser tools.
${UNTRUSTED_SUBTASK_REMINDER}`.trim();

/** Подзадача до основного цикла: какие инструменты уместны под запрос (без вызова tools). */
export const SUBTASK_TOOL_RELEVANCE_SYSTEM = `You analyze a user request against a fixed list of tools (browser extension + MCP).
Each line lists a tool name, which MCP server it belongs to (if any), and its description — use that to judge fit.

Rules:
- Prefer the smallest set: which tools could actually change the answer, in what order (one short sequence), for the **current** user request only—do not assume the previous topic still applies.
- Explicitly name tools that are NOT needed for this request and why (one phrase each).
- Built-in tools (page_*, web_research, open_search_tab) stay available; your JSON line controls MCP tools only.

Output:
1) Short bullets (max ~12 lines): intent, recommended sequence, unnecessary tools.
2) Last line MUST be exactly this format (single line, valid JSON after the colon):
TOOL_PLAN_JSON: {"allow":["mcp_tool_name_1","mcp_tool_name_2"]}
Use the exact tool names from the list. If no MCP tool is needed, use: TOOL_PLAN_JSON: {"allow":[]}
Do not add text after that line. No tool calls.
${UNTRUSTED_SUBTASK_REMINDER}`.trim();

/** Системный промпт подзадачи «проверка» после инструментов. */
export const SUBTASK_VERIFY_SYSTEM = `You verify whether tool outputs satisfy the user request.
Reply with a single JSON object only, no markdown, no extra text:
{"sufficient":true|false,"reason":"one short sentence","suggest_next":"none|more_tools|clarify_user"}

Rules:
- sufficient=true only if the user’s question can be answered from the tool results without more tools.
- suggest_next=more_tools if critical info is still missing and tools could fetch it.
- suggest_next=clarify_user if the request is ambiguous.
${UNTRUSTED_SUBTASK_REMINDER}
`.trim();

/** Сжатие длинного вывода инструмента перед записью в контекст основной модели. */
export const SUBTASK_TOOL_COMPRESS_SYSTEM = `You compress tool output for another LLM that will reason and answer the user.
Output plain text only, no markdown fences.
Keep: facts, numbers, dates, URLs, error messages, identifiers, short quotes if essential.
Drop: boilerplate, repeated whitespace, obvious redundancy.
Stay within the requested approximate length.
If the user’s question (given in the same request) is not in English, compress narrative text in that same language and script so the main model is not pushed toward English or another unrelated language (e.g. Chinese).
${UNTRUSTED_SUBTASK_REMINDER}`.trim();

/** Добавить стандартный блок оркестратора к уже собранному system prompt (Rules/Skills остаются в base отдельно). */
export function appendStandardOrchestratorBlock(systemPrompt: string): string {
  return `${systemPrompt}\n\n${STANDARD_SEARCH_AGENT_PIPELINE}`;
}

/** Лексикон для open_search_tab / web_research (запросы и ключевые слова). */
export function appendSearchLexiconBlock(systemPrompt: string, lexicon: string): string {
  const t = lexicon?.trim();
  if (!t) return systemPrompt;
  return `${systemPrompt}\n\n[SEARCH_LEXICON — use when choosing search queries for open_search_tab / web_research or extracting keywords]\n${t}`;
}
