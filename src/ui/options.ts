import type { LlmConfigEntry } from "../llm/client";
import { normalizeEndpoint, detectLlmHost, getLlmConfigsAndActive } from "../llm/client";
import {
  parseMcpServersList,
  listMcpTools,
  getDefaultMcpServersConfig
} from "../mcp/client";
import { translate, getStoredLocale } from "../i18n";

const llmConfigChips = document.getElementById("llm-config-chips") as HTMLDivElement | null;
const llmConfigAddBtn = document.getElementById("llm-config-add") as HTMLButtonElement | null;
const llmConfigForm = document.getElementById("llm-config-form") as HTMLDivElement | null;
const llmConfigNameInput = document.getElementById("llm-config-name") as HTMLInputElement | null;
const llmConfigEndpointTypeSelect = document.getElementById("llm-config-endpoint-type") as HTMLSelectElement | null;
const llmConfigEndpointInput = document.getElementById("llm-config-endpoint") as HTMLInputElement | null;
const llmConfigAutoBtn = document.getElementById("llm-config-auto") as HTMLButtonElement | null;
const llmConfigModelInput = document.getElementById("llm-config-model") as HTMLInputElement | null;
const llmConfigModelsDatalist = document.getElementById("llm-config-models-datalist") as HTMLDataListElement | null;
const llmConfigApiKeyInput = document.getElementById("llm-config-api-key") as HTMLInputElement | null;
const llmConfigSaveBtn = document.getElementById("llm-config-save") as HTMLButtonElement | null;
const llmConfigCancelBtn = document.getElementById("llm-config-cancel") as HTMLButtonElement | null;
const llmStatus = document.getElementById("llm-status") as HTMLSpanElement | null;
const mcpServersConfigInput = document.getElementById("mcp-servers-config") as HTMLTextAreaElement | null;
const mcpServersListEl = document.getElementById("mcp-servers-list") as HTMLDivElement | null;
const mcpStatus = document.getElementById("mcp-status") as HTMLSpanElement | null;
const browserAutomationCheckbox = document.getElementById("browser-automation-enabled") as HTMLInputElement | null;

let editingConfigId: string | null = null;

function getFormEndpointType(): "chat" | "custom" {
  return (llmConfigEndpointTypeSelect?.value === "custom" ? "custom" : "chat") as "chat" | "custom";
}

function showForm(entry?: LlmConfigEntry): void {
  if (!llmConfigForm || !llmConfigNameInput || !llmConfigEndpointInput || !llmConfigModelInput) return;
  editingConfigId = entry?.id ?? null;
  llmConfigForm.hidden = false;
  llmConfigNameInput.value = entry?.name ?? "";
  if (llmConfigEndpointTypeSelect) llmConfigEndpointTypeSelect.value = entry?.endpointType ?? "chat";
  llmConfigEndpointInput.value = entry?.endpoint ?? "";
  llmConfigModelInput.value = entry?.model ?? "";
  if (llmConfigApiKeyInput) {
    if (entry?.id) {
      chrome.storage.local.get({ llmApiKeys: {} as Record<string, string> }, (local) => {
        const keys = (local.llmApiKeys as Record<string, string>) ?? {};
        llmConfigApiKeyInput!.value = keys[entry.id] ?? "";
      });
    } else {
      llmConfigApiKeyInput.value = "";
    }
  }
}

function hideForm(): void {
  if (llmConfigForm) llmConfigForm.hidden = true;
  editingConfigId = null;
}

async function loadAndRenderConfigs(): Promise<void> {
  const { configs, activeId } = await getLlmConfigsAndActive();
  if (!llmConfigChips) return;
  llmConfigChips.innerHTML = "";
  for (const c of configs) {
    const chip = document.createElement("div");
    chip.className = "llm-config-chip" + (c.id === activeId ? " is-active" : "");
    chip.dataset.id = c.id;
    const nameSpan = document.createElement("span");
    nameSpan.className = "llm-config-chip-name";
    nameSpan.textContent = c.name;
    chip.appendChild(nameSpan);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "llm-config-chip-delete";
    delBtn.setAttribute("aria-label", "Delete");
    delBtn.textContent = "\u00D7";
    chip.appendChild(delBtn);
    nameSpan.addEventListener("click", () => showForm(c));
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void deleteConfig(c.id);
    });
    llmConfigChips.appendChild(chip);
  }
}

