# Analisa Percakapan Chatbot WhatsApp — Pomah Guesthouse

**Tanggal analisa:** 23 Juli 2026
**Sumber:** Panel admin `/admin/whatsapp` (Inbox 344 percakapan) + verifikasi silang ke source code.
**Fokus:** kualitas jawaban AI, kelancaran alur booking, konversi & customer service.

---

## Ringkasan eksekutif

Chatbot "Rani" sudah menangani mayoritas percakapan secara otomatis (hampir semua thread bertag **AI Auto**) dan untuk pertanyaan sederhana (harga, ketersediaan, lokasi, fasilitas) jawabannya rapi dan sopan. Namun ada **beberapa kegagalan berulang yang langsung memukul konversi**, terutama saat percakapan masuk tahap serius: booking, DP, survei, dan tamu yang datang kembali.

Tiga masalah paling kritis:

1. **Bot tidak mengenali booking yang sudah ada** — tamu yang sudah DP diperlakukan seperti tamu baru, dan harga di-quote ulang lebih tinggi.
2. **Fallback "sistem sibuk / sistem lambat" muncul terlalu sering** justru di momen krusial (mau pesan, tanya jam check-in, atur survei).
3. **Error teknis mentah bocor ke tamu** (pesan error database ditampilkan apa adanya).

---

## A. Kualitas jawaban AI

### A1. Harga tidak konsisten & tidak "dikunci" saat booking — **KRITIS**
Contoh nyata (thread **Naura Artanti**, 6281215572927):
- 27 Jun: untuk 7–8 Agustus 2026, Deluxe di-quote **Rp300.000/malam**, tamu memesan Single + 2 Deluxe dan **sudah DP** (booking Deluxe 206 & GD II).
- 23 Jul: tamu kembali, bot meng-quote Deluxe **Rp400.000/malam** dan berkata *"harga kamar Deluxe adalah Rp400.000 per malam"* — padahal tamu sudah bayar DP di harga 300k.
- Panel Tamu menampilkan **"No booking on file"** dan **"No guest profile linked"** — bot benar-benar tidak melihat booking yang sudah dibuat.

Dampak: tamu merasa harga dinaikkan sepihak setelah bayar DP → risiko batal + komplain. Ini menggabungkan dua bug: (a) booking tidak ter-link ke nomor/thread, (b) tidak ada konsep **harga terkunci** (`booked_price`) yang dihormati bot. Verifikasi kode: tidak ada field `booked_price`/`agreed_price`/`locked_price` di schema — bot selalu quote harga dinamis terbaru.

### A2. Loop "kirim brosur" & tidak bisa kirim foto kamar spesifik
Saat Naura minta *"foto kamar deluxe no 206 & GD II"* (kamar yang ia survei), bot berulang kali membalas template generik *"Baik Kak, kita kirimkan brosur ya 📸 / cek Instagram @pomahguesthouse"* dan mengabaikan permintaan unit spesifik (*"yg kamar deluxe 206 mana kak?"* tidak terjawab). Tool `Room - Kirim Foto ke WA Tamu` hanya kirim foto per **tipe**, bukan per **unit**.

### A3. Identitas/persona tidak konsisten
"Rani" muncul sebagai Front Office Agent, **Pricing Specialist**, dan **tim Finance & Pembayaran** dalam thread yang sama; di thread lain memakai nama **"Hana"**. Ada juga kebingungan identitas nyata: satu tamu ditegaskan *"kami tidak memiliki karyawan bernama Lubna Medina Alaydrus"*, dan tamu lain menulis *"Tapi mba nya Rani kan cewek"*. Perlu satu persona konsisten.

### A4. Bot membalas spam, vendor, dan OTA
Banyak thread AI Auto ke non-tamu: penawaran kredit, "BERAS JAYA", "Le Mineral", "GuestPedia", "Adit Red Doorz Semarang", "WhatsApp Business", sales. Bot menjawab sopan tapi ini buang resource, dan berisiko membocorkan info/promosi ke kompetitor (Red Doorz). Perlu filter/whitelist intent tamu vs non-tamu.

