/**
 * Fallback terakhir untuk tamu.
 *
 * Teks lama: "…Kakak bisa ketik 'lanjut' untuk meneruskan." — menyesatkan pada
 * dua sisi (insiden 9 Agu 2026): (1) tidak ada handler khusus untuk kata
 * 'lanjut', jadi tamu diberi instruksi yang tak berarti; (2) beberapa detik
 * kemudian bot TETAP mengirim jawaban aslinya, sehingga tamu melihat sistem
 * yang menyerah lalu menjawab sendiri. Sekarang: minta tamu menunggu, tanpa
 * membebani tamu dengan aksi, dan tanpa mengklaim datanya hilang.
 */

import { isClearGreeting, isClearThanks, isEmojiOnly } from "@/ai/router/message-gates";
import { isMediaRequest, looksLikeBookingInquiry } from "@/services/wa-autoreply/message-parsers";

export const FALLBACK_MESSAGE =
  "Mohon maaf Kak, balasannya sedikit lebih lama dari biasanya. Pertanyaan Kakak sudah kami terima dan sedang kami siapkan jawabannya ya 🙏";

export const MANAGER_FALLBACK_MESSAGE =
  "Maaf Admin, sistem AI sedang lambat dan belum berhasil memproses perintah ini. Silakan coba lagi sebentar lagi.";

export const QUICK_ACK_MESSAGE = "Sebentar Kak, saya cekkan dulu ya.";

/**
 * Ack "Sebentar Kak…" hanya kalau jawaban belum siap setelah ambang ini,
 * dihitung dari saat worker mengambil item antrian (`workerStartedAt`).
 *
 * Nilai lama (deadline 1,6 dtk, timer ~0,9 dtk) menembak bersamaan dengan
 * balasan cepat. Sapaan "malam" selesai ~1,3 dtk lalu ack Meta-nya menyusul
 * SETELAH jawaban, karena kirim ack tidak dibatalkan begitu balasan siap.
 * Sekarang timer baru menyala di ~3 dtk, dan hanya untuk pesan yang
 * benar-benar butuh lookup tool.
 */
export const QUICK_ACK_SLOW_THRESHOLD_MS = 3_000;

export function quickAckDelayMs(elapsedSincePickupMs: number): number {
  const elapsed = Number.isFinite(elapsedSincePickupMs) ? Math.max(0, elapsedSincePickupMs) : 0;
  return Math.max(0, QUICK_ACK_SLOW_THRESHOLD_MS - elapsed);
}

const CLOSING_CHITCHAT_RE =
  /\b(makasih|terima\s*kasih|trims?|trimakasih|thanks?|thank\s*you|thx|tq|sama\s*-?\s*sama|mantap|oke?\s*deh|ya\s*udah?|yaudah|sampai\s*(jumpa|ketemu)|see\s*you|bye)\b/i;

/** Ack "sebentar" tidak pantas untuk penutup/basa-basi singkat. */
export function isQuickAckSuppressedMessage(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text || text.length > 60) return false;
  if (text.includes("?")) return false;
  return CLOSING_CHITCHAT_RE.test(text);
}

const SHORT_SMALL_TALK_RE =
  /^(?:ok+|oke+|okay|sip|siap|baik(?:lah)?|iya+|ya+|yoi|hehe+|haha+|wkwk+|hihi+|lol|apa kabar(?:nya)?|kabar baik|gimana kabar(?:nya)?|lagi apa|ngapain)(?:\s+(?:kak|kakak|ka|ya|yah|dong|deh|nih))*[.!\s]*$/i;

/**
 * Availability, harga, booking, atau foto/brosur — pekerjaan yang sering
 * menunggu tool. "malam" saja TIDAK masuk: itu sapaan, walaupun
 * `HEAVY_INTENT_RE` memakai kata yang sama untuk anggaran AI ("2 malam").
 */
export function messageLikelyNeedsToolLookup(message: string): boolean {
  const text = (message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (isMediaRequest(text)) return true;
  if (
    /\b(?:harga|tarif|rate|biaya|pricelist|price|tersedia|ketersediaan|available|availability|kosong|booking|reservasi|check-?in|check-?out|invoice|refund)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/\d+\s*malam\b/i.test(text)) return true;
  return looksLikeBookingInquiry(text);
}

/**
 * Jadwalkan ack hanya bila pesan ini pantas menunggu lookup.
 * Sapaan, terima kasih, dan small talk singkat tidak pernah di-ack.
 */
export function shouldArmQuickAck(message: string): boolean {
  const text = (message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (
    isClearGreeting(text) ||
    isClearThanks(text) ||
    isEmojiOnly(text) ||
    isQuickAckSuppressedMessage(text) ||
    (text.length <= 40 && SHORT_SMALL_TALK_RE.test(text))
  ) {
    return false;
  }
  return messageLikelyNeedsToolLookup(text);
}

export function buildStateAwareFallback(state?: string): string {
  if (state === "WAITING_DATE_CHANGE" || state === "WAITING_DATE_CHANGE_CONFIRMATION") {
    return "Baik Kak, untuk melanjutkan booking, tanggal barunya kapan dan berapa malam?";
  }
  if (state === "AWAITING_NAME" || state === "CONFIRMING_NAME") {
    return "Baik Kak, mohon ketikkan nama lengkap untuk booking ini.";
  }
  if (state === "AWAITING_PHONE" || state === "CONFIRMING_PHONE") {
    return "Baik Kak, mohon ketikkan nomor WhatsApp yang bisa dihubungi.";
  }
  if (state === "CONFIRMING_BOOKING") {
    return "Apakah data booking sudah sesuai? Kakak bisa balas Ya, Lanjut, atau Batal.";
  }
  return FALLBACK_MESSAGE;
}

/**
 * Anggaran penuh untuk pesan berat (booking, harga, ketersediaan, pesan panjang).
 *
 * Audit 7 Agu 2026 (B3): nilai lama 18 s lebih kecil daripada worst-case SATU
 * turn LLM di orchestrator (10 s timeout + 0,5 s backoff + 10 s retry = 20,5 s),
 * sehingga percakapan tool-calling normal (2 turn) kerap dipotong AbortController
 * luar dan tamu menerima "sistem sedang lambat". Sekarang 22 s — masih aman di
 * bawah `HANDLE_ONE_DEADLINE_MS` (26 s) setelah dikurangi waktu persist + kirim
 * WhatsApp (~2 s). Orchestrator juga sekarang menerima deadline ini dan
 * memperkecil timeout per-panggilan agar muat (lihat `deadlineAt`).
 */
export const AI_TIMEOUT_MS = 22_000;

/** Reduced budget for lightweight conversation and FAQ messages. */
export const AI_TIMEOUT_LIGHT_MS = 16_000;

export const HEAVY_INTENT_RE =
  /\b(booking|pesan|reservasi|kamar|room|harga|rate|tarif|tersedia|available|avail|kosong|tanggal|check.?in|check.?out|checkout|menginap|malam|dp|bayar|transfer|invoice|refund|extra ?bed|ganti|ubah|batal)\b/i;

export function pickAiBudgetMs(message: string): number {
  const text = (message ?? "").trim();
  if (text.length > 120) return AI_TIMEOUT_MS;
  return HEAVY_INTENT_RE.test(text) ? AI_TIMEOUT_MS : AI_TIMEOUT_LIGHT_MS;
}
