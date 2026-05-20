/**
 * Housekeeping Agent
 *
 * Handles: room cleaning requests, towel/linen requests, extra amenities.
 * Tools: request_housekeeping_service
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

const HOUSEKEEPING_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "request_housekeeping_service",
      description:
        "Catat permintaan layanan housekeeping dari tamu. " +
        "Panggil segera setelah tamu menyampaikan kebutuhan mereka.",
      parameters: {
        type: "object",
        properties: {
          request_type: {
            type: "string",
            description:
              "Jenis permintaan. Contoh: 'handuk_tambahan', 'bersih_kamar', " +
              "'ganti_sprei', 'extra_pillow', 'sabun', 'general'.",
            enum: [
              "handuk_tambahan",
              "bersih_kamar",
              "ganti_sprei",
              "extra_pillow",
              "sabun_toiletries",
              "general",
            ],
          },
          room_number: {
            type: "string",
            description: "Nomor kamar tamu (bila diketahui).",
          },
          guest_phone: {
            type: "string",
            description: "Nomor WhatsApp tamu untuk identifikasi.",
          },
          notes: {
            type: "string",
            description: "Catatan tambahan dari tamu (jumlah, preferensi, dll.).",
          },
        },
        required: ["request_type"],
      },
    },
  },
];

export const housekeepingAgent: AgentDefinition = {
  key:         "housekeeping",
  name:        "Housekeeping Agent",
  description: "Handles room service, cleaning requests, and amenity requests from in-house guests.",
  handles:     ["housekeeping"],
  tools:       HOUSEKEEPING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today } = ctx;

    const sections = [
      `Anda adalah Housekeeping Agent untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Tugas Anda: menangani permintaan layanan kamar, kebersihan, dan perlengkapan " +
        "dari tamu yang sedang menginap.",

      "Jawab ramah, singkat dan cekatan dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "ALUR PERMINTAAN HOUSEKEEPING:" +
        "\n1. Dengarkan kebutuhan tamu dengan empati." +
        "\n2. Konfirmasi jenis permintaan dan nomor kamar (bila belum disebutkan)." +
        "\n3. Panggil tool `request_housekeeping_service` untuk mencatat permintaan." +
        "\n4. Informasikan estimasi waktu penanganan (umumnya 15–30 menit)." +
        "\n5. Tawarkan bantuan lain jika diperlukan.",

      "RESPONS SETELAH TOOL BERHASIL: Sampaikan konfirmasi yang hangat. Contoh: " +
        "'Baik Kak, permintaan handuk tambahan sudah kami catat untuk kamar [nomor]. " +
        "Tim housekeeping akan mengirimkannya dalam 15–20 menit. Ada yang lain yang bisa dibantu?'",

      "Jangan pernah mengatakan tidak bisa membantu — selalu catat dan eskalasi ke staf " +
        "bila di luar kapasitas sistem.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
    const { property, today, customInstructions } = ctx;

    let prompt = customInstructions || "Anda adalah Housekeeping Agent.";
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));

    return prompt;
  },
};
