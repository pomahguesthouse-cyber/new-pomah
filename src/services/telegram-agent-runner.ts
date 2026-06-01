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

const MAX_TURNS = 4;

interface RunArgs {
  agentDef:    AgentDefinition;
  messageText: string;
  agentCtx:    AgentContext;
  toolCtx:     ToolContext;
  llmConfig:   AiClientConfig;
}

export async function runAgentInGroupChannel(args: RunArgs): Promise<string | null> {
  const { agentDef, messageText, agentCtx, toolCtx, llmConfig } = args;

  const messages: AiMessage[] = [
    { role: "system", content: agentDef.buildSystemPrompt(agentCtx) },
    { role: "user",   content: messageText },
  ];

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
        console.error(`[TgAgentRunner][${agentDef.key}] HTTP ${res.status}`, await res.text());
        return null;
      }
      json = (await res.json()) as LlmResponse;
    } catch (e) {
      console.error(`[TgAgentRunner][${agentDef.key}] fetch error:`, e);
      return null;
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls    = assistantMsg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return (assistantMsg?.content ?? "").trim() || null;
    }

    messages.push(assistantMsg as AiMessage);
    for (const tc of toolCalls) {
      const { output } = await executeTool(
        tc.function?.name      ?? "",
        tc.function?.arguments ?? "{}",
        toolCtx,
      );
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }

  console.warn(`[TgAgentRunner][${agentDef.key}] max turns reached`);
  return null;
}
