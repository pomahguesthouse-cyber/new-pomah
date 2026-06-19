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

/**
 * Skor frustrasi 0-100 berdasarkan jumlah pola yang cocok, kata kunci
 * ekstrem (penipuan/scam), capslock, dan tanda seru berurutan.
 * Dipakai admin untuk prioritisasi tiket handoff.
 */
export function scoreFrustration(text: string): number {
  if (!text) return 0;
  let score = 0;
  const frustHits = FRUSTRATION_PATTERNS.filter((p) => p.test(text)).length;
  const trustHits = TRUST_PATTERNS.filter((p) => p.test(text)).length;
  score += frustHits * 18;
  score += trustHits * 12;
  if (/\b(penipuan|scam|nipu)\b/i.test(text)) score += 25;
  if (/!{2,}/.test(text)) score += 10;
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 6) {
    const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
    if (upperRatio > 0.7) score += 15;
  }
  if (text.length > 160) score += 5;
  return Math.max(0, Math.min(100, score));
}

/** Format ringkasan booking terakhir berdasarkan context state machine. */
export function summarizeBooking(context: any): string {
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

// ─── Handoff ticket creation ──────────────────────────────────────────────

export interface CreateHandoffTicketInput {
  phone: string;
  threadId?: string | null;
  kind: NonNullable<FrustrationKind>;
  triggerMessage: string;
  context: any;
}

/**
 * Buat tiket admin di tabel `handoff_tickets`. Idempotent per (phone, open):
 * jika sudah ada tiket open utk nomor ini, update saja agar tidak banjir.
 */
export async function createHandoffTicket(
  supabase: any,
  input: CreateHandoffTicketInput,
): Promise<{ id: string } | null> {
  try {
    const score = scoreFrustration(input.triggerMessage);
    const summary = summarizeBooking(input.context);
    const bookingCode: string | null =
      (input.context?.bookingCode as string | undefined) ?? null;

    // Cari tiket open existing untuk nomor ini.
    const { data: existing } = await supabase
      .from("handoff_tickets")
      .select("id, frustration_score")
      .eq("phone", input.phone)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("handoff_tickets")
        .update({
          frustration_kind: input.kind,
          frustration_score: Math.max(existing.frustration_score ?? 0, score),
          trigger_message: input.triggerMessage.slice(0, 1000),
          booking_summary: summary,
          booking_context: input.context ?? {},
          booking_code: bookingCode,
          thread_id: input.threadId ?? null,
        })
        .eq("id", existing.id);
      return { id: existing.id as string };
    }

    const { data, error } = await supabase
      .from("handoff_tickets")
      .insert({
        phone: input.phone,
        thread_id: input.threadId ?? null,
        booking_code: bookingCode,
        booking_summary: summary,
        booking_context: input.context ?? {},
        frustration_kind: input.kind,
        frustration_score: score,
        trigger_message: input.triggerMessage.slice(0, 1000),
        status: "open",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[Handoff] insert ticket failed:", error);
      return null;
    }
    return { id: data.id as string };
  } catch (e) {
    console.warn("[Handoff] createHandoffTicket error:", e);
    return null;
  }
}
