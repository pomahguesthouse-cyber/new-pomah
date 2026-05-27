# Alur Chatbot WhatsApp (Fonnte)

Dokumen ini menggambarkan alur runtime chatbot, berdasarkan kode di
[`src/routes/api.fonnte.ts`](../src/routes/api.fonnte.ts),
[`src/services/wa-autoreply.service.ts`](../src/services/wa-autoreply.service.ts),
[`src/ai/multi-agent-orchestrator.ts`](../src/ai/multi-agent-orchestrator.ts),
dan agent di [`src/ai/agents/`](../src/ai/agents).

## 1. Pipeline Webhook (penerimaan & penjadwalan balasan)

Webhook membalas `200` ke Fonnte **segera** setelah pesan masuk disimpan;
pipeline berat (debounce + LLM + kirim) berjalan di background lewat
`ctx.waitUntil` sehingga timeout webhook Fonnte yang singkat tidak mematikan
proses balasan. Di dev lokal (tanpa `waitUntil`) proses tetap di-`await`.

```mermaid
flowchart TD
    A[POST /api/fonnte] --> B[Verify token Fonnte<br/>mismatch: warn, lanjut]
    B --> C[Parse body]
    C --> D{Payload valid?}
    D -- tidak --> Z([Return 200])
    D -- ya --> E{isOutgoing?}
    E -- ya --> E1[Simpan pesan manual staf<br/>cek echo duplikat] --> Z
    E -- tidak --> F{Duplikat in-memory?<br/>dedupKey}
    F -- ya --> Z
    F -- tidak --> G[saveInboundMessage]
    G -- gagal --> ERR([Return 500])
    G -- ok --> H[Simpan intent badge<br/>fire-and-forget]
    H --> I[get_autoreply_context p_phone]
    I --> J{auto_reply aktif?<br/>fonnte_token ada?}
    J -- tidak --> Z
    J -- ya --> R200([Return 200 ke Fonnte — SEGERA])
    R200 -. waitUntil background .-> K[Debounce delayMs<br/>resolveQueueTiming]
    K --> L{Ada pesan masuk lebih baru?<br/>superseded}
    L -- ya --> STOP([Stop background])
    L -- tidak --> M[[executeAutoreplyForPhone]]
```

> Catatan: ada juga jalur **queue-worker** (`processWaQueueEntry` di
> `src/services/wa-queue-processor.ts`) yang memproses `wa_conversation_queue`
> dengan logika identik (debounce → claim → AI → kirim). Jalur webhook di atas
> adalah jalur utama yang aktif.

## 2. executeAutoreplyForPhone (inti balasan)

```mermaid
flowchart TD
    A[Load context + property + rooms] --> B{auto_reply & token ok?}
    B -- tidak --> X1([skipped_config])
    B -- ya --> C{SOP enabled?}
    C -- ya --> D[Load sop_documents cache 10mnt<br/>pisah: sopText + brosurFiles<br/>via isBrosurDoc]
    C -- tidak --> E
    D --> E{API key ada?<br/>explicit / Lovable}
    E -- tidak --> X2([no_api_key])
    E -- ya --> F[[Retry maks 3x:<br/>runMultiAgentOrchestration<br/>timeout AI 22 dtk]]
    F --> G{Dapat reply?}
    G -- ya --> H[finalReply = reply]
    G -- tidak --> H2[finalReply = FALLBACK_MESSAGE<br/>isFallback = true]
    H --> I[[Penanganan brosur / lampiran]]
    H2 --> J
    I --> J[Strip URL gambar telanjang]
    J --> K[sendWhatsAppMessage + lampiran]
    K --> L{Terkirim?}
    L -- tidak & ada lampiran --> M[Retry teks-only]
    M --> N
    L -- ya --> N[Simpan outbound + update meta]
    L -- tidak --> X3([send_failed])
    N --> OK([ok])
```

## 3. Penanganan brosur (langkah "Penanganan brosur / lampiran")

Brosur disimpan di tabel `sop_documents` dengan `doc_category = 'brosur'` dan
di-upload lewat tab **Brosur** di Knowledge & SOP. File berada di bucket publik
`brosur` agar URL-nya bisa diunduh Fonnte (SOP/Knowledge tetap privat di
`sop-documents`).

