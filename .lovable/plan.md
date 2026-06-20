## Analisis 2 sistem training chatbot

Saat ini ada dua jalur training yang berjalan paralel dan saling tumpang tindih:

### Sistem A — Training Examples (JSONL upload)
- File inti: `src/services/training-examples.service.ts`, `src/admin/functions/chatbot-training.functions.ts`, route `/admin/chatbot-training`
- Tabel: `chatbot_training_examples` (user_message, intent, stage, slot_updates, ideal_assistant_response, is_active)
- Retrieval: **keyword overlap + bonus intent/stage**, tanpa embedding. Ambil ≤500 baris lalu skor di memori, top-3 ke prompt.
- Sumber data: admin upload `.jsonl` manual (curated)
- Dipakai di `wa-autoreply.service.ts` → diinject ke `front-office.agent.ts` sebagai blok "CONTOH PERCAKAPAN BENAR".

### Sistem B — Conversation Log RAG (rating admin)
- File inti: `src/ai/training-rag.service.ts`, `src/admin/modules/training/training.functions.ts`, route `/admin/training`
- Tabel: `ai_conversation_logs` (user_message, ai_response, correction, rating, used, embedding 1536-dim)
- Retrieval: **vector embedding** via RPC `match_training_examples`, threshold 0.78, top-3.
- Sumber data: log percakapan asli yang admin rating `good` / beri `correction`, plus simulator.
- Dipakai (idealnya) sebagai few-shot di agent yang sama.

### Masalah utama
1. **Dua sumber kebenaran terpisah.** Admin harus belajar dua UI (`/admin/training` vs `/admin/chatbot-training`), dua format data, dua proses kurasi.
2. **Retrieval tidak konsisten.** Sistem A pakai keyword overlap (cepat, murah, tapi miss sinonim / typo / parafrase Bahasa Indonesia). Sistem B pakai embedding (akurat tapi butuh API key + RPC + biaya).
3. **Stopword & tokenizer di Sistem A lemah.** List stopword pendek, threshold 0.15 mudah false-positive untuk pesan singkat ("ya", "ok", "berapa"). "saya" muncul dobel di list.
4. **Tidak ada cross-check ke prompt agent.** Bila kedua sistem retrieve contoh berbeda untuk pesan yang sama, agent menerima dua blok few-shot yang bisa kontradiksi (Sistem A "CONTOH PERCAKAPAN BENAR" vs Sistem B "Contoh jawaban yang sudah disetujui admin").
5. **Sinyal kualitas tidak dipakai silang.** Sistem A tidak punya konsep `rating`/`used` runtime — sekali upload, contoh dianggap selalu benar. Sistem B punya `bad`/`correction` tapi negatif example tidak diretrieve sebagai "jangan tiru ini".
6. **Loop training tidak tertutup.** Tidak ada jalan dari "log Sistem B yang sudah di-rate good" → otomatis jadi entry kurasi Sistem A (atau sebaliknya). Admin harus copy-paste.
7. **Skema duplikat berbeda nama.** `TrainingExample` didefinisikan di dua file dengan field berbeda (`ideal_assistant_response` vs `effective_answer`, `stage/intent` vs `similarity`). Mudah keliru saat refactor.
8. **Backfill embedding hanya untuk Sistem B.** `chatbot_training_examples` tidak ikut diindeks, padahal isinya curated dan paling pantas dipakai sebagai gold standard retrieval.

### Saran (urut prioritas)

**P1 — Konsolidasi retrieval di satu pipeline hibrid**
- Tetap pertahankan dua tabel (sumber datanya berbeda: curated JSONL vs runtime log), tapi gabungkan di **satu service retrieval** `findTrainingContext({ userMessage, intent, stage })` yang:
  1. Query embedding ke `chatbot_training_examples` (tambah kolom `embedding` + RPC `match_chatbot_training_examples`).
  2. Query embedding ke `ai_conversation_logs` (sudah ada).
  3. Merge, dedup, re-rank — curated JSONL diberi bobot lebih tinggi (mis. score +0.15) karena sudah ditinjau.
  4. Return max 3 contoh, format ke satu blok prompt saja.
- Jatuhkan keyword overlap sebagai fallback bila API key embedding tidak tersedia.

**P2 — Unified admin UI**
- Satu route `/admin/training` dengan dua tab: **Curated examples (JSONL)** dan **Conversation logs (rating)**.
- Tombol "Promote to curated" di tab logs → insert ke `chatbot_training_examples` dengan `source_file='from-log'`. Tutup loop training.

**P3 — Negative examples**
- Manfaatkan `rating='bad' + correction` sebagai blok "JANGAN menjawab seperti ini, gunakan koreksi: …" di prompt — saat ini tidak diretrieve sama sekali.

**P4 — Bersihkan kode**
- Rename salah satu `TrainingExample` interface (mis. `CuratedTrainingExample` vs `LoggedTrainingExample`) supaya tidak ambigu di import.
- Hapus duplikat `"saya"` di STOPWORDS Sistem A.
- Standarisasi format blok prompt ("## Contoh jawaban …") agar agent tidak melihat dua heading berbeda.

**P5 — Observability**
- Log contoh mana yang akhirnya dipakai (id + score + sumber) di `ai_conversation_logs.metadata` supaya admin bisa audit "kenapa bot menjawab begitu".

### Rekomendasi langsung
Bila ingin minimal effort dengan dampak besar: kerjakan **P1 (hibrid retrieval) + P2 (promote-to-curated)** dulu. Itu menghapus duplikasi terbesar dan menutup loop training. P3–P5 menyusul.

(Plan ini hanya analisis + rekomendasi; tidak ada perubahan kode sampai Anda memilih saran mana yang ingin diimplementasikan.)