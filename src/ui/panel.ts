import type { MessageFromPanel, SearchResult } from "../types/messages";

const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
const searchButton = document.getElementById("search-button") as HTMLButtonElement | null;
const resultsContainer = document.getElementById("results") as HTMLDivElement | null;
const summarizeButton = document.getElementById("summarize-button") as HTMLButtonElement | null;
const summaryOutput = document.getElementById("summary-output") as HTMLTextAreaElement | null;

const llmEndpointInput = document.getElementById("llm-endpoint") as HTMLInputElement | null;
const llmModelInput = document.getElementById("llm-model") as HTMLInputElement | null;
const llmApiKeyInput = document.getElementById("llm-api-key") as HTMLInputElement | null;
const llmSaveButton = document.getElementById("llm-save") as HTMLButtonElement | null;
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement | null;

let currentResults: SearchResult[] = [];
const selectedIds = new Set<string>();

function renderResults(results: SearchResult[]) {
  if (!resultsContainer) return;
  resultsContainer.innerHTML = "";

  results.forEach((result) => {
    const div = document.createElement("div");
    div.className = "result";
    div.dataset.id = result.page.id;

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = result.page.title;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `${result.page.spaceKey ?? "no-space"} • score ${result.score}`;

    const url = document.createElement("a");
    url.className = "result-meta";
    url.href = result.page.url;
    url.textContent = "Open page";
    url.target = "_blank";

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(url);

    if (selectedIds.has(result.page.id)) {
      div.classList.add("selected");
    }

    div.addEventListener("click", () => {
      const id = result.page.id;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        div.classList.remove("selected");
      } else {
        selectedIds.add(id);
        div.classList.add("selected");
      }
      if (summarizeButton) {
        summarizeButton.disabled = selectedIds.size === 0;
      }
    });

    resultsContainer.appendChild(div);
  });
}

function sendMessage<TResponse>(message: MessageFromPanel): Promise<TResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      resolve(response);
    });
  });
}

async function handleSearch() {
  if (!searchInput) return;
  const query = searchInput.value.trim();
  if (!query) return;

  const response = await sendMessage<{
    ok: boolean;
    results?: SearchResult[];
    error?: string;
  }>({
    type: "SEARCH_QUERY",
    payload: { query }
  });

  if (!response.ok || !response.results) {
    if (summaryOutput) {
      summaryOutput.value = `Search error: ${response.error ?? "unknown error"}`;
    }
    return;
  }

  currentResults = response.results;
  renderResults(currentResults);
}

async function handleSummarize() {
  if (!summaryOutput) return;
  const pageIds = Array.from(selectedIds);
  if (pageIds.length === 0) return;

  summaryOutput.value = "Summarizing via local LLM...";

  const response = await sendMessage<{
    ok: boolean;
    summary?: { text?: string; error?: string };
    error?: string;
  }>({
    type: "SUMMARIZE",
    payload: { pageIds, query: searchInput?.value.trim() || undefined }
  });

  if (!response.ok || !response.summary) {
    summaryOutput.value = `Summary error: ${response.error ?? "unknown error"}`;
    return;
  }

  if (response.summary.error) {
    summaryOutput.value = `Summary error: ${response.summary.error}`;
  } else {
    summaryOutput.value = response.summary.text ?? "";
  }
}

function loadLlmConfig() {
  if (!llmEndpointInput || !llmModelInput || !llmApiKeyInput) return;
  chrome.storage.sync.get(
    {
      llmEndpoint: "http://localhost:11434/v1/chat/completions",
      llmModel: "llama3.1",
      llmApiKey: ""
    },
    (items) => {
      llmEndpointInput.value = items.llmEndpoint;
      llmModelInput.value = items.llmModel;
      llmApiKeyInput.value = items.llmApiKey;
    }
  );
}

function wireEvents() {
  searchButton?.addEventListener("click", () => {
    void handleSearch();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      void handleSearch();
    }
  });

  summarizeButton?.addEventListener("click", () => {
    void handleSummarize();
  });

  llmSaveButton?.addEventListener("click", () => {
    if (!llmEndpointInput || !llmModelInput || !llmApiKeyInput || !llmStatus) return;
    chrome.storage.sync.set(
      {
        llmEndpoint: llmEndpointInput.value.trim(),
        llmModel: llmModelInput.value.trim(),
        llmApiKey: llmApiKeyInput.value
      },
      () => {
        llmStatus.textContent = "Saved";
        setTimeout(() => {
          llmStatus.textContent = "";
        }, 1500);
      }
    );
  });
}

wireEvents();
loadLlmConfig();

