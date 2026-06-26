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
import { classifyIntent } from "./router/intent-classifier";
import { routeToAgent } from "./router/agent-router";
import { getAgent } from "./agents/registry";
import { ASK_AGENT_TOOL_NAME } from "./agents/manager.agent";
import { executeTool } from "@/tools/executor";
import { parseManagerCommand, formatManagerCommandResult, formatRoomRatesList } from "./manager-command-parser";
import type { ToolContext } from "@/tools/types";
import { getBookingState, processBookingState, isDataEntryState } from "./state-machine/booking-machine";
import { getMissingSlots, formatPartialBookingSummary, extractAllSlots } from "./state-machine/flexible-slot-extractor";
import { resolveContext, seedEntityFromSummary } from "./router/context-resolver";
import { rewriteQuery } from "./router/query-rewriter";
import {
  retrieveTrainingExamples,
  formatTrainingExamplesForPrompt,
  type TrainingExample,
} from "./training-rag.service";
import { normalizeAssistantName } from "./agents/persona";
import { runDeferred } from "@/lib/cf-context";

const DEFAULT_MAX_TURNS = 3;

function formatToolDraftReply(toolName: string, output: string): string | null {
  try {
    const data = JSON.parse(output) as Record<string, any>;
    if (typeof data.reply_to_guest === "string" && data.reply_to_guest.trim()) {
      return data.reply_to_guest.trim();
    }

    if (toolName === "check_room_availability" && Array.isArray(data.kamar)) {
      const period = typeof data.periode === "string" ? data.periode : data.tanggal;
      const rows = data.kamar
        .slice(0, 8)
        .map((r: any) => {
          const available = Number(r.kamar_tersedia ?? 0);
          const icon = available > 0 ? "✅" : "❌";
          const price = Number(r.harga_per_malam ?? r.nightly_rate ?? 0).toLocaleString("id-ID");
          const stock = Number.isFinite(available) ? `${available} kamar tersedia` : "stok belum diatur";
          return `${icon} ${r.nama}: ${stock}, Rp${price}/malam`;
        })
        .join("\n");
      if (rows) {
        return `Ketersediaan kamar untuk ${period ?? "tanggal tersebut"}:\n${rows}\n\nMau pilih kamar yang mana, Kak?`;
      }
    }

    if (toolName === "create_booking") {
      if (data.ok === false) {
        return `Maaf Kak, booking belum bisa saya buat: ${data.error ?? "data belum lengkap"}`;
      }
      if (data.reference_code) {
        const total = Number(data.total ?? data.total_amount ?? 0);
        const totalText = total ? ` Totalnya Rp${total.toLocaleString("id-ID")}.` : "";
        return `Booking Kakak berhasil dibuat dengan kode *${data.reference_code}*.${totalText}`;
      }
    }
  } catch {
    /* non-JSON tool output */
  }
  return null;
}

function normalizeAgentInstruction(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeAssistantName(value, "") : undefined;
}

function normalizeAgentManagerName(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeAssistantName(value, "") : undefined;
}

// ─── LLM gateway call ─────────────────────────────────────────────────────────

/**
 * Hard timeout per panggilan LLM agar tidak pernah menggantung worker.
 *
 * PENTING: nilai ini harus cukup kecil agar beberapa ronde tool-call
 * (klasifikasi intent → panggil tool → balas) muat di dalam AI_TIMEOUT_MS
 * (controller luar di wa-autoreply.service.ts). Dengan 12s per panggilan +
 * 1 retry internal, satu ronde maksimal ~24.5s; dua ronde "happy path"
 * (tanpa retry) ~24s — keduanya muat di anggaran luar 40s. Sebelumnya 18s,
 * yang membuat retry internal mustahil selesai dan multi-turn hampir selalu
 * dipotong oleh controller luar → balasan fallback "sistem sedang sibuk".
 */
const LLM_CALL_TIMEOUT_MS = 12_000;
/** Berapa kali mencoba ulang saat timeout/HTTP 5xx sebelum menyerah. */
const LLM_MAX_RETRIES = 1;

