export const FALLBACK_MESSAGE =
  "Maaf Kak, sistem sedang lambat. Data terakhir sudah saya simpan. Kakak bisa ketik 'lanjut' untuk meneruskan.";

export const MANAGER_FALLBACK_MESSAGE =
  "Maaf Admin, sistem AI sedang lambat dan belum berhasil memproses perintah ini. Silakan coba lagi sebentar lagi.";

export const QUICK_ACK_MESSAGE = "Sebentar Kak, saya cekkan dulu ya.";

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

/** Full budget for booking, pricing, availability, long, or otherwise heavy messages. */
export const AI_TIMEOUT_MS = 18_000;

/** Reduced budget for lightweight conversation and FAQ messages. */
export const AI_TIMEOUT_LIGHT_MS = 14_000;

export const HEAVY_INTENT_RE =
  /\b(booking|pesan|reservasi|kamar|room|harga|rate|tarif|tersedia|available|avail|kosong|tanggal|check.?in|check.?out|checkout|menginap|malam|dp|bayar|transfer|invoice|refund|extra ?bed|ganti|ubah|batal)\b/i;

export function pickAiBudgetMs(message: string): number {
  const text = (message ?? "").trim();
  if (text.length > 120) return AI_TIMEOUT_MS;
  return HEAVY_INTENT_RE.test(text) ? AI_TIMEOUT_MS : AI_TIMEOUT_LIGHT_MS;
}
