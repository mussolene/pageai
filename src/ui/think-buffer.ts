/**
 * Разбор буфера стрима: `<redacted_thinking>` … `</redacted_thinking>` (как в llm/client и panel).
 */
import type { ChatMessage, ReasoningStep } from "../types/messages";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

export function parseThinkBuffer(buf: string): { thinking?: string; answer?: string } {
  const thinkOpen = buf.indexOf(THINK_OPEN);
  const thinkClose = buf.indexOf(THINK_CLOSE);

  if (thinkClose === -1) {
    if (thinkOpen === -1) return { answer: buf };
    return { thinking: buf.slice(thinkOpen + THINK_OPEN.length) };
  }

  const thinking =
    thinkOpen === -1 ? "" : buf.slice(thinkOpen + THINK_OPEN.length, thinkClose);
  const answer = buf.slice(thinkClose + THINK_CLOSE.length);
  return { thinking, answer };
}

const DISCONNECT_NOTE = "\n\n_[Response interrupted — connection to the assistant was lost.]_";

/** Сохранить в истории то, что успело прийти по стриму, вместо полного удаления сообщения. */
export function buildPartialAssistantOnDisconnect(
  streamingBuffer: string,
  reasoningSteps: ReasoningStep[]
): ChatMessage | null {
  const parsed = parseThinkBuffer(streamingBuffer);
  const answer = (parsed.answer ?? "").trim();
  const thinking = (parsed.thinking ?? "").trim();

  let content = "";
  if (answer !== "") content = answer + DISCONNECT_NOTE;
  else if (thinking !== "") content = thinking + DISCONNECT_NOTE;
  else if (reasoningSteps.length > 0) {
    content = "_[Response interrupted — connection to the assistant was lost.]_";
  }

  if (content === "") return null;

  const msg: ChatMessage = {
    role: "assistant",
    content,
    timestamp: new Date().toISOString()
  };
  if (reasoningSteps.length > 0) {
    msg.reasoningSteps = [...reasoningSteps];
  }
  return msg;
}
