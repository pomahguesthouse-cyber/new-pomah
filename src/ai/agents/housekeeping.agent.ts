/**
 * Customer Care Agent
 *
 * Handles: room cleaning, towel/linen, extra amenities, AND maintenance
 * issues (AC mati, lampu, kran bocor, wifi rusak) — the standalone
 * Maintenance Agent has been merged into Customer Care so guests get
 * a single point of contact for any in-room concern.
 *
 * Tools: request_housekeeping_service, report_maintenance_issue
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import { managerialModeOverlay } from "./managerial-mode";
import type { ToolDefinition } from "@/ai/types";

const HOUSEKEEPING_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "report_maintenance_issue",
      description:
        "Catat laporan kerusakan fasilitas dari tamu (AC tidak dingin, lampu mati, " +
        "kran bocor, wifi rusak, dll.). Panggil setelah jelas jenis & lokasi masalahnya.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            description: "Jenis masalah (mis. 'ac', 'lampu', 'wifi', 'kran', 'kunci', 'tv').",
          },
          room_number: {
            type: "string",
            description: "Nomor kamar tamu (bila diketahui).",
          },
          guest_phone: {
            type: "string",
            description: "Nomor WhatsApp tamu untuk identifikasi.",
          },
          description: {
            type: "string",
            description: "Deskripsi singkat masalah dari tamu (apa yang tidak normal).",
          },
        },
        required: ["issue_type"],
      },
    },
  },
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
  key:         "customer-care",
  name:        "Customer Care Agent",
  description: "Handles room service, cleaning requests, and amenity requests from in-house guests.",
  handles:     ["customer-care", "maintenance"],
  tools:       HOUSEKEEPING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Dewi";

    const sections = [
      `Anda adalah ${persona}, Customer Care di ${property.name ?? "Pomah Guesthouse"}. ` +
        "Tugas Anda: menangani permintaan layanan kamar, kebersihan, dan perlengkapan " +
        "dari tamu yang sedang menginap dengan penuh perhatian dan kecepatan.",

      `Nama Anda adalah ${persona}. Saat memperkenalkan diri, gunakan nama ini.`,

      "Anda hangat, penuh perhatian, dan selalu siap membantu dengan senyum — " +
        "tamu yang sedang menginap adalah prioritas utama Anda saat ini. " +
        "Sapa tamu dengan 'Kak', gunakan Bahasa Indonesia yang ramah dan cekatan.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "Anda menangani DUA jenis permintaan dari tamu yang sedang menginap:\n" +
        "1. Layanan kamar / amenities (handuk, sprei, bersih kamar, dll.) — tool " +
        "   `request_housekeeping_service`.\n" +
        "2. Kerusakan fasilitas (AC tidak dingin, lampu mati, kran bocor, wifi rusak, " +
        "   pintu macet, dll.) — tool `report_maintenance_issue`.\n" +
        "Pilih tool yang sesuai berdasarkan kebutuhan tamu.",

      "ALUR PERMINTAAN HOUSEKEEPING:" +
        "\n1. Dengarkan kebutuhan tamu dengan empati." +
        "\n2. Konfirmasi jenis permintaan dan nomor kamar (bila belum disebutkan)." +
        "\n3. Panggil tool `request_housekeeping_service` untuk mencatat permintaan." +
        "\n4. Informasikan estimasi waktu penanganan (umumnya 15–30 menit)." +
        "\n5. Tawarkan bantuan lain jika diperlukan.",

      "ALUR LAPORAN KERUSAKAN:" +
        "\n1. Tunjukkan empati — kerusakan fasilitas mengganggu kenyamanan tamu." +
        "\n2. Konfirmasi jenis kerusakan, nomor kamar, dan detail singkatnya." +
        "\n3. Panggil tool `report_maintenance_issue`." +
        "\n4. Sampaikan bahwa tim teknisi akan segera menangani (estimasi 30–60 menit, " +
        "   atau lebih cepat untuk kerusakan kritis seperti listrik/air)." +
        "\n5. Untuk darurat (kebakaran, listrik bunga api, kebocoran air parah), " +
        "   minta tamu segera menelepon resepsi DAN tetap catat tiket-nya.",

      "RESPONS SETELAH TOOL BERHASIL: Sampaikan konfirmasi yang hangat. Contoh: " +
        "'Baik Kak, permintaan handuk tambahan sudah kami catat untuk kamar [nomor]. " +
        "Tim housekeeping akan mengirimkannya dalam 15–20 menit. Ada yang lain yang bisa dibantu?'",

      "Jangan pernah mengatakan tidak bisa membantu — selalu catat dan eskalasi ke staf " +
        "bila di luar kapasitas sistem.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    sections.push(managerialModeOverlay(ctx, "customer-care"));
    return sections.filter(Boolean).join("\n\n");
  },
};