```mermaid
flowchart TD
    A[finalReply siap] --> B{isBrochureRequest lastMessage?<br/>& ada brosurFiles & bukan fallback}
    B -- ya --> C[attachUrl = PDF brosur<br/>?? brosurFiles pertama]
    B -- tidak --> D{LLM sebut nama file brosur?}
    C --> E
    D -- ya --> C2[attachUrl = file itu] --> E
    D -- tidak --> F{Ada URL .pdf di teks?<br/>mis. invoice}
    F -- ya --> G[attachUrl = pdf, hapus dari teks] --> E
    F -- tidak --> E[Strip URL gambar telanjang]
    E --> H{Brosur diminta?}
    H -- ya --> I[Tambahkan link tautan brosur<br/>ke akhir pesan — agar tetap bisa dibuka<br/>walau lampiran gagal]
    H -- tidak --> J[Kirim]
    I --> J
```

> **Kenapa link + lampiran:** URL lampiran yang tidak terjangkau membuat Fonnte
> menolak seluruh pengiriman (tamu tidak menerima apa pun). Karena itu kode
> me-retry teks-only bila lampiran gagal, dan **selalu menyertakan link** brosur
> di badan pesan saat tamu meminta brosur.

## 4. Multi-Agent Orchestration (1 attempt)

Orchestration memakai **kontrak tiga-status** (`MultiAgentResult.status`):

- `reply` → kirim balasan, berhenti retry.
- `noop` → sengaja diam: tidak kirim apa pun, tidak retry (cadangan).
- `error` → gagal: webhook retry, lalu pakai `FALLBACK_MESSAGE`.

Hanya `error` yang memicu retry, sehingga user tidak pernah menerima respons
kosong dan retry tidak membuang side-effect.

```mermaid
flowchart TD
    A[Input: phone + messages + ctx] --> B{isManager?}
    B -- ya --> M[Manager Agent<br/>+ ask_agent loop ke sub-agent<br/>tools: get_bookings, update/change] --> OUT
    B -- tidak --> C[getBookingState<br/>dari wa_booking_states]
    C --> D{State != IDLE?}
    D -- ya --> E[processBookingState<br/>state machine deterministik]
    E --> F{handled & reply?}
    F -- ya --> OUT["Return reply<br/>(booking_state_machine)"]
    F -- tidak --> G[Set bookingInProgress=true<br/>bila masih isi data]
    D -- tidak --> H
    G --> H[classifyIntent]
    H --> I[routeToAgent + escalation]
    I --> J[[runAgent: system prompt + tools<br/>tool loop maks 5 turn]]
    J --> K{Dapat reply teks?}
    K -- ya --> OUT
    K -- tidak & agent != front-office --> L[Fallback Front Office Agent<br/>1x + tool loop sendiri] --> OUT
    K -- tidak & front-office --> OUT2["status=error → fallback webhook"]
    OUT["Return { status, reply, agentKey, intent, ... }"]
```

**Agent & tools utama:**

- **Front Office** — `check_room_availability`, `start_booking_details`, `create_booking`
- **Pricing** — tarif dinamis & promo
- **Customer Care** — status & kesiapan kamar
- **Maintenance** — perbaikan & fasilitas
- **Finance** — pembayaran & tagihan
- **Manager** — `ask_agent` (delegasi ke sub-agent)

## 5. Alur percakapan Front Office

```mermaid
flowchart TD
    A[Pesan tamu masuk] --> B{Sapaan & nama belum diketahui?}
    B -- ya --> C[Balas ramah + tanya nama<br/>'Dengan siapa saya berbicara?']
    C --> D{Tamu jawab nama?}
    D -- ya --> E[Sapa pakai nama di pesan berikutnya]
    D -- tidak, tanya hal lain --> F[Abaikan nama, lanjut bantu]
    B -- tidak --> G{Jenis pertanyaan?}
    E --> G
    F --> G

    G -- Tanya kamar umum<br/>tanpa tanggal --> H[check_room_availability hari ini<br/>sebut tipe kamar + status hari ini<br/>tanya tanggal & jumlah orang]
    G -- Sebut tanggal /<br/>'sold tanggal X?' --> I[check_room_availability tanggal itu<br/>jawab tersedia/penuh akurat]
    G -- Mau booking --> J[Cek ketersediaan → start_booking_details<br/>→ state machine kumpulkan data]
    G -- Info umum/SOP/brosur --> K[Jawab dari data kamar / SOP<br/>+ kirim file & link brosur]

    H --> L{Tamu pilih tanggal & pax?}
    L -- ya --> I
    I --> N{Tamu pilih kamar?}
    N -- ya --> J
    J --> O[Konfirmasi: kode booking,<br/>total harga, instruksi transfer]
```