async function deleteConfig(id: string): Promise<void> {
  const { configs, activeId } = await getLlmConfigsAndActive();
  const next = configs.filter((c) => c.id !== id);
  const nextActive = activeId === id ? (next[0]?.id ?? null) : activeId;
  await new Promise<void>((r) =>
    chrome.storage.sync.set({ llmConfigs: next, activeLlmConfigId: nextActive }, r)
  );
  const local = await new Promise<Record<string, string>>((r) =>
    chrome.storage.local.get({ llmApiKeys: {} as Record<string, string> }, (x) => r((x.llmApiKeys as Record<string, string>) ?? {}))
  );
  delete local[id];
  await new Promise<void>((r) => chrome.storage.local.set({ llmApiKeys: local }, r));
  if (editingConfigId === id) hideForm();
  await loadAndRenderConfigs();
}

function saveConfigFromForm(): void {
  if (!llmConfigNameInput || !llmConfigEndpointInput || !llmConfigModelInput || !llmStatus) return;
  const name = llmConfigNameInput.value.trim();
  const endpointRaw = llmConfigEndpointInput.value.trim();
  const model = llmConfigModelInput.value.trim();
  const endpointType = getFormEndpointType();
  if (!name) {
    llmStatus.textContent = "Enter name.";
    llmStatus.className = "status error";
    return;
  }
  if (!endpointRaw || !model) {
    llmStatus.textContent = "Enter endpoint and model.";
    llmStatus.className = "status error";
    return;
  }
  const endpoint = normalizeEndpoint(endpointRaw, endpointType);
  if (!endpoint) {
    llmStatus.textContent = "Invalid endpoint URL.";
    llmStatus.className = "status error";
    return;
  }

  (async () => {
    const { configs, activeId } = await getLlmConfigsAndActive();
    const apiKey = llmConfigApiKeyInput?.value ?? "";
    let next = [...configs];
    let nextActive = activeId;

    if (editingConfigId) {
      const idx = next.findIndex((c) => c.id === editingConfigId);
      if (idx >= 0) {
        next[idx] = {
          id: editingConfigId,
          name,
          endpoint: endpointRaw,
          endpointType,
          model
        };
      }
      const local = await new Promise<Record<string, string>>((r) =>
        chrome.storage.local.get({ llmApiKeys: {} as Record<string, string> }, (x) => r((x.llmApiKeys as Record<string, string>) ?? {}))
      );
      local[editingConfigId] = apiKey;
      await new Promise<void>((r) => chrome.storage.local.set({ llmApiKeys: local }, r));
    } else {
      const id = "cfg-" + Date.now();
      next.push({ id, name, endpoint: endpointRaw, endpointType, model });
      if (next.length === 1) nextActive = id;
      const local = await new Promise<Record<string, string>>((r) =>
        chrome.storage.local.get({ llmApiKeys: {} as Record<string, string> }, (x) => r((x.llmApiKeys as Record<string, string>) ?? {}))
      );
      local[id] = apiKey;
      await new Promise<void>((r) => chrome.storage.local.set({ llmApiKeys: local }, r));
    }

    await new Promise<void>((r) => chrome.storage.sync.set({ llmConfigs: next, activeLlmConfigId: nextActive }, r));
    llmStatus.textContent = "Saved";
    llmStatus.className = "status success";
    hideForm();
    await loadAndRenderConfigs();
  })();
}

async function runAutoDetectForm(): Promise<void> {
  if (!llmConfigEndpointInput || !llmStatus || !llmConfigEndpointTypeSelect) return;
  if (llmConfigAutoBtn) llmConfigAutoBtn.disabled = true;
  llmStatus.textContent = "Detecting…";
  llmStatus.className = "status info";
  try {
    const result = await detectLlmHost();
    if ("error" in result) {
      llmStatus.textContent = result.error;
      llmStatus.className = "status error";
      return;
    }
    llmConfigEndpointInput.value = result.baseUrl;
    llmConfigEndpointTypeSelect.value = "chat";
    if (result.models.length > 0 && llmConfigModelInput) {
      fillModelDatalist(result.models);
      llmConfigModelInput.value = result.models[0];
      chrome.storage.sync.set({ lastFetchedModels: result.models });
    }
    llmStatus.textContent = `Found: ${result.baseUrl}${result.models.length > 0 ? ` (${result.models.length} model(s))` : ""}`;
    llmStatus.className = "status success";
  } finally {
    if (llmConfigAutoBtn) llmConfigAutoBtn.disabled = false;
  }
}

