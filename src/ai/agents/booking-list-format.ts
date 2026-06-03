/**
 * Shared booking-list output format.
 *
 * Appended to any agent prompt that exposes `get_bookings` (Manager,
 * Finance). One canonical layout means manager sees the same emoji-block
 * report whether they ask "5 booking terbaru" (Manager) or "siapa belum
 * lunas" (Finance) — readable on Telegram, no markdown bullets.
 *
 * Keep this in ONE place so the format doesn't drift between agents.
 */

export const BOOKING_LIST_FORMAT_BLOCK = [
  "FORMAT DAFTAR BOOKING (WAJIB diikuti persis saat menyajikan hasil `get_bookings` " +
    "ke manajer — JANGAN pakai bullet markdown '*' / '-' / nomor, JANGAN gabung jadi " +
    "satu paragraf, JANGAN pakai bold '**...**'). Output adalah blok-blok teks polos " +
    "dipisahkan baris '━━━━━━━━━━━━━'.",

  "Setiap blok booking WAJIB menampilkan tanggal menginap sendiri. Jangan memakai header tanggal grup. " +
    "Alasannya: daftar booking terbaru diurutkan berdasarkan waktu pembuatan booking (created_at), " +
    "sehingga tanggal menginap bisa loncat-loncat. Jika tanggal hanya muncul sebagai header grup, " +
    "beberapa booking akan terlihat tidak punya tanggal.",

  "Template SATU blok booking (urutan baris persis, masing-masing baris dimulai emoji, " +
    "tanpa indentasi, tanpa karakter bullet):\n" +
    "🏷 <reference_code, mis. PG-XQRE9>\n" +
    "📅 <tanggal menginap Indonesia, BUKAN ISO. Contoh: '17–18 Juli 2026'>\n" +
    "👤 <nama tamu>\n" +
    "🛏 <nama kamar + nomor dalam kurung bila sudah di-assign; banyak kamar dipisah koma — " +
    "mis. 'Single (207), Grand Deluxe (GD-01)'>\n" +
    "💰 Rp<total format Indonesia titik ribuan: Rp3.300.000>" +
    " (BILA partial, tambahkan ' — DP Rp<paid> — Sisa Rp<outstanding>'; " +
    "BILA unpaid dan konteks piutang, tambahkan ' — Belum bayar')\n" +
    "<status emoji + label kapital depan: " +
    "'✅ Confirmed' / '✅ Checked_in' / '⏳ Pending' / '🟡 Partial' / '❌ Cancelled'>\n" +
    "🕒 Dibuat: <tanggal dan jam pembuatan booking, jika field created_at tersedia>",

  "ATURAN TANGGAL: Baris 📅 tidak boleh hilang. Bila check_in/check_out tersedia, formatkan " +
    "sebagai rentang menginap Indonesia: '12–13 Juni 2026' untuk bulan sama, " +
    "'14 Juni – 14 Juli 2026' untuk lintas bulan, '30 Des 2026 – 2 Jan 2027' untuk lintas tahun. " +
    "JANGAN tampilkan '2026-07-17'. Bila check_out kosong, tampilkan hanya check_in.",

  "Pemisah antar blok: baris baru kosong, lalu '━━━━━━━━━━━━━' (13 karakter ━), baris " +
    "baru kosong, lalu blok berikutnya. Jangan menggabungkan beberapa booking ke satu paragraf.",

  "Contoh output yang BENAR (perhatikan: kode booking paling atas dan setiap item punya tanggal):\n" +
    "🏷 PG-XQRE9\n" +
    "📅 12–13 Juni 2026\n" +
    "👤 Salasabil Shafira\n" +
    "🛏 Single (207), Grand Deluxe (GD-01)\n" +
    "💰 Rp550.000\n" +
    "✅ Confirmed\n" +
    "🕒 Dibuat: 19 Mei 2026, 08:42\n" +
    "\n" +
    "━━━━━━━━━━━━━\n" +
    "\n" +
    "🏷 PG-5M8Q6\n" +
    "📅 17–18 Juli 2026\n" +
    "👤 Renita\n" +
    "🛏 Family Suite 100\n" +
    "💰 Rp500.000 — DP Rp300.000 — Sisa Rp200.000\n" +
    "🟡 Partial\n" +
    "🕒 Dibuat: 27 Mei 2026, 07:21",

  "Contoh output yang SALAH dan TIDAK BOLEH dipakai:\n" +
    "📅 17–18 Juli 2026 lalu beberapa booking di bawahnya tanpa baris 📅.  ← tanggal per item hilang, ditolak\n" +
    "* **PG-Y3ZWD** (Uswatul) - check-in 17 Juli 2026, lunas.   ← markdown bullet/bold, ditolak\n" +
    "1. Salasabil Shafira | PG-XQRE9 | Rp550.000               ← bullet bernomor, ditolak\n" +
    "PG-Y3ZWD Uswatul 17/07/2026 lunas.                        ← format satu baris, ditolak",

  "Tidak ada pembuka 'Berikut daftar...' kecuali manajer eksplisit minta. Langsung " +
    "sajikan blok pertama. Bila konteks piutang, akhiri dengan satu baris ringkasan: " +
    "'Total <N> booking, outstanding Rp<total_outstanding>'.",
].join("\n\n");
