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

import type { AgentDefinition, AgentContext, AgentKey } from "@/ai/agents/types";
import type { AiClientConfig, AiMessage, LlmResponse } from "@/ai/types";
import type { ToolContext } from "@/tools/types";
import { executeTool } from "@/tools/executor";
import { getAgent } from "@/ai/agents/registry";
import { ASK_AGENT_TOOL_NAME } from "@/ai/agents/manager.agent";
import {
  formatManagerCommandResult,
  parseManagerCommand,
} from "@/ai/manager-command-parser";

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
   * Prior conversation turns for this (chat, thread, agent), oldest
   * first, WITHOUT the system prompt. Caller is responsible for
   * trimming. Empty / undefined = cold start.
   */
  history?:    AiMessage[];
}

export interface AgentRunResult {
  /** Reply text to forward to Telegram. ⚠️-prefixed on error. */
  reply: string;
  /**
   * Messages produced THIS turn (user message + assistant chain +
   * tool results). Empty when the run failed before producing a
   * usable assistant reply — caller should not persist in that case.
   */
  turn: AiMessage[];
}

/**
 * Returns `{ reply, turn }`. `reply` is the agent's natural-language
 * reply, or a SHORT human-readable error string starting with "⚠️" when
 * something blocks it (HTTP, max turns, repeated tool failures). `turn`
 * holds the new messages exchanged in this run so the caller can
 * append them to persisted history (only when the run actually
 * produced an assistant reply — empty on error).
 */
