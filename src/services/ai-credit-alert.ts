/**
 * AI Credit Alert.
 *
 * Mendeteksi saat kredit Lovable AI (cloud AI) hampir/sudah habis atau
 * diblokir kebijakan workspace, lalu mengirim notifikasi ke super admin
 * (WhatsApp + Telegram) lewat manager-notifier.
 *
 * Sinyal yang dipakai — status HTTP dari AI Gateway:
 *   402 → kredit tidak cukup untuk request (habis / hampir habis)
 *   403 → Lovable AI dimatikan atau limit kredit admin tercapai
 *   429 → rate limit; hanya dialarmkan bila terjadi berulang (>= 5 dalam 10 menit)
 *
 * Semua pemanggilan fire-and-forget-safe: tidak pernah throw dan tidak
 * pernah menghentikan alur balasan chatbot.
 */

type AlertKind = "credit_exhausted" | "policy_blocked" | "rate_limited";

/** Throttle per-isolate: maksimal 1 alert per jenis per 6 jam. */
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const lastAlertAt = new Map<AlertKind, number>();

/** Jendela penghitung 429 supaya rate limit sesaat tidak memicu alarm. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_THRESHOLD = 5;
let rateLimitHits: number[] = [];

function classify(status: number): AlertKind | null {
  if (status === 402) return "credit_exhausted";
  if (status === 403) return "policy_blocked";
  if (status === 429) return "rate_limited";
  return null;
}

/**
 * Laporkan kegagalan panggilan AI Gateway. Hanya status yang berkaitan
 * dengan kredit/kuota yang memicu notifikasi.
 */
export async function reportAiGatewayFailure(
  status: number,
  errorMessage?: string | null,
  source = "ai_gateway",
): Promise<void> {
  try {
    const kind = classify(status);
    if (!kind) return;

    if (kind === "rate_limited") {
      const now = Date.now();
      rateLimitHits = rateLimitHits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      rateLimitHits.push(now);
      if (rateLimitHits.length < RATE_LIMIT_THRESHOLD) return;
    }

    const last = lastAlertAt.get(kind) ?? 0;
    if (Date.now() - last < THROTTLE_MS) return;
    lastAlertAt.set(kind, Date.now());

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyAiCreditLow } = await import("./manager-notifier.service");
    await notifyAiCreditLow(supabaseAdmin as never, {
      kind,
      status,
      errorMessage: errorMessage ?? null,
      source,
    });
  } catch (e) {
    console.warn("[AiCreditAlert] gagal mengirim notifikasi (non-fatal):", e);
  }
}

/** Versi fire-and-forget untuk hot-path (tidak perlu di-await). */
export function reportAiGatewayFailureAsync(
  status: number,
  errorMessage?: string | null,
  source = "ai_gateway",
): void {
  void reportAiGatewayFailure(status, errorMessage, source);
}
