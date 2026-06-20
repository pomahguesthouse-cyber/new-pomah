# Alur Chatbot WhatsApp (Fonnte)

Dokumen ini menggambarkan alur runtime chatbot WhatsApp/Fonnte yang aktif di production, berdasarkan kode di:

- `src/routes/api.fonnte.ts`
- `src/services/queue.service.ts`
- `src/services/wa-autoreply.service.ts`
- `src/ai/multi-agent-orchestrator.ts`
- `src/ai/agents/`
- `src/ai/state-machine/booking-machine.ts`

## 1. Pipeline Webhook → DB Queue

Webhook `/api/fonnte` dibuat ringan. Tugas utamanya adalah menerima payload Fonnte, menyimpan pesan inbound, menjalankan notifikasi ringan secara background, lalu memasukkan pesan ke `wa_conversation_queue`. Webhook tidak menjalankan LLM langsung, sehingga bisa return `200 OK` cepat ke Fonnte.

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
    H --> N[Notifikasi incoming / payment proof<br/>via waitUntil bila tersedia]
    N --> I[get_autoreply_context p_phone]
    I --> J{auto_reply aktif / manager?<br/>fonnte_token ada?}
    J -- tidak --> Z
    J -- ya --> K[resolveQueueTiming]
    K --> L[queueCleanupZombies]
    L --> M[wa_queue_upsert]
    M --> Z
```

Catatan penting:

- Smart delay/debounce tidak lagi dilakukan dengan sleep di webhook.
- Idle batching dilakukan oleh database lewat `wa_queue_upsert` dengan `process_after` dan `max_wait_until`.
- Worker terpisah (`/api/queue-worker` / `/api/cron/process-wa-queue`) mengambil queue yang sudah ready.

## 2. Queue Worker

Queue worker memproses item yang sudah melewati idle window.

```mermaid
flowchart TD
    A[Worker / cron jalan] --> B[wa_queue_claim_next]
    B --> C{Ada entry ready?}
    C -- tidak --> Z([Selesai])
    C -- ya --> D[Claim atomic<br/>FOR UPDATE SKIP LOCKED]
    D --> E[Heartbeat lock]
    E --> F[executeAutoreplyForPhone]
    F --> G{Outcome}
    G -- ok / skipped_config / no_api_key --> H[wa_queue_complete]
    G -- send_failed / context_error / fatal --> I[wa_queue_fail<br/>retry/backoff]
    H --> B
    I --> B
```

Queue memberi jaminan:

- Satu conversation hanya diproses satu worker pada satu waktu.
- Burst pesan tamu dibalas sekali setelah idle window.
- Worker zombie dibersihkan saat lock expired.
- Error sementara bisa retry dengan backoff.

## 3. executeAutoreplyForPhone

Fungsi ini adalah inti balasan WhatsApp. Ia memuat konteks thread, data properti, tipe kamar, SOP, brosur, model AI, ringkasan chat, contoh training, lalu menjalankan orchestrator.

```mermaid
flowchart TD
    A[Load get_autoreply_context] --> B{auto_reply aktif / manager<br/>dan token Fonnte ada?}
    B -- tidak --> X1([skipped_config])
    B -- ya --> C[Load property + room_types]
    C --> D{SOP enabled?}
    D -- ya --> E[Load sop_documents cache 10mnt<br/>pisah SOP text + brosur files]
    D -- tidak --> F
    E --> F{AI key ada?}
    F -- tidak --> X2([no_api_key])
    F -- ya --> G[Training retrieval<br/>positive + negative examples]
    G --> H[runMultiAgentOrchestration<br/>timeout AI 22 dtk]
    H --> I{Ada reply?}
    I -- ya --> J[finalReply = reply]
    I -- tidak --> K[finalReply = FALLBACK_MESSAGE]
    J --> L[pickAttachment / cleanReplyBody]
    K --> L
    L --> M[sendWhatsAppMessage]
    M --> N{Terkirim?}
    N -- gagal + lampiran --> O[Retry text-only + link]
    O --> P{Terkirim?}
    N -- ya --> Q[Simpan outbound + metadata]
    P -- ya --> Q
    P -- tidak --> X3([send_failed])
    Q --> R[Conversation monitor + summarizer background]
    R --> OK([ok])
