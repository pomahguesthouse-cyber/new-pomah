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
import type {
  MultiAgentResult,
  AgentDefinition,
  AgentContext,
  AgentKey,
  IntentCategory,
} from "./agents/types";
import { mentionsExplicitDateSignal } from "@/lib/id-date";
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
import { burstWantsMedia, isMediaRequest } from "@/services/wa-autoreply/message-parsers";

// Dulu 6 — tidak realistis: anggaran luar (AI_TIMEOUT_MS di
// wa-autoreply.service.ts) hanya 14s, jadi maksimal ~2 ronde LLM yang benar-
// benar muat. 3 memberi ruang untuk 1 ronde tool-call + 1 balasan teks + 1
// cadangan, tanpa membiarkan loop tool memakan seluruh anggaran.
const DEFAULT_MAX_TURNS = 3;

// ─── Cache config Training RAG ────────────────────────────────────────────────
// readTrainingRagConfig men-query tabel `properties` — sebelumnya dilakukan
// SETIAP pesan masuk, menambah 1 round-trip DB serial di jalur panas sebelum
// agent jalan. Config ini nyaris tidak pernah berubah → cache 5 menit
// (per-isolate, sama seperti cache ai_intent_rules di intent-classifier).
type TrainingRagCfg = { enabled: boolean; matchCount: number; minSimilarity: number };
let cachedRagCfg: { cfg: TrainingRagCfg; expiresAt: number } | null = null;
const RAG_CFG_TTL_MS = 5 * 60 * 1000;

async function getTrainingRagConfigCached(supabaseAdmin: unknown): Promise<TrainingRagCfg> {
  const now = Date.now();
  if (cachedRagCfg && cachedRagCfg.expiresAt > now) return cachedRagCfg.cfg;
  const { readTrainingRagConfig } = await import("@/admin/modules/ai-lab/ai-lab.functions");
  const cfg = (await readTrainingRagConfig(supabaseAdmin as any)) as TrainingRagCfg;
  cachedRagCfg = { cfg, expiresAt: now + RAG_CFG_TTL_MS };
  return cfg;
}

/** Kosongkan cache config RAG — dipanggil editor admin setelah menyimpan. */
export function clearTrainingRagConfigCache(): void {
  cachedRagCfg = null;
}

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

function selectRecoveryClassifierQuery(lastUserMsg: string, unansweredMessages?: string[]): string {
  const candidates = (unansweredMessages ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  if (candidates.length === 0) return lastUserMsg;

  const scoreMessage = (message: string): number => {
    const text = message.toLowerCase();
    let score = Math.min(message.length, 160) / 40;
    if (/\b(available|availability|avail|tersedia|ketersediaan|kosong|ada kamar|guesthouse|guest house|kamar|room)\b/i.test(text)) {
      score += 6;
    }
    if (/\b(harga|rate|tarif|berapa|booking|reservasi|pesan|check.?in|check.?out|tanggal|malam|orang|tamu)\b/i.test(text)) {
      score += 3;
    }
    if (/\?/.test(message)) score += 2;
    if (/^\s*(halo|hai|hi|hello)\s*$/i.test(message)) score -= 4;
    if (/\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?|dapat|dapet|lihat|nemu)\b/i.test(text)) {
      score -= 2;
    }
    return score;
  };

  const best = candidates.reduce((winner, current) =>
    scoreMessage(current) > scoreMessage(winner) ? current : winner,
  );
  const joined = candidates.join("\n");
  return best === lastUserMsg.trim() ? joined : best;
}

// ─── LLM gateway call ─────────────────────────────────────────────────────────

/**
 * Batas atas timeout per panggilan LLM agar tidak pernah menggantung worker.
 *
 * Audit 7 Agu 2026 (B3): dulu nilai ini statis dan invariant
 * `LLM_CALL_TIMEOUT_MS × (LLM_MAX_RETRIES + 1) + backoff < AI_TIMEOUT_MS`
 * TIDAK terpenuhi (10 + 0,5 + 10 = 20,5s > 18s) — satu turn saja sudah bisa
 * melewati anggaran, sehingga percakapan tool-calling normal rutin dipotong
 * AbortController luar dan berakhir dengan fallback "sistem sedang lambat".
 *
 * Sekarang timeout dihitung dinamis dari SISA anggaran (`deadlineAt`):
 *   - Tidak pernah melebihi LLM_CALL_TIMEOUT_MAX_MS.
 *   - Tidak pernah melebihi sisa waktu dikurangi cadangan untuk memproses
 *     hasil + mengirim WhatsApp.
 *   - Retry hanya dijalankan bila sisa waktu memang cukup untuk satu
 *     panggilan penuh lagi (lihat `callLlm`).
 */
