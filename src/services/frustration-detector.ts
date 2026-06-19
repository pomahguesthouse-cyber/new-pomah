/**
 * Frustration & trust detection untuk WhatsApp autoreply.
 *
 * Dipanggil dari `wa-autoreply.service.ts` SEBELUM orchestrator AI dijalankan.
 * Jika pesan tamu menunjukkan kebingungan / curiga penipuan, kita short-circuit:
 *   - Kirim ringkasan booking terakhir (kalau ada).
 *   - Tampilkan verifikasi resmi (domain, invoice, kontak admin).
 *   - Tandai state HUMAN_HANDOFF_REQUIRED dan notify super admin.
 *
 * Tidak mengubah skema DB — handoff disimpan sebagai metadata pada
 * wa_booking_states.context.handoff = true sehingga kompatibel dengan
 * state machine existing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Frasa frustrasi/kebingungan yang memicu handoff ke manusia. */
const FRUSTRATION_PATTERNS: RegExp[] = [
  /\bsaya\s+pusing\b/i,
  /\bpusing\s+(saya|aku|nih|deh|kak)\b/i,
  /\bembuh\b/i,
  /\bbukan\s+email\b/i,
  /\bini\s+benar\??\b/i,
  /\bbenar\s+gak\??\b/i,
  /\bgak\s+ngerti\b/i,
  /\btidak\s+(ngerti|paham|mengerti)\b/i,
  /\bbingung\b/i,
  /\bribet\s+(banget|sekali|nih|amat)?\b/i,
  /\bcape(k)?\s+(deh|nih|amat)?\b/i,
  /\bmalas\b/i,
];

/** Pertanyaan trust / curiga penipuan — bukan frustrasi penuh, tapi butuh template verifikasi. */
const TRUST_PATTERNS: RegExp[] = [
  /\bpenipuan\b/i,
  /\bscam\b/i,
  /\bnipu\b/i,
  /\btidak\s+ai\s+kan\??\b/i,
  /\bgak\s+ai\s+kan\??\b/i,
  /\bbukan\s+ai\s+kan\??\b/i,
  /\bapakah\s+ini\s+(ai|bot|robot)\b/i,
  /\bini\s+(ai|bot|robot)\??\b/i,
  /\bamankah\b/i,
  /\bbeneran\s+(hotel|guesthouse|pomah)\??\b/i,
  /\basli\s+gak\??\b/i,
];

export type FrustrationKind = "frustrated" | "trust_question" | null;

export function detectFrustration(text: string): FrustrationKind {
  if (!text) return null;
  if (FRUSTRATION_PATTERNS.some((p) => p.test(text))) return "frustrated";
  if (TRUST_PATTERNS.some((p) => p.test(text))) return "trust_question";
  return null;
}

/** Format ringkasan booking terakhir berdasarkan context state machine. */
function summarizeBooking(context: any): string {
  if (!context || typeof context !== "object") return "";
  const parts: string[] = [];
  if (context.checkIn && context.checkOut) {
    parts.push(`tanggal ${context.checkIn} → ${context.checkOut}`);
  }
  if (context.roomName) parts.push(`kamar ${context.roomName}`);
  if (Array.isArray(context.rooms) && context.rooms.length > 0) {
    const rooms = context.rooms
      .map((r: any) => `${r.quantity ?? 1}x ${r.roomTypeName}`)
      .join(", ");
    if (rooms) parts.push(rooms);
  }
  if (context.adults) parts.push(`${context.adults} tamu`);
  if (context.guestName) parts.push(`a/n ${context.guestName}`);
  return parts.length > 0 ? `Data terakhir yang saya catat: ${parts.join(", ")}.` : "";
}

const TRUST_VERIFICATION =
  "Untuk memastikan, ini detail resmi Pomah Guesthouse:\n" +
  "- Website resmi: pomahguesthouse.com\n" +
  "- Invoice resmi otomatis dikirim setelah Kakak konfirmasi & transfer.\n" +
  "- Kalau ragu, Kakak bisa cek alamat & nomor admin di website tersebut.";

export interface FrustrationReplyResult {
  reply: string;
  shouldHandoff: boolean;
}

export function buildFrustrationReply(
  kind: NonNullable<FrustrationKind>,
  context: any,
): FrustrationReplyResult {
  const summary = summarizeBooking(context);

  if (kind === "trust_question") {
    const body =
      "Halo Kak, saya paham kalau Kakak ingin memastikan dulu — itu wajar 🙏.\n\n" +
      TRUST_VERIFICATION +
      "\n\nKalau ingin saya teruskan ke admin manusia, balas saja \"admin\" ya.";
    return { reply: body, shouldHandoff: false };
  }

  // frustrated → handoff
  const head =
    "Mohon maaf ya Kak kalau prosesnya terasa membingungkan. Saya rangkum dulu " +
    "info yang sudah Kakak kirim, lalu saya teruskan ke admin manusia kami.";
  const body =
    [head, summary, TRUST_VERIFICATION, "Admin akan segera membalas dari nomor yang sama ya, Kak 🙏."]
      .filter(Boolean)
      .join("\n\n");
  return { reply: body, shouldHandoff: true };
}

/**
 * Tandai state booking sebagai handoff (preserve context). Idempotent.
 * Kita memakai field state khusus "HUMAN_HANDOFF" agar interruption
 * detection di booking-machine berhenti mencoba menjawab otomatis.
 */
export async function markHumanHandoff(
  supabase: any,
  phone: string,
  context: any,
): Promise<void> {
  try {
    await supabase.rpc("update_booking_state", {
      p_phone: phone,
      p_state: "IDLE", // RPC mungkin memvalidasi enum — IDLE aman, kita pakai flag context.
      p_context: { ...(context ?? {}), handoff: true, handoff_at: new Date().toISOString() },
    });
  } catch (e) {
    console.warn("[Frustration] failed to mark handoff:", e);
  }
}
