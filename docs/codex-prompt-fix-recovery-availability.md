# Codex Prompt — Perbaiki balasan bertele-tele saat tamu kirim pesan beruntun (recovery mode) & pertanyaan availability tanpa tanggal

Salin seluruh blok di bawah ini ke Codex (agen sudah punya akses ke repo `new-pomah`).

---

## Tugas

Perbaiki perilaku chatbot WhatsApp (Pomah Guesthouse) yang gagal menjawab pertanyaan tamu secara langsung ketika tamu mengirim beberapa pesan beruntun. Balasan saat ini terasa bertele-tele, mengulang sapaan/perkenalan, dan seperti tidak menjawab pertanyaan.

## Reproduksi (kasus nyata dari simulator)

Tamu mengirim 5 pesan masuk berturut-turut tanpa dijawab:

```
1. "Halo"
2. "apakah masih available untuk guesthouse?"
3. "saya dapat ditiktok"
4. "apakah masih available untuk guesthouse?"
5. "saya dapat ditiktok"
```

Balasan bot sekarang (intent terklasifikasi = `general`):

```
Maaf Kak, saya bantu lanjutkan ya.
Halo Kak, dengan Rani dari Pomah Guesthouse. Ada yang bisa Rani bantu?

Untuk ketersediaan kamar, boleh tahu untuk tanggal berapa Kak rencana menginap, dan sampai tanggal berapa? 📅
```

Masalahnya:
- Diawali preamble recovery "Maaf Kak, saya bantu lanjutkan ya." + perkenalan ulang "Halo Kak, dengan Rani… Ada yang bisa Rani bantu?" → bertele-tele dan terasa mengabaikan pertanyaan.
- Pertanyaan inti tamu jelas: "apakah masih available?" → seharusnya bot ringkas menjawab dengan menanyakan tanggal (mis. "Boleh tahu untuk tanggal berapa, Kak?"), bukan memperkenalkan diri lagi.

Perilaku yang diinginkan (ringkas & langsung), kira-kira:

```
Halo Kak 😊 Untuk cek ketersediaan, boleh tahu rencana menginap tanggal berapa sampai tanggal berapa ya, Kak? 📅
```

(Boleh akui singkat bila ada beberapa pesan, tapi JANGAN memperkenalkan diri ulang atau menambahkan "Ada yang bisa Rani bantu?" yang redundan ketika kebutuhan tamu sudah jelas.)

## Akar masalah (sudah ditelusuri)

1. Recovery mode memaksa preamble kaku.
   File: `src/ai/multi-agent-orchestrator.ts` (sekitar baris 294–302).
   Saat `agentCtx.recoveryMode` true, system prompt menambahkan instruksi WAJIB:
   `Anda WAJIB memulai jawaban Anda dengan sapaan recovery: "Maaf Kak, saya bantu lanjutkan ya..." atau sejenisnya, lalu jawab semua poin...`
   Ini yang memunculkan preamble bertele-tele + re-greeting.

2. Recovery mode dipicu oleh burst pesan.
   File: `src/services/wa-autoreply.service.ts` (sekitar baris 1570–1573).
   `recoveryMode = consecutiveInbound >= 3`. Lima pesan tamu memicunya.

3. Klasifikasi intent memakai pesan TERAKHIR ("saya dapat ditiktok" = noise), bukan pertanyaan availability yang sebenarnya, sehingga intent jatuh ke `general`.
   File: `src/ai/multi-agent-orchestrator.ts` (cari `lastUserMsg` / `queryForClassifier` / pemanggilan `classifyIntent`).
   File classifier: `src/ai/router/intent-classifier.ts` (kategori `availability_check` punya pola `available`, harusnya cocok bila yang diklasifikasi pesan availability).

## Yang harus dikerjakan

### A. Lembutkan instruksi recovery mode (utama)
Di `src/ai/multi-agent-orchestrator.ts` blok `if (agentCtx.recoveryMode)`:
- Hapus paksaan preamble verbatim "Maaf Kak, saya bantu lanjutkan ya…".
- Ganti dengan instruksi agar agen menjawab pertanyaan inti secara LANGSUNG, RINGKAS, dan terpadu dalam satu balasan; boleh mengakui singkat bahwa ada beberapa pesan HANYA bila perlu, tanpa memperkenalkan diri ulang dan tanpa menambahkan "Ada yang bisa Rani bantu?".
- Pastikan tetap konsisten dengan aturan persona Front Office (lihat `src/ai/agents/front-office.agent.ts`): larangan sapaan waktu, anti-pengulangan sapaan (sapaan pembuka hanya di turn pertama), gaya WhatsApp teks polos.

### B. Availability tanpa tanggal harus dijawab ringkas
Pastikan ketika tamu menanyakan ketersediaan TANPA menyebut tanggal, balasan langsung menanyakan tanggal menginap (check-in–check-out) secara singkat, tanpa boilerplate perkenalan. Selaraskan dengan aturan tanggal di `front-office.agent.ts` (jangan memanggil tool `check_room_availability` sebelum tanggal eksplisit).

### C. Klasifikasi intent pada burst (sekunder, kalau memungkinkan tanpa regresi)
Saat `recoveryMode` aktif (beberapa pesan belum terjawab), klasifikasikan intent dari GABUNGAN pesan yang belum terjawab (`unansweredMessages`) atau pilih pesan paling substantif — bukan hanya pesan terakhir. Tujuannya agar contoh seperti ini terklasifikasi `availability_check`, bukan `general`. Pastikan tidak mengubah perilaku jalur normal (pesan tunggal).

### D. Tangani pesan noise dengan anggun
Pesan seperti "saya dapat ditiktok" (tamu menemukan kami di TikTok) tidak boleh membuat bot bingung atau mengabaikan pertanyaan utama. Cukup diakui sekilas (opsional) lalu fokus menjawab availability.

## Batasan (jangan dilanggar)

- Pertahankan kontrak output JSON balasan: `{"reply": "..."}` (lihat instruksi di orchestrator setelah blok recovery). Jangan ubah ini.
- Jangan rusak alur booking state-machine / `pendingBookingSlots` (blok recovery dipakai juga saat pengisian data booking).
- Patuhi aturan Front Office: tanpa sapaan waktu ("selamat pagi/siang/…"), sapaan pembuka hanya di turn pertama, gaya WhatsApp teks polos (tanpa markdown `*_#`).
- Balasan harus ringkas (konteks WhatsApp). Hindari perkenalan ulang & kalimat redundan.
- Jangan menyentuh jalur deterministik availability/harga; fokus pada jalur agen-LLM & recovery.

## Verifikasi

1. Jalankan `bun run typecheck` (atau `npm run typecheck`) — harus bersih.
2. Uji ulang skenario 5 pesan beruntun di atas (boleh via simulator AI Lab / unit test): balasan harus ringkas, langsung menanyakan tanggal untuk cek ketersediaan, TANPA preamble "Maaf Kak, saya bantu lanjutkan ya…" dan TANPA perkenalan ulang/"Ada yang bisa Rani bantu?".
3. Pastikan jalur normal tetap baik:
   - Pesan tunggal "apakah masih available?" → tetap menanyakan tanggal dengan ringkas.
   - Alur booking yang sedang berjalan (recovery saat pengisian data) tetap mengarahkan tamu melanjutkan pengisian.
4. Tunjukkan diff akhir dan ringkas perubahan per file.

## Catatan
Tujuan akhir: nada balasan sekonkret contoh nyata admin ("untuk kapan kak") — langsung, ramah, tidak bertele-tele — sambil tetap mematuhi persona dan kontrak teknis di atas.
