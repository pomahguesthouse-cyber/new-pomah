/**
 * "lihat pricelist" / "daftar harga" / "minta harga" → tanyakan tanggal.
 *
 * Harga Pomah mengikuti kalender (room_daily_rates → fallback
 * room_types.base_rate), jadi tidak ada satu "pricelist" statis. Sebelumnya
 * kata pricelist dianggap permintaan brosur (bot kirim PDF tanpa tanya
 * tanggal) atau jatuh ke LLM ("Kami cek terlebih dahulu ya, Kak." lalu diam).
 * Permintaan brosur/foto eksplisit tetap masuk alur brosur.
 */
const PRICELIST_RE =
  /\b(?:price\s*-?\s*list|pricelist|pl)(?:nya)?\b|\b(?:daftar|list)\s+harga(?:nya)?\b|\bminta\s+(?:info\s+)?harga(?:nya)?\b|\binfo\s+harga(?:nya)?\b/i;
const EXPLICIT_MEDIA_RE =
  /\b(?:brosur|brochure|katalog|catalog|catalogue)(?:nya)?\b|\b(?:foto|poto|photo|gambar|pict?ures?|pics?|video)(?:nya|2)?\b|\bbergambar\b/i;

export function isPricelistAsk(text: string): boolean {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t.length > 240) return false;
  if (!PRICELIST_RE.test(t)) return false;
  return !EXPLICIT_MEDIA_RE.test(t);
}

export const PRICELIST_ASK_DATES_REPLY =
  "Untuk tanggal berapa rencana menginapnya, Kak? Dan untuk berapa orang? Nanti kami cek harga & ketersediaannya. 🙏";

/** Balasan tanya tanggal bila tamu minta pricelist dan tanggal belum diketahui. */
export function buildPricelistAskDatesReply(params: {
  message: string;
  hasKnownDates: boolean;
  mentionsDate: boolean;
}): string | null {
  if (!isPricelistAsk(params.message)) return null;
  if (params.hasKnownDates || params.mentionsDate) return null;
  return PRICELIST_ASK_DATES_REPLY;
}
