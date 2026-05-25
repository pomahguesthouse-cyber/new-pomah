/**
 * AI Orchestrator.
 *
 * Manages the multi-turn conversation loop between the LLM and tools.
 * Runs up to `maxTurns` rounds: each round either returns a text reply or
 * dispatches one or more tool calls, appends their results, and continues.
 *
 * This module is runtime-agnostic (works in Cloudflare Workers AND Deno
 * Edge Functions) as long as `fetch` is available.
 */

import type {
  OrchestrationInput,
  OrchestrationResult,
  AiMessage,
  LlmResponse,
} from "./types";
import { executeTool } from "@/tools/executor";
import type { ToolContext } from "@/tools/types";

const DEFAULT_MAX_TURNS = 4;

// ─── LLM gateway call ─────────────────────────────────────────────────────────

async function callLlm(
  config:   OrchestrationInput["client"],
  messages: AiMessage[],
  tools:    OrchestrationInput["tools"],
): Promise<LlmResponse | null> {
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model:       config.model,
        temperature: 0.6,
        max_tokens:  2000,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      console.error("[Orchestrator] LLM HTTP error:", res.status, await res.text());
      return null;
    }

    return (await res.json()) as LlmResponse;
  } catch (e) {
    console.error("[Orchestrator] LLM fetch error:", e);
    return null;
  }
}

// ─── Main orchestration loop ──────────────────────────────────────────────────

/**
 * Run the full AI orchestration pipeline.
 *
 * @param input       Conversation history + config
 * @param toolContext Supabase clients + pre-fetched data for tool handlers
 */
export async function runOrchestration(
  input:       OrchestrationInput,
  toolContext: ToolContext,
): Promise<OrchestrationResult> {
  const maxTurns  = input.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolsUsed = new Set<string>();

  // Drop trailing assistant turns: the LLM returns an empty completion when the
  // conversation ends on an assistant message (nothing new to answer).
  const trimmed = [...input.messages];
  while (trimmed.length && trimmed[trimmed.length - 1].direction !== "in") trimmed.pop();
  const history = trimmed.length ? trimmed : input.messages;

  // Build the initial message array: system + conversation history
  const messages: AiMessage[] = [
    { role: "system", content: input.systemPrompt },
    ...history.map((m) => ({
      role:    (m.direction === "in" ? "user" : "assistant") as AiMessage["role"],
      content: m.body,
    })),
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const json = await callLlm(input.client, messages, input.tools);

    if (!json) {
      return { reply: null, toolsUsed: Array.from(toolsUsed), error: "LLM gateway error" };
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls    = assistantMsg?.tool_calls ?? [];

    // ── Text reply — done ────────────────────────────────────────────────────
    if (toolCalls.length === 0) {
      const reply = assistantMsg?.content?.trim() ?? null;
      if (!reply) {
        const detail = json.error?.message ?? "Empty LLM response";
        console.error("[Orchestrator] No reply content:", detail);
        return { reply: null, toolsUsed: Array.from(toolsUsed), error: detail };
      }
      return { reply, toolsUsed: Array.from(toolsUsed) };
    }

    // ── Tool calls — execute and continue ────────────────────────────────────
    // Append the assistant's tool-call message
    messages.push(assistantMsg as AiMessage);

    for (const tc of toolCalls) {
      const { output, toolLabel } = await executeTool(
        tc.function?.name    ?? "",
        tc.function?.arguments ?? "{}",
        toolContext,
      );

      if (toolLabel) toolsUsed.add(toolLabel);

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      output,
      });
    }
    // next turn: send tool results back to LLM
  }

  console.error("[Orchestrator] max turns reached without a text reply");
  return { reply: null, toolsUsed: Array.from(toolsUsed), error: "Max turns exceeded" };
}

// ─── Agent label helper ───────────────────────────────────────────────────────

/** Map tools-used to the primary agent label shown in the admin inbox. */
export function deriveAgentLabel(toolsUsed: string[]): string {
  if (toolsUsed.includes("Booking Engine"))  return "Front Office Agent";
  if (toolsUsed.includes("Room Availability")) return "Pricing Agent";
  return "Front Office Agent";
}
