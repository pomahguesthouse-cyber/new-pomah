/**
 * Multi-Agent Orchestrator.
 *
 * Pipeline:
 *   1. Classify intent of the last user message
 *   2. Route to the appropriate agent (with escalation logic)
 *   3. Run the selected agent: own system prompt + own tools + own LLM call
 *   4. If the Manager Agent calls `ask_agent`, run the sub-agent and inject result
 *   5. Return final reply + metadata
 *
 * Key properties:
 *   - Each agent gets its OWN LLM call — prompts are NEVER mixed
 *   - Manager Agent can delegate to any specialist via the `ask_agent` tool
 *   - The executor handles all other tool calls (availability, booking, etc.)
 *   - Graceful fallback to Front Office Agent on any routing/run error
 */

import type { AiMessage, LlmResponse, AiClientConfig } from "./types";
import type { MultiAgentResult, AgentDefinition, AgentContext, AgentKey } from "./agents/types";
import { classifyIntent }                    from "./router/intent-classifier";
import { routeToAgent }                      from "./router/agent-router";
import { getAgent }                          from "./agents/registry";
import { ASK_AGENT_TOOL_NAME }              from "./agents/manager.agent";
import { executeTool }                       from "@/tools/executor";
import type { ToolContext }                  from "@/tools/types";
import { getBookingState, processBookingState } from "./state-machine/booking-machine";

const DEFAULT_MAX_TURNS = 5;

// ─── LLM gateway call ─────────────────────────────────────────────────────────

async function callLlm(
  config:   AiClientConfig,
  messages: AiMessage[],
  agent:    AgentDefinition,
  signal?:  AbortSignal,
): Promise<LlmResponse | null> {
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${config.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model:       config.model,
        temperature: 0.6,
        max_tokens:  600,
        messages,
        tools:       agent.tools.length > 0 ? agent.tools : undefined,
        tool_choice: agent.tools.length > 0 ? "auto"      : undefined,
      }),
    });

    if (!res.ok) {
      console.error(
        `[MultiAgent][${agent.key}] LLM HTTP error:`,
        res.status,
        await res.text(),
      );
      return null;
    }

    return (await res.json()) as LlmResponse;
  } catch (e) {
    console.error(`[MultiAgent][${agent.key}] LLM fetch error:`, e);
    return null;
  }
}

// ─── Single agent runner ──────────────────────────────────────────────────────

/**
 * Run a single agent to completion (multi-turn tool loop).
 *
 * Handles all tool calls EXCEPT `ask_agent` (which is intercepted by the
 * top-level orchestrator so the manager can call sub-agents).
 *
 * @param agent          The agent definition to run
 * @param conversationMsgs  Full conversation history (user/assistant turns)
 * @param agentCtx       Context for the agent's system prompt builder
 * @param toolCtx        Context for tool execution
 * @param llmConfig      API credentials
 * @param maxTurns       Max tool-call rounds
 * @param onAskAgent     Callback when `ask_agent` is called (manager only)
 */
