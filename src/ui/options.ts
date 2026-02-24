import { checkLlmConnection, getLMStudioModelsForEndpoint, normalizeEndpoint, isLocalLlmEndpoint } from "../llm/client";
import {
  checkMcpConnection,
  parseMcpServersConfigForCheck,
  parseMcpServersList,
  listMcpTools,
  getDefaultMcpServersConfig
} from "../mcp/client";
import { translate, getStoredLocale } from "../i18n";

const llmEndpointTypeSelect = document.getElementById("llm-endpoint-type") as HTMLSelectElement | null;
const llmEndpointInput = document.getElementById("llm-endpoint") as HTMLInputElement | null;
const llmModelInput = document.getElementById("llm-model") as HTMLInputElement | null;
const llmApiKeyInput = document.getElementById("llm-api-key") as HTMLInputElement | null;
const llmSaveButton = document.getElementById("llm-save") as HTMLButtonElement | null;
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement | null;
const llmFetchModelsBtn = document.getElementById("llm-fetch-models") as HTMLButtonElement | null;
const llmModelSelect = document.getElementById("llm-model-select") as HTMLSelectElement | null;
const mcpServersConfigInput = document.getElementById("mcp-servers-config") as HTMLTextAreaElement | null;
const mcpServersListEl = document.getElementById("mcp-servers-list") as HTMLDivElement | null;
const mcpCheckBtn = document.getElementById("mcp-check") as HTMLButtonElement | null;
const mcpStatus = document.getElementById("mcp-status") as HTMLSpanElement | null;

function loadLlmConfig() {
  if (!llmEndpointInput || !llmModelInput || !llmApiKeyInput) return;
  chrome.storage.sync.get(
    {
      llmEndpoint: "http://localhost:1234",
      llmEndpointType: "chat" as "chat" | "custom",
      llmModel: "qwen/qwen3-4b-2507",
      mcpServersConfig: "",
      mcpServerUrl: "",
      mcpHeaders: "",
      mcpServersEnabled: {} as Record<string, boolean>
    },
    (items) => {
      const endpointType = items.llmEndpointType === "custom" ? "custom" : "chat";
      if (llmEndpointTypeSelect) llmEndpointTypeSelect.value = endpointType;
      let endpointDisplay = items.llmEndpoint ?? "";
      if (endpointType === "chat" && endpointDisplay.endsWith("/v1/chat/completions")) {
        endpointDisplay = endpointDisplay.replace(/\/v1\/chat\/completions\/?$/i, "");
      }
      llmEndpointInput!.value = endpointDisplay;
      llmModelInput.value = items.llmModel;
      chrome.storage.local.get({ llmApiKey: "" }, (local) => {
        llmApiKeyInput!.value = (local.llmApiKey as string) ?? "";
      });
      if (mcpServersConfigInput) {
        let config = items.mcpServersConfig || "";
        if (!config && items.mcpServerUrl) {
          let headers: Record<string, string> | undefined;
          if (items.mcpHeaders) {
            try {
              headers = JSON.parse(items.mcpHeaders as string) as Record<string, string>;
            } catch {
              /* ignore */
            }
          }
          config = JSON.stringify({
            mcpServers: {
              legacy: {
                url: items.mcpServerUrl,
                ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
              }
            }
          }, null, 2);
        }
        mcpServersConfigInput.value = config || getDefaultMcpServersConfig();
        void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput.value);
      }
    }
  );
}

