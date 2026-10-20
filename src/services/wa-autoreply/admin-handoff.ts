/**
 * Handoff ke admin manusia (laporan Sania 13–18 Okt 2026).
 *
 * Kasus: Ika (PG-GDWES) menunggu ±30 menit setelah bot bilang "konfirmasi ke
 * tim", Azaaa menunggu ±40 menit setelah bukti TF 17 Okt 09:35, Aliif
 * (PG-K66KR) mengancam cancel. Bot hanya berjanji tanpa ada yang diberi tahu.
 *
 * Pemicu: tamu minta admin/manusia, kirim bukti transfer, mengancam cancel,
 * komplain, atau balasan bot sendiri menyerahkan ke tim (bot tidak tahu).
 * Aksi: tiket `handoff_tickets`, notifikasi admin (push + WhatsApp), dan bot
 * dijeda di thread itu (`whatsapp_threads.ai_paused_until`) sampai staf
 * mengembalikan ke AI, tiket diselesaikan, atau batas waktu habis.
 *
 * Tidak pernah menjanjikan batas waktu ke tamu.
 */

export type AdminHandoffKind =
  | "admin_request"
  | "payment_proof"
  | "cancel_threat"
  | "complaint"
  | "unknown_answer"
  | "facility_unknown"
  | "booking_change_request";

/** Jeda bot setelah handoff. Staf bisa mengembalikan ke AI lebih cepat. */
export const ADMIN_HANDOFF_PAUSE_MS = 6 * 60 * 60 * 1000;

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ADMIN_REQUEST_PATTERNS: RegExp[] = [
  /^\s*(admin|cs|min|mimin)\s*[.!?]*\s*$/,
  /\b(minta|mau|ingin|pengen|pingin|bisa|boleh|tolong|tlg|perlu)\b.{0,30}\b(admin|cs|customer service|manusia|orang asli|staf|staff|petugas|owner|pemilik|resepsionis|karyawan)\b/,
  /\b(hubungkan|sambungkan|alihkan|teruskan)\b.{0,25}\b(admin|cs|staf|staff|petugas|manusia|owner|pemilik)\b/,
  /\b(bicara|ngobrol|chat|telp|telepon|telpon|hubungi)\b.{0,15}\b(dengan|sama|ke)\b.{0,10}\b(admin|cs|manusia|orang|staf|staff|petugas|owner|pemilik)\b/,
  /\bnomor\b.{0,15}\b(admin|cs|owner|pemilik|petugas)\b/,
  /\b(jangan|bukan|gak mau|ga mau|tidak mau)\b.{0,10}\b(bot|robot|ai)\b/,
];

const CANCEL_THREAT_PATTERNS: RegExp[] = [
  /\b(cancel|batal|batalin|batalkan)\s+(aja|saja|deh|lah)\b/,
  /\b(saya|aku|sy|mending|lebih baik|terpaksa|kalau gitu|kalo gitu|klo gitu|ya udah|yaudah)\b.{0,20}\b(cancel|batal|batalin|batalkan)\b/,
  /\b(minta|mau|ingin)\b.{0,10}\b(refund|uang\s*(saya\s*)?kembali|pengembalian\s+dana)\b/,
  /\bpindah\s+(ke\s+)?(hotel|penginapan|tempat)\s+lain\b/,
];

const COMPLAINT_PATTERNS: RegExp[] = [
  /\b(komplain|complain|keluhan|kecewa|mengecewakan|tidak profesional|gak profesional|ga profesional)\b/,
  /\b(lama banget|lama sekali|lambat banget|nunggu lama|menunggu lama|ditunggu dari tadi|dari tadi (?:gak|ga|tidak|belum) (?:dibales|dibalas|dijawab|direspon))\b/,
  /\b(kok|kenapa)\b.{0,10}\b(belum|gak|ga|tidak)\b.{0,10}\b(dibales|dibalas|dijawab|direspon|dikabari)\b/,
  /\b(kotor|bau|jorok|berisik)\b.{0,20}\b(banget|sekali|parah|kamar|kamarnya)\b/,
  /\b(kamar|kamarnya|ac|air|wifi|shower|kran|lampu|tv)\b.{0,20}\b(rusak|mati|bocor|tidak berfungsi|gak berfungsi|ga berfungsi|tidak nyala|gak nyala|ga nyala)\b/,
];