```

## 4. Penanganan Brosur / Lampiran

Brosur disimpan di `sop_documents` dengan kategori `brosur` / `brochure`, dan file publiknya berada di bucket publik agar Fonnte bisa mengambil lampiran.

```mermaid
flowchart TD
    A[Reply AI siap] --> B{Tamu minta brosur?}
    B -- ya --> C[pickAttachment dari brosurFiles]
    B -- tidak --> D{Reply sebut PDF / file?}
    D -- ya --> C
    D -- tidak --> E[Clean reply body]
    C --> F[Kirim teks + lampiran]
    F --> G{Lampiran gagal?}
    G -- ya --> H[Retry teks-only + link]
    G -- tidak --> I[Simpan outbound]
    H --> I
```

## 5. Multi-Agent Orchestration

Orchestrator memakai kontrak tiga status: `reply`, `noop`, dan `error`.

```mermaid
flowchart TD
    A[Input: phone + messages + ctx] --> B{isManager?}
    B -- ya --> M[Manager Agent<br/>deterministic command / ask_agent] --> OUT
    B -- tidak --> C[getBookingState]
    C --> D{State != IDLE?}
    D -- ya --> E[processBookingState]
    E --> F{handled & reply?}
    F -- ya --> OUT[Return reply dari state machine]
    F -- tidak --> G[bookingInProgress=true bila data entry]
    D -- tidak --> H
    G --> H[resolveContext + rewriteQuery]
    H --> I[classifyIntent]
    I --> J[routeToAgent]
    J --> K[runAgent + tool loop max 5]
    K --> L{Reply ada?}
    L -- ya --> OUT
    L -- tidak & agent != front-office --> N[Fallback Front Office]
    N --> OUT
    L -- tidak & front-office --> ERR[status=error]
```

Agent utama:

- **Front Office** — greeting, cek kamar, availability, start booking detail.
- **Pricing** — tarif, promo, harga.
- **Customer Care** — status kamar dan layanan tamu.
- **Maintenance** — fasilitas rusak/keluhan teknis.
- **Finance** — invoice, pembayaran, tagihan.
- **Manager** — command internal dan delegasi `ask_agent`.

## 6. Booking Flow Tamu

Mode tamu sengaja tidak memberi tool `create_booking` ke Front Office Agent. LLM hanya boleh memulai pengumpulan data lewat `start_booking_details`. Booking final dibuat oleh state machine setelah tamu konfirmasi ringkasan.

```mermaid
flowchart TD
    A[Tamu tanya kamar / booking] --> B[Front Office cek availability]
    B --> C{Tamu pilih kamar + tanggal?}
    C -- belum --> D[update_booking_slots / tanya slot kurang]
    C -- ya --> E[start_booking_details]
    E --> F[Booking State Machine]
    F --> G[AWAITING_NAME]
    G --> H[CONFIRMING_NAME]
    H --> I[AWAITING_EMAIL]
    I --> J[CONFIRMING_PHONE]
    J --> K[CONFIRMING_BOOKING]
    K --> L{Tamu Ya/Lanjut?}
    L -- ya --> M[create_booking langsung dari state machine]
    L -- koreksi --> N[update slot + ringkasan ulang]
    L -- batal --> O[Reset state]
    M --> P[PAYMENT_PENDING + invoice/payment info]
```

Interupsi aman: bila tamu bertanya fasilitas, harga, lokasi, refund, komplain, atau pembayaran saat sedang isi data booking, state machine tidak menghapus progres. Orchestrator menjawab pertanyaan lewat agent lalu melanjutkan state yang sama pada pesan berikutnya.

## 7. Debug Endpoint

Endpoint GET mendukung:

- `?debug=1` untuk cek env, RPC context, queue, LLM reachability, dan pesan terakhir.
- `?test_reply=1&phone=628xxx` untuk menjalankan orchestrator tanpa harus menunggu webhook/queue.
- `?test_reply=1&phone=628xxx&sop=1` untuk mirror produksi dengan SOP dan brosur.
- `?test_reply=1&phone=628xxx&send=1` untuk mengirim hasil test ke WhatsApp.

Debug endpoint wajib diberi token melalui query `token=` atau `Authorization: Bearer ...`.

## 8. Catatan Robustness

- Queue claim dilakukan atomic di database untuk menghindari double reply.
- `create_booking` harus memilih kamar fisik sebelum menulis booking final.
- Lampiran brosur punya fallback text-only agar tamu tetap menerima link.
- Bot-loop / repeated tool `need_dates` dipantau dan bisa men-trigger notifikasi manager.
- Untuk anti-overbooking di beban tinggi, tetap ideal menambah lock transaksional atau constraint unik di level database.
