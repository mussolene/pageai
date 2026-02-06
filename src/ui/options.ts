const llmEndpointInput = document.getElementById("llm-endpoint") as HTMLInputElement | null;
const llmModelInput = document.getElementById("llm-model") as HTMLInputElement | null;
const llmApiKeyInput = document.getElementById("llm-api-key") as HTMLInputElement | null;
const llmSaveButton = document.getElementById("llm-save") as HTMLButtonElement | null;
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement | null;

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