const TRANSFER_CLAIM_RE =
  /\b(sudah|udah|udh|sdh|barusan|baru saja|baru aja|telah)\s+(?:saya\s+|aku\s+)?(tf|transfer|trf|ditransfer|bayar|dibayar|bayar lunas|lunas|kirim (?:uang|dana)|dp)\b/;

/** Tamu bilang sudah transfer (teks, tanpa gambar bukti). */
export function detectTransferClaim(text: string): boolean {
  const t = norm(text);
  if (!t || t.length > 300) return false;
  if (/\?/.test(t) && /\b(kalau|kalo|bisa|boleh|harus|apakah)\b/.test(t)) return false;
  return TRANSFER_CLAIM_RE.test(t);
}

/** Balasan untuk klaim transfer tanpa bukti. Status tetap belum lunas; tanpa batas waktu. */
export const TRANSFER_CLAIM_REPLY =
  "Terima kasih, Kak 🙏 Kami cek terlebih dahulu ya, Kak. Kalau belum, mohon kirim foto/screenshot bukti " +
  "transfernya di chat ini supaya admin bisa mencocokkan pembayarannya.";

/** Pemicu dari pesan tamu (teks). Bukti transfer dideteksi terpisah dari media. */
export function detectGuestHandoffTrigger(text: string): AdminHandoffKind | null {
  const t = norm(text);
  if (!t) return null;
  if (ADMIN_REQUEST_PATTERNS.some((p) => p.test(t))) return "admin_request";
  const policyQuestion = /\b(kebijakan|aturan|syarat|ketentuan|kena biaya|dikenakan|potongan)\b/.test(t) && t.includes("?");
  if (!policyQuestion && CANCEL_THREAT_PATTERNS.some((p) => p.test(t))) return "cancel_threat";
  if (COMPLAINT_PATTERNS.some((p) => p.test(t))) return "complaint";
  return null;
}

const DEFERS_TO_STAFF_PATTERNS: RegExp[] = [
  /\b(konfirmasi|konfirmasikan|cek|cekkan|tanyakan|teruskan|sampaikan|diskusikan)\b(?:\s+(?:dulu|terlebih dahulu|lebih dulu))?\s+(?:ke|kepada|dengan|sama)\s+(?:tim|staf|staff|admin|front office|bagian|pengelola|manajemen|owner)\b/,
  /\b(akan|segera|nanti)\b.{0,20}\b(konfirmasi|kabari|kabarkan|informasikan)\b.{0,20}\b(tim|staf|staff|admin)\b/,
  /\btim kami akan (?:segera )?(?:mengecek|cek|konfirmasi|menghubungi)\b/,
];

/** Balasan bot menyerahkan ke tim — artinya bot tidak tahu jawabannya. */
export function replyDefersToStaff(reply: string): boolean {
  const t = norm(reply);
  if (!t) return false;
  return DEFERS_TO_STAFF_PATTERNS.some((p) => p.test(t));
}