async function renderMcpServersList(
  enabled: Record<string, boolean>,
  configJson: string
) {
  if (!mcpServersListEl) return;
  mcpServersListEl.innerHTML = "";
  const parsed = parseMcpServersList(configJson);
  if ("error" in parsed || parsed.servers.length === 0) return;
  const toolsLabel = await translate("settings.mcpTools");
  const loadingLabel = await translate("settings.checkingMcp") || "Loading…";
  const noToolsLabel = await translate("settings.mcpNoTools") || "No tools";
  for (const server of parsed.servers) {
    const row = document.createElement("div");
    row.className = "mcp-server-row";
    const leftCol = document.createElement("div");
    leftCol.className = "mcp-server-row-left";
    const nameSpan = document.createElement("span");
    nameSpan.className = "mcp-server-name";
    nameSpan.textContent = server.name;
    leftCol.appendChild(nameSpan);
    const details = document.createElement("details");
    details.className = "mcp-tools-details";
    const summary = document.createElement("summary");
    summary.className = "mcp-tools-summary";
    summary.textContent = toolsLabel;
    details.appendChild(summary);
    const toolsContainer = document.createElement("div");
    toolsContainer.className = "mcp-tools-container";
    details.appendChild(toolsContainer);
    const serverUrl = server.url;
    const serverHeaders = server.headers;
    details.addEventListener("toggle", () => {
      if (!details.open || toolsContainer.children.length > 0 || !serverUrl) return;
      toolsContainer.textContent = loadingLabel;
      listMcpTools(serverUrl, { headers: serverHeaders }).then(async (res) => {
        toolsContainer.innerHTML = "";
        toolsContainer.className = "mcp-tools-container";
        if ("error" in res) {
          toolsContainer.textContent = res.error;
          toolsContainer.classList.add("mcp-tools-error");
          return;
        }
        if (res.tools.length === 0) {
          toolsContainer.textContent = noToolsLabel;
          return;
        }
        const ul = document.createElement("ul");
        ul.className = "mcp-tools-list";
        for (const tool of res.tools) {
          const li = document.createElement("li");
          li.className = "mcp-tool-item";
          const nameEl = document.createElement("span");
          nameEl.className = "mcp-tool-name";
          nameEl.textContent = tool.name;
          li.appendChild(nameEl);
          if (tool.description) {
            const desc = document.createElement("span");
            desc.className = "mcp-tool-desc";
            desc.textContent = tool.description;
            li.appendChild(desc);
          }
          if (tool.inputSchema?.properties && typeof tool.inputSchema.properties === "object") {
            const params = Object.keys(tool.inputSchema.properties) as string[];
            if (params.length > 0) {
              const paramsEl = document.createElement("span");
              paramsEl.className = "mcp-tool-params";
              paramsEl.textContent = `(${params.join(", ")})`;
              li.appendChild(paramsEl);
            }
          }
          ul.appendChild(li);
        }
        toolsContainer.appendChild(ul);
      });
    });
    leftCol.appendChild(details);
    row.appendChild(leftCol);
    const switchWrap = document.createElement("label");
    switchWrap.className = "mcp-server-toggle-wrap";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "mcp-server-toggle";
    toggle.checked = enabled[server.name] !== false;
    toggle.setAttribute("aria-label", `Enable ${server.name}`);
    switchWrap.appendChild(toggle);
    row.appendChild(switchWrap);
    mcpServersListEl.appendChild(row);
    toggle.addEventListener("change", () => {
      const next = { ...enabled, [server.name]: toggle.checked };
      chrome.storage.sync.set({ mcpServersEnabled: next });
    });
  }
}

function getEndpointType(): "chat" | "custom" {
  return (llmEndpointTypeSelect?.value === "custom" ? "custom" : "chat") as "chat" | "custom";
}

async function saveLlmConfig() {
  if (!llmEndpointInput || !llmModelInput || !llmStatus) return;
  const endpointRaw = llmEndpointInput.value.trim();
  const model = llmModelInput.value.trim();
  const endpointType = getEndpointType();
  if (!endpointRaw || !model) {
    llmStatus.textContent = await translate("options.enterEndpointAndModel");
    llmStatus.className = "status error";
    return;
  }
  const endpoint = normalizeEndpoint(endpointRaw, endpointType);
  if (!endpoint) {
    llmStatus.textContent = await translate("options.enterEndpointFirst");
    llmStatus.className = "status error";
    return;
  }
  llmStatus.textContent = await translate("settings.checking");
  llmStatus.className = "status info";
  const check = await checkLlmConnection(endpoint, model);
  if (!check.available) {
    llmStatus.textContent = "\u2716 " + check.error;
    llmStatus.className = "status error";
    return;
  }
  if (!isLocalLlmEndpoint(endpointRaw)) {
    const externalMsg =
      (await translate("options.externalEndpointWarning")) ||
      "Chat and page content will be sent to this server. Continue?";
    const confirmed = await new Promise<boolean>((resolve) => {
      chrome.storage.sync.get({ llmExternalEndpointConfirmed: false }, (items) => {
        if (items.llmExternalEndpointConfirmed) {
          resolve(true);
          return;
        }
        resolve(window.confirm(externalMsg));
      });
    });
    if (!confirmed) {
      llmStatus.textContent = (await translate("options.saveCancelled")) || "Save cancelled.";
      llmStatus.className = "status error";
      return;
    }
    await new Promise<void>((r) => chrome.storage.sync.set({ llmExternalEndpointConfirmed: true }, r));
  }
  const apiKey = llmApiKeyInput?.value ?? "";
  chrome.storage.local.set({ llmApiKey: apiKey });
  const toSave: Record<string, unknown> = {
    llmEndpoint: endpointRaw,
    llmEndpointType: endpointType,
    llmModel: model
  };
  if (mcpServersConfigInput?.value.trim()) toSave.mcpServersConfig = mcpServersConfigInput.value.trim();
  chrome.storage.sync.set(toSave, async () => {
    llmStatus.textContent = await translate("options.saved");
    llmStatus.className = "status success";
    setTimeout(() => { llmStatus.textContent = ""; llmStatus.className = "status"; }, 2000);
  });
}