function fillModelDatalist(models: string[]): void {
  if (!llmConfigModelsDatalist) return;
  llmConfigModelsDatalist.innerHTML = "";
  models.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    llmConfigModelsDatalist.appendChild(opt);
  });
}

function loadLlmConfigs(): void {
  void getLlmConfigsAndActive().then(({ configs }) => {
    void loadAndRenderConfigs();
    chrome.storage.sync.get({ lastFetchedModels: [] as string[] }, (items) => {
      fillModelDatalist(items.lastFetchedModels ?? []);
    });
  });
}

const MCP_ERROR_LOADING = "Error loading";

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
          if (mcpStatus) {
            mcpStatus.textContent = MCP_ERROR_LOADING;
            mcpStatus.className = "status error";
          }
          return;
        }
        if (mcpStatus) {
          mcpStatus.textContent = "";
          mcpStatus.className = "status";
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
    switchWrap.appendChild(toggle);
    row.appendChild(switchWrap);
    mcpServersListEl.appendChild(row);
    toggle.addEventListener("change", () => {
      const next = { ...enabled, [server.name]: toggle.checked };
      chrome.storage.sync.set({ mcpServersEnabled: next });
    });
  }
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
  if (llmSummary) llmSummary.textContent = "LLM configs";
  if (mcpSummary) mcpSummary.textContent = await translate("settings.mcpServersConfig");

  if (llmConfigAddBtn) llmConfigAddBtn.textContent = "Add";
  if (llmConfigSaveBtn) llmConfigSaveBtn.textContent = "Save";
  if (llmConfigCancelBtn) llmConfigCancelBtn.textContent = "Cancel";
  const summaries = document.querySelectorAll('details summary');
  if (summaries[1]) (summaries[1] as HTMLElement).textContent = await translate("settings.browserAutomation");
  const browserAutomationDetails = document.querySelector('.browser-automation-row .label-text');
  if (browserAutomationDetails) browserAutomationDetails.textContent = await translate("settings.browserAutomationDescription");

  const mcpLabel = document.getElementById("options-mcp-label");
  if (mcpLabel) mcpLabel.textContent = await translate("settings.mcpServersConfig");
  if (mcpServersConfigInput) mcpServersConfigInput.placeholder = await translate("settings.mcpServersConfigPlaceholder");
}

function loadBrowserAutomation() {
  chrome.storage.sync.get({ browserAutomationEnabled: false }, (items) => {
    if (browserAutomationCheckbox) browserAutomationCheckbox.checked = Boolean(items.browserAutomationEnabled);
  });
}

function wireEvents() {
  llmConfigAddBtn?.addEventListener("click", () => showForm());
  llmConfigSaveBtn?.addEventListener("click", () => saveConfigFromForm());
  llmConfigCancelBtn?.addEventListener("click", () => hideForm());
  llmConfigAutoBtn?.addEventListener("click", () => void runAutoDetectForm());

  browserAutomationCheckbox?.addEventListener("change", () => {
    chrome.storage.sync.set({ browserAutomationEnabled: browserAutomationCheckbox.checked });
  });

  mcpServersConfigInput?.addEventListener("input", () => {
    const raw = mcpServersConfigInput?.value?.trim() ?? "";
    if (raw) chrome.storage.sync.set({ mcpServersConfig: raw });
    chrome.storage.sync.get({ mcpServersEnabled: {} as Record<string, boolean> }, (items) => {
      void renderMcpServersList(items.mcpServersEnabled || {}, mcpServersConfigInput?.value ?? "");
    });
  });
}

function loadMcp() {
  chrome.storage.sync.get(
    {
      mcpServersConfig: "",
      mcpServerUrl: "",
      mcpHeaders: "",
      mcpServersEnabled: {} as Record<string, boolean>
    },
    (items) => {
      if (!mcpServersConfigInput) return;
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
  );
}

wireEvents();
loadLlmConfigs();
loadMcp();
loadBrowserAutomation();
void updateUI();