/** Balasan ke tamu saat handoff dari pesan tamu. Tanpa batas waktu. */
export function buildAdminHandoffGuestReply(kind: AdminHandoffKind): string {
  switch (kind) {
    case "complaint":
      return (
        "Mohon maaf atas ketidaknyamanannya, Kak 🙏 Pesan Kakak sudah kami teruskan ke admin Pomah Guesthouse " +
        "dan admin akan membalas langsung di chat ini."
      );
    case "cancel_threat":
      return (
        "Baik Kak, kami mohon maaf 🙏 Permintaan Kakak sudah kami teruskan ke admin Pomah Guesthouse " +
        "untuk ditindaklanjuti, dan admin akan membalas langsung di chat ini."
      );
    case "booking_change_request":
      return (
        "Permintaan perubahan booking Kakak sudah kami teruskan ke admin Pomah Guesthouse ya, Kak 🙏 " +
        "Booking belum berubah sampai admin mengonfirmasi. Admin akan membalas langsung di chat ini."
      );
    case "facility_unknown":
    case "unknown_answer":
      return (
        "Untuk hal tersebut kami teruskan ke admin Pomah Guesthouse dulu ya, Kak 🙏 " +
        "Admin akan membalas langsung di chat ini."
      );
    case "payment_proof":
    case "admin_request":
    default:
      return (
        "Baik Kak 🙏 Pesan Kakak sudah kami teruskan ke admin Pomah Guesthouse. " +
        "Admin akan membalas langsung di chat ini."
      );
  }
}

export const ADMIN_HANDOFF_KIND_LABEL: Record<AdminHandoffKind, string> = {
  admin_request: "Tamu minta bicara dengan admin",
  payment_proof: "Tamu mengirim bukti transfer",
  cancel_threat: "Tamu mengancam/minta cancel",
  complaint: "Tamu komplain",
  unknown_answer: "Bot tidak tahu jawabannya",
  facility_unknown: "Data fasilitas kamar belum diisi",
  booking_change_request: "Tamu minta ubah tanggal booking (BELUM diubah)",
};

export interface AdminHandoffNoticeInput {
  kind: AdminHandoffKind;
  phone: string;
  guestName?: string | null;
  bookingCode?: string | null;
  trigger: string;
  threadId?: string | null;
  pauseUntil?: string | null;
}

export interface AdminHandoffNotice {
  message: string;
  pushTitle: string;
  pushBody: string;
  url: string;
  /** Parameter template Utility WhatsApp (bila env template diset). */
  templateParams: string[];
}

