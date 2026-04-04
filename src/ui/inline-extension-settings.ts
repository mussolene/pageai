/**
 * Общие элементы настроек в боковой панели и popup (дублируют часть Options).
 */
import { CHAT_CONTEXT_SYNC_DEFAULTS } from "../chat/chat-context-sync";
import { mergeAgentInstructionsForDisplay, persistUnifiedAgentInstructions } from "../chat/agent-instructions-ui";
import {
  ORCHESTRATOR_SYNC_STORAGE_DEFAULTS,
  mergeOrchestratorSettings,
  type OrchestratorSyncSettings
} from "../agent/orchestrator-settings";

function showChatContextStatus(): void {
  const el = document.getElementById("chat-context-status");
  if (!el) return;
  el.textContent = "Saved";
  el.className = "status success";
  setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, 1500);
}

function showInlineOrchestratorStatus(): void {
  const el = document.getElementById("inline-orchestrator-status");
  if (!el) return;
  el.textContent = "Saved";
  el.className = "status success";
  setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, 1500);
}

function showInstructionsStatus(): void {
  const el = document.getElementById("panel-instructions-status");
  if (!el) return;
  el.textContent = "Saved";
  el.className = "status success";
  setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, 2000);
}

function persistChatContext(): void {
  const maxM = document.getElementById("chat-context-max-messages") as HTMLInputElement | null;
  const maxC = document.getElementById("chat-context-max-chars") as HTMLInputElement | null;
  const rollEn = document.getElementById("chat-rolling-summary-enabled") as HTMLInputElement | null;
  const rollEv = document.getElementById("chat-rolling-summary-every") as HTMLInputElement | null;
  const rollBt = document.getElementById("chat-rolling-summary-batch") as HTMLInputElement | null;
  chrome.storage.sync.set(
    {
      chatContextMaxMessages: Number(maxM?.value ?? 56),
      chatContextMaxChars: Number(maxC?.value ?? 100_000),
      chatRollingSummaryEnabled: rollEn?.checked !== false,
      chatRollingSummaryEvery: Number(rollEv?.value ?? 16),
      chatRollingSummaryBatch: Number(rollBt?.value ?? 8)
    },
    () => showChatContextStatus()
  );
}

function readPartialOrchestratorFromInlineForm(): Record<string, unknown> {
  const plan = document.getElementById("inline-orchestrator-plan-enabled") as HTMLInputElement | null;
  const verify = document.getElementById("inline-orchestrator-verify-enabled") as HTMLInputElement | null;
  const maxIt = document.getElementById("inline-orchestrator-max-tool-iterations") as HTMLInputElement | null;
  return {
    orchestratorPlanEnabled: plan?.checked ?? true,
    orchestratorVerifyEnabled: verify?.checked ?? true,
    orchestratorMaxToolIterations: Number(maxIt?.value ?? 10)
  };
}

function persistOrchestratorInlineMerge(): void {
  chrome.storage.sync.get(ORCHESTRATOR_SYNC_STORAGE_DEFAULTS, (items) => {
    const patch = readPartialOrchestratorFromInlineForm();
    const next: Record<string, unknown> = {
      ...(items as Record<string, unknown>),
      orchestratorPlanEnabled: patch.orchestratorPlanEnabled,
      orchestratorVerifyEnabled: patch.orchestratorVerifyEnabled,
      orchestratorMaxToolIterations: patch.orchestratorMaxToolIterations
    };
    chrome.storage.sync.set(next, () => showInlineOrchestratorStatus());
  });
}

