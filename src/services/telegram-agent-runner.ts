/**
 * Lightweight per-agent runner used by the Telegram group-channel path.
 *
 * The full multi-agent orchestrator routes via classifier + Manager Agent
 * delegation. When a Telegram group is dedicated to a specific agent
 * (e.g. Front Office, Finance), we skip routing entirely and run THAT
 * agent against the user's message. This keeps each group's
 * conversation single-personality, which is the point of having
 * separate groups per agent.
 */

import type { AgentDefinition, AgentContext } from "@/ai/agents/types";
import type { AiClientConfig, AiMessage, LlmResponse } from "@/ai/types";
import type { ToolContext } from "@/tools/types";
import { executeTool } from "@/tools/executor";

// Content Manager + Manager Agent commonly chain 3-5 tool calls
// (list → discover → upsert×N → summarize), so the cap is generous.
const MAX_TURNS = 8;

interface RunArgs {
  agentDef:    AgentDefinition;
  messageText: string;
  agentCtx:    AgentContext;
  toolCtx:     ToolContext;
  llmConfig:   AiClientConfig;
  /**
   * Prior conversation turns (excluding system prompt) for this
   * (chat, thread, agent) scope. Empty array for a fresh conversation.
   */
  priorTurns?: AiMessage[];
}

/**
 * Returns the agent's natural-language reply, or a SHORT human-readable
 * error string starting with "⚠️" when something blocks it (HTTP, max
 * turns, repeated tool failures). Never returns null any more — the
 * Telegram caller appends the string verbatim so the admin sees what
 * actually went wrong instead of a generic "(agent tidak menghasilkan
 * balasan)".
 */
export interface RunResult {
  reply:    string;          // always non-empty
  newTurns: AiMessage[];     // turns produced THIS run (user + assistant + tools)
}

export async function runAgentInGroupChannel(args: RunArgs): Promise<RunResult> {
  const { agentDef, messageText, agentCtx, toolCtx, llmConfig, priorTurns = [] } = args;

  // System prompt is rebuilt fresh every run so persona/mode/managerName
  // changes propagate immediately; only the turn list comes from history.
  const sysPrompt = agentDef.buildSystemPrompt(agentCtx);
  const userTurn: AiMessage = { role: "user", content: messageText };
  const messages: AiMessage[] = [
    { role: "system", content: sysPrompt },
    ...priorTurns,
    userTurn,
  ];
  const newTurns: AiMessage[] = [userTurn];

  const toolTrail: string[] = []; // for error summarising
  let lastToolError: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let json: LlmResponse | null = null;
    try {
      const res = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${llmConfig.apiKey}`,
        },
        body: JSON.stringify({
          model:       llmConfig.model,
          temperature: 0.6,
          max_tokens:  1500,
          messages,
          tools:       agentDef.tools.length > 0 ? agentDef.tools : undefined,
          tool_choice: agentDef.tools.length > 0 ? "auto"      : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[TgAgentRunner][${agentDef.key}] HTTP ${res.status}`, body);
        return { reply: `⚠️ LLM error ${res.status}. ${truncate(body, 200)}`, newTurns };
      }
      json = (await res.json()) as LlmResponse;
    } catch (e) {
      console.error(`[TgAgentRunner][${agentDef.key}] fetch error:`, e);
      return {
        reply: `⚠️ Tidak bisa menghubungi LLM: ${e instanceof Error ? e.message : String(e)}`,
        newTurns,
      };
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls    = assistantMsg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (assistantMsg?.content ?? "").trim();
      if (text) {
        newTurns.push({ role: "assistant", content: text });
        return { reply: text, newTurns };
      }
      // Empty completion — surface what we know so admin can debug.
      const reply = lastToolError
        ? `⚠️ Agent berhenti tanpa balasan. Tool terakhir gagal: ${lastToolError}`
        : toolTrail.length > 0
        ? `⚠️ Agent berhenti tanpa balasan setelah tool: ${toolTrail.join(" → ")}`
        : "⚠️ Agent tidak menghasilkan balasan (LLM mengembalikan content kosong).";
      return { reply, newTurns };
    }

    const assistantTurn = assistantMsg as AiMessage;
    messages.push(assistantTurn);
    newTurns.push(assistantTurn);
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      console.info(`[TgAgentRunner][${agentDef.key}] turn ${turn + 1}: ${name}`);
      const { output } = await executeTool(
        name,
        tc.function?.arguments ?? "{}",
        toolCtx,
      );
      toolTrail.push(name);
      // Sniff JSON ok:false for short error chain so we can surface it.
      try {
        const parsed = JSON.parse(output);
        if (parsed && parsed.ok === false && typeof parsed.error === "string") {
          lastToolError = `${name}: ${parsed.error}`;
        } else {
          lastToolError = null;
        }
      } catch { /* non-JSON output, ignore */ }
      const toolTurn: AiMessage = { role: "tool", tool_call_id: tc.id, content: output };
      messages.push(toolTurn);
      newTurns.push(toolTurn);
    }
  }

  console.warn(`[TgAgentRunner][${agentDef.key}] max turns reached after: ${toolTrail.join(" → ")}`);
  return {
    reply: `⚠️ Pekerjaan terlalu panjang (lebih dari ${MAX_TURNS} langkah). ` +
      `Tool yang sudah dijalankan: ${toolTrail.join(" → ") || "(none)"}. ` +
      `Coba minta task yang lebih spesifik / dipecah.`,
    newTurns,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