const LLM_CALL_TIMEOUT_MAX_MS = 10_000;
/** Lantai timeout — di bawah ini panggilan hampir pasti sia-sia. */
const LLM_CALL_TIMEOUT_MIN_MS = 3_500;
/** Cadangan waktu untuk parsing hasil, eksekusi tool, dan pengiriman balasan. */
const LLM_BUDGET_RESERVE_MS = 1_500;
/** Berapa kali mencoba ulang saat timeout/HTTP 5xx sebelum menyerah. */
const LLM_MAX_RETRIES = 1;

/**
 * Timeout efektif untuk satu panggilan LLM berdasarkan sisa anggaran.
 * `null` berarti sisa waktu sudah tidak cukup untuk memanggil sama sekali.
 */
function resolveCallTimeoutMs(deadlineAt?: number): number | null {
  if (!deadlineAt) return LLM_CALL_TIMEOUT_MAX_MS;
  const remaining = deadlineAt - Date.now() - LLM_BUDGET_RESERVE_MS;
  if (remaining < LLM_CALL_TIMEOUT_MIN_MS) return null;
  return Math.min(LLM_CALL_TIMEOUT_MAX_MS, remaining);
}

async function callLlmOnce(
  config: AiClientConfig,
  messages: AiMessage[],
  agent: AgentDefinition,
  tools: AgentDefinition["tools"],
  signal?: AbortSignal,
  timeoutMs: number = LLM_CALL_TIMEOUT_MAX_MS,
): Promise<{ ok: true; data: LlmResponse } | { ok: false; retriable: boolean; reason: string }> {
  // Gabungkan signal pemanggil dengan timeout internal kita.
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
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
        // Balasan WhatsApp pendek; 800 token (~3000 karakter) cukup bahkan
        // untuk daftar booking manager. Nilai lama 2000 memperpanjang tail
        // latency saat model "kebablasan" menulis panjang.
        max_tokens: 800,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        response_format: tools.length > 0 ? undefined : { type: "json_object" },
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
  deadlineAt?: number,
): Promise<{ response: LlmResponse | null; retries: Array<{ attempt: number; reason: string; latency_ms: number }> }> {
  const retries: Array<{ attempt: number; reason: string; latency_ms: number }> = [];
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const timeoutMs = resolveCallTimeoutMs(deadlineAt);
    if (timeoutMs === null) {
      // Sisa anggaran tidak cukup. Berhenti rapi supaya pemanggil bisa memakai
      // draft dari tool (kalau ada) alih-alih dipotong paksa di tengah fetch.
      console.warn(`[MultiAgent][${agent.key}] anggaran waktu habis — berhenti sebelum panggilan LLM`);
      retries.push({ attempt, reason: "budget_exhausted", latency_ms: 0 });
      return { response: null, retries };
    }

    const t0 = Date.now();
    const r = await callLlmOnce(config, messages, agent, tools, signal, timeoutMs);
    if (r.ok) return { response: r.data, retries };
    const latency_ms = Date.now() - t0;
    retries.push({ attempt, reason: r.reason, latency_ms });
    if (!r.retriable) {
      return { response: null, retries };
    }
    if (attempt < LLM_MAX_RETRIES) {
      // Retry hanya masuk akal bila sisa waktu cukup untuk satu panggilan
      // penuh lagi SETELAH backoff — kalau tidak, kita hanya membakar sisa
      // anggaran lalu tetap gagal.
      const BACKOFF_MS = 500;
      if (resolveCallTimeoutMs(deadlineAt ? deadlineAt - BACKOFF_MS : undefined) === null) {
        console.warn(`[MultiAgent][${agent.key}] lewati retry LLM — sisa anggaran tidak cukup`);
        return { response: null, retries };
      }
      console.warn(`[MultiAgent][${agent.key}] retry LLM (attempt ${attempt + 1}) — reason: ${r.reason}`);
      await new Promise((res) => setTimeout(res, BACKOFF_MS));
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
  conversationMsgs: Array<{ direction: string; body: string; isHuman?: boolean }>,
  agentCtx: AgentContext,
  toolCtx: ToolContext,
  llmConfig: AiClientConfig,
  maxTurns: number,
  onAskAgent?: (agentKey: AgentKey, question: string) => Promise<string>,
  signal?: AbortSignal,
  /** Blok few-shot dari training simulator (opsional, sudah diformat) */
  trainingExamplesBlock?: string,
  /**
   * Batas waktu dinding-jam (epoch ms) untuk seluruh orkestrasi. Dipakai
   * menghitung timeout per panggilan LLM supaya tidak pernah melampaui
   * anggaran luar (audit 7 Agu 2026 — B3).
   */
  deadlineAt?: number,
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
  // Daftar nama tool yang SAH untuk agent ini — dipakai untuk memblokir
  // panggilan tool halusinasi di luar daftar (lihat enforcement di bawah).
  const allowedToolNames = new Set(
    (agentTools ?? []).map((t) => t.function?.name).filter(Boolean) as string[],
  );

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
  // Use structured JSON summary as primary context; only use text summary if JSON is empty
  if (agentCtx.chatSummaryJson && Object.keys(agentCtx.chatSummaryJson).length > 0) {
    const s = agentCtx.chatSummaryJson;
    const fmt = (v: string | number | null | undefined) =>
      v === null || v === undefined || v === "" ? "-" : String(v);
    const structuredLines = [
      `- Nama tamu: ${fmt(s.guest_name)}`,
      `- Tipe kamar terakhir: ${fmt(s.room_type)}`,
      `- Topik terakhir: ${fmt(s.last_topic)}`,
      `- Status booking: ${fmt(s.booking_status)}`,
      `- Status pembayaran: ${fmt(s.payment_status)}`,
      `- Check-in / out: ${fmt(s.check_in)} → ${fmt(s.check_out)}`,
      `- Jumlah tamu: ${fmt(s.guest_count)}`,
      `- Pertanyaan belum dijawab: ${fmt(s.unresolved_question)}`,
      `- Komplain aktif: ${s.complaint_active ? "ya" : "tidak"}`,
      `- Permintaan khusus: ${fmt(s.special_requests)}`,
      `- Preferensi tamu: ${fmt(s.preference_notes)}`,
    ].join("\n");
    systemPrompt +=
      `\n\nKONTEKS SESI (Default, JANGAN konfirmasi ulang):\n` +
      structuredLines +
      `\nJika tamu menyebut data baru, abaikan nilai lama.`;
    // Direktif eksplisit: pertanyaan yang tercatat belum terjawab WAJIB
    // dituntaskan di turn ini — bukan sekadar konteks latar. Tanpa blok ini
    // field tersebut hanya jadi satu baris pasif yang sering diabaikan model.
    if (s.unresolved_question) {
      systemPrompt +=
        `\n\n⚠️ JAWAB TUNTAS: "${s.unresolved_question}"`;
    }
  } else if (agentCtx.chatSummary) {
    systemPrompt += `\n\nRINGKASAN: ${agentCtx.chatSummary}`;
  }

  if (agentCtx.activeBookingContext) {
    systemPrompt += `\n\n${agentCtx.activeBookingContext}`;
  }

  if (agentCtx.guestProfile && Number(agentCtx.guestProfile.total_bookings ?? 0) > 0) {
    const gp = agentCtx.guestProfile;
    const verifiedName = typeof gp.full_name === "string" ? gp.full_name.trim() : "";
    const bookingLines = (Array.isArray(gp.bookings) ? gp.bookings : [])
      .slice(0, 5)
      .map((booking) => {
        const ref = booking.reference_code ?? booking.id?.slice(0, 8) ?? "-";
        const dates = [booking.check_in, booking.check_out].filter(Boolean).join(" → ");
        const room = booking.room_type ?? "kamar";
        const phase = booking.is_upcoming ? "mendatang/aktif" : "riwayat";
        return `- ${phase}: ${ref}, ${room}, ${dates || "tanggal tidak tersedia"}, status ${booking.status ?? "-"}, pembayaran ${booking.payment_status ?? "-"}`;
      });
    systemPrompt +=
      `\n\nPROFIL TAMU TERVERIFIKASI DARI DATABASE:\n` +
      `- Nama: ${verifiedName || "-"}\n` +
      `- Tamu lama: ya (${Number(gp.total_bookings ?? 0)} booking tercatat)\n` +
      (bookingLines.length ? `- Booking terkait:\n${bookingLines.join("\n")}\n` : "") +
      `Gunakan nama depan secara natural maksimal sekali pada pembuka bila sesuai. ` +
      `Jangan menyebut jumlah transaksi, total belanja, tag internal, atau mengatakan sistem melacak tamu. ` +
      `Jika tamu membuat booking untuk dirinya sendiri, gunakan nama tersimpan sebagai default dan jangan minta ulang. ` +
      `Jika tamu menyatakan booking untuk orang lain atau memberi nama baru, gunakan data baru tersebut.`;
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

  if (agentCtx.activeBooking?.referenceCode) {
    const ab = agentCtx.activeBooking;
    const idr = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
    const roomLines = ab.rooms
      .map((r) => `  - ${r.name}: ${idr(r.nightlyRate)}/malam (harga terkunci)`)
      .join("\n");
    systemPrompt +=
      `\n\n[BOOKING TAMU YANG SUDAH ADA — SUMBER KEBENARAN HARGA]\n` +
      `Tamu ini SUDAH punya booking aktif atas nomornya:\n` +
      `• Kode booking: ${ab.referenceCode}\n` +
      `• Menginap: ${ab.checkIn} → ${ab.checkOut}\n` +
      `• Status: ${ab.status}${ab.paymentStatus ? ` / pembayaran: ${ab.paymentStatus}` : ""}\n` +
      (roomLines ? `• Kamar & harga yang sudah disepakati:\n${roomLines}\n` : "") +
      `• Total: ${idr(ab.totalAmount)}` +
      (ab.paidAmount && ab.paidAmount > 0 ? `, sudah dibayar ${idr(ab.paidAmount)}` : "") +
      `\nATURAN: Jika tamu bertanya soal harga/kamar untuk booking yang SAMA ini, ` +
      `pakai HARGA TERKUNCI di atas — JANGAN meng-quote ulang harga dinamis terbaru ` +
      `yang bisa berbeda. Jangan menaikkan harga yang sudah disepakati. Kalau tamu ` +
      `minta tanggal/kamar BARU di luar booking ini, barulah cek harga terkini seperti biasa.`;
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
    systemPrompt +=
      `\nJawab pertanyaan inti tamu secara langsung, ringkas, dan terpadu dalam satu balasan.` +
      ` Jika ada pesan yang hanya konteks sumber (mis. TikTok/Instagram/lampiran), boleh akui sangat singkat lalu kembali ke kebutuhan utama.` +
      ` Jangan memakai preamble recovery seperti "Maaf Kak, saya bantu lanjutkan ya", jangan memperkenalkan diri ulang, dan jangan menambahkan "Ada yang bisa Rani bantu?" ketika kebutuhan tamu sudah jelas.` +
      ` Untuk pertanyaan ketersediaan tanpa tanggal eksplisit, jangan panggil tool availability; cukup tanyakan tanggal check-in dan check-out secara singkat.`;
  }

  // Enforce JSON output for text replies
  systemPrompt += `\n\nPENTING: Jika Anda memberikan balasan akhir (bukan memanggil fungsi), balasan tersebut WAJIB berformat JSON murni dengan skema: {"reply": "isi pesan Anda untuk tamu/user"}. JANGAN membungkus dengan markdown block. Jika Anda memanggil fungsi/tool, biarkan content kosong dan gunakan tool_calls.`;

  const humanTurnsPresent = history.some((m) => m.direction === "out" && m.isHuman);
  const humanHandoffNote = humanTurnsPresent
    ? "\n\nCATATAN KONTEKS: Beberapa balasan sebelumnya (ditandai prefix `[Admin manusia]:`) ditulis oleh staf Pomah secara manual, bukan oleh Anda. Anggap balasan itu sebagai keputusan resmi tim — JANGAN mengoreksi, mengulang, atau membantahnya. Lanjutkan percakapan mengikuti arah yang sudah diberikan admin dan hanya isi kekosongan info yang belum dijawab."
    : "";
  const messages: AiMessage[] = [
    { role: "system", content: systemPrompt + humanHandoffNote },
    ...(trainingExamplesBlock ? [{ role: "system" as const, content: trainingExamplesBlock }] : []),
    ...history.map((m) => ({
      role: (m.direction === "in" ? "user" : "assistant") as AiMessage["role"],
      content: m.direction === "out" && m.isHuman ? `[Admin manusia]: ${m.body}` : m.body,
    })),
  ];


  for (let turn = 0; turn < maxTurns; turn++) {
    const { response: json, retries } = await callLlm(
      llmConfig,
      messages,
      agent,
      agentTools,
      signal,
      deadlineAt,
    );
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
      let reply = assistantMsg?.content?.trim() ?? null;
      
      // Parse JSON if present
      if (reply) {
        const raw = reply;
        try {
          const clean = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
          const parsed = JSON.parse(clean);
          if (typeof parsed.reply === "string") {
            reply = parsed.reply;
          }
        } catch (e) {
          // JSON.parse gagal (mis. JSON terpotong oleh max_tokens atau ada
          // teks di sekitar objek). Jangan kirim raw JSON ke tamu — coba
          // ekstrak nilai "reply" dengan regex dulu.
          const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (m) {
            reply = m[1]
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\")
              .trim();
            console.warn(`[MultiAgent][${agent.key}] JSON reply malformed — extracted via regex`);
          } else {
            console.warn(`[MultiAgent][${agent.key}] Failed to parse JSON reply, using raw output:`, reply);
          }
        }
      }

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
      } else if (!allowedToolNames.has(toolName)) {
        // ENFORCEMENT (4 Jul 2026): executor global mengeksekusi tool apa pun
        // di registry — LLM yang menghalusinasi nama tool di luar daftarnya
        // (mis. `create_booking`, yang bahkan disebut di prompt front-office
        // sebagai "TIDAK dimiliki") tetap tereksekusi. Insiden nyata: booking
        // PG-57HH6 dibuat TANPA ringkasan konfirmasi + tanpa validasi
        // kapasitas karena front-office mode tamu memanggil create_booking
        // langsung. Tolak di sini, beri sinyal jelas ke LLM.
        console.warn(
          `[MultiAgent][${agent.key}] BLOCKED unauthorized tool call: ${toolName} (tidak ada di daftar tool agent)`,
        );
        output = JSON.stringify({
          ok: false,
          error:
            `Tool ${toolName} tidak tersedia untuk kamu. Gunakan hanya tool yang terdaftar. ` +
            `Untuk booking final, arahkan tamu mengikuti alur konfirmasi (state machine) — jangan membuat booking langsung.`,
        });
        toolLabel = null;
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
    reply: lastToolDraftReply ?? null,
    toolsUsed: Array.from(toolsUsed),
    // If a tool produced a draft reply (e.g. formatted availability), treat as
    // success so the guest/admin gets useful data instead of a generic fallback.
    ...(lastToolDraftReply
      ? {}
      : { error: "Max turns exceeded" }),
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
  messages: Array<{ direction: string; body: string; isHuman?: boolean }>;

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
  /**
   * Batas waktu dinding-jam (epoch ms) untuk seluruh orkestrasi. Timeout tiap
   * panggilan LLM dihitung dari sisa waktu ini, dan retry internal dilewati
   * bila sisanya tidak cukup — mencegah AbortController luar memotong di
   * tengah jalan dan memaksa fallback (audit 7 Agu 2026 — B3).
   */
  deadlineAt?: number;
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
        Math.max(3, maxTurns - 1),
        undefined,
        input.signal,
        undefined,
        input.deadlineAt,
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
      undefined,
      input.deadlineAt,
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
    const stateResult = await processBookingState(input.toolCtx, input.phone, lastUserMsg, stateRecord, {
      knownGuestName: input.agentCtx.chatSummaryJson?.guest_name ?? null,
      knownGuestCount: input.agentCtx.chatSummaryJson?.guest_count ?? null,
    });

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
          undefined,
          input.deadlineAt,
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
  //
  // GUARD (issue #5, insiden 22-23 Sep): flexible-slot-extractor kadang menarik
  // tanggal dari frase pendek tak-eksplisit ("kalau yg ini apakah type kamar…")
  // sehingga menimpa tanggal booking aktif tamu. Bila tamu punya
  // activeBookingContext DAN pesan terakhir tidak mengandung sinyal tanggal
  // eksplisit, TOLAK liveSlots.check_in agar agreedDates tidak drift.
  // Deteksi sinyal tanggal memakai helper kanonik di @/lib/id-date — dulu regex
  // keempat yang berdiri sendiri di file ini (audit 7 Agu 2026 — B6), sehingga
  // "8 sepember" (typo) atau "tgl 18" bisa dianggap bukan sinyal tanggal di
  // sini padahal jalur WhatsApp menganggapnya sinyal. Versi bersama juga
  // menoleransi typo nama bulan dan mengabaikan pola kuantitas ("2 malam").
  const hasExplicitDateSignal =
    mentionsExplicitDateSignal(lastUserMsg) || /\bminggu depan|akhir minggu|weekend\b/i.test(lastUserMsg);
  const shouldAcceptLiveDates =
    hasExplicitDateSignal || !input.agentCtx.activeBookingContext;
  const mergedCheckIn =
    (shouldAcceptLiveDates ? liveSlots.check_in : undefined) ?? input.agentCtx.agreedDates?.checkIn;
  const mergedCheckOut =
    (shouldAcceptLiveDates ? liveSlots.check_out : undefined) ?? input.agentCtx.agreedDates?.checkOut;
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

  // Rujukan kamar yang ambigu ("yang ini bisa berapa orang ya") — beri tahu
  // agent supaya mengkonfirmasi, bukan menjawab tipe kamar hasil tebakan.
  if (resolved.entityAmbiguous) {
    input.agentCtx.ambiguousRoomReference = {
      candidate: resolved.entity?.label,
      offeredRooms: (input.toolCtx.rooms ?? []).map((r) => String(r.name)).filter(Boolean),
    };
    console.info(
      `[MultiAgent] Ambiguous room reference — candidate "${resolved.entity?.label ?? "-"}" ` +
        `will be confirmed, not assumed`,
    );
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
  const recoveryClassifierQuery = input.agentCtx.recoveryMode
    ? selectRecoveryClassifierQuery(lastUserMsg, input.agentCtx.unansweredMessages)
    : lastUserMsg;
  const queryForClassifier =
    rewrite.rewritten_applied && recoveryClassifierQuery === lastUserMsg
      ? rewrite.rewritten
      : recoveryClassifierQuery;
  if (input.agentCtx.recoveryMode && queryForClassifier !== lastUserMsg) {
    console.info(
      `[MultiAgent] Recovery classifier query selected: "${queryForClassifier.slice(0, 160)}"`,
    );
  }
  // 4b DIMULAI DI SINI, PARALEL dengan classifyIntent (O1): retrieval training
  // examples (embedding + RPC) tidak bergantung pada hasil klasifikasi, jadi
  // tidak perlu menunggu — dulu serial dan menambah 0,3–1s per turn AI
  // (lebih parah lagi saat classifier jatuh ke LLM fallback ~5s).
  const trainingExamplesPromise: Promise<TrainingExample[]> = (async () => {
    const alreadyProvided = (input.agentCtx.trainingExamples?.length ?? 0) > 0;
    if (alreadyProvided || input.agentCtx.bookingInProgress || lastUserMsg.trim().length === 0) {
      return [];
    }
    try {
      const ragCfg = await getTrainingRagConfigCached(input.toolCtx.supabaseAdmin);
      if (!ragCfg.enabled) {
        console.info("[MultiAgent] Training RAG disabled by config");
        return [];
      }
      return await retrieveTrainingExamples(input.toolCtx.supabaseAdmin, lastUserMsg, input.llmConfig, {
        matchCount: ragCfg.matchCount,
        minSimilarity: ragCfg.minSimilarity,
      });
    } catch (e) {
      console.warn("[MultiAgent] Training RAG failed (non-fatal):", e);
      return [];
    }
  })();

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

  // 4b (lanjutan). Ambil hasil retrieval yang sudah berjalan paralel di atas.
  const trainingExamples: TrainingExample[] = await trainingExamplesPromise;
  let trainingBlock: string | undefined;
  if (trainingExamples.length > 0) {
    trainingBlock = formatTrainingExamplesForPrompt(trainingExamples);
    console.info(
      `[MultiAgent] Training RAG: ${trainingExamples.length} contoh ` +
        `(top sim ${trainingExamples[0].similarity.toFixed(2)})`,
    );
  }

  // 5. Route to agent
  let routing = routeToAgent(classified);

  // Payment-proof override: a guest who sends a transfer screenshot with NO
  // caption arrives as the attachment marker "[Lampiran image]", which carries
  // no payment keywords and would misroute to Front Office — so the OCR →
  // update_payment_status (mark invoice LUNAS) flow never runs. During the
  // post-booking PAYMENT_PENDING window an incoming image is overwhelmingly a
  // payment proof, so force it to the Finance Agent.
  const isAttachmentMarker = /\[\s*lampiran\b/i.test(lastUserMsg);
  if (
    isAttachmentMarker &&
    stateRecord.state === "PAYMENT_PENDING" &&
    routing.agentKey !== "finance"
  ) {
    routing = {
      agentKey: "finance",
      confidence: Math.max(classified.confidence, 0.9),
      reason: "Payment-proof image during PAYMENT_PENDING → Finance Agent",
      escalated: false,
    };
  }

  // ── Capability override: permintaan media selalu ke Front Office ─────────
  // `send_room_photos` / `send_room_tour` HANYA dimiliki Front Office. Bila
  // burst tamu mengandung permintaan foto/brosur/video/tour tetapi klasifikasi
  // memenangkan intent lain (mis. pricing_inquiry karena pesan penutup burst
  // menanyakan harga), agent tujuan tidak punya cara memenuhi permintaan itu
  // dan cenderung mengarang keterbatasan ("kami belum bisa menampilkan gambar
  // kamar") — bertentangan dengan balasan Front Office di burst yang sama.
  // Insiden 9 Agu 2026, transcript 6281210853153.
  const mediaWantedInBurst =
    !isAttachmentMarker &&
    (burstWantsMedia(
      (input.messages ?? []).map((m) => ({ direction: m.direction, body: m.body })),
    ) ||
      isMediaRequest(lastUserMsg));
  if (mediaWantedInBurst && routing.agentKey !== "front-office" && !input.isManager) {
    routing = {
      agentKey: "front-office",
      confidence: Math.max(classified.confidence, 0.9),
      reason: `Media request in burst (was ${routing.agentKey}) → Front Office (owns send_room_photos)`,
      escalated: false,
    };
  }

  // Intent EFEKTIF = hasil klasifikasi + override di atas. Dipakai agent untuk
  // memangkas daftar tool (lihat `frontOfficeAgent.getTools`). Permintaan media
  // WAJIB terbaca sebagai `media_request` supaya `send_room_photos` /
  // `send_room_tour` tetap tersedia — invarian #1 chatbot-consistency.
  const effectiveIntent: IntentCategory = mediaWantedInBurst
    ? "media_request"
    : classified.category;

  console.info(
    `[MultiAgent] Routing → ${routing.agentKey} | ${routing.reason}` +
      (effectiveIntent !== classified.category ? ` | intent→${effectiveIntent}` : ""),
  );

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
          input.deadlineAt,
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
      intent: effectiveIntent,
      customInstructions: normalizeAgentInstruction(input.aiLabConfig?.agents?.[routing.agentKey]?.instructions),
      managerName: normalizeAgentManagerName(input.aiLabConfig?.agents?.[routing.agentKey]?.managerName),
    },
    input.toolCtx,
    input.llmConfig,
    maxTurns,
    onAskAgent,
    input.signal,
    trainingBlock,
    input.deadlineAt,
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
      input.deadlineAt,
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