export async function runAgentInGroupChannel(args: RunArgs): Promise<AgentRunResult> {
  const { agentDef, messageText, agentCtx, toolCtx, llmConfig, history } = args;

  const userMsg: AiMessage = { role: "user", content: messageText };
  const turn: AiMessage[] = [userMsg];

  if (agentDef.key === "manager") {
    const parsedCommand = parseManagerCommand(messageText);
    if (parsedCommand) {
      const result = await executeTool(parsedCommand.toolName, parsedCommand.rawArgs, {
        ...toolCtx,
        isManager: true,
      });
      const reply = formatManagerCommandResult(parsedCommand, result.output);
      turn.push({ role: "assistant", content: reply });
      console.info(`[TgAgentRunner][manager] deterministic command: ${parsedCommand.label}`);
      return { reply, turn };
    }
  }

  // System prompt is rebuilt fresh every run so persona/mode/managerName
  // changes propagate immediately; only the turn list comes from history.
  const sysPrompt = agentDef.buildSystemPrompt(agentCtx);
  const agentTools = agentDef.getTools?.(agentCtx) ?? agentDef.tools;
  const messages: AiMessage[] = [
    { role: "system", content: sysPrompt },
    ...(history ?? []),
    userMsg,
  ];

  const toolTrail: string[] = []; // for error summarising
  let lastToolError: string | null = null;

  for (let turnNo = 0; turnNo < MAX_TURNS; turnNo++) {
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
          tools:       agentTools.length > 0 ? agentTools : undefined,
          tool_choice: agentTools.length > 0 ? "auto"     : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[TgAgentRunner][${agentDef.key}] HTTP ${res.status}`, body);
        return { reply: `⚠️ LLM error ${res.status}. ${truncate(body, 200)}`, turn: [] };
      }
      json = (await res.json()) as LlmResponse;
    } catch (e) {
      console.error(`[TgAgentRunner][${agentDef.key}] fetch error:`, e);
      return {
        reply: `⚠️ Tidak bisa menghubungi LLM: ${e instanceof Error ? e.message : String(e)}`,
        turn:  [],
      };
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls    = assistantMsg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (assistantMsg?.content ?? "").trim();
      if (text) {
        turn.push({ role: "assistant", content: text });
        return { reply: text, turn };
      }
      // Empty completion — surface what we know so admin can debug.
      if (lastToolError) {
        return {
          reply: `⚠️ Agent berhenti tanpa balasan. Tool terakhir gagal: ${lastToolError}`,
          turn:  [],
        };
      }
      if (toolTrail.length > 0) {
        return {
          reply: `⚠️ Agent berhenti tanpa balasan setelah tool: ${toolTrail.join(" → ")}`,
          turn:  [],
        };
      }
      return {
        reply: "⚠️ Agent tidak menghasilkan balasan (LLM mengembalikan content kosong).",
        turn:  [],
      };
    }

    const assistantTurn = assistantMsg as AiMessage;
    messages.push(assistantTurn);
    turn.push(assistantTurn);
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      console.info(`[TgAgentRunner][${agentDef.key}] turn ${turnNo + 1}: ${name}`);

      let output: string;
      if (name === ASK_AGENT_TOOL_NAME) {
        // ask_agent is intercepted here, not executed by the standard
        // executor (which has no handler for it). Spawn a sub-agent run
        // in-process and feed its reply back as the tool result.
        output = await delegateToSubAgent({
          rawArgs:  tc.function?.arguments ?? "{}",
          agentCtx,
          toolCtx,
          llmConfig,
          parentAgentKey: agentDef.key,
        });
      } else {
        const result = await executeTool(name, tc.function?.arguments ?? "{}", toolCtx);
        output = result.output;
      }
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
      const toolMsg: AiMessage = { role: "tool", tool_call_id: tc.id, content: output };
      messages.push(toolMsg);
      turn.push(toolMsg);
    }
  }

  console.warn(`[TgAgentRunner][${agentDef.key}] max turns reached after: ${toolTrail.join(" → ")}`);
  return {
    reply:
      `⚠️ Pekerjaan terlalu panjang (lebih dari ${MAX_TURNS} langkah). ` +
      `Tool yang sudah dijalankan: ${toolTrail.join(" → ") || "(none)"}. ` +
      `Coba minta task yang lebih spesifik / dipecah.`,
    turn: [],
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ─── ask_agent delegation (in-process sub-agent run) ────────────────────────

const ALLOWED_SUB_AGENTS: ReadonlySet<AgentKey> = new Set([
  "front-office", "pricing", "customer-care", "finance", "content",
] as AgentKey[]);

interface DelegateArgs {
  rawArgs:        string;
  agentCtx:       AgentContext;
  toolCtx:        ToolContext;
  llmConfig:      AiClientConfig;
  parentAgentKey: AgentKey;
}

/**
 * Run a sub-agent for ONE turn (cold conversation, just the question)
 * and return its reply as a JSON tool result.
 *
 * The sub-agent inherits agentCtx — so mode='managerial' carries over,
 * and the sub-agent's prompt branches correctly (e.g. Pricing managerial
 * vs guest). Tool ctx is the same too, so isManager + supabase clients
 * are preserved.
 *
 * Never throws — exceptions become an error JSON so the parent agent
 * can decide how to handle it.
 */
async function delegateToSubAgent(args: DelegateArgs): Promise<string> {
  let parsed: { agent_key?: string; question?: string } = {};
  try { parsed = JSON.parse(args.rawArgs); } catch { /* ignore */ }
  const rawKey = (parsed.agent_key ?? "").toLowerCase().trim();
  const question = (parsed.question ?? "").trim();

  if (!rawKey || !ALLOWED_SUB_AGENTS.has(rawKey as AgentKey)) {
    return JSON.stringify({
      ok: false,
      error: `agent_key tidak valid: '${rawKey}'. Pilihan: ${[...ALLOWED_SUB_AGENTS].join(", ")}.`,
    });
  }
  if (!question) {
    return JSON.stringify({
      ok: false,
      error: "Field 'question' wajib diisi saat memanggil ask_agent.",
    });
  }
  const subKey = rawKey as AgentKey;

  console.info(`[TgAgentRunner][${args.parentAgentKey}] ask_agent → ${subKey}: "${question.slice(0, 80)}"`);

  try {
    const subAgent = getAgent(subKey);
    // Override managerName so the sub-agent introduces itself as itself,
    // not the parent (Juminten asking Pricing should get a Julia-flavored
    // reply, not Juminten talking to herself).
    const subCtx: AgentContext = { ...args.agentCtx, managerName: undefined };
    const result = await runAgentInGroupChannel({
      agentDef:    subAgent,
      messageText: question,
      agentCtx:    subCtx,
      toolCtx:     args.toolCtx,
      llmConfig:   args.llmConfig,
      // No history — sub-agent runs as a cold one-shot.
      history:     [],
    });
    // Reply starts with ⚠️ when the sub-agent itself errored. Surface that
    // as ok:false so the parent LLM knows to recover instead of pass-through.
    if (result.reply.startsWith("⚠️")) {
      return JSON.stringify({ ok: false, error: result.reply, sub_agent: subKey });
    }
    return JSON.stringify({ ok: true, sub_agent: subKey, response: result.reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[TgAgentRunner][${args.parentAgentKey}] ask_agent → ${subKey} threw:`, msg);
    return JSON.stringify({ ok: false, error: `Sub-agent threw: ${msg}`, sub_agent: subKey });
  }
}
