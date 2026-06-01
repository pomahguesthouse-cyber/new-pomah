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
}

/**
 * Returns the agent's natural-language reply, or a SHORT human-readable
 * error string starting with "⚠️" when something blocks it (HTTP, max
 * turns, repeated tool failures). Never returns null any more — the
 * Telegram caller appends the string verbatim so the admin sees what
 * actually went wrong instead of a generic "(agent tidak menghasilkan
 * balasan)".
 */
export async function runAgentInGroupChannel(args: RunArgs): Promise<string> {
  const { agentDef, messageText, agentCtx, toolCtx, llmConfig } = args;

  const messages: AiMessage[] = [
    { role: "system", content: agentDef.buildSystemPrompt(agentCtx) },
    { role: "user",   content: messageText },
  ];

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
        return `⚠️ LLM error ${res.status}. ${truncate(body, 200)}`;
      }
      json = (await res.json()) as LlmResponse;
    } catch (e) {
      console.error(`[TgAgentRunner][${agentDef.key}] fetch error:`, e);
      return `⚠️ Tidak bisa menghubungi LLM: ${e instanceof Error ? e.message : String(e)}`;
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls    = assistantMsg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (assistantMsg?.content ?? "").trim();
      if (text) return text;
      // Empty completion — surface what we know so admin can debug.
      if (lastToolError) return `⚠️ Agent berhenti tanpa balasan. Tool terakhir gagal: ${lastToolError}`;
      if (toolTrail.length > 0) return `⚠️ Agent berhenti tanpa balasan setelah tool: ${toolTrail.join(" → ")}`;
      return "⚠️ Agent tidak menghasilkan balasan (LLM mengembalikan content kosong).";
    }

    messages.push(assistantMsg as AiMessage);
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
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }

  console.warn(`[TgAgentRunner][${agentDef.key}] max turns reached after: ${toolTrail.join(" → ")}`);
  return `⚠️ Pekerjaan terlalu panjang (lebih dari ${MAX_TURNS} langkah). ` +
    `Tool yang sudah dijalankan: ${toolTrail.join(" → ") || "(none)"}. ` +
    `Coba minta task yang lebih spesifik / dipecah.`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
