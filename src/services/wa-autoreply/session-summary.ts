import type { ChatSummaryStructured } from "@/ai/chat-summary.types";
import { chatCompletionText } from "@/services/ai-client.service";
import {
  parseStructuredSummary,
  SUMMARY_MAX_CHARS,
} from "@/services/wa-autoreply/session-summary-policy";

export const SUMMARY_MIN_MESSAGES = 3;

export type SummaryMessage = {
  direction: string;
  body: string;
  sent_at?: string;
};

export type SummaryAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/**
 * Ringkasan berkala mahal kalau selalu membaca ULANG seluruh sesi: bagian
 * terbesar promptnya (schema + aturan) sudah tetap, lalu ditambah transkrip
 * penuh setiap kali. Padahal dari satu giliran ke giliran berikutnya yang
 * benar-benar baru cuma 1–2 pesan.
 *
 * Karena itu ada dua mode:
 *   - "full"        : baca seluruh sesi. Dipakai saat belum ada ringkasan,
 *                     saat ringkasan sudah lama (drift), atau saat banyak
 *                     pesan menumpuk sejak ringkasan terakhir.
 *   - "incremental" : kirim ringkasan JSON terakhir + HANYA pesan baru
 *                     sesudahnya, dan minta model MEMPERBARUI, bukan menyusun
 *                     ulang dari nol.
 */
export type SummaryMode = "full" | "incremental";

/** Pesan sejak ringkasan terakhir yang masih layak diproses inkremental. */
export const SUMMARY_INCREMENTAL_MAX_WINDOW = 12;

/**
 * Umur maksimal ringkasan yang boleh dipakai sebagai dasar inkremental.
 *
 * Mode inkremental hanya melihat pesan baru, jadi salah tafsir di ringkasan
 * lama tidak akan pernah terkoreksi. Setelah jeda panjang percakapan biasanya
 * sudah pindah topik — lebih aman baca ulang semuanya.
 */
export const SUMMARY_FULL_RESYNC_AFTER_MS = 30 * 60 * 1000;

export interface SummaryPlan {
  mode: SummaryMode;
  /** Pesan yang benar-benar dikirim ke model. */
  window: SummaryMessage[];
}

/**
 * Tentukan apa yang perlu dikirim ke model — atau `null` bila tidak ada yang
 * perlu dikerjakan sama sekali (tidak ada pesan baru sejak ringkasan terakhir),
 * yang berarti satu panggilan LLM utuh bisa dilewati.
 *
 * Fungsi murni supaya bisa diuji tanpa gateway maupun database.
 */
export function planSummaryWindow(params: {
  messages: SummaryMessage[];
  previous?: ChatSummaryStructured | null;
  /** `chat_summary_updated_at` — batas air pesan yang sudah terangkum. */
  summaryUpdatedAt?: string | null;
  /** Ringkasan teks lama; ikut menentukan besar prompt mode "full". */
  existingSummary?: string | null;
  /** Waktu acuan; disuntik di tes. */
  now?: number;
}): SummaryPlan | null {
  const { messages, previous, summaryUpdatedAt, existingSummary, now = Date.now() } = params;
  if (messages.length === 0) return null;

  const full: SummaryPlan = { mode: "full", window: messages };
  if (!previous?.short_summary?.trim()) return full;
  if (!summaryUpdatedAt) return full;

  const watermark = Date.parse(summaryUpdatedAt);
  if (!Number.isFinite(watermark)) return full;
  if (now - watermark > SUMMARY_FULL_RESYNC_AFTER_MS) return full;
  // Tanpa `sent_at` tidak ada cara aman memotong transkrip.
  if (messages.some((m) => !m.sent_at)) return full;

  const window = messages.filter((m) => {
    const t = Date.parse(m.sent_at as string);
    return Number.isFinite(t) && t > watermark;
  });
  if (window.length === 0) return null;
  if (window.length > SUMMARY_INCREMENTAL_MAX_WINDOW) return full;

  // Mode inkremental menukar transkrip lama dengan ringkasan JSON + instruksi
  // tambahan "pertahankan field lama". Untuk sesi pendek tukar itu justru
  // LEBIH besar — dan baca-ulang-penuh sekalian lebih akurat. Jadi jangan
  // percaya heuristik jumlah pesan; bandingkan besar prompt yang sebenarnya.
  const incremental: SummaryPlan = { mode: "incremental", window };
  const incrementalSize = buildSummaryPrompt(incremental, existingSummary, previous).length;
  const fullSize = buildSummaryPrompt(full, existingSummary, previous).length;
  return incrementalSize < fullSize ? incremental : full;
}

