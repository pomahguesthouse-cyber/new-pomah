Ringkasan: Halaman beranda membutuhkan 5,8 detik sebelum konten pertama muncul (FCP) dan 7,7 detik untuk muat penuh. TTFB mencapai 4 detik. Database menunjukkan 743.182 transaksi rollback dan 634.000+ panggilan webhook/WA yang memakan 23 menit total eksekusi. Plan ini menargetkan backend, bundle frontend, dan rendering secara berurutan.

Hasil analisis performa saat ini
--------------------------------

TTFB:        4.041 ms (sangat lambat — server membutuhkan 4 detik untuk merespons)
FCP:         5.880 ms (pengunjung melihat layar kosong selama 6 detik)
Full Load:   7.762 ms
DOM Nodes:   4.158 (cukup berat)
JS Scripts:  220 file, total 2,4 MB

Resource paling lambat:
  - recharts.js          220 KB   1.380 ms
  - lucide-react.js      179 KB   1.142 ms
  - react-dom_client.js  166 KB   1.375 ms
  - admin/seo.tsx        116 KB   1.335 ms  (file admin di-load di halaman publik)
  - Hero image (Storage)          1.489 ms

Database:
  - net.http_post  dipanggil 633.965 kali = 1.392.449 ms total (~23 menit)
  - Transaksi rollback: 743.182 kali
  - Memori database: 69%
  - Query booking dengan nested JSON aggregation lambat

1. Percepat respons server (TTFB) — dampak terbesar
----------------------------------------------------
TTFB 4 detik adalah masalah utama. Pengunjung menunggu server sebelum browser bisa mulai merender apa pun.

1a. Optimasi `getPublicSiteData`
  - Saat ini `getPublicSiteData` memanggil `supabasePublic.rpc("get_public_property")` dan `room_types.select(...)` secara parallel.
  - Query `room_types` menggunakan `.select("..., rooms(id)")` — nested select ini bisa jadi N+1 jika Supabase tidak mengoptimalkannya.
  - Ganti nested select dengan `count` exact atau pindahkan perhitungan `total_physical_rooms` ke RPC/function database.
  - Tambahkan `staleTime` lebih agresif pada loader router (bukan hanya pada `useQuery`).

1b. Cache SSR dengan `staleTime` + `preloadStaleTime`
  - Di `src/router.tsx`, `defaultPreloadStaleTime: 0` membuat setiap navigasi memaksa refetch.
  - Naikkan ke `30_000` (30 detik) untuk data publik yang jarang berubah.
  - Di route `/`, naikkan `staleTime` dari `5 * 60 * 1000` ke `60 * 60 * 1000` (1 jam) karena property data & room types sangat jarang berubah.

1c. Reduksi query WhatsApp/Webhook
  - `net.http_post` dipanggil hampir 634.000 kali — ini menandakan cron job atau queue worker berjalan terlalu sering / tidak efisien.
  - Kurangi frekuensi cron `process-wa-queue` dan `booking-stuck-monitor` jika intervalnya terlalu rapat.
  - Pastikan queue worker memakai batching, bukan satu per satu.

2. Kurangi ukuran JavaScript bundle — frontend
-------------------------------------------------
2a. Split `index.tsx` (2.615 baris) menjadi komponen lazy
  - `index.tsx` memiliki 2.615 baris kode. Semua section (Hero, Testimoni, Fasilitas, Explore, Booking Dialog, dll) di-render sekaligus.
  - Pindahkan section below-the-fold (testimonials, explore, facilities, rooms list) ke file komponen terpisah dengan `React.lazy()` atau `.lazy.tsx` route splitting.
  - Gunakan `React.Suspense` dengan fallback skeleton ringan.

2b. Hapus import langsung `rooms.$slug.tsx` dari `index.tsx`
  - Baris 55: `import { BookingDialog, ... } from "@/routes/rooms.$slug"`
  - Ini menarik seluruh file `rooms.$slug.tsx` (39.657 baris) ke dalam bundle beranda.
  - Duplikat atau pindahkan `BookingDialog` ke `src/public/components/` agar bisa di-import tanpa menarik route lain.

2c. Pisahkan `recharts` dari bundle publik
  - `recharts.js` (220 KB) di-load di halaman publik. Library chart ini seharusnya hanya digunakan di halaman admin (analytics, SEO).
  - Jika `src/components/ui/chart.tsx` di-import oleh komponen publik, ganti dengan dynamic import atau pindahkan komponen chart ke `src/admin/components/`.

