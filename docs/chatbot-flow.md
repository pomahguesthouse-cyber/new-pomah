# Alur Chatbot WhatsApp (Fonnte)

Dokumen ini menggambarkan alur runtime chatbot, berdasarkan kode di
[`src/routes/api.fonnte.ts`](../src/routes/api.fonnte.ts),
[`src/ai/multi-agent-orchestrator.ts`](../src/ai/multi-agent-orchestrator.ts),
dan agent di [`src/ai/agents/`](../src/ai/agents).

## 1. Pipeline Webhook (penerimaan & balasan)

```mermaid
flowchart TD
    A[POST /api/fonnte] --> B[Verify token Fonnte]
    B --> C[Parse body]
    C --> D{Payload valid?}
    D -- tidak --> Z([Return OK 200])
    D -- ya --> E{Pesan keluar / outgoing?}
    E -- ya --> E1[Simpan pesan manual staf<br/>cek echo duplikat] --> Z
    E -- tidak --> F{Duplikat in-memory?<br/>dedupKey}
    F -- ya --> Z
    F -- tidak --> G[Simpan pesan masuk + intent badge]
    G --> H[get_autoreply_context p_phone]
    H --> I{Thread ada?<br/>auto_reply aktif?<br/>fonnte_token ada?}
    I -- tidak --> Z
    I -- ya --> J[Debounce 3 detik]
    J --> K{Ada pesan lebih baru?<br/>superseded}
    K -- ya --> Z
    K -- tidak --> L{Circuit breaker aktif?}
    L -- ya --> M[Kirim fallback] --> Z
    L -- tidak --> N[Load property + rooms + SOP/brosur cache]
    N --> O[[Retry orkestrasi + balasan]]
    O --> Z
```

## 2. Retry webhook + lokasi fallback

Retry yang sesungguhnya ada di lapisan webhook (`MAX_AI_RETRIES = 3`) dan
membungkus seluruh orkestrasi. Pesan fallback (`FALLBACK_MESSAGE`) juga
ditentukan di lapisan webhook — orchestrator hanya mengembalikan `reply`
atau `null`, sehingga user tidak pernah menerima respons kosong.

```mermaid
flowchart TD
    subgraph WEBHOOK["Lapisan Webhook — /api/fonnte"]
        direction TB
        S0[Pesan masuk lolos dedup,<br/>debounce, circuit breaker] --> RT{Retry orkestrasi<br/>attempt ≤ 3?}
        RT -- ya --> ORCH[[Multi-Agent Orchestration]]
        ORCH --> RC{Dapat reply?}
        RC -- ya --> OK[Reset failure count]
        RC -- tidak --> RT
        RT -- habis 3× --> FB[finalReply = FALLBACK_MESSAGE<br/>isFallback = true<br/>naikkan failure → trip breaker]
        OK --> SEND
        FB --> SEND[Cek outbound dedup → kirim Fonnte → simpan]
    end

    subgraph ORCHESTRATION["Multi-Agent Orchestration — 1 attempt"]
        direction TB
        A[Input] --> B{isManager?}
        B -- ya --> M[Manager Agent<br/>+ ask_agent loop<br/>tools: get_bookings,<br/>update/change booking] --> OUT
        B -- tidak --> C[getBookingState]
        C --> D{State != IDLE?}
        D -- ya --> E[processBookingState] --> F{Handled + reply?}
        F -- ya --> OUT[Return reply ATAU null]
        F -- tidak --> G
        D -- tidak --> G[classifyIntent]
        G --> H[routeToAgent + jalankan agent]
        H --> J[[Tool loop maks 5 turn<br/>T1 availability / T2 booking / T3 ask_agent]]
        J --> K{Reply teks?}
        K -- ya --> OUT
        K -- tidak / max turns --> L{agent != front-office?<br/>anti-loop guard}
        L -- ya --> N[Fallback Front Office<br/>1× + tool loop sendiri] --> OUT
        L -- tidak --> OUT
    end

    ORCH -.memanggil.-> A
    OUT -.reply/null kembali ke.-> RC
```

## 3. Alur percakapan Front Office

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
    G -- Mau booking --> J[Cek ketersediaan → minta nama,<br/>email, no HP → create_booking]
    G -- Info umum/SOP/brosur --> K[Jawab dari data kamar / SOP / kirim link brosur]

    H --> L{Tamu pilih tanggal & pax?}
    L -- ya --> I
    I --> M{Tamu pilih kamar?}
    M -- ya --> J
    J --> N[Konfirmasi: kode booking,<br/>total harga, instruksi transfer]
```

## Catatan robustness

- **create_booking** memilih kamar fisik (`pickAvailableRoom`) *sebelum* menulis
  apa pun. Bila tak ada kamar bebas, booking ditolak — menghindari record tamu/
  booking yatim dan mencegah `booking_rooms.room_id = null` secara diam-diam.
- Untuk jaminan anti-overbooking penuh di bawah konkurensi tinggi, idealnya
  ditambah lock transaksional / constraint unik di level database.
