# Plan: Training per-percakapan + tombol edit/hapus

## Tujuan
1. Setiap kali admin klik "Simpan Training", seluruh transcript percakapan disimpan sebagai **satu entri** (bukan banyak baris per pasangan), dilengkapi **judul** yang disarankan otomatis dan bisa diedit.
2. Tombol **edit** dan **hapus** di kartu "Training tersimpan" selalu terlihat (sekarang tersembunyi sampai dihover).

## Perubahan

### 1. Skema database (migration)
Tambah kolom ke `ai_conversation_logs`:
- `title text` — judul percakapan (nullable, hanya diisi untuk entri tipe percakapan).
- `transcript jsonb` — array `{direction:'in'|'out', body:string}` untuk percakapan utuh. Nullable agar baris lama tetap valid.

Bersihkan data lama (sesuai pilihan user):
- `DELETE FROM ai_conversation_logs WHERE source = 'simulator'`.

Tidak perlu mengubah `embedding`, `effective_answer`, atau function `match_training_examples` — kolom `user_message` & `ai_response` tetap diisi (sebagai ringkasan flat) supaya RAG pipeline existing tidak break.

### 2. Server functions (`simulator.functions.ts`)

**`saveSimulationAsTraining`** — ubah input + perilaku:
- Input baru: `{ title: string (max 120), transcript: TranscriptMsg[] }` (bukan lagi `pairs[]`).
- Validasi: minimal 1 pesan `in` dan 1 pesan `out`.
- Insert **satu** row:
  - `title` = judul dari admin.
  - `transcript` = array transcript utuh.
  - `user_message` = pesan tamu pertama (untuk kompatibilitas + retrieval).
  - `ai_response` = gabungan jawaban bot (join `\n\n`) — dipakai sebagai `effective_answer` untuk embedding.
  - `source = 'simulator'`, `rating = 'good'`, `used = true`.
- Embed seperti sebelumnya (best-effort).

**`updateSimulatorTraining`** — perluas input:
- Tambah field `title?: string` dan `transcript?: TranscriptMsg[]`.
- Saat transcript diupdate, regenerate `user_message` (pesan tamu pertama) & `ai_response` (gabungan jawaban bot) lalu re-embed.

**`listSimulatorTraining`** — tambahkan `title` & `transcript` ke select.

**`exportSimulatorTraining`** — tambahkan `title` & `transcript` ke select.

**Baru: `suggestTrainingTitle`** — server function kecil:
- Input: `{ transcript: TranscriptMsg[] }`.
- Panggil LLM (pakai `buildEnv` yang sudah ada) dengan prompt singkat: "Beri judul ≤60 karakter dalam Bahasa Indonesia untuk percakapan berikut, hanya kembalikan judul tanpa tanda kutip."
- Fallback bila LLM gagal: ambil 60 karakter pertama dari pesan tamu pertama.

### 3. UI `chat-simulator-view.tsx`

**Dialog "Simpan Training"** (sekarang menampilkan list pasangan):
- Ganti jadi form satu percakapan:
  - Field **Judul** di atas, otomatis terisi via `suggestTrainingTitle` saat dialog dibuka (loading state kecil), bisa diedit admin.
  - Preview transcript utuh (urut, gelembung tamu kanan / bot kiri) — read-only, scrollable.
  - Tombol "Simpan Training" memanggil `saveSimulationAsTraining({ title, transcript })`.

**Kartu "Training tersimpan"**:
- Tiap item menampilkan: **judul** (bold), tanggal kecil, preview 1-2 baris pesan tamu pertama, badge jumlah turn (mis. "6 pesan").
- Klik item → buka dialog detail/edit (lihat di bawah).
- **Tombol edit & hapus selalu terlihat** (hilangkan `opacity-0 group-hover:opacity-100`, ganti dengan styling tombol biasa di kanan).

**Dialog Edit Training** — rombak:
- Field **Judul** (input).
- List transcript editable: tiap pesan bisa diedit isinya (textarea kecil per turn), bisa hapus turn, bisa tambah turn baru (tombol "+ Tamu" / "+ Bot").
- Tombol Simpan → panggil `updateSimulatorTraining({ id, title, transcript })`.

### 4. Hal yang TIDAK diubah
- Pipeline RAG retrieval (`retrieveTrainingExamples` & `match_training_examples`) tetap apa adanya — karena `user_message` + `ai_response` masih diisi.
- Halaman konfigurasi RAG, smart-delay, SOP — tidak disentuh.
- Booking state machine — tidak disentuh.

## Catatan teknis
- `transcript` jsonb divalidasi via Zod di server.
- Judul auto-suggest pakai model yang sama dengan orchestrator (`env.model`), prompt pendek supaya murah.
- Export JSON akan menyertakan `title` & `transcript`; CSV menambahkan kolom `title` (transcript tetap hanya di JSON karena terlalu nested untuk CSV).
