/**
 * Telegram per-chat per-agent conversation history.
 *
 * Each (chat_id, message_thread_id || '', agent_key) has its own rolling
 * window of `AiMessage` turns. Loaded before an agent run, written back
 * after — so a follow-up like "publish saja" sees the tool ids and
 * results from the prior turn.
 *
 * Window policy:
 *   - Trim to MAX_KEEP turns before persisting.
 *   - Drop everything if the last update is >IDLE_RESET_HOURS old.
 *   - System prompt is NEVER stored; it's rebuilt fresh each run from
 *     the current agent definition + context.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiMessage } from "@/ai/types";

type Db = SupabaseClient<any, any, any>;

const MAX_KEEP = 30;          // turns (each user/assistant/tool counts as 1)
const IDLE_RESET_HOURS = 24;  // drop history older than this on next load

export interface HistoryKey {
  chatId:    string;
  threadId:  string | null;   // null treated as "" in the PK
  agentKey:  string;
}

function pkParts(key: HistoryKey) {
  return {
    chat_id:           key.chatId,
    message_thread_id: key.threadId ?? "",
    agent_key:         key.agentKey,
  };
}

export async function loadHistory(db: Db, key: HistoryKey): Promise<AiMessage[]> {
  try {
    const p = pkParts(key);
    const { data } = await db
      .from("telegram_chat_history")
      .select("turns, updated_at")
      .eq("chat_id",           p.chat_id)
      .eq("message_thread_id", p.message_thread_id)
      .eq("agent_key",          p.agent_key)
      .maybeSingle();
    if (!data) return [];
    // Idle reset.
    const ageMs = Date.now() - new Date(data.updated_at as string).getTime();
    if (ageMs > IDLE_RESET_HOURS * 3600 * 1000) {
      // Don't bother deleting on read; will be overwritten on next save.
      return [];
    }
    const turns = (data.turns as AiMessage[] | null) ?? [];
    return Array.isArray(turns) ? turns : [];
  } catch (e) {
    console.warn("[TgHistory] load failed:", e);
    return [];
  }
}

/**
 * Persist the COMPLETE turn list (already-loaded prefix + new turns
 * from this run), trimmed to MAX_KEEP. Caller should pass the union;
 * we don't try to append-only because tool_call_ids need to stay
 * paired with their tool results.
 */
export async function saveHistory(
  db: Db,
  key: HistoryKey,
  allTurns: AiMessage[],
): Promise<void> {
  try {
    const trimmed = trimWithPairing(allTurns, MAX_KEEP);
    const p = pkParts(key);
    await db
      .from("telegram_chat_history")
      .upsert(
        {
          ...p,
          turns:      trimmed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_id,message_thread_id,agent_key" },
      );
  } catch (e) {
    console.warn("[TgHistory] save failed:", e);
  }
}

export async function clearHistory(db: Db, key: HistoryKey): Promise<void> {
  try {
    const p = pkParts(key);
    await db
      .from("telegram_chat_history")
      .delete()
      .eq("chat_id",           p.chat_id)
      .eq("message_thread_id", p.message_thread_id)
      .eq("agent_key",          p.agent_key);
  } catch (e) {
    console.warn("[TgHistory] clear failed:", e);
  }
}

/**
 * Trim to `max` turns while keeping assistant-tool-call ↔ tool-result
 * pairing intact. Without this, a naive `.slice(-max)` could chop off
 * an assistant tool_calls message and leave a dangling tool result —
 * which the LLM gateway rejects with "tool message must follow a
 * tool_calls message".
 */
function trimWithPairing(turns: AiMessage[], max: number): AiMessage[] {
  if (turns.length <= max) return turns;
  let start = turns.length - max;
  // If the cut would land on a tool result, walk back to its assistant.
  while (start > 0 && turns[start].role === "tool") start--;
  // If start lands ON an assistant whose tool_calls precede our window,
  // walking back already keeps the pair. If it lands on something else,
  // we're fine.
  return turns.slice(start);
}
