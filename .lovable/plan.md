# Penutup sopan untuk negosiasi yang tidak berlanjut

## Perubahan
- Tambahkan deteksi khusus untuk pesan negosiasi yang sekaligus menyatakan tidak jadi atau menutup percakapan.
- Balas satu kali secara singkat: tegaskan tarif yang tampil adalah harga terbaik, lalu tutup dengan sopan tanpa menanyakan jumlah tamu atau menawarkan booking lagi.
- Samakan aturan pada Pricing dan Front Office agar respons AI tetap konsisten bila jalur cepat tidak digunakan.
- Tambahkan tes regresi untuk contoh percakapan yang ditemukan di log.

## Teknis
- Perbarui pembuat jawaban FAQ deterministik agar pola seperti “kalau tidak tidak apa-apa, terima kasih” tidak masuk kembali ke alur ketersediaan.
- Pertahankan alur nego yang masih terbuka: bot tetap boleh menawarkan booking atau kamar lebih ekonomis sesuai ketersediaan.
- Jalankan tes terkait dan verifikasi build aplikasi.
