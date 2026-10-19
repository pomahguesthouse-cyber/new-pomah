/**
 * Koreksi tanggal untuk booking yang SUDAH tercatat (kasus Khodijah PG-Y3E3N,
 * 10 Okt 2026): AI menulis "saya sudah perbarui tanggal check-in-nya" padahal
 * booking/invoice tidak berubah dan ketersediaan tidak dicek ulang.
 *
 * Jalur state machine sudah benar sejak #86 (draft ditulis ulang + cek ulang
 * ketersediaan; setelah booking ada → staf diberi tahu). Guard ini menutup
 * jalur AI: klaim "sudah diubah" untuk booking yang ada diganti jawaban jujur
 * dan permintaan diteruskan ke admin. Booking tidak pernah diubah di sini.
 */

const CLAIM_RE =
  /\b(sudah|telah|udah)\s+(?:saya\s+|kami\s+|aku\s+)?(perbarui|diperbarui|perbaharui|diperbaharui|ubah|diubah|ganti|diganti|update|diupdate|koreksi|dikoreksi|sesuaikan|disesuaikan|ubahkan)\b/i;
const DATE_WORD_RE = /\b(tanggal|tgl|check.?in|check.?out|cekin|cekout|menginap dari|malam)\b/i;
/** Balasan menyatakan tanggal booking sudah diubah. */
export function claimsDateUpdated(reply: string): boolean {
  const text = String(reply ?? "");
  return CLAIM_RE.test(text) && DATE_WORD_RE.test(text);
}

export function buildHonestDateChangeReply(bookingCode: string | null): string {
  const ref = bookingCode ? ` ${bookingCode}` : "";
  return (
    `Untuk perubahan tanggal booking${ref}, permintaan Kakak sudah kami teruskan ke admin ya, Kak 🙏 ` +
    "Tanggal booking dan invoice belum berubah sampai admin mengecek ketersediaan kamar dan harganya. " +
    "Admin akan membalas langsung di chat ini."
  );
}

/**
 * true bila balasan AI harus diganti: tamu punya booking tercatat, balasan
 * mengklaim tanggal sudah diubah, dan state machine tidak menangani giliran ini.
 */
export function shouldReplaceDateUpdateClaim(input: {
  reply: string;
  hasRecordedBooking: boolean;
  toolsUsed: string[];
}): boolean {
  if (!input.hasRecordedBooking) return false;
  if (input.toolsUsed.includes("booking_state_machine")) return false;
  return claimsDateUpdated(input.reply);
}
