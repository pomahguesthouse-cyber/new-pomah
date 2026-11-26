/**
 * Keputusan "bot harus diam" setelah tamu minta admin / handoff lain.
 *
 * Insiden Lana Arifah 26 Nov 2026: tamu menulis "admin", bot membalas
 * "Pesan Kakak sudah kami teruskan ke admin…", lalu ±2 menit kemudian
 * mengirim sapaan sendiri dan terus menjawab ketersediaan. Penyebabnya:
 * `triggerAdminHandoff` hanya mengisi `whatsapp_threads.ai_paused_until`
 * (6 jam) dan tiket, tanpa `wa_booking_states.context.handoff`. Guard di
 * worker hanya jalan bila flag itu true, dan tidak dicek lagi tepat
 * sebelum kirim — giliran yang sudah lewat pagar awal tetap mengirim.
 *
 * Lepas kembali: staf menekan "Kembalikan ke AI", mengirim /ai, atau
 * menyelesaikan tiket (ai_paused_until dikosongkan, flag dihapus).
 * Batas waktu yang sudah ada: `ADMIN_HANDOFF_PAUSE_MS` (6 jam) tetap
 * ditulis. Selama tiket masih terbuka DAN flag handoff menyala, bot
 * tetap diam melewati 6 jam itu — sama seperti handoff frustrasi.
 * Bila yang tersimpan hanya jeda (flag gagal), bot boleh aktif lagi
 * setelah jeda habis.
 */

export interface HandoverSnapshot {
  aiAuto?: boolean | null;
  aiPausedUntil?: string | null;
  handoffFlag?: boolean;
  hasOpenTicket?: boolean;
  now?: Date;
}

export function isPauseActive(
  aiPausedUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!aiPausedUntil) return false;
  const ts = Date.parse(aiPausedUntil);
  return Number.isFinite(ts) && ts > now.getTime();
}

/**
 * True bila bot tidak boleh mengirim apa pun ke thread ini (balasan,
 * fallback, nudge, brosur, sapaan susulan).
 */
export function shouldSuppressBotSend(input: HandoverSnapshot): boolean {
  if (input.aiAuto === false) return true;
  if (isPauseActive(input.aiPausedUntil, input.now)) return true;
  if (input.handoffFlag && input.hasOpenTicket) return true;
  return false;
}

type Db = {
  from: (table: string) => any;
  rpc?: (fn: string, args: unknown) => Promise<{ data?: unknown; error?: unknown }>;
};

/** Baca jeda thread + flag booking + tiket terbuka. Gagal baca = tidak menekan. */
export async function loadThreadHandoverSnapshot(
  db: Db,
  args: { threadId?: string | null; phone?: string | null; now?: Date },
): Promise<HandoverSnapshot> {
  const snap: HandoverSnapshot = {
    now: args.now,
    handoffFlag: false,
    hasOpenTicket: false,
  };
  if (args.threadId) {
    try {
      const { data } = await db
        .from("whatsapp_threads")
        .select("ai_auto, ai_paused_until")
        .eq("id", args.threadId)
        .maybeSingle();
      const row = (data ?? null) as { ai_auto?: boolean | null; ai_paused_until?: string | null } | null;
      snap.aiAuto = row?.ai_auto ?? null;
      snap.aiPausedUntil = row?.ai_paused_until ?? null;
    } catch {
      /* biarkan kosong — pemanggil gagal-terbuka */
    }
  }
  if (args.phone && typeof db.rpc === "function") {
    try {
      const { data } = await db.rpc("get_active_booking_state", { p_phone: args.phone });
      const ctx = (data as { context?: unknown } | null)?.context;
      snap.handoffFlag =
        !!ctx &&
        typeof ctx === "object" &&
        (ctx as { handoff?: unknown }).handoff === true;
    } catch {
      /* flag opsional */
    }
  }
  if (args.phone) {
    try {
      const { data } = await db
        .from("handoff_tickets")
        .select("id")
        .eq("phone", args.phone)
        .eq("status", "open")
        .limit(1);
      snap.hasOpenTicket = Array.isArray(data) && data.length > 0;
    } catch {
      /* tiket opsional */
    }
  }
  return snap;
}