async function fetchModels() {
  if (!llmFetchModelsBtn || !llmModelSelect || !llmEndpointInput || !llmStatus) return;
  const endpointRaw = llmEndpointInput.value.trim();
  if (!endpointRaw) {
    llmStatus.textContent = await translate("options.enterEndpointFirst");
    llmStatus.className = "status error";
    return;
  }
  const endpoint = normalizeEndpoint(endpointRaw, getEndpointType());
  if (!endpoint) {
    llmStatus.textContent = await translate("options.enterEndpointFirst");
    llmStatus.className = "status error";
    return;
  }
  llmFetchModelsBtn.disabled = true;
  llmModelSelect.innerHTML = "";
  llmStatus.textContent = await translate("settings.checking");
  llmStatus.className = "status info";
  try {
    const result = await getLMStudioModelsForEndpoint(endpoint);
    if ("error" in result) {
      llmStatus.textContent = result.error;
      llmStatus.className = "status error";
      return;
    }
    llmStatus.textContent = "";
    result.models.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      llmModelSelect.appendChild(opt);
    });
    if (result.models.length > 0 && llmModelInput && !llmModelInput.value)
      llmModelInput.value = result.models[0];
  } catch (err) {
    llmStatus.textContent = (err as Error).message || "Failed to fetch models";
    llmStatus.className = "status error";
  } finally {
    llmFetchModelsBtn.disabled = false;
  }
}

async function checkMcp() {
  if (!mcpCheckBtn || !mcpStatus || !mcpServersConfigInput) return;
  const json = mcpServersConfigInput.value.trim();
  const parsed = parseMcpServersConfigForCheck(json);
  if ("error" in parsed) {
    mcpStatus.textContent = "\u2716 " + parsed.error;
    mcpStatus.className = "status error";
    setTimeout(() => { mcpStatus.textContent = ""; mcpStatus.className = "status"; }, 3000);
    return;
  }
  mcpCheckBtn.disabled = true;
  mcpStatus.textContent = await translate("settings.checkingMcp");
  mcpStatus.className = "status info";
  const result = await checkMcpConnection(parsed.url, { headers: parsed.headers });
  mcpCheckBtn.disabled = false;
  if (result.ok) {
    mcpStatus.textContent = await translate("settings.mcpConnected");
    mcpStatus.className = "status success";
  } else {
    mcpStatus.textContent = "\u2716 " + result.error;
    mcpStatus.className = "status error";
  }
  setTimeout(() => { mcpStatus.textContent = ""; mcpStatus.className = "status"; }, 3000);
}

async function updateUI() {
  const locale = await getStoredLocale();
  document.documentElement.lang = locale === "ru" ? "ru" : "en";

  document.title = await translate("options.title");
  const title = document.querySelector(".title");
  const subtitle = document.querySelector(".subtitle");
  if (title) title.textContent = await translate("options.title");
  if (subtitle) subtitle.textContent = await translate("options.subtitle");

  const llmSummary = document.getElementById("options-llm-summary");
  const mcpSummary = document.getElementById("options-mcp-summary");
  if (llmSummary) llmSummary.textContent = await translate("options.llmSection");
  if (mcpSummary) mcpSummary.textContent = await translate("settings.mcpServersConfig");

  const endpointTypeLabel = document.querySelector('label:has(#llm-endpoint-type) .label-text');
  const endpointLabel = document.getElementById("options-endpoint-label");
  const modelLabel = document.getElementById("options-model-label");
  const apiKeyLabel = document.getElementById("options-apikey-label");
  const mcpLabel = document.getElementById("options-mcp-label");
  if (endpointTypeLabel) endpointTypeLabel.textContent = await translate("settings.endpointType");
  if (llmEndpointTypeSelect) {
    const typeOpts = llmEndpointTypeSelect.querySelectorAll("option");
    if (typeOpts[0]) typeOpts[0].textContent = await translate("settings.endpointTypeChat");
    if (typeOpts[1]) typeOpts[1].textContent = await translate("settings.endpointTypeCustom");
  }
  if (endpointLabel) endpointLabel.textContent = await translate("options.endpoint");
  if (modelLabel) modelLabel.textContent = await translate("options.model");
  if (apiKeyLabel) apiKeyLabel.textContent = await translate("options.apiKey");
  if (mcpLabel) mcpLabel.textContent = await translate("settings.mcpServersConfig");

  if (llmEndpointInput) llmEndpointInput.placeholder = getEndpointType() === "custom" ? (await translate("settings.llmEndpointPlaceholderCustom")) : (await translate("settings.llmEndpointPlaceholder"));
  if (llmModelInput) llmModelInput.placeholder = await translate("settings.modelPlaceholder");
  if (llmSaveButton) llmSaveButton.textContent = await translate("options.save");
  if (llmFetchModelsBtn) llmFetchModelsBtn.textContent = await translate("settings.fetchModels");
  if (mcpServersConfigInput) mcpServersConfigInput.placeholder = await translate("settings.mcpServersConfigPlaceholder");
  if (mcpCheckBtn) mcpCheckBtn.textContent = await translate("settings.checkMcp");
}

function wireEvents() {
  llmSaveButton?.addEventListener("click", () => void saveLlmConfig());
  llmFetchModelsBtn?.addEventListener("click", () => void fetchModels());
  llmModelSelect?.addEventListener("change", () => {
    if (llmModelInput && llmModelSelect?.value) llmModelInput.value = llmModelSelect.value;
  });
  mcpCheckBtn?.addEventListener("click", () => void checkMcp());
  mcpServersConfigInput?.addEventListener("input", () => {
    chrome.storage.sync.get({ mcpServersEnabled: {} as Record<string, boolean> }, (items) => {
      void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput?.value ?? "");
    });
  });
}

wireEvents();
loadLlmConfig();
void updateUI();
