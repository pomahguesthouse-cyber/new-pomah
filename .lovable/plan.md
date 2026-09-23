# Hemat token WhatsApp autoreply

## Perubahan
1. Tambahkan penanda eksplisit bahwa retrieval training sudah dicoba di autoreply, termasuk ketika hasilnya kosong atau gagal, lalu cegah orchestrator mengulang embedding.
2. Persempit fallback intent berbasis AI: pesan pendek, salam, terima kasih, emoji, lampiran tanpa teks, dan hasil rule yang kuat tetap deterministik; perluas rule untuk FAQ umum yang jelas.
3. Pisahkan gate SOP dari training dan lewati embedding SOP untuk salam, terima kasih, emoji-only, serta media-only.
4. Buat prompt Front Office khusus `general`/FAQ ringan yang hanya membawa identitas, hard guard penting, FAQ relevan, konteks dinamis, dan instruksi AI Lab; alur booking, availability, payment, serta finance tetap memakai prompt lengkap yang sesuai.

## Verifikasi
- Tambahkan regresi untuk keputusan fallback intent, gate retrieval, flag anti-double-retrieval, dan ukuran/isi prompt general.
- Jalankan tes terkait, pemeriksaan TypeScript, linter terarah, dan cek hasil build otomatis.

## Batasan
Tidak mengubah harga, proses booking produksi, jumlah maksimum turn, model summary, atau secret.
