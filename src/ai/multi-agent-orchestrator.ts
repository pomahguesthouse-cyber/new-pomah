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
import { getBookingState, processBookingState, isDataEntryState } from "./state-machine/booking-machine";
import { resolveContext } from "./router/context-resolver";
import { rewriteQuery }   from "./router/query-rewriter";
import {
  retrieveTrainingExamples,
  formatTrainingExamplesForPrompt,
  type TrainingExample,
} from "./training-rag.service";

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
        // Gemini 2.5 thinking tokens count against this budget; keep it generous
        // so reasoning + tool calls don't exhaust it and return empty content.
        max_tokens:  2000,
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
  /** Blok few-shot dari training simulator (opsional, sudah diformat) */
  trainingExamplesBlock?: string,
): Promise<{ reply: string | null; toolsUsed: string[]; error?: string }> {
  const toolsUsed = new Set<string>();

  // Drop trailing assistant turns: Gemini returns an empty completion when the
  // conversation ends on an assistant message (it has nothing new to answer).
  // The meaningful last turn is always the guest's latest inbound message.
  const trimmed = [...conversationMsgs];
  while (trimmed.length && trimmed[trimmed.length - 1].direction !== "in") trimmed.pop();
  const history = trimmed.length ? trimmed : conversationMsgs;

  // Build message array: agent system prompt (+ optional training examples
  // as a second system message) + conversation history. Examples are kept
  // in a SEPARATE system message so they don't bloat the agent's base prompt
  // and are clearly labelled as guidance, not as part of the persona.
  let systemPrompt = agent.buildSystemPrompt(agentCtx);
  if (agentCtx.chatSummary) {
    systemPrompt += `\n\nRINGKASAN PERCAKAPAN SEBELUMNYA:\n${agentCtx.chatSummary}\n` +
      `Gunakan ringkasan di atas sebagai konteks latar belakang obrolan. Tamu baru saja mengirimkan pesan baru untuk memulai sesi baru.`;
  }

  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt },
    ...(trainingExamplesBlock
      ? [{ role: "system" as const, content: trainingExamplesBlock }]
      : []),
    ...history.map((m) => ({
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

  // Make the guest's chat number available to every agent's prompt builder
  // and to tools / the booking state machine.
  input.agentCtx.chatPhone = input.phone;
  input.toolCtx.phone = input.phone;

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
      status:            agentResult.reply ? "reply" : "error",
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
      input.toolCtx,
      input.phone,
      lastUserMsg,
      stateRecord
    );

    if (stateResult.handled && stateResult.reply) {
      return {
        status:            "reply",
        reply:             stateResult.reply,
        toolsUsed:         ["booking_state_machine"],
        agentKey:          "front-office",
        intent:            "general",
        routingConfidence: 1.0,
        escalated:         false,
      };
    }
    // Not handled = the guest interrupted the booking with an unrelated question.
    // Let the LLM answer it, but flag that a booking is in progress so the agent
    // does not restart the flow (the state machine resumes on the next reply).
    if (isDataEntryState(stateRecord.state)) {
      input.agentCtx.bookingInProgress = true;
    }
  }

  // 4. Context resolver + query rewriter (deterministic; no LLM).
  //    Lets short follow-ups like "kalau deluxe" inherit the prior topic/entity
  //    so the classifier sees a self-contained query instead of guessing.
  const resolved = resolveContext(
    lastUserMsg,
    {
      lastTopic:  stateRecord.last_topic,
      lastEntity: stateRecord.last_entity,
      slots:      stateRecord.slots,
    },
    input.toolCtx.rooms,
  );
  const rewrite = rewriteQuery(lastUserMsg, resolved);
  if (rewrite.rewritten_applied) {
    console.info(
      `[MultiAgent] Resolver: topic=${resolved.topic} entity=${resolved.entity?.label ?? "-"} ` +
      `| rewrite: "${rewrite.original}" → "${rewrite.rewritten}" | reasons: ${resolved.reasons.join("; ")}`,
    );
  }

  // 5. Classify intent — use the rewritten query when one was produced.
  const queryForClassifier = rewrite.rewritten_applied ? rewrite.rewritten : lastUserMsg;
  const classified = await classifyIntent(queryForClassifier, input.toolCtx.supabaseAdmin, input.llmConfig);
  console.info(
    `[MultiAgent] Intent: ${classified.category} (confidence: ${classified.confidence.toFixed(2)}) ` +
    `| terms: ${classified.matchedTerms.slice(0, 3).join(", ")}`,
  );

  // 4a. Eskalasi komplain: jika intent komplain/maintenance dgn confidence > 0.7,
  //     buat record di guest_complaints + notif manager (fire-and-forget).
  const complaintCategories: string[] = ["complaint", "maintenance"];
  if (
    complaintCategories.includes(classified.category) &&
    classified.confidence > 0.7 &&
    lastUserMsg.trim().length > 0
  ) {
    void (async () => {
      try {
        const db: any = input.toolCtx.supabaseAdmin;
        const { data: existing } = await db
          .from("guest_complaints")
          .select("id")
          .eq("phone", input.phone)
          .in("status", ["OPEN", "IN_PROGRESS"])
          .limit(1)
          .maybeSingle();
        if (existing?.id) return; // sudah ada komplain aktif untuk nomor ini

        const { data: thread } = await db
          .from("whatsapp_threads")
          .select("id, display_name")
          .eq("phone", input.phone)
          .maybeSingle();

        const { data: inserted } = await db
          .from("guest_complaints")
          .insert({
            guest_name: thread?.display_name ?? null,
            phone: input.phone,
            thread_id: thread?.id ?? null,
            category: classified.category,
            message: lastUserMsg,
            confidence: classified.confidence,
            status: "OPEN",
          })
          .select("id")
          .single();
        if (inserted?.id) {
          const { notifyComplaint } = await import("@/services/manager-notifier.service");
          await notifyComplaint(db, inserted.id);
        }
      } catch (e) {
        console.warn("[MultiAgent] Eskalasi komplain gagal:", e);
      }
    })();
  }

  // 4b. Retrieve training examples (RAG di ai_conversation_logs).
  //     Skip saat tamu sedang di tengah pengisian data booking — di sana
  //     jawaban harus mengikuti state machine, bukan few-shot.
  let trainingExamples: TrainingExample[] = [];
  let trainingBlock: string | undefined;
  if (!input.agentCtx.bookingInProgress && lastUserMsg.trim().length > 0) {
    try {
      const { readTrainingRagConfig } = await import(
        "@/admin/modules/ai-lab/ai-lab.functions"
      );
      const ragCfg = await readTrainingRagConfig(input.toolCtx.supabaseAdmin);
      if (ragCfg.enabled) {
        trainingExamples = await retrieveTrainingExamples(
          input.toolCtx.supabaseAdmin,
          lastUserMsg,
          input.llmConfig,
          { matchCount: ragCfg.matchCount, minSimilarity: ragCfg.minSimilarity },
        );
        if (trainingExamples.length > 0) {
          trainingBlock = formatTrainingExamplesForPrompt(trainingExamples);
          console.info(
            `[MultiAgent] Training RAG: ${trainingExamples.length} contoh ` +
              `(top sim ${trainingExamples[0].similarity.toFixed(2)}, ` +
              `k=${ragCfg.matchCount}, min=${ragCfg.minSimilarity})`,
          );
        }
      } else {
        console.info("[MultiAgent] Training RAG disabled by config");
      }
    } catch (e) {
      console.warn("[MultiAgent] Training RAG failed (non-fatal):", e);
    }
  }

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
          { 
            ...input.agentCtx, 
            customInstructions: input.aiLabConfig?.agents?.[subKey]?.instructions,
            managerName:        input.aiLabConfig?.agents?.[subKey]?.managerName,
          },
          input.toolCtx,
          input.llmConfig,
          Math.max(2, maxTurns - 2), // sub-agents get fewer turns
          undefined, // no nested delegation
          input.signal,
          trainingBlock,
        );

        return result.reply
          ? JSON.stringify({ ok: true,  response: result.reply })
          : JSON.stringify({ ok: false, error:    result.error ?? "Sub-agent returned no reply" });
      }
    : undefined;

  const agentResult = await runAgent(
    agent,
    input.messages,
    { 
      ...input.agentCtx, 
      customInstructions: input.aiLabConfig?.agents?.[routing.agentKey]?.instructions,
      managerName:        input.aiLabConfig?.agents?.[routing.agentKey]?.managerName,
    },
    input.toolCtx,
    input.llmConfig,
    maxTurns,
    onAskAgent,
    input.signal,
    trainingBlock,
  );

  // Persist topic/entity/slots so the NEXT turn can resolve short follow-ups.
  // Fire-and-forget — failure here must not break the reply path.
  if (resolved.topic || resolved.entity || Object.keys(resolved.slots).length) {
    void input.toolCtx.supabasePublic
      .rpc("update_conversation_topic", {
        p_phone:       input.phone,
        p_last_topic:  resolved.topic ?? null,
        p_last_entity: resolved.entity ?? null,
        p_slots:       resolved.slots ?? {},
      })
      .then(({ error }: { error: unknown }) => {
        if (error) console.warn("[MultiAgent] update_conversation_topic failed:", error);
      });
  }

  // 6. If primary agent failed, fall back to Front Office
  if (!agentResult.reply && routing.agentKey !== "front-office") {
    console.warn(`[MultiAgent] ${routing.agentKey} failed — falling back to front-office`);
    const foAgent = getAgent("front-office");
    const foResult = await runAgent(
      foAgent,
      input.messages,
      { 
        ...input.agentCtx, 
        customInstructions: input.aiLabConfig?.agents?.["front-office"]?.instructions,
        managerName:        input.aiLabConfig?.agents?.["front-office"]?.managerName,
      },
      input.toolCtx,
      input.llmConfig,
      maxTurns,
      undefined,
      input.signal,
      trainingBlock,
    );

    return {
      status:               foResult.reply ? "reply" : "error",
      reply:                foResult.reply,
      toolsUsed:            foResult.toolsUsed,
      agentKey:             "front-office",
      intent:               classified.category,
      routingConfidence:    routing.confidence,
      escalated:            routing.escalated,
      error:                foResult.error,
      trainingExamplesUsed: trainingExamples.length,
      trainingExampleIds:   trainingExamples.map((ex) => ex.id),
    };
  }

  return {
    status:               agentResult.reply ? "reply" : "error",
    reply:                agentResult.reply,
    toolsUsed:            agentResult.toolsUsed,
    agentKey:             routing.agentKey,
    intent:               classified.category,
    routingConfidence:    routing.confidence,
    escalated:            routing.escalated,
    error:                agentResult.error,
    trainingExamplesUsed: trainingExamples.length,
    trainingExampleIds:   trainingExamples.map((ex) => ex.id),
  };
}

// ─── Agent label helper ───────────────────────────────────────────────────────

/** Map the active agent key to the admin inbox label. */
export function deriveAgentLabelFromKey(agentKey: string): string {
  const labels: Record<string, string> = {
    "front-office": "Front Office Agent",
    pricing:        "Pricing Agent",
    "customer-care": "Customer Care Agent",
    maintenance:    "Maintenance Agent",
    finance:        "Finance Agent",
    manager:        "Manager Agent",
  };
  return labels[agentKey] ?? "Front Office Agent";
}
