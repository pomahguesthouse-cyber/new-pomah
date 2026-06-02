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

  "Kelompokkan booking berdasarkan rentang tanggal menginap (check-in – check-out). " +
    "Header tanggal hanya muncul SEKALI di atas grup, bukan diulang per blok. Bila " +
    "semua booking di rentang yang sama, cukup satu header di paling atas.",

  "Template SATU blok booking (urutan baris persis, masing-masing baris dimulai emoji, " +
    "tanpa indentasi, tanpa karakter bullet):\n" +
    "👤 <nama tamu>\n" +
    "🏷 <reference_code, mis. PG-XQRE9>\n" +
    "🛏 <nama kamar + nomor dalam kurung bila sudah di-assign; banyak kamar dipisah koma — " +
    "mis. 'Single (207), Grand Deluxe (GD-01)'>\n" +
    "💰 Rp<total format Indonesia titik ribuan: Rp3.300.000>" +
    " (BILA partial, tambahkan ' — DP Rp<paid> — Sisa Rp<outstanding>'; " +
    "BILA unpaid dan konteks piutang, tambahkan ' — Belum bayar')\n" +
    "<status emoji + label kapital depan: " +
    "'✅ Confirmed' / '✅ Checked_in' / '⏳ Pending' / '🟡 Partial' / '❌ Cancelled'>",

  "Header tanggal grup (baris di atas blok pertama tiap grup):\n" +
    "📅 <tanggal Indonesia, BUKAN ISO. Contoh: '17–18 Juli 2026' (rentang dalam bulan " +
    "sama), '14 Juni – 14 Juli 2026' (lintas bulan), '30 Des 2026 – 2 Jan 2027' (lintas " +
    "tahun). JANGAN tampilkan '2026-07-17'.>",

  "Pemisah antar blok: baris baru kosong, lalu '━━━━━━━━━━━━━' (13 karakter ━), baris " +
    "baru kosong, lalu blok berikutnya. Antar grup tanggal sama saja.",

  "Contoh output yang BENAR (perhatikan: tidak ada '*', tidak ada '**bold**', emoji di " +
    "setiap baris, header tanggal sekali per grup):\n" +
    "📅 12 Juni 2026\n" +
    "\n" +
    "👤 Salasabil Shafira\n" +
    "🏷 PG-XQRE9\n" +
    "🛏 Single (207), Grand Deluxe (GD-01)\n" +
    "💰 Rp550.000\n" +
    "✅ Confirmed\n" +
    "\n" +
    "━━━━━━━━━━━━━\n" +
    "\n" +
    "📅 14 Juni – 14 Juli 2026\n" +
    "\n" +
    "👤 Nurmalinda\n" +
    "🏷 PG-YCMKS\n" +
    "🛏 Family Suite 100\n" +
    "💰 Rp3.300.000\n" +
    "✅ Confirmed\n" +
    "\n" +
    "━━━━━━━━━━━━━\n" +
    "\n" +
    "📅 17–18 Juli 2026\n" +
    "\n" +
    "👤 Renita\n" +
    "🏷 PG-5M8Q6\n" +
    "🛏 Family Suite 100\n" +
    "💰 Rp500.000 — DP Rp300.000 — Sisa Rp200.000\n" +
    "🟡 Partial",

  "Contoh output yang SALAH dan TIDAK BOLEH dipakai:\n" +
    "* **PG-Y3ZWD** (Uswatul) - check-in 17 Juli 2026, lunas.   ← markdown bullet/bold, ditolak\n" +
    "1. Salasabil Shafira | PG-XQRE9 | Rp550.000               ← bullet bernomor, ditolak\n" +
    "PG-Y3ZWD Uswatul 17/07/2026 lunas.                        ← format ISO + satu baris, ditolak",

  "Tidak ada pembuka 'Berikut daftar...' kecuali manajer eksplisit minta. Langsung " +
    "sajikan blok pertama. Bila konteks piutang, akhiri dengan satu baris ringkasan: " +
    "'Total <N> booking, outstanding Rp<total_outstanding>.'",
].join("\n\n");