## Pengumpulan data booking — alur hybrid

Sapaan, cek ketersediaan, pilih kamar, dan tanya umum tetap ditangani LLM
(Front Office Agent). Begitu tamu memilih tipe kamar + tanggal dan ingin
booking, agent memanggil tool **`start_booking_details`** yang **memindahkan
kontrol** ke state machine deterministik (`src/ai/state-machine/booking-machine.ts`).
Sejak itu, setiap pesan tamu diintersep oleh state machine (state != IDLE),
bukan LLM — sehingga langkahnya konsisten.

State disimpan per-nomor di tabel `wa_booking_states` (RPC
`get_active_booking_state` / `update_booking_state`), berfungsi sebagai memory
temporer percakapan yang auto-reset 15 menit.

Langkah deterministik:

- **`start_booking_details`** → set `CONFIRMING_NAME` (bila nama sudah diketahui
  dari percakapan) atau `AWAITING_NAME`. Menyimpan kamar, tanggal, harga,
  jumlah tamu ke context.
- **`AWAITING_NAME` → `CONFIRMING_NAME`**: tamu mengetik nama → bot bertanya
  pakai nama itu atau nama lain. "Ya" untuk memakai, ketik nama lain untuk
  mengganti.
- **`CONFIRMING_NAME` → `AWAITING_EMAIL`**: minta email.
- **`AWAITING_EMAIL` → `CONFIRMING_PHONE`**: bot menampilkan nomor WhatsApp yang
  sedang dipakai chat (dari `phone` payload, diformat `0xxxx`) dan menanyakan
  pakai nomor itu atau nomor lain. "Ya" → pakai nomor chat; ketik nomor lain →
  pakai itu; minta nomor lain → `AWAITING_PHONE`.
- **`CONFIRMING_PHONE`/`AWAITING_PHONE` → `CONFIRMING_BOOKING`**: tampilkan
  ringkasan.
- **`CONFIRMING_BOOKING`**: bila tamu setuju, state machine memanggil
  `create_booking` **langsung** (bukan via LLM), lalu membalas kode booking,
  total, dan instruksi transfer → `PAYMENT_PENDING`.

`ToolContext.phone` & `AgentContext.chatPhone` diisi orchestrator dari
`input.phone` agar tool dan state machine tahu nomor chat tamu.

### Penanganan interupsi di tengah pengisian data

Bila tamu menanyakan hal lain saat sedang mengisi data booking (mis. "fasilitas
deluxe apa saja?", "AC nya dingin ga?"), state machine TIDAK menghapus progres:

1. `isExpectedAnswer(state, message)` mengecek apakah pesan adalah jawaban yang
   sedang ditunggu (email valid, nomor, "Ya", dll). Bila ya → diproses normal.
2. Bila bukan jawaban DAN terdeteksi pertanyaan (`QUESTION_PATTERN`) atau intent
   eskalasi (`INTERRUPT_INTENTS`: complaint, maintenance, customer-care, pricing,
   payment, availability, booking) → `processBookingState` mengembalikan
   `handled: false` **tanpa mengubah state**.
3. Orchestrator melanjutkan ke LLM untuk menjawab, dan menyetel
   `AgentContext.bookingInProgress = true` sehingga Front Office Agent menjawab
   singkat lalu mengingatkan untuk melanjutkan — tanpa memanggil
   `start_booking_details`/`create_booking` lagi.
4. Pesan tamu berikutnya kembali diintersep state machine pada state yang sama,
   sehingga pengisian data lanjut dari titik terakhir. Hanya "batal/cancel"
   (`CANCELLATION_PATTERNS`) yang benar-benar mereset ke `IDLE`; selain itu
   state auto-reset 15 menit bila percakapan ditinggalkan.

## Catatan robustness

- **create_booking** memilih kamar fisik (`pickAvailableRoom`) *sebelum* menulis
  apa pun. Bila tak ada kamar bebas, booking ditolak — menghindari record tamu/
  booking yatim dan mencegah `booking_rooms.room_id = null` secara diam-diam.
- **Brosur** disimpan di bucket publik terpisah (`brosur`) agar Fonnte dapat
  mengunduhnya; bila lampiran gagal, balasan teks + link tetap terkirim.
- Untuk jaminan anti-overbooking penuh di bawah konkurensi tinggi, idealnya
  ditambah lock transaksional / constraint unik di level database.
