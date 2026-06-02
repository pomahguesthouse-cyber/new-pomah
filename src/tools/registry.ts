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
              description: "Satu baris item kamar.",
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
        "Sertakan guest_name bila tamu sudah pernah menyebutkan namanya.",
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
                quantity: { type: "number", description: "Jumlah kamar." }
              },
              required: ["room_type", "quantity"]
            }
          },
          check_in:   { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
          check_out:  { type: "string", description: "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk 1 malam." },
          adults:     { type: "number", description: "Jumlah tamu dewasa. Default 1." },
          children:   { type: "number", description: "Jumlah anak. Default 0." },
          guest_name: { type: "string", description: "Nama tamu bila sudah disebutkan di percakapan. Kosongkan bila belum." },
        },
        required: ["check_in"],
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
];

/** Human-readable label shown in the admin inbox for each tool call. */
export const TOOL_LABELS: Record<string, string> = {
  check_room_availability:      "Room Availability",
  start_booking_details:        "Booking Flow",
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
  get_room_specifications:      "Room Specifications",
};