### A5. Tamu minta AI dimatikan
Thread **itsnadzakia**: *"AI nya tolong dimatiin dulu aja kak"*. Sinyal frustrasi + kebutuhan handoff ke manusia yang mulus (bukan sekadar tombol "Kembalikan ke AI" di sisi admin).

---

## B. Alur booking

### B1. Fallback "sistem sibuk / sistem lambat" di momen krusial — **KRITIS**
Di thread Naura, pertanyaan penting berturut-turut gagal dijawab dan dibalas fallback:
- *"check in check out jam berapa?"* → "sistem sedang sibuk…"
- *"besok bisa survei dulu?"* / *"jam 9 bisa survey kak?"* → "sistem sedang sibuk…"
- *"saya mau pesan single + 2 deluxe"* → sempat kena fallback.

Verifikasi kode: string ada di `src/services/wa-autoreply/runtime-policy.ts` (*"Maaf Kak, sistem sedang lambat… ketik 'lanjut'"*) dan `wa-autoreply.service.ts`. Ini fallback timeout — artinya agent LLM/tool **sering timeout** saat butuh beberapa tool call (cek ketersediaan + spesifikasi + simpan). Frekuensinya tinggi (muncul di banyak thread: Bila, Qinthara, Yani, iiim, dst). Setiap kemunculannya = potensi booking hilang.

### B2. Error database mentah bocor ke tamu — **KRITIS**
Thread **sen**: bot mengirim ke tamu:
> *"Gagal menyimpan data tamu: duplicate key value violates unique constraint…"*

Verifikasi kode: `src/tools/booking.tool.ts:516` melakukan `INSERT` ke tabel `guests` lalu mengembalikan `gErr.message` mentah ke tamu. Karena `phone` unik, tamu berulang (repeat guest) memicu duplicate-key. Seharusnya **upsert / cari-guest-existing**, dan pesan error di-sanitasi jadi bahasa ramah.

### B3. Booking flow rapuh untuk grup besar / multi-kamar
Banyak permintaan 4–10 orang. Bot menyarankan kombinasi kamar (baru diperbaiki — lihat commit `refine-wa-chatbot-room-combination-suggestions`), tapi saat eksekusi booking kombinasi, muncul error B2. Alur multi-kamar perlu diuji end-to-end.

### B4. Survei kamar belum ditangani
Permintaan survei ("besok bisa survei?", "jam 9 bisa?") tidak punya alur jelas — bot bertanya tipe kamar lalu kena fallback. Padahal survei = calon tamu serius (high intent). Butuh alur penjadwalan survei + eskalasi ke Front Office.

### B5. Timeout menyimpan draft lalu minta ketik "lanjut"
Pola *"Data terakhir sudah saya simpan. Ketik 'lanjut'"* membebani tamu untuk melanjutkan sendiri; banyak tamu tidak membalas → drop-off.

---

## C. Konversi & Customer Service

### C1. Banyak thread berakhir di "kamar penuh" tanpa alternatif kuat
Puluhan thread (7–8 Agustus & 17–18 Juli sangat sering penuh) berakhir *"semua tipe kamar sudah penuh, terima kasih"*. Sebagian menawarkan tanggal lain, tapi tidak konsisten. Peluang: **waitlist otomatis** + tawaran tanggal terdekat yang tersedia secara proaktif.

### C2. Tidak ada dorongan closing yang konsisten
Beberapa jawaban bagus (*"Mau langsung saya proses bookingnya?"*), tapi banyak yang berhenti di info harga lalu *"ada lagi yang bisa dibantu?"* tanpa call-to-action booking. Perlu CTA closing standar setelah quote harga.