async function runAgent(
  agent:            AgentDefinition,
  conversationMsgs: Array<{ direction: string; body: string }>,
  agentCtx:         AgentContext,
  toolCtx:          ToolContext,
  llmConfig:        AiClientConfig,
  maxTurns:         number,
  onAskAgent?:      (agentKey: AgentKey, question: string) => Promise<string>,
  signal?:          AbortSignal,
): Promise<{ reply: string | null; toolsUsed: string[]; error?: string }> {
  const toolsUsed = new Set<string>();

  // Build message array: agent system prompt + conversation history
  const messages: AiMessage[] = [
    { role: "system", content: agent.buildSystemPrompt(agentCtx) },
    ...conversationMsgs.map((m) => ({
      role:    (m.direction === "in" ? "user" : "assistant") as AiMessage["role"],
      content: m.body,
    })),
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const json = await callLlm(llmConfig, messages, agent, signal);

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
        console.error(`[MultiAgent][${agent.key}] No reply:`, detail);
        return { reply: null, toolsUsed: Array.from(toolsUsed), error: detail };
      }
      return { reply, toolsUsed: Array.from(toolsUsed) };
    }

    // ── Tool calls ────────────────────────────────────────────────────────────
    messages.push(assistantMsg as AiMessage);

    for (const tc of toolCalls) {
      const toolName = tc.function?.name ?? "";
      const rawArgs  = tc.function?.arguments ?? "{}";

      let output: string;
      let toolLabel: string | null = null;

      // Intercept `ask_agent` — delegate to sub-agent
      if (toolName === ASK_AGENT_TOOL_NAME && onAskAgent) {
        let parsed: { agent_key?: string; question?: string } = {};
        try { parsed = JSON.parse(rawArgs); } catch { /* ignore */ }

        const subKey      = (parsed.agent_key ?? "front-office") as AgentKey;
        const question    = parsed.question ?? "";
        toolLabel         = `ask_agent → ${subKey}`;

        console.info(`[MultiAgent][manager] Delegating to ${subKey}: "${question.slice(0, 80)}"`);
        output = await onAskAgent(subKey, question);
      } else {
        // Standard tool execution
        const result = await executeTool(toolName, rawArgs, toolCtx);
        output    = result.output;
        toolLabel = result.toolLabel;
      }

      if (toolLabel) toolsUsed.add(toolLabel);

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      output,
      });
    }
    // next turn: send tool results back to agent LLM
  }

  console.error(`[MultiAgent][${agent.key}] max turns reached without a text reply`);
  return { reply: null, toolsUsed: Array.from(toolsUsed), error: "Max turns exceeded" };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface MultiAgentInput {
  /** User phone number for state tracking */
  phone: string;
  /** Is the user an authenticated property manager? */
  isManager?: boolean;
  /** Full conversation history (ascending) */
  messages:  Array<{ direction: string; body: string }>;
  /** Pre-fetched context for agents */
  agentCtx:  AgentContext;
  /** Supabase clients + room data for tool execution */
  toolCtx:   ToolContext;
  /** AI gateway credentials */
  llmConfig: AiClientConfig;
  /** AI Lab Dashboard Configuration */
  aiLabConfig?: Record<string, any>;
  /** Max LLM turns per agent run (default 5) */
  maxTurns?: number;
  /** Optional abort signal to cancel LLM API requests */
  signal?: AbortSignal;
}

/**
 * Run the full multi-agent pipeline:
 *   classify → route → run agent → (manager delegates if needed) → return
 */
