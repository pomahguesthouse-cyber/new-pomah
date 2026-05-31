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
        "Buat pesanan/booking kamar untuk tamu. Panggil HANYA setelah tamu memilih tipe kamar " +
        "dan memberikan nama lengkap, email, dan nomor HP. Jangan panggil bila data belum lengkap.",
      parameters: {
        type: "object",
        properties: {
          room_type:  { type: "string", description: "Nama tipe kamar yang dipilih tamu." },
          full_name:  { type: "string", description: "Nama lengkap tamu." },
          email:      { type: "string", description: "Alamat email tamu." },
          phone:      { type: "string", description: "Nomor HP/WhatsApp tamu." },
          check_in:   { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
          check_out:  { type: "string", description: "Tanggal check-out format YYYY-MM-DD." },
          adults:     { type: "number", description: "Jumlah tamu dewasa. Default 1." },
          children:   { type: "number", description: "Jumlah anak. Default 0." },
        },
        required: ["room_type", "full_name", "email", "phone", "check_in", "check_out"],
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
          room_type:  { type: "string", description: "Nama tipe kamar yang dipilih tamu." },
          check_in:   { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
          check_out:  { type: "string", description: "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk 1 malam." },
          adults:     { type: "number", description: "Jumlah tamu dewasa. Default 1." },
          children:   { type: "number", description: "Jumlah anak. Default 0." },
          guest_name: { type: "string", description: "Nama tamu bila sudah disebutkan di percakapan. Kosongkan bila belum." },
        },
        required: ["room_type", "check_in"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bookings",
      description: "Daftar booking. Bisa difilter berdasarkan status (pending, confirmed, checked_in, dll) atau tanggal check_in/check_out.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Status booking, misal 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'" },
          date: { type: "string", description: "Tanggal (YYYY-MM-DD) untuk mencari booking yang menginap di tanggal tersebut." },
          limit: { type: "number", description: "Maksimal data yang dikembalikan. Default 10." },
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
  get_bookings:                 "Manager - List Bookings",
  update_booking_status:        "Manager - Update Booking Status",
  change_booking_room:          "Manager - Change Booking Room",
  get_room_specifications:      "Room Specifications",
};
