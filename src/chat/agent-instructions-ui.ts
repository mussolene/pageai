/**
 * Единое поле «инструкции агента» в UI: в storage остаются `agentRules` + legacy `agentSkills`.
 * При сохранении из объединённого поля пишем только `agentRules` и очищаем `agentSkills`.
 */

export function mergeAgentInstructionsForDisplay(agentRules: string, agentSkills: string): string {
  const r = (agentRules ?? "").trim();
  const s = (agentSkills ?? "").trim();
  if (!r && !s) return "";
  if (!s) return agentRules ?? "";
  if (!r) return agentSkills ?? "";
  return `${r}\n\n---\n\n${s}`;
}

export function persistUnifiedAgentInstructions(text: string): { agentRules: string; agentSkills: string } {
  return { agentRules: text, agentSkills: "" };
}