export async function runMultiAgentOrchestration(
  input: MultiAgentInput,
): Promise<MultiAgentResult> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;

  // 1. Extract last user message for classification
  const lastUserMsg = [...input.messages]
    .reverse()
    .find((m) => m.direction === "in")
    ?.body ?? "";

  // 2. Classify intent
  // 2. Manager Bypass
  if (input.isManager) {
    console.info(`[MultiAgent] Manager authenticated — routing directly to Manager Agent`);
    const agent = getAgent("manager");
    
    // For manager agent, we still need the onAskAgent callback
    const onAskAgent = async (subKey: AgentKey, question: string): Promise<string> => {
      const subAgent = getAgent(subKey);
      const syntheticMessages = [
        ...input.messages,
        { direction: "in", body: question },
      ];
      const result = await runAgent(
        subAgent,
        syntheticMessages,
        input.agentCtx,
        input.toolCtx,
        input.llmConfig,
        Math.max(2, maxTurns - 2),
        undefined,
        input.signal,
      );
      return result.reply
        ? JSON.stringify({ ok: true,  response: result.reply })
        : JSON.stringify({ ok: false, error:    result.error ?? "Sub-agent returned no reply" });
    };

    const agentResult = await runAgent(
      agent,
      input.messages,
      { ...input.agentCtx, customInstructions: input.aiLabConfig?.agents?.["manager"]?.instructions },
      input.toolCtx,
      input.llmConfig,
      maxTurns,
      onAskAgent,
      input.signal,
    );

    return {
      reply:             agentResult.reply,
      toolsUsed:         agentResult.toolsUsed,
      agentKey:          "manager",
      intent:            "general", // irrelevant for manager
      routingConfidence: 1.0,
      escalated:         false,
      error:             agentResult.error,
    };
  }

  // 3. State Machine Interception
  const stateRecord = await getBookingState(input.toolCtx.supabasePublic, input.phone);
  
  if (stateRecord.state !== "IDLE") {
    console.info(`[MultiAgent] Intercepted by Booking State Machine | State: ${stateRecord.state}`);
    const stateResult = await processBookingState(
      input.toolCtx.supabasePublic,
      input.phone,
      lastUserMsg,
      stateRecord
    );

    if (stateResult.handled && stateResult.reply) {
      return {
        reply:             stateResult.reply,
        toolsUsed:         ["booking_state_machine"],
        agentKey:          "front-office",
        intent:            "general",
        routingConfidence: 1.0,
        escalated:         false,
      };
    }
    // If not handled or needs LLM processing, we can either fall through or force front-office
    // For now, if the state machine didn't handle it with a direct reply, we let the normal flow run.
  }

  // 4. Classify intent
  const classified = classifyIntent(lastUserMsg);
  console.info(
    `[MultiAgent] Intent: ${classified.category} (confidence: ${classified.confidence.toFixed(2)}) ` +
    `| terms: ${classified.matchedTerms.slice(0, 3).join(", ")}`,
  );

  // 5. Route to agent

  // 5. Route to agent
  const routing = routeToAgent(classified);
  console.info(`[MultiAgent] Routing → ${routing.agentKey} | ${routing.reason}`);

  // 6. Load agent
  const agent = getAgent(routing.agentKey);

  // 7. Run agent
  //    For Manager Agent: provide the `onAskAgent` callback that runs sub-agents
  const isManagerRoute = routing.agentKey === "manager";

  const onAskAgent = isManagerRoute
    ? async (subKey: AgentKey, question: string): Promise<string> => {
        const subAgent = getAgent(subKey);

        // Build a synthetic single-turn conversation for the sub-agent
        const syntheticMessages = [
          ...input.messages,
          // Inject manager's question as the latest user turn
          { direction: "in", body: question },
        ];

        const result = await runAgent(
          subAgent,
          syntheticMessages,
          { ...input.agentCtx, customInstructions: input.aiLabConfig?.agents?.[subKey]?.instructions },
          input.toolCtx,
          input.llmConfig,
          Math.max(2, maxTurns - 2), // sub-agents get fewer turns
          undefined, // no nested delegation
          input.signal,
        );

        return result.reply
          ? JSON.stringify({ ok: true,  response: result.reply })
          : JSON.stringify({ ok: false, error:    result.error ?? "Sub-agent returned no reply" });
      }
    : undefined;

  const agentResult = await runAgent(
    agent,
    input.messages,
    { ...input.agentCtx, customInstructions: input.aiLabConfig?.agents?.[routing.agentKey]?.instructions },
    input.toolCtx,
    input.llmConfig,
    maxTurns,
    onAskAgent,
    input.signal,
  );

  // 6. If primary agent failed, fall back to Front Office
  if (!agentResult.reply && routing.agentKey !== "front-office") {
    console.warn(`[MultiAgent] ${routing.agentKey} failed — falling back to front-office`);
    const foAgent = getAgent("front-office");
    const foResult = await runAgent(
      foAgent,
      input.messages,
      { ...input.agentCtx, customInstructions: input.aiLabConfig?.agents?.["front-office"]?.instructions },
      input.toolCtx,
      input.llmConfig,
      maxTurns,
      undefined,
      input.signal,
    );

    return {
      reply:             foResult.reply,
      toolsUsed:         foResult.toolsUsed,
      agentKey:          "front-office",
      intent:            classified.category,
      routingConfidence: routing.confidence,
      escalated:         routing.escalated,
      error:             foResult.error,
    };
  }

  return {
    reply:             agentResult.reply,
    toolsUsed:         agentResult.toolsUsed,
    agentKey:          routing.agentKey,
    intent:            classified.category,
    routingConfidence: routing.confidence,
    escalated:         routing.escalated,
    error:             agentResult.error,
  };
}

// ─── Agent label helper ───────────────────────────────────────────────────────

/** Map the active agent key to the admin inbox label. */
export function deriveAgentLabelFromKey(agentKey: string): string {
  const labels: Record<string, string> = {
    "front-office": "Front Office Agent",
    pricing:        "Pricing Agent",
    housekeeping:   "Customer Care Agent",
    maintenance:    "Maintenance Agent",
    finance:        "Finance Agent",
    manager:        "Manager Agent",
  };
  return labels[agentKey] ?? "Front Office Agent";
}