### C3. Follow-up manual, tidak otomatis
Thread **GuestPedia**/**'D'lost** menunjukkan follow-up ("Rani tunggu kabar baiknya") tapi tidak ada nurture otomatis untuk tamu yang menggantung (sudah tanya harga, belum booking). Peluang reminder terjadwal.

### C4. Konteks percakapan tidak terisi
Panel **Context Summary** untuk thread aktif kosong semua (Tipe Kamar —, Topik —, Status Booking —, Check-in —, dst) walau percakapan panjang. Slot extraction tidak jalan/terlambat → admin manusia yang mengambil alih tidak dapat konteks cepat.

### C5. Handoff ke manusia belum mulus
Tombol "Kembalikan ke AI" ada, tapi tidak terlihat sinyal jelas kapan bot **otomatis** menyerahkan ke manusia (mis. saat tamu sudah DP, minta survei, komplain harga, atau minta "matiin AI"). `frustration-detector.ts` sudah ada — perlu dipastikan memicu eskalasi pada kasus-kasus ini.

---

## Prioritas perbaikan

| # | Masalah | Area | Prioritas | Aksi ringkas |
|---|---------|------|-----------|--------------|
| 1 | Booking existing tidak dikenali + harga di-quote ulang lebih tinggi | AI/Booking | **P0** | Link booking ke nomor/thread; simpan & hormati `booked_price`; tampilkan booking aktif di konteks bot |
| 2 | Fallback "sistem sibuk/lambat" terlalu sering di momen krusial | Booking | **P0** | Investigasi timeout tool/LLM (queue & pg_net); naikkan batas/optimasi; kurangi jumlah tool call per giliran |
| 3 | Error DB mentah bocor ke tamu ("duplicate key…") | Booking | **P0** | Ubah `booking.tool.ts` insert guest → upsert by phone; sanitasi semua pesan error |
| 4 | Bot balas spam/OTA/vendor (mis. Red Doorz) | AI | **P1** | Deteksi intent non-tamu → jangan auto-reply / eskalasi diam |
| 5 | Loop "kirim brosur", tak bisa kirim foto unit spesifik | AI | **P1** | Dukung kirim foto per unit; jangan ulang template sama 2x |
| 6 | Handoff ke manusia belum mulus (DP, survei, komplain, "matiin AI") | CS | **P1** | Auto-eskalasi via `frustration-detector` + notifikasi admin |
| 7 | Persona/nama tidak konsisten (Rani vs Hana; jabatan berubah) | AI | **P1** | Kunci satu persona + satu jabatan |
| 8 | Alur survei kamar belum ada | Booking/CS | **P1** | Buat alur jadwal survei + eskalasi Front Office |
| 9 | Context Summary kosong | CS | **P2** | Perbaiki slot extraction realtime |
| 10 | "Kamar penuh" tanpa alternatif/waitlist; CTA closing lemah | Konversi | **P2** | Tawarkan tanggal terdekat + waitlist otomatis; CTA booking standar |
| 11 | Tidak ada follow-up otomatis untuk lead menggantung | Konversi | **P2** | Reminder terjadwal untuk tamu yang tanya harga tapi belum booking |

---

## Catatan verifikasi

Temuan booking (#1, #2, #3) dikonfirmasi langsung di source code:
- `src/tools/booking.tool.ts:508–518` — insert guest tanpa upsert, error mentah dikembalikan.
- `src/services/wa-autoreply/runtime-policy.ts` & `wa-autoreply.service.ts:657` — fallback "sistem sibuk/lambat".
- Tidak ditemukan field harga terkunci (`booked_price`/`agreed_price`) di schema Supabase.

Temuan kualitas & konversi berdasarkan pembacaan Inbox (344 thread) dan satu thread mendalam (Naura Artanti). Untuk kuantifikasi (mis. % thread yang kena fallback, % berakhir "penuh", conversion rate), disarankan query langsung ke tabel `whatsapp_messages`/`conversation_alerts` — sandbox saat ini diblokir dari Supabase, jadi angka pastinya belum dihitung.

---

## Update implementasi (23 Juli 2026)

### ✅ P0 #3 — error DB bocor + profil tamu duplikat (SELESAI, code)
`src/tools/booking.tool.ts`: insert guest diganti **reuse profil by phone** (`phoneVariants` di util baru `src/lib/phone.ts`), pesan error DB mentah diganti kalimat ramah, race unique-constraint di-recover, dan rollback dijaga (`guestWasCreated`) agar tak pernah cascade-delete booking lama tamu berulang.

### ✅ P0 #1 (separuh) — bot kini "melihat" booking aktif & harga terkunci (SELESAI, code)
Ternyata harga sudah tersimpan per booking (`booking_rooms.nightly_rate`) — tidak perlu kolom/migrasi baru. Yang kurang adalah menyuguhkannya ke bot. Ditambahkan:
- `AgentContext.activeBooking` (`src/ai/agents/types.ts`).
- `loadActiveBookingContext()` di `wa-autoreply.service.ts` — muat booking pending/confirmed terbaru tamu + kamar & harga terkunci (lookup terindeks, best-effort, non-blocking).
- Blok prompt `[BOOKING TAMU YANG SUDAH ADA — SUMBER KEBENARAN HARGA]` di `multi-agent-orchestrator.ts` yang memerintahkan agent memakai harga terkunci, bukan re-quote harga dinamis, untuk stay yang sama.

Efek: kasus Naura (DP di 300k lalu di-quote 400k) tidak terulang — bot merujuk harga yang sudah disepakati. Dedup guest (P0 #3) juga memulihkan link nomor→booking sehingga panel tak lagi "No booking on file".

### 🔎 P0 #2 — akar timeout "sistem sibuk/lambat" (INVESTIGASI SELESAI, belum diubah)
Mekanisme (terverifikasi di kode):
- Budget wall-clock keras: **18 dtk** untuk pesan booking/harga/ketersediaan, **14 dtk** untuk pesan ringan (`AI_TIMEOUT_MS`/`AI_TIMEOUT_LIGHT_MS`, `runtime-policy.ts`). Lewat batas → `controller.abort()` → `AbortError` → kirim `FALLBACK_MESSAGE`.
- Kenapa sering lewat: satu giliran booking merangkai banyak langkah dalam satu jendela waktu — klasifikasi intent (LLM) → retrieval SOP (RAG) → tool ketersediaan (DB) → kadang tool spesifikasi kamar → hingga `maxTurns` (5) giliran LLM → kadang delegasi ke Manager Agent (rantai LLM lagi). Tiap panggilan Gemini ~3–8 dtk; 2–3 panggilan berurutan sudah menembus 18 dtk.
- Plafon platform: berjalan di Cloudflare Workers via pg_net dari queue; migrasi `...pg_net_timeout_30s` menyetel batas pg_net ~30 dtk — jadi 18 dtk aplikasi masih ada sedikit ruang, tapi limit CPU Workers membatasi.
- **Observability sudah ada:** setiap timeout tercatat di tabel `ai_retry_audit` (reason=`timeout`, `latency_ms`, `agent_key`). Query tabel ini untuk % pasti + agent/intent penyumbang terbesar SEBELUM menyetel apa pun.

Rekomendasi (butuh keputusan, belum saya ubah karena berisiko regresi):
1. Kurangi giliran LLM berurutan untuk booking: cache hasil ketersediaan dalam satu giliran, paralelkan availability+specs, turunkan `maxTurns` untuk alur tamu, atau lewati delegasi Manager untuk pertanyaan tamu sederhana.
2. Pakai model lebih cepat/murah khusus langkah klasifikasi agar budget habis untuk menjawab, bukan me-rute.
3. UX timeout lebih baik: alih-alih "ketik 'lanjut'", biarkan queue menyelesaikan di background lalu kirim jawaban asli (zombie-retry sudah mengirim ulang pesan pending). Minimal, QUICK_ACK 6 dtk sudah menutup "mohon tunggu".
4. Kuantifikasi dari `ai_retry_audit` dulu, targetkan agent/intent terburuk, baru tuning.
