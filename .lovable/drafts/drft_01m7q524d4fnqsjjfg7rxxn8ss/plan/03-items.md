**Tes item 2:** skrip baru `scripts/test-public-today-rate.ts` — Deluxe base 230000 + tarif harian 207000 pada tanggal X → `today_rate` 207000; tanpa tarif harian → base_rate; stop-sell → fallback base_rate. Sesuaikan `test-public-seo.ts` agar meta "mulai" memakai harga efektif.

## Item 1 — Hapus angka statis Single (dan tipe lain)

**File:** `src/public/content/approved-seo.ts` (ROOM_FROM_RATES baris 78, fungsi `rp()` baris 90), `src/admin/modules/seo/seo.functions.ts` (priceRange), `scripts/test-seo-room-prices.ts`, `scripts/test-landing-page-seo.ts` (baris 328).

**Pendekatan:** hapus `ROOM_FROM_RATES` seluruhnya (bukan hanya Single, agar tidak ada angka statis lain). Copy SEO yang memuat harga menjadi fungsi yang menerima harga dari loader (`today_rate ?? base_rate`); bila harga tidak tersedia, kalimat harga dihilangkan (tidak pakai angka cadangan). `priceRange` dihitung dari min–max base_rate DB. base_rate DB tidak diubah.

**Tes:** `test-seo-room-prices.ts` diubah: memastikan tidak ada literal harga di `approved-seo.ts` dan copy memakai angka yang diberikan; `test-landing-page-seo.ts` memakai harga fixture dari tes, bukan konstanta.

**Risiko:** halaman yang memanggil copy tanpa data harga akan tampil tanpa kalimat harga — diterima, lebih baik daripada harga salah.

## Item 5 — Spesifikasi Family Room 222 / Family Suite 100

**File:** `src/routes/index.tsx` (kartu ~449, saat ini `bed_type: null`), `src/routes/rooms.index.tsx` (~116–120), `src/routes/rooms.$slug.tsx`, helper kecil baru `src/public/lib/room-spec-label.ts`.

**Pendekatan:** helper `roomSpecLabel(room)`: jika `bedrooms >= 2` → "4 tamu · 50 m² · 2 kamar tidur · 2 kamar mandi" (tanpa jenis kasur); jika 1 kamar tidur → tetap tampilkan jenis kasur. Di detail kamar, baris kasur untuk tipe multi-kamar menjadi "Konfigurasi kasur per kamar tidur: tanyakan via WhatsApp" — tidak mengarang.

**Tes:** `scripts/test-room-spec-label.ts` — bedrooms 2 → tidak memuat "Queen"/"Double", memuat "2 kamar tidur"; bedrooms 1 → memuat jenis kasur.

## Item 3 — Konteks alamat City Guide

**File:** `src/routes/explore.index.tsx` (baris ~715 dan ~869), `src/public/lib/city-guide.ts` (baris 162/179: `location` saat ini mengambil alamat lebih dulu daripada jarak).

**Pendekatan:** tampilkan nama tempat, lalu "Alamat tempat: …" dan "Jarak dari Pomah: …" (nearby_distance) sebagai dua baris terpisah. Di kartu ringkas, prioritaskan jarak dari Pomah; alamat dengan label. Data tidak diubah.

**Tes:** perluas `scripts/test-explore-event-filter.ts` atau skrip baru untuk shaper `city-guide.ts`: alamat selalu disertai label dan jarak terpisah.

## Item 4 — Ulasan terbaru dulu

**File:** `src/public/functions/google-reviews.functions.ts` (setelah `parseStoredReviews`, baris ~97).

**Pendekatan:** sortir stabil: yang punya `date` valid menurun (terbaru dulu), yang tanpa tanggal di belakang dengan urutan aslinya. Tidak menambah atau mengubah isi ulasan. Hasil yang diharapkan: Irdesmiati I. (08/12/2025), Wahyu A. (07/12/2025), Tamu Google (25/11/2025), Irza A. (02/11/2025), …

**Tes:** perluas `scripts/test-review-display.ts` dengan fixture campuran bertanggal/tidak.

## Item 6 — Bagian Promo + halaman /promo

**File:** baru `src/public/content/promos.ts` (daftar 5 promo, teks saja), baru `src/public/components/promo-section.tsx`, baru `src/routes/promo.tsx` (head() sendiri: title, description, og, twitter:card), `src/routes/index.tsx` (sisip bagian promo ringkas + link "Lihat semua promo"), `src/routes/sitemap[.]xml.ts` (tambah /promo).

**Isi (tanpa angka):** promo hari kerja Deluxe (malam Senin–Kamis, booking langsung via WA/website); paket wisuda/acara kampus Family Room 222 & Family Suite 100 + bonus late check-out; 3 malam hari kerja potongan malam ketiga (Single: bonus late check-out); tamu lama booking ulang via WA dapat potongan kecil atau gratis late check-out; upgrade hemat ke Grand Deluxe yang masih kosong di hari H untuk tamu Deluxe. Tiap kartu: tombol "Tanya via WhatsApp" (nomor dari `properties.whatsapp_number` lewat data publik yang sudah ada, pesan terisi nama promo) dan "Cek ketersediaan" ke `/book` (hanya tautan, alur /book tidak disentuh). Catatan: "Syarat & ketentuan berlaku, harga final mengikuti sistem."

**Tes:** `scripts/test-promo-content.ts` — tidak ada pola `Rp`/angka harga/persen di `promos.ts`; sitemap memuat `/promo`.

**Risiko:** promo tampil sebagai teks pemasaran, tidak terhubung ke perhitungan harga — sesuai permintaan; tim harus menerapkan potongan manual saat konfirmasi.

## Detail teknis umum

- Komentar kode dalam Bahasa Indonesia, tanpa `any`, named export, file kebab-case.
- Setelah tiap item: typecheck, skrip tes terkait, dan cek tampilan di browser lokal.
- Tidak ada perubahan pada `room_types`, `room_daily_rates`, `properties`, `bookings`, ulasan.