export function loadInlineExtensionSettings(): void {
  chrome.storage.sync.get(CHAT_CONTEXT_SYNC_DEFAULTS, (items) => {
    const maxM = document.getElementById("chat-context-max-messages") as HTMLInputElement | null;
    const maxC = document.getElementById("chat-context-max-chars") as HTMLInputElement | null;
    const rollEn = document.getElementById("chat-rolling-summary-enabled") as HTMLInputElement | null;
    const rollEv = document.getElementById("chat-rolling-summary-every") as HTMLInputElement | null;
    const rollBt = document.getElementById("chat-rolling-summary-batch") as HTMLInputElement | null;
    if (maxM) maxM.value = String(items.chatContextMaxMessages ?? 56);
    if (maxC) maxC.value = String(items.chatContextMaxChars ?? 100_000);
    if (rollEn) rollEn.checked = items.chatRollingSummaryEnabled !== false;
    if (rollEv) rollEv.value = String(items.chatRollingSummaryEvery ?? 16);
    if (rollBt) rollBt.value = String(items.chatRollingSummaryBatch ?? 8);
  });

  chrome.storage.sync.get(ORCHESTRATOR_SYNC_STORAGE_DEFAULTS, (items) => {
    const s = mergeOrchestratorSettings(items as Record<string, unknown>);
    const plan = document.getElementById("inline-orchestrator-plan-enabled") as HTMLInputElement | null;
    const verify = document.getElementById("inline-orchestrator-verify-enabled") as HTMLInputElement | null;
    const maxIt = document.getElementById("inline-orchestrator-max-tool-iterations") as HTMLInputElement | null;
    if (plan) plan.checked = s.orchestratorPlanEnabled;
    if (verify) verify.checked = s.orchestratorVerifyEnabled;
    if (maxIt) maxIt.value = String(s.orchestratorMaxToolIterations);
  });

  chrome.storage.sync.get({ mcpAgentPromptsEnabled: false }, (items) => {
    const el = document.getElementById("mcp-agent-prompts-enabled") as HTMLInputElement | null;
    if (el) el.checked = Boolean(items.mcpAgentPromptsEnabled);
  });

  chrome.storage.sync.get({ agentRules: "", agentSkills: "" }, (items) => {
    const ta = document.getElementById("panel-agent-instructions") as HTMLTextAreaElement | null;
    if (ta) {
      ta.value = mergeAgentInstructionsForDisplay(
        (items.agentRules as string) ?? "",
        (items.agentSkills as string) ?? ""
      );
    }
  });
}

export function wireInlineExtensionSettings(): void {
  const chatIds = [
    "chat-context-max-messages",
    "chat-context-max-chars",
    "chat-rolling-summary-enabled",
    "chat-rolling-summary-every",
    "chat-rolling-summary-batch"
  ];
  for (const id of chatIds) {
    document.getElementById(id)?.addEventListener("change", persistChatContext);
  }

  document.getElementById("inline-orchestrator-plan-enabled")?.addEventListener("change", persistOrchestratorInlineMerge);
  document.getElementById("inline-orchestrator-verify-enabled")?.addEventListener("change", persistOrchestratorInlineMerge);
  document.getElementById("inline-orchestrator-max-tool-iterations")?.addEventListener("change", persistOrchestratorInlineMerge);

  document.getElementById("mcp-agent-prompts-enabled")?.addEventListener("change", () => {
    const el = document.getElementById("mcp-agent-prompts-enabled") as HTMLInputElement | null;
    chrome.storage.sync.set({ mcpAgentPromptsEnabled: el?.checked === true });
  });

  const instr = document.getElementById("panel-agent-instructions") as HTMLTextAreaElement | null;
  const applyInstr = (): void => {
    const { agentRules, agentSkills } = persistUnifiedAgentInstructions(instr?.value ?? "");
    chrome.storage.sync.set({ agentRules, agentSkills });
    showInstructionsStatus();
  };
  instr?.addEventListener("input", applyInstr);
  instr?.addEventListener("blur", applyInstr);

  document.getElementById("panel-open-options-agent")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

/** Синхронизация полей оркестратора при изменении storage извне (например с страницы Options). */
export function applyOrchestratorInlineFromSettings(s: OrchestratorSyncSettings): void {
  const plan = document.getElementById("inline-orchestrator-plan-enabled") as HTMLInputElement | null;
  const verify = document.getElementById("inline-orchestrator-verify-enabled") as HTMLInputElement | null;
  const maxIt = document.getElementById("inline-orchestrator-max-tool-iterations") as HTMLInputElement | null;
  if (plan) plan.checked = s.orchestratorPlanEnabled;
  if (verify) verify.checked = s.orchestratorVerifyEnabled;
  if (maxIt) maxIt.value = String(s.orchestratorMaxToolIterations);
}
