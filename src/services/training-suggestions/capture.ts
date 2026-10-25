/**
 * Tangkap balasan staf (manusia) di WhatsApp sebagai USULAN data training.
 * Modul murni (tanpa I/O) supaya filter bisa dites. Hasilnya selalu status
 * pending — tidak pernah aktif sebelum admin menyetujui.
 */

export type CaptureMessage = {
  id: string;
  thread_id: string;
  direction: "in" | "out" | string;
  body: string | null;
  sent_at: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SuggestionDraft = {
  thread_id: string;
  source_message_id: string;
  guest_question: string;
  staff_answer: string;
  flags: string[];
  dedupe_key: string;
};

export type SuggestionFlag = "price" | "phone" | "booking_code" | "guest_name";

const GUEST_WINDOW_MS = 6 * 60 * 60 * 1000; // pertanyaan tamu max 6 jam sebelum balasan
const ANSWER_GROUP_MS = 10 * 60 * 1000; // balasan staf beruntun ≤10 menit digabung
const MAX_GUEST_MSGS = 3;

/** Balasan dari manusia: inbox admin atau HP WhatsApp staf. Bukan bot/sistem. */
export function isStaffReply(m: CaptureMessage): boolean {
  if (m.direction !== "out") return false;
  const md = (m.metadata ?? {}) as Record<string, unknown>;
  if (md.is_system_command === true || md.is_system_command === "true") return false;
  if ((m.body ?? "").trim().startsWith("[sistem]")) return false;
  return (
    md.is_manual_admin === true ||
    md.is_native_human === true ||
    md.source === "admin_inbox" ||
    md.source === "whatsapp_native"
  );
}

const TRIVIAL = new Set(
  [
    "ok", "oke", "okay", "okey", "siap", "baik", "iya", "ya", "y", "sip", "noted", "done",
    "terima kasih", "terimakasih", "makasih", "thanks", "thank you", "sama sama", "sama-sama",
    "halo", "hallo", "hai", "hi", "selamat pagi", "selamat siang", "selamat sore", "selamat malam",
    "pagi", "siang", "sore", "malam", "baik kak", "siap kak", "ok kak", "oke kak", "iya kak", "ya kak",
    "sama sama kak", "terima kasih kak", "makasih kak", "ditunggu", "ditunggu kak", "mohon ditunggu",
  ].map((s) => s.replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()),
);

function normalizeWords(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Sapaan, "ok", emoji/media saja, atau terlalu pendek → tidak layak jadi training. */
export function isTrivialReply(body: string | null | undefined, metadata?: Record<string, unknown> | null): boolean {
  const t = (body ?? "").trim();
  if (!t) return true; // media tanpa caption
  const md = (metadata ?? {}) as Record<string, unknown>;
  const mediaType = typeof md.media_type === "string" ? md.media_type : null;
  if (mediaType && !["conversation", "text", "extendedTextMessage"].includes(mediaType) && t.length < 25) return true;
  if (/^\[(image|video|audio|document|sticker|media|gambar|foto)[^\]]*\]$/i.test(t)) return true;
  const w = normalizeWords(t);
  if (!w) return true; // emoji/tanda baca saja
  if (TRIVIAL.has(w)) return true;
  if (w.length < 15 || w.split(" ").length < 3) return true;
  return false;
}

const PRICE_RE = /\bRp\.?\s?\d|\b\d{2,3}(?:[.,]\d{3})+\b|\b\d{2,4}\s?(?:rb|ribu|k)\b|\b\d+(?:[.,]\d+)?\s?(?:jt|juta)\b/i;
const PHONE_RE = /(?:\+?62[\s-]?|\b0)8[\d\s.-]{7,14}\d/g;
const BOOKING_RE = /\b[A-Z]{2,4}-[A-Z0-9]{4,8}\b/g;

export function hasPrice(text: string): boolean {
  return PRICE_RE.test(text);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Nama tamu dari display_name thread (kata ≥3 huruf, bukan kata umum). */
export function guestNameTokens(displayName: string | null | undefined): string[] {
  const stop = new Set(["kak", "bapak", "ibu", "pak", "bu", "mas", "mbak", "guest", "tamu", "pomah"]);
  return (displayName ?? "")
    .split(/[^\p{L}]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !stop.has(s.toLowerCase()));
}

/**
 * Hapus nomor telepon, kode booking, dan nama tamu; tandai harga eksplisit
 * (harga tidak dihapus agar admin melihat konteks, tapi wajib diganti
 * sebelum disetujui — harga selalu dari kalender harga).
 */
export function sanitizeText(text: string, names: string[] = []): { text: string; flags: SuggestionFlag[] } {
  const flags = new Set<SuggestionFlag>();
  let out = text;
  if (PHONE_RE.test(out)) {
    flags.add("phone");
    out = out.replace(PHONE_RE, "[nomor]");
  }
  PHONE_RE.lastIndex = 0;
  if (BOOKING_RE.test(out)) {
    flags.add("booking_code");
    out = out.replace(BOOKING_RE, "[kode booking]");
  }
  BOOKING_RE.lastIndex = 0;
  for (const n of names) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(n)}(?=$|[^\\p{L}])`, "giu");
    if (re.test(out)) {
      flags.add("guest_name");
      out = out.replace(re, "$1[nama]");
    }
  }
  if (hasPrice(out)) flags.add("price");
  return { text: out.replace(/[ \t]+/g, " ").trim(), flags: [...flags] };
}

/** Masalah yang memblokir persetujuan (dicek ulang saat Setujui). */
export function approvalBlockers(question: string, answer: string): string[] {
  const issues: string[] = [];
  if (hasPrice(answer)) issues.push("Jawaban masih memuat harga. Hapus angka Rp — harga selalu diambil dari kalender harga.");
  PHONE_RE.lastIndex = 0;
  if (PHONE_RE.test(answer) || PHONE_RE.test(question)) issues.push("Masih ada nomor telepon.");
  PHONE_RE.lastIndex = 0;
  BOOKING_RE.lastIndex = 0;
  if (BOOKING_RE.test(answer) || BOOKING_RE.test(question)) issues.push("Masih ada kode booking.");
  BOOKING_RE.lastIndex = 0;
  if (question.trim().length < 5 || answer.trim().length < 10) issues.push("Pertanyaan/jawaban terlalu pendek.");
  return issues;
}

export function dedupeKey(question: string, answer: string): string {
  const s = `${normalizeWords(question)}|${normalizeWords(answer)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}${s.length.toString(16)}`;
}

const ts = (m: CaptureMessage) => (m.sent_at ? Date.parse(m.sent_at) : 0);

/**
 * Pasangkan pertanyaan tamu (≤3 pesan terakhir, ≤6 jam) dengan balasan staf
 * (pesan staf beruntun ≤10 menit digabung). Satu usulan per kelompok balasan;
 * source_message_id = pesan staf pertama → idempoten bila dipindai ulang.
 */
export function buildSuggestions(messages: CaptureMessage[], displayName?: string | null): SuggestionDraft[] {
  const sorted = [...messages].sort((a, b) => ts(a) - ts(b));
  const names = guestNameTokens(displayName);
  const out: SuggestionDraft[] = [];
  let guest: CaptureMessage[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.direction === "in") {
      if ((m.body ?? "").trim()) guest.push(m);
      continue;
    }
    if (!isStaffReply(m)) continue; // balasan bot tidak memutus pertanyaan (kasus handoff)
    const group = [m];
    let j = i + 1;
    while (j < sorted.length) {
      const n = sorted[j];
      if (n.direction === "in") break;
      if (isStaffReply(n) && ts(n) - ts(group[group.length - 1]) <= ANSWER_GROUP_MS) group.push(n);
      else if (isStaffReply(n)) break;
      j++;
    }
    i = j - 1;
    const recentGuest = guest.filter((g) => ts(m) - ts(g) <= GUEST_WINDOW_MS).slice(-MAX_GUEST_MSGS);
    guest = [];
    const parts = group.filter((g) => !isTrivialReply(g.body, g.metadata)).map((g) => (g.body ?? "").trim());
    if (!parts.length || !recentGuest.length) continue;
    const rawQ = recentGuest.map((g) => (g.body ?? "").trim()).join("\n");
    if (normalizeWords(rawQ).length < 5) continue;
    const q = sanitizeText(rawQ, names);
    const a = sanitizeText(parts.join("\n"), names);
    const flags = [...new Set([...q.flags.filter((f) => f !== "price"), ...a.flags])];
    out.push({
      thread_id: m.thread_id,
      source_message_id: m.id,
      guest_question: q.text,
      staff_answer: a.text,
      flags,
      dedupe_key: dedupeKey(q.text, a.text),
    });
  }
  return out;
}
