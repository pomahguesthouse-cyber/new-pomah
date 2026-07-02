/**
 * OpenAI function-calling tool definitions.
 *
 * Add new tools here without touching the orchestrator or executor.
 * The registry is a plain array — tree-shaken from the build if unused.
 */

import type { ToolDefinition } from "@/ai/types";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "check_room_availability",
      description:
        "Cek ketersediaan kamar nyata (jumlah kamar kosong per tipe) untuk rentang tanggal. " +
        "Gunakan saat tamu menanyakan kamar tersedia/kosong atau ingin booking.",
      parameters: {
        type: "object",
        properties: {
          check_in: {
            type: "string",
            description: "Tanggal check-in format YYYY-MM-DD. Kosongkan untuk hari ini.",
          },
          check_out: {
            type: "string",
            description:
              "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk sehari setelah check-in.",
          },
          adults: {
            type: "number",
            description:
              "Jumlah tamu dewasa bila sudah disebut. Dipakai untuk menilai kecocokan kapasitas kamar.",
          },
          children: {
            type: "number",
            description:
              "Jumlah anak bila sudah disebut. Dipakai bersama adults untuk menilai kapasitas total tamu.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Buat SATU booking (satu reference_code) yang bisa berisi SATU atau BEBERAPA kamar. " +
        "Mode tamu (WA): WAJIB nama+email+HP lengkap (untuk invoice & konfirmasi). " +
        "Mode manajerial (staff entry via Telegram/manajer): cukup nama + minimal 1 tipe kamar + " +
        "check_in. Email/HP boleh kosong — staf isi belakangan via admin UI. " +
        "check_out boleh kosong (default 1 malam = check_in + 1 hari).\n\n" +
        "MULTI-KAMAR: pakai `rooms: [{room_type, quantity}, ...]`. Total akan dihitung " +
        "sum(rate × quantity × nights) dari semua item. Contoh manajer bilang " +
        "'deluxe 2 kamar, single 1 kamar' → rooms: [{room_type:'Deluxe',quantity:2},{room_type:'Single',quantity:1}].\n" +
        "SINGLE-KAMAR: boleh tetap pakai `room_type` string lama untuk kompatibel.",
      parameters: {
        type: "object",
        properties: {
          room_type:  { type: "string", description: "Tipe kamar tunggal. Pakai HANYA kalau 1 kamar saja." },
          rooms: {
            type: "array",
            description:
              "Multi-kamar dalam SATU booking. Tiap item: { room_type, quantity }. " +
              "Pakai ini bila manajer menyebut lebih dari satu tipe atau >1 kamar dari tipe yang sama.",
            items: {
              type: "object",
              properties: {
                room_type: { type: "string", description: "Nama tipe kamar." },
                quantity: { type: "number", description: "Jumlah kamar." }
              },
              required: ["room_type", "quantity"]
            },
          },
          full_name:  { type: "string", description: "Nama lengkap tamu (WAJIB)." },
          email:      { type: "string", description: "Email tamu. WAJIB di mode tamu, opsional di mode manajerial." },
          phone:      { type: "string", description: "HP/WhatsApp tamu. WAJIB di mode tamu, opsional di mode manajerial." },
          check_in:   { type: "string", description: "Tanggal check-in YYYY-MM-DD." },
          check_out:  { type: "string", description: "Tanggal check-out YYYY-MM-DD. Kosongkan untuk default 1 malam." },
          adults:     { type: "number", description: "Jumlah dewasa. Default 1." },
          children:   { type: "number", description: "Jumlah anak. Default 0." },
        },
        required: ["full_name", "check_in"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_booking_details",
      description:
        "Mulai proses pengisian data pemesanan. Panggil SETELAH tamu memilih tipe kamar dan tanggal " +
        "menginap serta menyatakan ingin booking — JANGAN menanyakan nama/email/HP sendiri. " +
        "Tool ini mengambil alih percakapan untuk mengumpulkan & mengonfirmasi nama dan nomor secara bertahap. " +
        "Sertakan guest_name bila tamu sudah pernah menyebutkan namanya. " +
        "WAJIB sertakan price_per_night dari hasil check_room_availability (nightly_rate) " +
        "agar ringkasan harga yang dilihat tamu sama dengan invoice.",
      parameters: {
        type: "object",
        properties: {
          room_type:  { type: "string", description: "Nama tipe kamar yang dipilih tamu. Boleh kosong jika parameter 'rooms' diisi." },
          rooms: {
            type: "array",
            description: "Daftar tipe kamar dan jumlahnya jika tamu memesan lebih dari satu kamar. Contoh: [{\"room_type\": \"Single\", \"quantity\": 1}, {\"room_type\": \"Deluxe\", \"quantity\": 2}]",
            items: {
              type: "object",
              properties: {
                room_type: { type: "string", description: "Nama tipe kamar." },
                quantity: { type: "number", description: "Jumlah kamar." },
                price_per_night: { type: "number", description: "Harga per malam dari hasil check_room_availability (nightly_rate). Wajib diisi agar harga akurat." },
              },
              required: ["room_type", "quantity"]
            }
          },
          check_in:   { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
          check_out:  { type: "string", description: "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk 1 malam." },
          adults:     { type: "number", description: "Jumlah tamu dewasa. Default 1." },
          children:   { type: "number", description: "Jumlah anak. Default 0." },
          guest_name: { type: "string", description: "Nama tamu bila sudah disebutkan di percakapan. Kosongkan bila belum." },
          price_per_night: {
            type: "number",
            description:
              "Harga per malam DINAMIS dari hasil check_room_availability (field nightly_rate). " +
              "WAJIB diisi agar ringkasan tamu dan invoice menunjukkan harga yang sama. " +
              "Jangan abaikan atau biarkan kosong jika availability sudah dipanggil.",
          },
        },
        required: ["check_in"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_booking_slots",
      description:
        "Simpan POTONGAN data booking ke memori percakapan saat tamu menjawab sebagian. " +
        "Gunakan SETIAP KALI tamu menyebut satu informasi booking (tipe kamar / jumlah orang / " +
        "tanggal) TAPI Anda BELUM punya semua data untuk memanggil `start_booking_details`. " +
        "Contoh: tamu hanya bilang 'Deluxe' atau '2 orang' atau 'tanggal 20 Juni'. " +
        "Tool ini tidak mengirim balasan — setelah memanggil, lanjutkan menanyakan slot " +
        "berikutnya yang masih kosong. Jangan memanggil bila semua data sudah lengkap " +
        "(langsung panggil `start_booking_details` saja).",
      parameters: {
        type: "object",
        properties: {
          room_type: { type: "string", description: "Tipe kamar yang baru disebut tamu (mis. 'Deluxe'). Kosongkan jika belum disebut di pesan ini." },
          adults:    { type: "number", description: "Jumlah dewasa yang baru disebut tamu. Kosongkan jika belum disebut." },
          children:  { type: "number", description: "Jumlah anak yang baru disebut tamu. Kosongkan jika belum disebut." },
          check_in:  { type: "string", description: "Tanggal check-in YYYY-MM-DD yang baru disebut. Kosongkan jika belum disebut." },
          check_out: { type: "string", description: "Tanggal check-out YYYY-MM-DD. Kosongkan jika belum disebut atau hanya 1 malam." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "offer_alternative_rooms",
      description:
        "Panggil saat `check_room_availability` menunjukkan tipe kamar yang DIMINTA tamu " +
        "PENUH untuk tanggalnya, TAPI ada tipe kamar lain yang tersedia di tanggal yang sama. " +
        "Tool ini menyetel state machine ke AWAITING_ALTERNATIVE_ROOM_TYPE — jangan tanya " +
        "tipe kamar lagi sendiri. Setelah memanggil, kirim isi `message` VERBATIM ke tamu. " +
        "JANGAN dipanggil bila tipe kamar yang diminta justru tersedia.",
      parameters: {
        type: "object",
        properties: {
          requested_room_type: {
            type: "string",
            description: "Nama tipe kamar yang awalnya diminta tamu dan ternyata penuh (mis. 'Deluxe').",
          },
          check_in:  { type: "string", description: "Tanggal check-in YYYY-MM-DD." },
          check_out: { type: "string", description: "Tanggal check-out YYYY-MM-DD." },
          adults:    { type: "number", description: "Jumlah dewasa. Default 1." },
          children:  { type: "number", description: "Jumlah anak. Default 0." },
          guest_name: {
            type: "string",
            description: "Nama tamu bila sudah disebut sebelumnya. Kosongkan bila belum.",
          },
          alternatives: {
            type: "array",
            description:
              "Daftar tipe kamar yang masih tersedia. Ambil DARI hasil " +
              "`check_room_availability` (entry dengan `tidak_tersedia=false` dan " +
              "`kamar_tersedia>0`). Sertakan minimal 1 item.",
            items: {
              type: "object",
              properties: {
                room_type:       { type: "string", description: "Nama tipe kamar." },
                price_per_night: { type: "number", description: "Harga per malam (rupiah)." },
              },
              required: ["room_type"],
            },
          },
        },
        required: ["requested_room_type", "check_in", "check_out", "alternatives"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bookings",
      description:
        "Daftar booking. Default urut dari booking yang paling baru dibuat (cocok untuk 'booking terakhir / terbaru'). " +
        "Bisa difilter berdasarkan status booking, status pembayaran (unpaid/partial/paid — pakai untuk " +
        "'siapa yang belum lunas / belum bayar'), atau tanggal check_in/check_out.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Status booking, misal 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'" },
          payment_status: {
            description:
              "Status pembayaran. 'unpaid' = belum bayar sama sekali, 'partial' = sudah DP / bayar " +
              "sebagian, 'paid' = lunas. Boleh string tunggal atau array. Untuk 'siapa yang BELUM " +
              "LUNAS' (manajer biasanya menganggap ini = belum bayar penuh, jadi termasuk DP yang " +
              "belum dilunasi), kirim ['unpaid','partial']. Untuk 'siapa yang belum bayar sama sekali', " +
              "kirim 'unpaid' saja.",
            oneOf: [
              { type: "string", enum: ["unpaid", "partial", "paid"] },
              {
                type: "array",
                items: { type: "string", enum: ["unpaid", "partial", "paid"] },
                minItems: 1,
              },
            ],
          },
          date: { type: "string", description: "Tanggal (YYYY-MM-DD) untuk mencari booking yang menginap di tanggal tersebut." },
          limit: { type: "number", description: "Maksimal data yang dikembalikan. Default 10." },
          sort: {
            type: "string",
            enum: ["recent", "upcoming"],
            description:
              "Urutan hasil. 'recent' (default) = booking yang paling baru dibuat di atas — pakai untuk 'booking terakhir' / 'booking terbaru'. " +
              "'upcoming' = urut check-in dari yang paling dekat — pakai untuk 'jadwal check-in', 'siapa menginap besok'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_booking_status",
      description: "Ubah status booking (misalnya untuk membatalkan/hapus booking, set menjadi 'cancelled').",
      parameters: {
        type: "object",
        properties: {
          reference_code: { type: "string", description: "Kode referensi booking (contoh: REF-1234)" },
          status: { type: "string", description: "Status baru: 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'" },
        },
        required: ["reference_code", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_booking",
      description:
        "Hapus/batalkan booking (managerial only). Manajer cukup sebut kode booking atau " +
        "nama tamu — tool resolve sendiri. Default mode='cancel' (soft: status → cancelled, " +
        "slot kamar bebas). Mode='hard' untuk DELETE row DB permanen (butuh confirmed=true " +
        "di panggilan kedua). Pakai saat manajer bilang 'batalkan booking ...', 'hapus " +
        "booking ...', 'cancel reservasi ...'.",
      parameters: {
        type: "object",
        properties: {
          reference_code: { type: "string", description: "Kode booking (mis. PG-XXXX). Paling akurat." },
          guest_name:     { type: "string", description: "Nama tamu (substring match). Bila ambigu, tool minta klarifikasi." },
          mode:           { type: "string", enum: ["cancel", "hard"], description: "Default 'cancel'. 'hard' = DELETE permanen." },
          confirmed:      { type: "boolean", description: "Wajib true di panggilan kedua mode='hard'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_booking_room",
      description: "Pindahkan booking ke kamar lain (ubah nomor kamar yang di-assign).",
      parameters: {
        type: "object",
        properties: {
          reference_code: { type: "string", description: "Kode referensi booking" },
          new_room_number: { type: "string", description: "Nomor kamar tujuan (contoh: '101')" },
        },
        required: ["reference_code", "new_room_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_extra_bed",
      description:
        "Manajer-only. Tambah/kurangi/set jumlah extra bed pada SATU kamar di booking tertentu. " +
        "Total booking otomatis dihitung ulang (nightly_rate × nights + extra_bed_rate × count × nights). " +
        "Contoh: 'di booking PMH-002 tambahkan extrabed di kamar Family Suite 100' → " +
        "reference_code='PMH-002', room_number='100', mode='add', count=1. " +
        "Bila manajer menyebut nama tipe tanpa nomor kamar dan booking hanya punya 1 kamar dari tipe itu, " +
        "kirim room_type saja. Bila ambigu, tool akan minta klarifikasi.",
      parameters: {
        type: "object",
        properties: {
          reference_code: { type: "string", description: "Kode booking (mis. PMH-002)." },
          room_number: {
            type: "string",
            description:
              "Nomor kamar spesifik (mis. '100'). Diprioritaskan di atas room_type bila keduanya diisi.",
          },
          room_type: {
            type: "string",
            description:
              "Nama tipe kamar (mis. 'Family Suite'). Pakai bila nomor kamar tidak disebut manajer.",
          },
          mode: {
            type: "string",
            enum: ["add", "set", "remove"],
            description:
              "'add' (default) menambah count ke jumlah saat ini. 'set' menimpa jadi count. " +
              "'remove' mengurangi count.",
          },
          count: {
            type: "number",
            description:
              "Jumlah extra bed sesuai mode. Default 1 untuk add/remove, wajib diisi untuk set.",
          },
          confirmed: {
            type: "boolean",
            description:
              "Wajib true pada panggilan kedua setelah konfirmasi manajer. Panggilan pertama " +
              "akan mengembalikan needs_confirmation.",
          },
        },
        required: ["reference_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reply_to_guest",
      description:
        "Kirim pesan WhatsApp ke tamu yang sudah punya thread. Dipakai oleh Manager Agent " +
        "saat manajer minta meneruskan balasan kustom ke tamu via Telegram. " +
        "Refuse kalau tamu belum pernah inisiasi chat.",
      parameters: {
        type: "object",
        properties: {
          guest_phone: {
            type: "string",
            description: "Nomor HP tamu (format apa saja: 0812, 6281, +6281 — akan dinormalkan).",
          },
          message: {
            type: "string",
            description: "Isi pesan yang akan dikirim ke tamu via WhatsApp.",
          },
        },
        required: ["guest_phone", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_room_specifications",
      description:
        "Mendapatkan spesifikasi kamar statis (seperti deskripsi, fasilitas/amenities, lokasi lantai, kapasitas tamu, tipe tempat tidur, kapasitas extra bed, dan tarif extra bed) dari database untuk tipe kamar tertentu atau semua tipe kamar.",
      parameters: {
        type: "object",
        properties: {
          room_type: {
            type: "string",
            description: "Nama tipe kamar (misal: 'Deluxe', 'Grand Deluxe'). Kosongkan untuk mendapatkan semua kamar.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_keyword_ranking",
      description:
        "Cek posisi domain Pomah di Google SERP untuk satu keyword via Serper. Simpan hasilnya ke " +
        "seo_keywords (upsert) dan log ke seo_agent_logs. Return: posisi (1-30 atau null bila tidak " +
        "dalam top 30), posisi sebelumnya, delta, top 5 kompetitor. Pakai saat manajer minta " +
        "'cek posisi kita untuk keyword X' atau 'apakah peringkat kita untuk Y turun'.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "Keyword target persis seperti yang akan diketik tamu di Google " +
              "(mis. 'guesthouse semarang dekat unnes').",
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tracked_keywords",
      description:
        "Daftar keyword yang ditrack di tabel seo_keywords berikut posisi terakhir, search volume, " +
        "intent, dan priority. Pakai sebagai langkah PERTAMA saat manajer minta laporan SEO umum " +
        "('bagaimana posisi kita sekarang', 'mana yang turun', 'fokus keyword apa hari ini') — " +
        "dari hasil ini Anda bisa pilih keyword mana yang layak di-refresh via check_keyword_ranking.",
      parameters: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Filter berdasarkan kolom priority. Kosongkan untuk semua.",
          },
          only_unranked: {
            type: "boolean",
            description: "True untuk hanya menampilkan keyword yang ranking_position-nya null.",
          },
          order_by: {
            type: "string",
            enum: ["position", "priority", "updated_at"],
            description:
              "Default 'updated_at' (paling baru cek). 'position' = posisi terbaik dulu. " +
              "'priority' = high → medium → low.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_page_seo",
      description:
        "Audit on-page SEO untuk SATU halaman publik Pomah. Fetch HTML, ekstrak title, meta " +
        "description, canonical, robots, og tags, jumlah H1/H2, word count, lalu beri daftar " +
        "issue (title terlalu pendek/panjang, meta hilang, noindex, dll.). Domain wajib sama " +
        "dengan public_domain properti — proteksi SSRF.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relatif halaman (mis. '/rooms', '/'). Akan di-resolve ke domain properti.",
          },
          url: {
            type: "string",
            description:
              "URL lengkap (alternatif untuk path). Wajib menggunakan domain yang sama dengan " +
              "public_domain properti, kalau berbeda tool akan reject.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_daily_room_rate",
      description:
        "MANAJER ONLY. Upsert harga harian (override) untuk satu tipe kamar di tabel " +
        "room_daily_rates — menimpa room_types.base_rate untuk tanggal yang ditentukan. " +
        "Pakai untuk perintah seperti 'Set Deluxe 10 Juni jadi 350rb', " +
        "'Family 17–18 Agustus 600rb', 'block Single 17 Agustus', " +
        "'set extrabed Deluxe weekend ini 75rb'.\n\n" +
        "Range: from_date wajib, to_date opsional (default = from_date untuk single date). " +
        "Maksimum rentang 366 hari. Konversi nilai harga: '350rb'/'350k' = 350000, '1.2jt' = 1200000. " +
        "Minimal SATU dari (rate, extrabed_rate, stop_sell, min_stay, note) harus diberikan; " +
        "field yang tidak disebut akan di-preserve untuk row existing atau di-snapshot " +
        "(rate = base_rate saat ini) untuk row baru. " +
        "stop_sell=true berarti tipe kamar ini tidak dijual untuk tanggal itu.",
      parameters: {
        type: "object",
        properties: {
          room_type:     { type: "string", description: "Nama (substring case-insensitive) atau UUID tipe kamar." },
          from_date:     { type: "string", description: "Tanggal mulai YYYY-MM-DD (inclusive)." },
          to_date:       { type: "string", description: "Tanggal akhir YYYY-MM-DD (inclusive). Kosongkan untuk single date." },
          rate:          { type: "number", description: "Tarif per malam (rupiah utuh). Kosongkan untuk preserve / snapshot base_rate." },
          extrabed_rate: { type: "number", description: "Tarif extrabed per malam. Kosongkan untuk fallback ke room_types.extrabed_rate." },
          stop_sell:     { type: "boolean", description: "True = tidak dijual untuk tanggal ini. Default false." },
          min_stay:      { type: "number", description: "Minimum nights (integer 1–30). Default 1 (saat ini informasional, belum diberlakukan)." },
          note:          { type: "string", description: "Catatan singkat (opsional)." },
        },
        required: ["room_type", "from_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_room_rates",
      description:
        "MANAJER ONLY. Baca daftar harga harian (override + base) dalam rentang tanggal. " +
        "Pakai untuk 'lihat harga harian bulan Juni', 'harga Deluxe minggu depan', " +
        "'tanggal apa saja yang sudah di-set khusus'. Output JSON murni (array per tanggal × tipe kamar). " +
        "Tanpa room_type → kembalikan semua tipe.",
      parameters: {
        type: "object",
        properties: {
          from_date:         { type: "string", description: "Tanggal mulai YYYY-MM-DD (inclusive)." },
          to_date:           { type: "string", description: "Tanggal akhir YYYY-MM-DD (inclusive). Kosongkan untuk single date." },
          room_type:         { type: "string", description: "Filter ke satu tipe kamar (nama/UUID). Kosongkan untuk semua." },
          include_base_rate: { type: "boolean", description: "Default true: sertakan tanggal-tanggal yang TIDAK punya override (source='base_rate')." },
        },
        required: ["from_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_daily_room_rate",
      description:
        "MANAJER ONLY. Hapus override harga harian untuk satu tipe kamar di rentang tanggal " +
        "— tanggal tersebut kembali ke room_types.base_rate. Pakai untuk 'reset Deluxe 11 Juni ke base', " +
        "'hapus override Juli minggu pertama'. Rentang ≥31 hari minta konfirmasi (panggil ulang dengan confirmed=true).",
      parameters: {
        type: "object",
        properties: {
          room_type: { type: "string", description: "Nama atau UUID tipe kamar." },
          from_date: { type: "string", description: "Tanggal mulai YYYY-MM-DD (inclusive)." },
          to_date:   { type: "string", description: "Tanggal akhir YYYY-MM-DD (inclusive). Kosongkan untuk single date." },
          confirmed: { type: "boolean", description: "Wajib true di panggilan kedua untuk rentang ≥31 hari." },
        },
        required: ["room_type", "from_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_room_rate",
      description:
        "MANAJER ONLY. Ubah tarif dasar (base_rate) dan/atau tarif extrabed " +
        "sebuah tipe kamar di tabel room_types. Panggil HANYA saat super admin / " +
        "manajer secara eksplisit menginstruksikan perubahan harga via Telegram atau " +
        "WhatsApp (mis. 'ganti harga Deluxe jadi 350rb', 'naikin extrabed Single jadi 75000'). " +
        "JANGAN PERNAH panggil saat berbicara dengan tamu — tool akan menolak. " +
        "Konfirmasi nominal ke manajer SEBELUM memanggil bila terdapat ambiguitas (mis. 'naikin 50rb' " +
        "tidak jelas naik 50.000 atau jadi 50.000). Setelah berhasil, sampaikan tarif lama → tarif baru.",
      parameters: {
        type: "object",
        properties: {
          room_type: {
            type: "string",
            description:
              "Nama (case-insensitive substring) atau UUID tipe kamar. " +
              "Contoh: 'Deluxe', 'Family Suite 100'.",
          },
          base_rate: {
            type: "number",
            description:
              "Tarif baru per malam dalam rupiah utuh (mis. 350000 untuk Rp 350.000). " +
              "Kosongkan bila hanya ingin mengubah extrabed_rate.",
          },
          extrabed_rate: {
            type: "number",
            description:
              "Tarif baru extrabed per malam dalam rupiah utuh. " +
              "Kosongkan bila hanya ingin mengubah base_rate.",
          },
        },
        required: ["room_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_booking_form",
      description:
        "Buat tautan FORM BOOKING sekali pakai untuk tamu WhatsApp lalu kirim ke tamu. " +
        "Pakai SETELAH tamu memilih tipe kamar & tanggal dan menyatakan ingin booking, " +
        "SEBAGAI ALTERNATIF dari `start_booking_details` — tujuannya memindahkan pengisian " +
        "nama, email, jumlah extra bed, dan catatan ke halaman web supaya percakapan tidak bertele-tele. " +
        "Tool akan mengembalikan `suggested_reply` berisi link + penjelasan singkat — kirim VERBATIM " +
        "ke tamu sebagai balasan berikutnya. JANGAN menanyakan data pemesan lagi di chat setelah ini; " +
        "tunggu webhook submit form. Jika tool mengembalikan `ok:false` (mis. fitur dimatikan), " +
        "lanjutkan pakai `start_booking_details` seperti biasa.",
      parameters: {
        type: "object",
        properties: {
          room_type:   { type: "string", description: "Nama tipe kamar yang sudah disepakati (mis. 'Deluxe'). Boleh kosong bila tamu belum memilih." },
          check_in:    { type: "string", description: "Tanggal check-in YYYY-MM-DD bila sudah disepakati." },
          check_out:   { type: "string", description: "Tanggal check-out YYYY-MM-DD bila sudah disepakati." },
          guest_count: { type: "number", description: "Total tamu (dewasa + anak) bila sudah disebut. Default kosong." },
          rooms:       { type: "number", description: "Jumlah kamar yang dipesan dari tipe yang sama. Default kosong (1)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_booking_form_submission",
      description:
        "Ambil submitted_data dari form booking sekali pakai berdasarkan token. " +
        "Dipakai hanya untuk recovery/admin/debug; alur normal diproses otomatis oleh state machine saat marker [FORM_SUBMITTED:<token>] masuk queue.",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "Token dari marker [FORM_SUBMITTED:<token>]." },
        },
        required: ["token"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "block_room",
      description: "Blokir tipe kamar tertentu untuk rentang tanggal tertentu (maintenance, dsb).",
      parameters: {
        type: "object",
        properties: {
          room_type: { type: "string", description: "Nama tipe kamar yang diblokir (mis. 'Deluxe')" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
          reason: { type: "string", description: "Alasan pemblokiran (mis. 'AC Rusak')" },
        },
        required: ["room_type", "start_date", "end_date", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_to_manager",
      description: "Teruskan pesan, informasi, atau laporan langsung ke owner/manajer properti.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Isi pesan yang akan disampaikan" },
          urgency: { type: "string", enum: ["low", "normal", "high"], description: "Tingkat urgensi" },
        },
        required: ["message"],
      },
    },
  },
];

/** Human-readable label shown in the admin inbox for each tool call. */
export const TOOL_LABELS: Record<string, string> = {
  check_room_availability:      "Room Availability",
  start_booking_details:        "Booking Flow",
  update_booking_slots:         "Booking Slots",
  offer_alternative_rooms:      "Booking - Tawarkan Kamar Alternatif",
  create_booking:               "Booking Engine",
  request_housekeeping_service: "Housekeeping",
  report_maintenance_issue:     "Maintenance",
  get_payment_info:             "Finance",
  get_payment_proof_result:     "Finance - OCR Bukti Transfer",
  send_invoice:                 "Finance - Kirim Invoice",
  update_payment_status:        "Finance - Update Status Pembayaran",
  cc_payment_proof_to_admin:    "Finance - CC Bukti Transfer ke Super Admin",
  get_bookings:                 "Manager - List Bookings",
  update_booking_status:        "Manager - Update Booking Status",
  delete_booking:               "Manager - Hapus / Batalkan Booking",
  change_booking_room:          "Manager - Change Booking Room",
  reply_to_guest:               "Manager - Reply to Guest",
  discover_semarang_content:    "Content - Cari Konten Semarang",
  upsert_explore_item:          "Content - Tulis Entri City Guide",
  list_explore_items:           "Content - List Entri",
  publish_explore_item:         "Content - Publish Entri",
  publish_explore_items_by_category: "Content - Publish Massal per Kategori",
  generate_explore_image:       "Content - Generate Gambar Event",
  discover_property_reviews:    "Content - Cari Ulasan Properti (web search)",
  save_custom_google_reviews:   "Content - Simpan Ulasan Kustom",
  restore_custom_google_reviews: "Content - Restore Ulasan Kustom dari Audit",
  scrape_competitor_prices:     "Pricing - Scrape Harga Kompetitor",
  update_room_rate:             "Pricing - Ubah Tarif Kamar (Manajer)",
  set_daily_room_rate:          "Pricing - Set Harga Harian (Manajer)",
  get_daily_room_rates:         "Pricing - Lihat Harga Harian (Manajer)",
  delete_daily_room_rate:       "Pricing - Hapus Override Harga Harian (Manajer)",
  get_room_specifications:      "Room Specifications",
  check_keyword_ranking:        "Content - SEO Cek Posisi Google",
  list_tracked_keywords:        "Content - SEO List Keyword Terpantau",
  audit_page_seo:               "Content - SEO Audit Halaman",
  generate_booking_form:        "Booking - Kirim Form Sekali Pakai",
  get_booking_form_submission:  "Booking - Baca Submission Form",
  block_room:                   "Manager - Blokir Kamar",
  send_to_manager:              "Manager - Eskalasi ke Manajer",
};
