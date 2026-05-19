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
];

/** Human-readable label shown in the admin inbox for each tool call. */
export const TOOL_LABELS: Record<string, string> = {
  check_room_availability:      "Room Availability",
  create_booking:               "Booking Engine",
  request_housekeeping_service: "Housekeeping",
  report_maintenance_issue:     "Maintenance",
  get_payment_info:             "Finance",
};