export function buildAdminHandoffNotice(input: AdminHandoffNoticeInput): AdminHandoffNotice {
  const label = ADMIN_HANDOFF_KIND_LABEL[input.kind];
  const guest = (input.guestName || "").trim() || "Tamu";
  const digits = String(input.phone ?? "").replace(/[^\d]/g, "");
  const trigger = String(input.trigger ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "-";
  const url = input.threadId ? `/admin/whatsapp?thread=${input.threadId}` : "/admin/whatsapp";
  const message = [
    `🙋 PERLU ADMIN — ${label}`,
    "",
    `Tamu: ${guest}`,
    `Nomor: ${digits || "-"}`,
    `Kode booking: ${(input.bookingCode || "").trim() || "-"}`,
    `Pesan: "${trigger}"`,
    "",
    "Bot BERHENTI membalas otomatis di chat ini sampai admin membalas lalu menekan " +
      "\"Kembalikan ke AI\" (atau kirim /ai di chat tamu), atau tiket diselesaikan." +
      (input.pauseUntil ? " Bot aktif lagi otomatis setelah 6 jam." : ""),
    `Chat: ${url}`,
  ].join("\n");
  return {
    message,
    pushTitle: `Perlu admin: ${guest}`,
    pushBody: `${label}\n${trigger.slice(0, 140)}`,
    url,
    templateParams: [label, guest, digits || "-", trigger.slice(0, 200)],
  };
}

/** Jeda yang lebih lama menang — balasan staf tidak memperpendek jeda handoff. */
export function laterPause(existing: string | null | undefined, candidate: string | null): string | null {
  const a = existing ? Date.parse(existing) : NaN;
  const b = candidate ? Date.parse(candidate) : NaN;
  if (Number.isNaN(a)) return candidate;
  if (Number.isNaN(b)) return existing ?? null;
  return a >= b ? (existing as string) : candidate;
}

type Db = { from: (t: string) => any; rpc?: (fn: string, args: unknown) => any };

export interface TriggerAdminHandoffInput {
  phone: string;
  threadId?: string | null;
  kind: AdminHandoffKind;
  triggerMessage: string;
  guestName?: string | null;
  context?: unknown;
  /** false bila alert sudah dikirim jalur lain (mis. bukti transfer). */
  notify?: boolean;
  /** Lama jeda bot. Default ADMIN_HANDOFF_PAUSE_MS; 0 = tiket + alert tanpa jeda. */
  pauseMs?: number;
  now?: Date;
}

export interface AdminHandoffDeps {
  createTicket: (db: Db, input: {
    phone: string;
    threadId?: string | null;
    kind: string;
    triggerMessage: string;
    context: unknown;
  }) => Promise<{ id: string } | null>;
  notify: (db: Db, notice: AdminHandoffNoticeInput & { ticketId: string | null }) => Promise<void>;
}

async function defaultDeps(): Promise<AdminHandoffDeps> {
  const [{ createHandoffTicket }, { notifyAdminHandoff }] = await Promise.all([
    import("../frustration-detector"),
    import("../manager-notifier.service"),
  ]);
  return {
    createTicket: (db, input) => createHandoffTicket(db as never, input as never),
    notify: (db, notice) => notifyAdminHandoff(db as never, notice),
  };
}

/**
 * Buat tiket, jeda bot di thread, dan beri tahu admin. Tidak melempar.
 * Mengembalikan waktu jeda (ISO) bila thread berhasil dijeda.
 */
export async function triggerAdminHandoff(
  db: Db,
  input: TriggerAdminHandoffInput,
  deps?: AdminHandoffDeps,
): Promise<{ ticketId: string | null; pausedUntil: string | null }> {
  const now = input.now ?? new Date();
  let ticketId: string | null = null;
  let pausedUntil: string | null = null;
  let d: AdminHandoffDeps;
  try {
    d = deps ?? (await defaultDeps());
  } catch (e) {
    console.warn("[AdminHandoff] gagal memuat modul:", e);
    return { ticketId, pausedUntil };
  }
  const ctx = (input.context && typeof input.context === "object" ? input.context : {}) as Record<string, unknown>;
  try {
    const ticket = await d.createTicket(db, {
      phone: input.phone,
      threadId: input.threadId ?? null,
      kind: input.kind,
      triggerMessage: input.triggerMessage,
      context: ctx,
    });
    ticketId = ticket?.id ?? null;
  } catch (e) {
    console.warn("[AdminHandoff] tiket gagal:", e);
  }
  const pauseMs = input.pauseMs ?? ADMIN_HANDOFF_PAUSE_MS;
  if (input.threadId && pauseMs > 0) {
    try {
      const { data: thread } = await db
        .from("whatsapp_threads")
        .select("ai_paused_until")
        .eq("id", input.threadId)
        .maybeSingle();
      const candidate = new Date(now.getTime() + pauseMs).toISOString();
      pausedUntil = laterPause((thread as { ai_paused_until?: string | null } | null)?.ai_paused_until, candidate);
      await db.from("whatsapp_threads").update({ ai_paused_until: pausedUntil }).eq("id", input.threadId);
    } catch (e) {
      console.warn("[AdminHandoff] jeda thread gagal:", e);
      pausedUntil = null;
    }
  }
  if (input.notify !== false) {
    try {
      await d.notify(db, {
        kind: input.kind,
        phone: input.phone,
        guestName: input.guestName ?? null,
        bookingCode: (ctx.bookingCode as string | undefined) ?? null,
        trigger: input.triggerMessage,
        threadId: input.threadId ?? null,
        pauseUntil: pausedUntil,
        ticketId,
      });
    } catch (e) {
      console.warn("[AdminHandoff] notifikasi gagal:", e);
    }
  }
  return { ticketId, pausedUntil };
}