async function callLlmOnce(
  config: AiClientConfig,
  messages: AiMessage[],
  agent: AgentDefinition,
  tools: AgentDefinition["tools"],
  signal?: AbortSignal,
): Promise<{ ok: true; data: LlmResponse } | { ok: false; retriable: boolean; reason: string }> {
  // Gabungkan signal pemanggil dengan timeout internal kita.
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), LLM_CALL_TIMEOUT_MS);
  const onAbort = () => timeoutCtrl.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: timeoutCtrl.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.6,
        max_tokens: 2000,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[MultiAgent][${agent.key}] LLM HTTP ${res.status}:`, body);
      // 408/429/5xx → boleh retry; 4xx lainnya → permanen.
      const retriable = res.status === 408 || res.status === 429 || res.status >= 500;
      return { ok: false, retriable, reason: `http_${res.status}` };
    }

    return { ok: true, data: (await res.json()) as LlmResponse };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    const reason = aborted ? (signal?.aborted ? "caller_abort" : "timeout") : "fetch_error";
    if (reason !== "caller_abort") {
      console.error(`[MultiAgent][${agent.key}] LLM ${reason}:`, e);
    }
    // Caller abort tidak boleh diulang; timeout/jaringan boleh.
    return { ok: false, retriable: reason !== "caller_abort", reason };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function callLlm(
  config: AiClientConfig,
  messages: AiMessage[],
  agent: AgentDefinition,
  tools: AgentDefinition["tools"],
  signal?: AbortSignal,
): Promise<{ response: LlmResponse | null; retries: Array<{ attempt: number; reason: string; latency_ms: number }> }> {
  const retries: Array<{ attempt: number; reason: string; latency_ms: number }> = [];
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    const r = await callLlmOnce(config, messages, agent, tools, signal);
    if (r.ok) return { response: r.data, retries };
    const latency_ms = Date.now() - t0;
    if (!r.retriable) {
      retries.push({ attempt, reason: r.reason, latency_ms });
      return { response: null, retries };
    }
    if (attempt < LLM_MAX_RETRIES) {
      retries.push({ attempt, reason: r.reason, latency_ms });
      console.warn(`[MultiAgent][${agent.key}] retry LLM (attempt ${attempt + 1}) — reason: ${r.reason}`);
      // Backoff singkat sebelum coba ulang.
      await new Promise((res) => setTimeout(res, 500));
    } else {
      retries.push({ attempt, reason: r.reason, latency_ms });
    }
  }
  return { response: null, retries };
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
  agent: AgentDefinition,
  conversationMsgs: Array<{ direction: string; body: string }>,
  agentCtx: AgentContext,
  toolCtx: ToolContext,
  llmConfig: AiClientConfig,
  maxTurns: number,
  onAskAgent?: (agentKey: AgentKey, question: string) => Promise<string>,
  signal?: AbortSignal,
  /** Blok few-shot dari training simulator (opsional, sudah diformat) */
  trainingExamplesBlock?: string,
): Promise<{
  reply: string | null;
  toolsUsed: string[];
  error?: string;
  retries?: Array<{ attempt: number; reason: string; latency_ms: number }>;
  loopAlert?: { toolName: string; repeatCount: number; lastArgs?: string; sampleOutput?: string };
}> {
  const toolsUsed = new Set<string>();
  const allRetries: Array<{ attempt: number; reason: string; latency_ms: number }> = [];
  let emptyCompletionRetried = false;
  let lastToolDraftReply: string | null = null;
  // Track per-tool need_dates repeats — surfaces loop pattern to caller.
  const needDatesCount = new Map<string, { count: number; lastArgs: string; lastOutput: string }>();
  // Resolve tools dynamically per run so context-aware tool sets (e.g.
  // mode-gated Front Office tools) take effect; fall back to the static list.
  const agentTools = agent.getTools?.(agentCtx) ?? agent.tools;

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
    systemPrompt +=
      `\n\nRINGKASAN PERCAKAPAN SEBELUMNYA:\n${agentCtx.chatSummary}\n` +
      `Gunakan ringkasan di atas sebagai konteks latar belakang obrolan. Tamu baru saja mengirimkan pesan baru untuk memulai sesi baru.`;
  }
  if (agentCtx.chatSummaryJson) {
    const s = agentCtx.chatSummaryJson;
    const fmt = (v: string | number | null | undefined) =>
      v === null || v === undefined || v === "" ? "-" : String(v);
    const structuredLines = [
      `- Tipe kamar terakhir: ${fmt(s.room_type)}`,
      `- Topik terakhir: ${fmt(s.last_topic)}`,
      `- Status booking: ${fmt(s.booking_status)}`,
      `- Status pembayaran: ${fmt(s.payment_status)}`,
      `- Check-in / out: ${fmt(s.check_in)} → ${fmt(s.check_out)}`,
      `- Jumlah tamu: ${fmt(s.guest_count)}`,
      `- Pertanyaan belum dijawab: ${fmt(s.unresolved_question)}`,
      `- Komplain aktif: ${s.complaint_active ? "ya" : "tidak"}`,
    ].join("\n");
    systemPrompt +=
      `\n\nKONTEKS TERSTRUKTUR DARI SESI SEBELUMNYA (pakai sebagai default, JANGAN konfirmasi ulang kecuali tamu menyebut data baru):\n` +
      structuredLines +
      `\nKalau pesan terakhir tamu menyebut tanggal / tipe kamar / jumlah tamu yang BERBEDA dengan data di atas, ABAIKAN nilai lama dan ikuti pesan terbaru.`;
  }
  if (agentCtx.agreedDates?.checkIn && agentCtx.agreedDates?.checkOut) {
    // NOTE: softer wording. Sebelumnya kalimat "TANGGAL SUDAH DISEPAKATI…
    // JANGAN reset" membuat Gemini menyimpulkan percakapan sudah selesai
    // sehingga hanya membalas dengan sapaan terakhir. Sekarang tanggal
    // disajikan sebagai catatan konteks — agen tetap menanyakan ulang
    // kalau tamu jelas-jelas mengajukan pertanyaan baru tanpa tanggal.
    systemPrompt +=
      `\n\nCATATAN KONTEKS — tanggal yang sebelumnya pernah dibahas dengan tamu ini:\n` +
      `• check_in: ${agentCtx.agreedDates.checkIn}\n` +
      `• check_out: ${agentCtx.agreedDates.checkOut}\n` +
      `Pakai tanggal ini sebagai default kalau tamu jelas melanjutkan topik kamar/booking ` +
      `yang sama (misal "harganya?", "yang deluxe gimana?", "oke booking"). ` +
      `Kalau tamu memulai topik baru atau menyebut tanggal lain, abaikan default ini.`;
  }

  if (agentCtx.bookingInProgress) {
    systemPrompt += `\n\n[INFO BOOKING INTERRUPT]`;
    systemPrompt += `\nSaat ini tamu sedang berada di tengah-tengah proses booking (fase pengumpulan data).`;
    if (agentCtx.pendingBookingSlots && agentCtx.pendingBookingSlots.length > 0) {
      systemPrompt += `\nData yang masih kosong: ${agentCtx.pendingBookingSlots.join(", ")}.`;
    }
    systemPrompt += `\nJawablah pertanyaan/permintaan terakhir dari tamu dengan singkat & ramah, lalu tambahkan ajakan sopan untuk melanjutkan pengisian data booking yang masih kurang tersebut.`;
  }

  if (agentCtx.recoveryMode) {
    systemPrompt += `\n\n[RECOVERY MODE ACTIVE]`;
    systemPrompt += `\nTamu mengirimkan beberapa pesan cepat berturut-turut tanpa balasan.`;
    if (agentCtx.unansweredMessages && agentCtx.unansweredMessages.length > 0) {
      systemPrompt +=
        `\nPesan-pesan tamu yang belum terjawab:\n` +
        agentCtx.unansweredMessages.map((m, i) => `${i + 1}. "${m}"`).join("\n");
    }
    systemPrompt += `\nAnda WAJIB memulai jawaban Anda dengan sapaan recovery: "Maaf Kak, saya bantu lanjutkan ya..." atau sejenisnya, lalu jawab semua poin pertanyaan/pesan di atas secara komprehensif dalam satu balasan terintegrasi.`;
  }

  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt },
    ...(trainingExamplesBlock ? [{ role: "system" as const, content: trainingExamplesBlock }] : []),
    ...history.map((m) => ({
      role: (m.direction === "in" ? "user" : "assistant") as AiMessage["role"],
      content: m.body,
    })),
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const { response: json, retries } = await callLlm(llmConfig, messages, agent, agentTools, signal);
    if (retries.length) allRetries.push(...retries);

    if (!json) {
      return {
        reply: null,
        toolsUsed: Array.from(toolsUsed),
        error: "LLM gateway error",
        ...(allRetries.length ? { retries: allRetries } : {}),
      };
    }

    const assistantMsg = json.choices?.[0]?.message;
    const toolCalls = assistantMsg?.tool_calls ?? [];

    // ── Text reply — done ────────────────────────────────────────────────────
    if (toolCalls.length === 0) {
      const reply = assistantMsg?.content?.trim() ?? null;
      if (!reply) {
        if (!emptyCompletionRetried) {
          emptyCompletionRetried = true;
          console.warn(`[MultiAgent][${agent.key}] empty completion — retrying with explicit final-answer nudge`);
          messages.push({
            role: "user",
            content:
              "Balasan sebelumnya kosong. Jawab pesan tamu terakhir sekarang dalam Bahasa Indonesia yang singkat, ramah, dan langsung membantu. Jangan kosong.",
          });
          continue;
        }
        const detail = json.error?.message ?? "Empty LLM response";
        console.error(`[MultiAgent][${agent.key}] No reply:`, detail);
        return {
          reply: lastToolDraftReply,
          toolsUsed: Array.from(toolsUsed),
          error: lastToolDraftReply ? `${detail}; returned tool draft` : detail,
          ...(allRetries.length ? { retries: allRetries } : {}),
        };
      }
      return { reply, toolsUsed: Array.from(toolsUsed), ...(allRetries.length ? { retries: allRetries } : {}) };
    }

    // ── Tool calls ────────────────────────────────────────────────────────────
    messages.push(assistantMsg as AiMessage);

    for (const tc of toolCalls) {
      const toolName = tc.function?.name ?? "";
      const rawArgs = tc.function?.arguments ?? "{}";

      let output: string;
      let toolLabel: string | null = null;

      // Intercept `ask_agent` — delegate to sub-agent
      if (toolName === ASK_AGENT_TOOL_NAME && onAskAgent) {
        let parsed: { agent_key?: string; question?: string } = {};
        try {
          parsed = JSON.parse(rawArgs);
        } catch {
          /* ignore */
        }

        const subKey = (parsed.agent_key ?? "front-office") as AgentKey;
        const question = parsed.question ?? "";
        toolLabel = `ask_agent → ${subKey}`;

        console.info(`[MultiAgent][manager] Delegating to ${subKey}: "${question.slice(0, 80)}"`);
        try {
          output = await onAskAgent(subKey, question);
        } catch (e) {
          // Don't kill the manager turn — surface a JSON error result so the
          // LLM can either retry, answer from its own knowledge, or report
          // gracefully to the manager instead of bubbling an exception.
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[MultiAgent][manager] ask_agent → ${subKey} threw:`, msg);
          output = JSON.stringify({ ok: false, error: `Sub-agent ${subKey} threw: ${msg}` });
        }
      } else {
        // Standard tool execution
        const result = await executeTool(toolName, rawArgs, toolCtx);
        output = result.output;
        toolLabel = result.toolLabel;
      }

      if (toolLabel) toolsUsed.add(toolLabel);

      const draft = formatToolDraftReply(toolName, output);
      if (draft) lastToolDraftReply = draft;

      // Loop heuristic: jika tool yang sama mengembalikan need_dates: true
      // ≥2× dalam 1 run → surface ke caller (super admin akan dapat alert).
      if (toolName && output.includes('"need_dates"')) {
        try {
          const parsed = JSON.parse(output);
          if (parsed && parsed.need_dates === true) {
            const prev = needDatesCount.get(toolName) ?? { count: 0, lastArgs: "", lastOutput: "" };
            needDatesCount.set(toolName, {
              count: prev.count + 1,
              lastArgs: rawArgs,
              lastOutput: output,
            });
          }
        } catch {
          /* ignore non-JSON */
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: output,
      });
    }
    // next turn: send tool results back to agent LLM
  }

  // Build loopAlert payload if any tool stuck on need_dates.
  let loopAlert: { toolName: string; repeatCount: number; lastArgs?: string; sampleOutput?: string } | undefined;
  for (const [toolName, info] of needDatesCount.entries()) {
    if (info.count >= 2 && (!loopAlert || info.count > loopAlert.repeatCount)) {
      loopAlert = { toolName, repeatCount: info.count, lastArgs: info.lastArgs, sampleOutput: info.lastOutput };
    }
  }

  console.error(`[MultiAgent][${agent.key}] max turns reached without a text reply`);
  return {
    reply: lastToolDraftReply,
    toolsUsed: Array.from(toolsUsed),
    error: lastToolDraftReply ? "Max turns exceeded; returned tool draft" : "Max turns exceeded",
    ...(allRetries.length ? { retries: allRetries } : {}),
    ...(loopAlert ? { loopAlert } : {}),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface MultiAgentInput {
  /** User phone number for state tracking */
  phone: string;
  /** Is the user an authenticated property manager? */
  isManager?: boolean;
  /** Full conversation history (ascending) */
  messages: Array<{ direction: string; body: string }>;
  /** Pre-fetched context for agents */
  agentCtx: AgentContext;
  /** Supabase clients + room data for tool execution */
  toolCtx: ToolContext;
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
export async function runMultiAgentOrchestration(input: MultiAgentInput): Promise<MultiAgentResult> {
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;

  // Make the guest's chat number available to every agent's prompt builder
  // and to tools / the booking state machine.
  input.agentCtx.chatPhone = input.phone;
  input.toolCtx.phone = input.phone;
  input.toolCtx.llmConfig = input.toolCtx.llmConfig ?? input.llmConfig;
  // Propagate the manager flag into tool context so privileged tools
  // (e.g. update_room_rate) can gate themselves to internal users only.
  if (input.isManager) input.toolCtx.isManager = true;

  // 1. Extract last user message for classification
  const lastUserMsg = [...input.messages].reverse().find((m) => m.direction === "in")?.body ?? "";

  // 2. Classify intent
  // 2. Manager Bypass
  if (input.isManager) {
    console.info(`[MultiAgent] Manager authenticated — routing directly to Manager Agent`);

    // Intercept deterministic commands
    const parsedCommand = parseManagerCommand(lastUserMsg);
    if (parsedCommand) {
      console.info(`[MultiAgent][manager] Intercepted deterministic command: ${parsedCommand.label}`);

      // list_room_rates is special: formats ctx.rooms directly, no tool call.
      if (parsedCommand.toolName === "list_room_rates") {
        const reply = formatRoomRatesList(input.toolCtx.rooms as any);
        return {
          status: "reply",
          reply,
          toolsUsed: [],
          agentKey: "manager",
          intent: "general",
          routingConfidence: 1.0,
          escalated: false,
        };
      }

      const result = await executeTool(parsedCommand.toolName, parsedCommand.rawArgs, {
        ...input.toolCtx,
        isManager: true,
      });
      const reply = formatManagerCommandResult(parsedCommand, result.output);
      return {
        status: "reply",
        reply,
        toolsUsed: [parsedCommand.toolName],
        agentKey: "manager",
        intent: "general",
        routingConfidence: 1.0,
        escalated: false,
      };
    }

    const agent = getAgent("manager");

    // For manager agent, we still need the onAskAgent callback
    const onAskAgent = async (subKey: AgentKey, question: string): Promise<string> => {
      const subAgent = getAgent(subKey);
      const syntheticMessages = [...input.messages, { direction: "in", body: question }];
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
        ? JSON.stringify({ ok: true, response: result.reply })
        : JSON.stringify({ ok: false, error: result.error ?? "Sub-agent returned no reply" });
    };

    const agentResult = await runAgent(
      agent,
      input.messages,
      {
        ...input.agentCtx,
        customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.["manager"]?.instructions),
      },
      input.toolCtx,
      input.llmConfig,
      maxTurns,
      onAskAgent,
      input.signal,
    );

    return {
      status: agentResult.reply ? "reply" : "error",
      reply: agentResult.reply,
      toolsUsed: agentResult.toolsUsed,
      agentKey: "manager",
      intent: "general", // irrelevant for manager
      routingConfidence: 1.0,
      escalated: false,
      error: agentResult.error,
      retries: agentResult.retries,
    };
  }

  // 3. State Machine Interception
  const stateRecord = await getBookingState(input.toolCtx.supabaseAdmin, input.phone);

  if (stateRecord.state !== "IDLE" || /^\[FORM_SUBMITTED:[^\]]+\]\s*$/i.test(lastUserMsg)) {
    console.info(`[MultiAgent] Intercepted by Booking State Machine | State: ${stateRecord.state}`);
    const stateResult = await processBookingState(input.toolCtx, input.phone, lastUserMsg, stateRecord);

    if (stateResult.handled && stateResult.reply) {
      let combinedReply = stateResult.reply;
      const toolsUsed: string[] = ["booking_state_machine"];

      // Hand invoice delivery to the Finance Agent in the same turn so the
      // guest sees one combined message: state-machine ack + agent-crafted
      // invoice details. Best-effort — if the agent fails, the ack still
      // ships and the guest can ask again later.
      let financeRetries: any[] | undefined = undefined;
      if (stateResult.followUp === "send_invoice") {
        const refCode = stateResult.followUpRef ?? "";
        // Pass full booking context so Finance Agent doesn't rely solely on a
        // DB lookup that may not have propagated yet (race condition right after
        // booking creation). Include booking code + key fields inline.
        const bookingCtx = stateRecord.context;
        const ctxLines = [
          refCode ? `Kode booking: ${refCode}` : null,
          bookingCtx.guestName ? `Nama tamu: ${bookingCtx.guestName}` : null,
          bookingCtx.guestPhone ? `Nomor HP: ${bookingCtx.guestPhone}` : null,
          bookingCtx.guestEmail ? `Email: ${bookingCtx.guestEmail}` : null,
          bookingCtx.checkIn ? `Check-in: ${bookingCtx.checkIn}` : null,
          bookingCtx.checkOut ? `Check-out: ${bookingCtx.checkOut}` : null,
          bookingCtx.roomName ? `Kamar: ${bookingCtx.roomName}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        const synthesized = refCode
          ? `Mohon kirimkan detail invoice dan info pembayaran untuk booking berikut:\n${ctxLines}`
          : `Mohon kirimkan detail invoice dan info pembayaran untuk booking saya yang baru.`;
        const financeAgent = getAgent("finance");
        const financeResult = await runAgent(
          financeAgent,
          [{ direction: "in", body: synthesized }],
          {
            ...input.agentCtx,
            customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.["finance"]?.instructions),
          },
          input.toolCtx,
          input.llmConfig,
          Math.max(2, (input.maxTurns ?? DEFAULT_MAX_TURNS) - 1),
          undefined,
          input.signal,
        );
        if (financeResult.reply) {
          combinedReply = `${stateResult.reply}\n\n${financeResult.reply}`;
          for (const t of financeResult.toolsUsed) toolsUsed.push(t);
        } else {
          // Finance Agent failed (e.g. DB lookup race after booking creation).
          // Degrade gracefully: show a friendly fallback instead of silently
          // dropping the invoice section, so the guest still gets confirmation.
          console.warn("[MultiAgent] Finance follow-up failed:", financeResult.error);
          if (refCode) {
            combinedReply =
              `${stateResult.reply}\n\n` +
              `Booking Kakak sudah berhasil dibuat dengan kode *${refCode}*. ` +
              `Detail pembayaran akan kami kirimkan segera. ` +
              `Admin juga sudah kami beri notifikasi.`;
          }
        }
        financeRetries = financeResult.retries;
      }

      return {
        status: "reply",
        reply: combinedReply,
        toolsUsed,
        agentKey: stateResult.followUp === "send_invoice" ? "finance" : "front-office",
        intent: "general",
        routingConfidence: 1.0,
        escalated: false,
        retries: financeRetries,
      };
    }
    // Not handled = the guest interrupted the booking with an unrelated question.
    // Let the LLM answer it, but flag that a booking is in progress so the agent
    // does not restart the flow (the state machine resumes on the next reply).
    if (isDataEntryState(stateRecord.state)) {
      input.agentCtx.bookingInProgress = true;
      input.agentCtx.pendingBookingSlots = getMissingSlots(stateRecord.context);
    }
  }

  // 4. Context resolver + query rewriter (deterministic; no LLM).
  //    Lets short follow-ups like "kalau deluxe" inherit the prior topic/entity
  //    so the classifier sees a self-contained query instead of guessing.
  //    If per-phone state was reset (new session / topic timeout) but a chat
  //    summary survives, seed lastEntity from it so the first turn of the
  //    new session still has continuity.
  const seededEntity = stateRecord.last_entity
    ? stateRecord.last_entity
    : (seedEntityFromSummary(
        {
          chatSummary: input.agentCtx.chatSummary,
          chatSummaryJson: input.agentCtx.chatSummaryJson,
        },
        input.toolCtx.rooms,
      ) as Record<string, unknown> | undefined);
  const resolved = resolveContext(
    lastUserMsg,
    {
      lastTopic: stateRecord.last_topic,
      lastEntity: seededEntity ?? null,
      slots: stateRecord.slots,
    },
    input.toolCtx.rooms,
  );

  // Seed agreedDates dari slots tersimpan agar diinject ke system prompt.
  // Hanya pakai kalau topic belum di-timeout (10 menit) — `last_topic` masih
  // ada artinya percakapan benar-benar masih aktif. Kalau sudah expired,
  // tanggal lama dianggap basi: men-inject-nya hanya mengelabui Gemini
  // sehingga membalas dengan sapaan terakhir (lihat regresi simulator).
  const priorSlots = (stateRecord.slots ?? {}) as Record<string, unknown>;
  const priorCheckIn = typeof priorSlots.checkIn === "string" ? priorSlots.checkIn : undefined;
  const priorCheckOut = typeof priorSlots.checkOut === "string" ? priorSlots.checkOut : undefined;

  // Decouple agreedDates dari last_topic — slots fresh selama record itu
  // sendiri belum kadaluarsa (DB sudah filter expired records via
  // get_active_booking_state). Hilangkan kelangkaan: tanggal hilang padahal
  // booking state masih aktif.
  if (priorCheckIn && priorCheckOut) {
    input.agentCtx.agreedDates = { checkIn: priorCheckIn, checkOut: priorCheckOut };
  }

  // Inject partial booking slots (room type / jumlah tamu) ke prompt agent
  // supaya tidak re-ask info yang sudah disebut tamu di turn sebelumnya.
  const partialRoomType = typeof priorSlots.partialRoomType === "string" ? priorSlots.partialRoomType : undefined;
  const partialAdults = typeof priorSlots.partialAdults === "number" ? priorSlots.partialAdults : undefined;
  const partialChildren = typeof priorSlots.partialChildren === "number" ? priorSlots.partialChildren : undefined;
  if (partialRoomType || partialAdults !== undefined || partialChildren !== undefined) {
    input.agentCtx.partialBooking = {
      roomType: partialRoomType,
      adults: partialAdults,
      children: partialChildren,
    };
  }

  // ── Slot persistence saat IDLE (Opsi B) ────────────────────────────────────
  // Saat tamu hanya bertanya-tanya (state IDLE, belum masuk booking flow),
  // state machine tidak menyimpan slot apa pun — sehingga tanggal/jumlah tamu/
  // tipe kamar yang sudah disebut bisa "terlupa" oleh agent LLM dan ditanyakan
  // ulang. Di sini kita jalankan extractor deterministik pada pesan tamu
  // terakhir dan MERGE hasilnya ke agreedDates / partialBooking, lalu nanti
  // dipersist ke finalSlots agar bertahan ke turn berikutnya. Slot baru yang
  // disebut tamu menimpa nilai lama; slot yang tidak disebut dipertahankan.
  const liveSlots = lastUserMsg.trim()
    ? extractAllSlots(
        lastUserMsg,
        (input.toolCtx.rooms ?? []) as Array<{ id: string; name: string; base_rate?: number | null }>,
        input.phone,
        input.toolCtx.today as string | undefined,
      )
    : {};

  // Tanggal: kalau tamu menyebut check-in & check-out baru di pesan ini, pakai
  // itu; kalau tidak, pertahankan agreedDates yang sudah ada.
  const mergedCheckIn = liveSlots.check_in ?? input.agentCtx.agreedDates?.checkIn;
  const mergedCheckOut = liveSlots.check_out ?? input.agentCtx.agreedDates?.checkOut;
  if (mergedCheckIn && mergedCheckOut) {
    input.agentCtx.agreedDates = { checkIn: mergedCheckIn, checkOut: mergedCheckOut };
  }

  // Tipe kamar / jumlah tamu: merge live extraction di atas nilai prior.
  const mergedRoomType = liveSlots.room_type ?? input.agentCtx.partialBooking?.roomType;
  const mergedAdults = liveSlots.adults ?? input.agentCtx.partialBooking?.adults;
  const mergedChildren = liveSlots.children ?? input.agentCtx.partialBooking?.children;
  if (mergedRoomType || mergedAdults !== undefined || mergedChildren !== undefined) {
    input.agentCtx.partialBooking = {
      roomType: mergedRoomType,
      adults: mergedAdults,
      children: mergedChildren,
    };
  }

  const rewrite = rewriteQuery(lastUserMsg, resolved);
  if (rewrite.rewritten_applied) {
    console.info(
      `[MultiAgent] Resolver: topic=${resolved.topic} entity=${resolved.entity?.label ?? "-"} ` +
        `| rewrite: "${rewrite.original}" → "${rewrite.rewritten}" | reasons: ${resolved.reasons.join("; ")}`,
    );
  }

  // 5. Classify intent — use the rewritten query when one was produced.
  //    Pass conversation context so short follow-ups ("ya", "oke") inherit the
  //    prior intent instead of degrading to "general".
  const queryForClassifier = rewrite.rewritten_applied ? rewrite.rewritten : lastUserMsg;
  const classified = await classifyIntent(queryForClassifier, input.toolCtx.supabaseAdmin, input.llmConfig, {
    bookingActive: stateRecord.state !== "IDLE",
    lastTopic: resolved.topic ?? stateRecord.last_topic ?? null,
    roomTypeNames: input.toolCtx.rooms.map((r) => r.name),
  });
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
    void runDeferred("MultiAgent.complaint-escalation", async () => {
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
    });
  }

  // 4b. Retrieve training examples (RAG di ai_conversation_logs).
  //     Skip saat tamu sedang di tengah pengisian data booking — di sana
  //     jawaban harus mengikuti state machine, bukan few-shot.
  //     Skip juga bila pemanggil (wa-autoreply) sudah melakukan unified
  //     retrieval & menaruh hasilnya di `agentCtx.trainingExamples` —
  //     hindari fetch ganda.
  let trainingExamples: TrainingExample[] = [];
  let trainingBlock: string | undefined;
  const alreadyProvided = (input.agentCtx.trainingExamples?.length ?? 0) > 0;
  if (!alreadyProvided && !input.agentCtx.bookingInProgress && lastUserMsg.trim().length > 0) {
    try {
      const { readTrainingRagConfig } = await import("@/admin/modules/ai-lab/ai-lab.functions");
      const ragCfg = await readTrainingRagConfig(input.toolCtx.supabaseAdmin);
      if (ragCfg.enabled) {
        trainingExamples = await retrieveTrainingExamples(input.toolCtx.supabaseAdmin, lastUserMsg, input.llmConfig, {
          matchCount: ragCfg.matchCount,
          minSimilarity: ragCfg.minSimilarity,
        });
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
  const managerSubAgentRetries: Array<{ attempt: number; reason: string; latency_ms: number }> = [];

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
            customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.[subKey]?.instructions),
            managerName: normalizeAgentManagerName(input.aiLabConfig?.agents?.[subKey]?.managerName),
          },
          input.toolCtx,
          input.llmConfig,
          Math.max(2, maxTurns - 2), // sub-agents get fewer turns
          undefined, // no nested delegation
          input.signal,
          trainingBlock,
        );

        if (result.retries) {
          managerSubAgentRetries.push(...result.retries);
        }

        return result.reply
          ? JSON.stringify({ ok: true, response: result.reply })
          : JSON.stringify({ ok: false, error: result.error ?? "Sub-agent returned no reply" });
      }
    : undefined;

  const agentResult = await runAgent(
    agent,
    input.messages,
    {
      ...input.agentCtx,
      customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.[routing.agentKey]?.instructions),
      managerName: normalizeAgentManagerName(input.aiLabConfig?.agents?.[routing.agentKey]?.managerName),
    },
    input.toolCtx,
    input.llmConfig,
    maxTurns,
    onAskAgent,
    input.signal,
    trainingBlock,
  );

  // Persist topic/entity/slots so the NEXT turn can resolve short follow-ups.
  // Merge tanggal terbaru (jika tool availability/start-booking dipanggil) ke
  // slots agar turn berikutnya tetap memakai tanggal yang sama.
  const finalSlots: Record<string, unknown> = { ...(resolved.slots ?? {}) };
  if (input.toolCtx.lastDates) {
    finalSlots.checkIn = input.toolCtx.lastDates.checkIn;
    finalSlots.checkOut = input.toolCtx.lastDates.checkOut;
  } else if (input.agentCtx.agreedDates) {
    // Pertahankan tanggal yang sudah disepakati (dari slot tersimpan ATAU hasil
    // ekstraksi live di turn ini) walau tool tanggal tidak dipanggil.
    finalSlots.checkIn = input.agentCtx.agreedDates.checkIn;
    finalSlots.checkOut = input.agentCtx.agreedDates.checkOut;
  } else if (priorCheckIn && priorCheckOut) {
    finalSlots.checkIn = priorCheckIn;
    finalSlots.checkOut = priorCheckOut;
  }
  // Persist partial booking slots (tipe kamar / jumlah tamu) hasil merge live
  // extraction, supaya turn berikutnya tidak menanyakan ulang.
  if (input.agentCtx.partialBooking) {
    if (input.agentCtx.partialBooking.roomType !== undefined)
      finalSlots.partialRoomType = input.agentCtx.partialBooking.roomType;
    if (input.agentCtx.partialBooking.adults !== undefined)
      finalSlots.partialAdults = input.agentCtx.partialBooking.adults;
    if (input.agentCtx.partialBooking.children !== undefined)
      finalSlots.partialChildren = input.agentCtx.partialBooking.children;
  }
  // Fire-and-forget — failure here must not break the reply path.
  if (resolved.topic || resolved.entity || Object.keys(finalSlots).length) {
    void runDeferred("MultiAgent.update-conversation-topic", async () => {
      const { error } = await input.toolCtx.supabaseAdmin.rpc("update_conversation_topic", {
        p_phone: input.phone,
        p_last_topic: resolved.topic ?? null,
        p_last_entity: resolved.entity ?? null,
        p_slots: finalSlots,
      });
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
        customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.["front-office"]?.instructions),
        managerName: normalizeAgentManagerName(input.aiLabConfig?.agents?.["front-office"]?.managerName),
      },
      input.toolCtx,
      input.llmConfig,
      maxTurns,
      undefined,
      input.signal,
      trainingBlock,
    );

    return {
      status: foResult.reply ? "reply" : "error",
      reply: foResult.reply,
      toolsUsed: foResult.toolsUsed,
      agentKey: "front-office",
      intent: classified.category,
      routingConfidence: routing.confidence,
      escalated: routing.escalated,
      error: foResult.error,
      trainingExamplesUsed: trainingExamples.length,
      trainingExampleIds: trainingExamples.map((ex) => ex.id),
      retries:
        foResult.retries || managerSubAgentRetries.length
          ? [...(foResult.retries ?? []), ...managerSubAgentRetries]
          : undefined,
    };
  }

  return {
    status: agentResult.reply ? "reply" : "error",
    reply: agentResult.reply,
    toolsUsed: agentResult.toolsUsed,
    agentKey: routing.agentKey,
    intent: classified.category,
    routingConfidence: routing.confidence,
    escalated: routing.escalated,
    error: agentResult.error,
    trainingExamplesUsed: trainingExamples.length,
    trainingExampleIds: trainingExamples.map((ex) => ex.id),
    retries:
      agentResult.retries || managerSubAgentRetries.length
        ? [...(agentResult.retries ?? []), ...managerSubAgentRetries]
        : undefined,
    loopAlert: agentResult.loopAlert,
  };
}

// ─── Agent label helper ───────────────────────────────────────────────────────

/** Map the active agent key to the admin inbox label. */
export function deriveAgentLabelFromKey(agentKey: string): string {
  const labels: Record<string, string> = {
    "front-office": "Front Office Agent",
    pricing: "Pricing Agent",
    "customer-care": "Customer Care Agent",
    finance: "Finance Agent",
    content: "Content Manager Agent",
    manager: "Manager Agent",
  };
  return labels[agentKey] ?? "Front Office Agent";
}
