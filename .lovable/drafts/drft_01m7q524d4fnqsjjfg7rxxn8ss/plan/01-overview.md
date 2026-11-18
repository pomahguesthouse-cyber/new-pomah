# Rencana 6 perbaikan website publik

Aturan keras berlaku untuk semua langkah: tanpa SQL/migration, tanpa ubah data DB, tanpa angka Rp di kode/konten, tanpa sentuh .env, tanpa ubah alur booking/pembayaran (submitPublicBooking, submitCartBooking, /book), tanpa deploy/publish. Dikerjakan satu item per pesan, urutan yang disarankan: 2 → 1 → 5 → 3 → 4 → 6 (item 1 bergantung pada field harga dari item 2).

## Item 2 — Harga efektif hari ini (fondasi)

**File:** `src/public/functions/public.functions.ts` (loadPublicSiteData, shapePublicSiteData, getRoomTypeDetail), `src/routes/index.tsx` (~111 meta, ~2385 "Harga Hari Ini", ~449 kartu), `src/routes/rooms.index.tsx`, `src/routes/rooms.$slug.tsx` (~504, ~605, ~690 "Kamar Lainnya"), `src/routes/lp.$slug.tsx` (~1420), `src/public/components/unnes-landing.tsx`, `src/public/lib/structured-data.ts`, `src/public/lib/public-seo.ts`, `src/routes/llms[.]txt.ts`.

**Pendekatan:** di server, satu query `getDailyRatesForRange(todayWIB(), todayWIB()+1)` untuk semua tipe kamar, lalu `resolveRoomNightlyRates` (resolver yang sama dengan booking engine) → tambah field per kamar: `today_rate`, `standard_rate` (= base_rate), `rate_date`. Semua tampilan "mulai"/"Harga Hari Ini", JSON-LD `Offer.price` dan `syncFromPrice` pakai `today_rate ?? base_rate`. Bila `today_rate < standard_rate`, tampilkan harga standar dicoret kecil (data asli, bukan karangan). Saat tamu memilih tanggal, perilaku `checkRoomTypeAvailability` tetap.

**Cache 60 detik:** cache key ditambah `rate_date` sehingga pergantian hari WIB langsung memicu muat ulang; perubahan tarif harian muncul maksimal 60 detik kemudian.

**Risiko:** tipe kamar stop-sell hari ini — tampilkan base_rate tanpa label "hari ini" alih-alih menyembunyikan kamar; JSON-LD harga berubah harian (wajar untuk Google).