const SUMMARY_SCHEMA_HINT = `{
  "short_summary": string (maks ${SUMMARY_MAX_CHARS} karakter, 1-3 kalimat Bahasa Indonesia),
  "guest_name": string|null,
  "last_topic": "pricing"|"availability"|"facility"|"booking"|"payment"|"complaint"|"location"|"general"|null,
  "room_type": string|null,
  "check_in": string|null (YYYY-MM-DD),
  "check_out": string|null (YYYY-MM-DD),
  "guest_count": number|null,
  "booking_status": "none"|"pending"|"confirmed"|"cancelled"|"checked_in"|"checked_out"|null,
  "payment_status": "unpaid"|"down_payment"|"paid"|"pay_at_hotel"|null,
  "complaint_active": boolean,
  "unresolved_question": string|null,
  "needs_human": boolean,
  "handoff_reason": string|null
}`;

/** Aturan anti-mengarang yang berlaku di kedua mode. */
const SUMMARY_CORE_RULES =
  `- Jangan mengarang. Field yang TIDAK pernah disebut tamu/bot → null (atau false untuk boolean).\n` +
  `- check_in/check_out: ambil dari tanggal TERAKHIR yang disebut TAMU, bukan dari pesan bot.\n` +
  `  Bila bot menyebut tanggal yang berbeda dari tanggal terakhir yang diminta tamu, IKUTI TAMU\n` +
  `  (bot bisa saja salah baca tanggal — jangan diabadikan ke ringkasan). Tanggal lama yang sudah\n` +
  `  digantikan permintaan baru → buang. Tamu belum pernah menyebut tanggal → null.\n` +
  `- short_summary: 1-3 kalimat fokus konteks aktif (tipe kamar, status booking, pertanyaan belum dijawab).\n` +
  `- last_topic: pilih topik terakhir yang dibahas tamu.\n` +
  `- Jawab HANYA JSON valid, tanpa code fence, tanpa kata pengantar.`;

function renderTranscript(history: SummaryMessage[]): string {
  return history
    .map((message) => `${message.direction === "in" ? "Tamu" : "Bot"}: ${message.body}`)
    .join("\n");
}

/**
 * Prompt yang benar-benar dikirim ke model. Diekspor supaya tes bisa mengukur
 * penghematan dan memastikan mode inkremental tidak kehilangan instruksi
 * "pertahankan field lama" — tanpa perlu memanggil gateway.
 */
export function buildSummaryPrompt(
  plan: SummaryPlan,
  existingSummary?: string | null,
  previous?: ChatSummaryStructured | null,
): string {
  return plan.mode === "incremental" && previous
    ? buildIncrementalPrompt(plan.window, previous)
    : buildFullPrompt(plan.window, existingSummary);
}

function buildFullPrompt(history: SummaryMessage[], existingSummary?: string | null): string {
  return (
    `Riwayat obrolan tamu Pomah Guesthouse:\n\n${renderTranscript(history)}\n\n` +
    (existingSummary ? `Ringkasan sesi sebelumnya:\n${existingSummary}\n\n` : "") +
    `Ekstrak status percakapan ke JSON dengan schema:\n${SUMMARY_SCHEMA_HINT}\n\n` +
    `ATURAN PENTING:\n${SUMMARY_CORE_RULES}`
  );
}

function buildIncrementalPrompt(
  window: SummaryMessage[],
  previous: ChatSummaryStructured,
): string {
  return (
    `Ringkasan JSON percakapan ini sampai giliran sebelumnya:\n${JSON.stringify(previous)}\n\n` +
    `Pesan BARU sesudah ringkasan itu:\n\n${renderTranscript(window)}\n\n` +
    `PERBARUI ringkasan tersebut memakai schema yang sama:\n${SUMMARY_SCHEMA_HINT}\n\n` +
    `ATURAN PENTING:\n` +
    `- Ini PEMBARUAN, bukan penyusunan ulang. Field yang tidak disinggung pesan baru WAJIB\n` +
    `  disalin PERSIS dari ringkasan lama — jangan mengosongkannya hanya karena tidak muncul lagi.\n` +
    `- Ubah hanya field yang benar-benar berubah karena pesan baru di atas.\n` +
    `- unresolved_question: kosongkan (null) bila pesan baru sudah menjawabnya; isi bila muncul\n` +
    `  pertanyaan baru yang belum terjawab.\n` +
    `${SUMMARY_CORE_RULES}`
  );
}

