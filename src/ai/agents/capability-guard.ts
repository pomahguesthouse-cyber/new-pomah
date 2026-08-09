/**
 * Guard kapabilitas lintas-agent.
 *
 * Masalah yang diperbaiki (insiden 9 Agu 2026, transcript 6281210853153):
 * hanya Front Office yang memegang `send_room_photos` / `send_room_tour`.
 * Ketika sebuah turn mendarat di agent lain (Pricing / Finance / Customer
 * Care) sementara riwayat percakapan berisi permintaan foto, agent itu tidak
 * melihat tool media di daftar tool-nya lalu MENYIMPULKAN properti tidak punya
 * kemampuan tersebut — "Mohon maaf Kak, untuk saat ini kami belum bisa
 * menampilkan gambar kamar secara langsung." Kalimat itu terkirim beberapa
 * detik setelah Front Office menjawab "Baik Kak, kita kirimkan brosur ya Kak
 * 📸" pada burst yang sama, sehingga tamu menerima dua klaim yang bertentangan.
 *
 * Router sekarang sudah memaksa permintaan media ke Front Office. Blok ini
 * adalah lapis kedua: melarang agent non-Front-Office menyangkal kapabilitas
 * yang sebenarnya DIMILIKI properti, hanya karena tool-nya tidak ada di
 * tangannya sendiri.
 */
export const CAPABILITY_HONESTY_BLOCK =
  "BATAS KAPABILITAS (WAJIB): Kamu hanya memegang sebagian tool tim. Foto kamar, " +
  "brosur, video, dan Virtual Tour 360° TERSEDIA di Pomah Guesthouse dan dikirim " +
  "oleh rekanmu di Front Office. DILARANG KERAS menulis kalimat seperti 'kami belum " +
  "bisa menampilkan gambar/foto/video kamar', 'sistem kami tidak mendukung pengiriman " +
  "foto', atau mengarahkan tamu ke Instagram/website sebagai pengganti. Bila tamu " +
  "meminta foto/brosur/video/tour, jawab bagian yang memang bidangmu lalu tutup " +
  "dengan: 'Untuk foto kamarnya langsung saya kirimkan ya, Kak 📸' — jangan menyangkal, " +
  "jangan menjanjikan tamu harus mencari sendiri. Prinsip yang sama berlaku untuk " +
  "kapabilitas tim lain: kalau kamu tidak memegang tool-nya, JANGAN menyimpulkan " +
  "properti tidak bisa melakukannya.";
