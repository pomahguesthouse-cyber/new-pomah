/**
 * Default kebijakan hotel untuk ditampilkan saat properti belum
 * mengisi `hotel_policy` di pengaturan. Dipisah ke modul kecil
 * sendiri agar route publik bisa meng-import constant ini tanpa
 * menarik seluruh bundle `rooms.$slug.tsx` (yang berukuran besar)
 * — yang berdampak signifikan pada ukuran initial bundle homepage.
 */
export const DEFAULT_HOTEL_POLICY = [
  "Tidak diperbolehkan membawa makanan/buah berbau menyengat seperti durian",
  "Tidak diperbolehkan mengkonsumsi alkohol di penginapan ini",
  "Tidak diperbolehkan melakukan pesta",
  "Tidak boleh merokok di dalam kamar",
  "Area merokok pada lokasi tertentu seperti balkon dan lobby lantai 2",
].join("\n");