2d. Optimasi `lucide-react`
  - File lucide-react 179 KB. Meskipun Vite melakukan tree-shaking, import 39+ icon dari root package bisa memaksa bundler menyertakan banyak modul.
  - Konfirmasi build production menggunakan `lucide-react` tree-shaking. Di development profil tetap besar, tapi di production seharusnya lebih kecil.
  - Alternatif: gunakan `@lucide/lab` atau import per-icon (`lucide-react/dist/esm/icons/wifi`).

2e. Hapus admin/seo.tsx dari chunk publik
  - File `admin/seo.tsx` (116 KB) terlihat di network halaman publik.
  - Periksa apakah ada import chain dari komponen publik ke admin module (misalnya `mergeHomepageConfig`, `listActivePublicEvents`, dll yang mungkin menarik modul admin).
  - Pindahkan fungsi/util yang dibutuhkan publik ke `src/public/` atau `src/lib/` agar tidak menarik seluruh file admin.

3. Optimasi gambar dan aset
----------------------------
3a. Hero image preload sudah ada — pertahankan
  - `head()` route sudah menambahkan `<link rel="preload" as="image">` untuk hero slide pertama.
  - Tetapi image dari Supabase Storage membutuhkan 1.489 ms. Pertimbangkan:
    - Gunakan CDN atau image transformer (Cloudflare Images) untuk resize otomatis.
    - Kompresi WebP/AVIF untuk hero image.
    - Jika ukuran file besar, pertimbangkan lazy-loading slide ke-2 dan seterusnya.

3b. Lazy-load gambar di bawah fold
  - Semua gambar room types, explore items, dan testimonial seharusnya memakai `loading="lazy"`.
  - Tambahkan `decoding="async"` pada `<img>` untuk menghindari blocking main thread.

3c. Google Reviews script
  - Script Google Reviews di-inject via `document.createElement("script")` di useEffect.
  - Pindahkan ke `async`/`defer` script tag di `head()` route, atau tunda inisialisasi sampai after interactive.

4. Optimasi database — kurangi rollback & webhook
---------------------------------------------------
4a. Index untuk query booking
  - Query booking dengan `LEFT JOIN LATERAL` + `json_agg` membutuhkan 5-27 ms rata-rata (total 30-33 detik).
  - Pastikan index ada pada: `bookings.status`, `bookings.check_in`, `bookings.check_out`, `booking_rooms.booking_id`, `booking_rooms.room_id`.
  - Jika query ini hanya untuk kalender/dashboard, pertimbangkan materialized view atau cache Redis/Lovable Cloud.

4b. Batch webhook calls
  - 634.000 panggilan `net.http_post` menandakan setiap notifikasi dikirim satu per satu.
  - Implementasi batch: kumpulkan notifikasi selama X detik, lalu kirim sekali.
  - Gunakan `pg_cron` dengan interval lebih jarang jika real-time tidak kritikal.

4c. Kurangi transaksi rollback
  - 743.182 rollback sejak boot menandakan banyak query gagal (timeout, constraint violation, atau deadlock).
  - Periksa log query untuk error berulang. Tambahkan timeout dan retry dengan exponential backoff.

5. Code splitting konkret — file target
-----------------------------------------
File yang perlu diubah:

  - `src/routes/index.tsx`       → pecah jadi `HomeHero.tsx`, `HomeRooms.tsx`, `HomeTestimonials.tsx`, `HomeExplore.tsx`, `HomeFacilities.tsx`, `HomeBookingDialog.tsx`
  - `src/routes/index.tsx`       → hapus `import { BookingDialog } from "@/routes/rooms.$slug"`
  - `src/public/components/`     → tambahkan `BookingDialog.tsx` (duplikat/ekstrak dari rooms.$slug)
  - `src/components/ui/chart.tsx` → pindahkan ke `src/admin/components/` atau gunakan dynamic import
  - `src/router.tsx`             → ubah `defaultPreloadStaleTime: 0` jadi `30_000`
  - `src/routes/index.tsx`       → `staleTime: 5 * 60 * 1000` jadi `60 * 60 * 1000`
  - `src/routes/index.tsx`       → tambahkan `loading="lazy"` dan `decoding="async"` pada semua `<img>` below-fold

Urutan implementasi yang direkomendasikan
------------------------------------------
1. Langkah 1a + 1b — optimasi loader & cache SSR (paling cepat implementasi, dampak besar pada TTFB)
2. Langkah 2b — hapus import `rooms.$slug` dari `index.tsx` (mengurangi bundle size signifikan)
3. Langkah 2c — pisahkan recharts dari publik (mengurangi 220 KB)
4. Langkah 5 — pecah `index.tsx` jadi komponen lazy (mengurangi initial JS parse & DOM)
5. Langkah 3 — optimasi gambar & lazy loading (dampak visual pada FCP/LCP)
6. Langkah 4 — optimasi database & webhook (memperbaiki backend secara menyeluruh)