# Plan: Training simulator dipakai chatbot

## Tujuan
Setiap pasangan `user_message → ai_response` (atau `correction` bila admin mengedit) yang disimpan dari simulator dengan `rating="good"` harus ikut diretrieve saat chatbot menyusun jawaban, sehingga koreksi admin benar-benar memengaruhi perilaku bot.

## Pendekatan
Pakai **RAG di atas `ai_conversation_logs`** — sejalan dengan infrastruktur `sop_chunks` + pgvector yang sudah ada. Tidak fine-tuning, tidak ganti model. Contoh yang sudah diembed di-retrieve top-K dan diinjeksi ke system prompt agent sebagai "Contoh jawaban yang disetujui admin".

## Langkah

### 1. Skema database (migration)
- Tambah kolom `embedding vector(3072)` ke `ai_conversation_logs`.
- Tambah kolom `effective_answer text generated always as (coalesce(correction, ai_response)) stored` — jawaban final yang dipakai (koreksi menang atas jawaban asli).
- Index HNSW `vector_cosine_ops` pada `embedding`.
- Function `match_training_examples(query_embedding vector(3072), match_count int, min_similarity float)` yang hanya mengembalikan baris dengan `rating='good'` dan `used=true`.
- GRANT execute ke `authenticated` dan `service_role`.

### 2. Embedding pipeline (server-side)
- Helper baru `src/ai/training-rag.service.ts`:
  - `embedTrainingExample(logId)` — panggil Lovable AI `google/gemini-embedding-001` atas teks `"User: ... \nAssistant: <effective_answer>"`, simpan ke kolom `embedding`.
  - `retrieveTrainingExamples(query, k=3, minSim=0.78)` — embed pesan tamu, panggil `match_training_examples`, return top-K.
- Trigger embedding di dua titik:
  - `saveSimulationAsTraining` (di `simulator.functions.ts`) — setelah insert, embed baris yang baru.
  - `setTrainingRating` / `updateTrainingExample` (di `training.functions.ts`) — re-embed bila `correction` atau `ai_response` berubah, atau bila status berubah jadi `good`.
- Backfill: server function admin-only `backfillTrainingEmbeddings` (batch 20) untuk meng-embed baris lama.

### 3. Integrasi ke orchestrator
- Di `src/ai/multi-agent-orchestrator.ts` (atau context-builder yang dipakai agent jawaban umum), sebelum panggil LLM:
  - Ambil pesan terakhir user.
  - Panggil `retrieveTrainingExamples` (skip bila < min_similarity).
  - Inject blok ke system prompt:
    ```
    Contoh jawaban yang sudah disetujui admin (pakai sebagai panduan gaya & isi):
    Q: ...
    A: ...
    ```
  - Batasi total ≤ ~1500 token agar tidak menggeser sopText.
- Pakai retrieval ini hanya untuk agent percakapan umum / FAQ. **Skip** untuk booking state machine (jawaban di sana harus deterministik dari state).

### 4. UI feedback di AI Lab
- Di `chat-simulator-view.tsx`, tampilkan badge kecil di balon jawaban bot: "Pakai N contoh training" bila retrieval aktif, dengan tooltip berisi ID contoh yang dipakai (untuk debugging).
- Tambah indikator status embedding di halaman `/admin/training` (kolom: "Indexed" / "Pending").

### 5. Verifikasi
- Simulasikan: simpan koreksi di simulator → reset percakapan → kirim pertanyaan serupa → cek jawaban mengikuti koreksi.
- Cek log `toolsUsed` / response agent menyertakan ID contoh yang di-retrieve.

## Catatan teknis
- Model embedding: `google/gemini-embedding-001` (3072 dim) — sama family dengan yang sudah ada di proyek, simpel disetujui.
- Dimensi harus konsisten dengan `sop_chunks` bila ingin pakai satu function; sebaiknya tetap pisah tabel agar bisa filter `rating='good'` tanpa polusi SOP.
- Token budget: kirim ringkasan `effective_answer` (truncate ke ~600 char per contoh) supaya prompt tidak meledak.
- Privasi: `user_message` dari WhatsApp bisa berisi PII; pastikan retrieval hanya jalan server-side dan tidak dikirim ke klien selain ID.

## Yang tidak dikerjakan di plan ini
- Tidak fine-tuning model.
- Tidak mengubah cara `sop_documents` / `sop_chunks` di-retrieve.
- Tidak mengubah booking state machine.