/**
 * Model khusus perangkum, dari env `SUMMARY_AI_MODEL`.
 *
 * Merangkum jauh lebih ringan daripada melayani tamu, jadi model termurah di
 * gateway sudah cukup. Dibiarkan kosong → pakai model yang sama dengan agent
 * (perilaku lama). Kalau gateway menolak model itu, panggilan pertama yang
 * gagal mematikan override untuk sisa isolate ini dan jatuh ke model utama —
 * salah ketik nama model tidak akan mematikan summarizer.
 */
let summaryModelOverrideDisabled = false;

export function resolveSummaryConfig(config: SummaryAiConfig): SummaryAiConfig {
  const override = process.env.SUMMARY_AI_MODEL?.trim();
  if (!override || summaryModelOverrideDisabled || override === config.model) return config;
  return { ...config, model: override };
}

export async function generateSessionSummary(
  history: SummaryMessage[],
  existingSummary: string | null | undefined,
  config: SummaryAiConfig,
  options?: { plan?: SummaryPlan; previousStructured?: ChatSummaryStructured | null },
): Promise<ChatSummaryStructured | null> {
  const plan: SummaryPlan = options?.plan ?? { mode: "full", window: history };
  const previous = options?.previousStructured ?? null;

  const prompt = buildSummaryPrompt(plan, existingSummary, previous);

  const askOptions = {
    temperature: 0.2,
    maxTokens: 700,
    responseFormat: { type: "json_object" as const },
  };

  try {
    const summaryConfig = resolveSummaryConfig(config);
    let raw = await chatCompletionText(summaryConfig, [{ role: "user", content: prompt }], askOptions);

    if (raw === null && summaryConfig.model !== config.model) {
      summaryModelOverrideDisabled = true;
      console.warn(
        `[SessionSummarizer] SUMMARY_AI_MODEL="${summaryConfig.model}" ditolak gateway — ` +
          `kembali ke ${config.model} untuk sisa isolate ini`,
      );
      raw = await chatCompletionText(config, [{ role: "user", content: prompt }], askOptions);
    }

    return parseStructuredSummary(raw ?? "");
  } catch (error) {
    console.error("[SessionSummarizer] Failed to generate summary:", error);
    return null;
  }
}

export async function updateThreadSummary(
  client: any,
  threadId: string,
  structured: ChatSummaryStructured,
  opts?: { jsonOnly?: boolean },
): Promise<void> {
  const { data: previous } = await client
    .from("whatsapp_threads")
    .select("chat_summary_version")
    .eq("id", threadId)
    .maybeSingle();

  const nextVersion =
    ((previous as { chat_summary_version?: number } | null)?.chat_summary_version ?? 0) + 1;

  const patch: Record<string, unknown> = opts?.jsonOnly
    ? {
        chat_summary_json: structured,
        chat_summary_version: nextVersion,
        chat_summary_updated_at: new Date().toISOString(),
      }
    : {
        chat_summary: structured.short_summary,
        chat_summary_json: structured,
        chat_summary_version: nextVersion,
        chat_summary_updated_at: new Date().toISOString(),
      };

  const { error } = await client.from("whatsapp_threads").update(patch).eq("id", threadId);
  if (error) {
    console.error("[SessionSummarizer] Database update failed:", error.message);
  }
}

export async function regenerateThreadSummary(
  client: any,
  threadId: string,
  config: SummaryAiConfig,
): Promise<{ ok: boolean; summary?: ChatSummaryStructured; error?: string }> {
  const { data: rows } = await client
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .limit(30);

  const history = ((rows ?? []) as SummaryMessage[]).reverse();
  if (history.length < SUMMARY_MIN_MESSAGES) {
    return { ok: false, error: "Belum cukup pesan untuk diringkas." };
  }

  const { data: existing } = await client
    .from("whatsapp_threads")
    .select("chat_summary")
    .eq("id", threadId)
    .maybeSingle();

  const summary = await generateSessionSummary(
    history,
    (existing as { chat_summary?: string } | null)?.chat_summary ?? "",
    config,
  );

  if (!summary) {
    return { ok: false, error: "Gagal membuat ringkasan (JSON invalid)." };
  }

  await updateThreadSummary(client, threadId, summary);
  console.info(`[SessionSummarizer] manual regen for thread ${threadId.slice(0, 8)}`);
  return { ok: true, summary };
}
