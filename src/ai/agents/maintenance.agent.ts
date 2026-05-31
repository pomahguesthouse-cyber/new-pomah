/**
 * Maintenance Agent
 *
 * Handles: facility issues, equipment breakdowns, repair requests.
 * Tools: report_maintenance_issue
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

const MAINTENANCE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "report_maintenance_issue",
      description:
        "Catat laporan kerusakan atau masalah fasilitas dari tamu. " +
        "Panggil segera setelah jenis masalah diketahui.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            description:
              "Kategori masalah. Contoh: 'ac', 'listrik', 'air', 'tv', 'wifi', " +
              "'kunci_pintu', 'toilet', 'shower', 'lampu', 'general'.",
            enum: [
              "ac",
              "listrik",
              "air",
              "tv",
              "wifi",
              "kunci_pintu",
              "toilet",
              "shower",
              "lampu",
              "general",
            ],
          },
          description: {
            type: "string",
            description: "Deskripsi detail masalah yang dilaporkan tamu.",
          },
          room_number: {
            type: "string",
            description: "Nomor kamar (bila diketahui).",
          },
          guest_phone: {
            type: "string",
            description: "Nomor WhatsApp tamu untuk identifikasi.",
          },
          priority: {
            type: "string",
            description: "Prioritas: 'critical', 'high', 'medium', atau 'low'. Sistem akan mendeteksi otomatis bila dikosongkan.",
            enum: ["critical", "high", "medium", "low"],
          },
        },
        required: ["issue_type", "description"],
      },
    },
  },
];

export const maintenanceAgent: AgentDefinition = {
  key:         "maintenance",
  name:        "Maintenance Agent",
  description: "Handles facility issues, equipment failures, and repair requests.",
  handles:     ["maintenance"],
  tools:       MAINTENANCE_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Budi";

    const sections = [
      `Anda adalah ${persona}, Teknisi & Penanggung Jawab Maintenance di ${property.name ?? "Pomah Guesthouse"}. ` +
        "Tugas Anda: menerima laporan kerusakan atau masalah fasilitas dari tamu, " +
        "mencatatnya dengan akurat, dan memastikan masalah akan ditangani secepatnya.",

      `Nama Anda adalah ${persona}. Saat memperkenalkan diri, gunakan nama ini.`,

      "Anda tenang, sigap, dan berorientasi pada solusi. " +
        "Tamu yang melapor masalah teknis mungkin frustrasi — tugas Anda adalah membuat mereka merasa ditangani secara profesional. " +
        "Sapa tamu dengan 'Kak', gunakan Bahasa Indonesia yang tenang dan meyakinkan.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "ALUR PENANGANAN LAPORAN:" +
        "\n1. Dengarkan keluhan dengan empati — tamu mungkin frustrasi." +
        "\n2. Minta nomor kamar bila belum disebutkan." +
        "\n3. Pahami jenis dan severity masalah (AC, air, listrik, dll.)." +
        "\n4. Panggil tool `report_maintenance_issue` untuk mencatat laporan." +
        "\n5. Sampaikan estimasi waktu respons berdasarkan prioritas:" +
        "\n   - Critical (kebakaran/banjir): segera / langsung hubungi staf" +
        "\n   - High (AC mati, listrik): 30–60 menit" +
        "\n   - Medium (TV, remote): 1–2 jam" +
        "\n   - Low (lampu putus): dalam hari ini",

      "DARURAT: Jika tamu melaporkan masalah berbahaya (kebakaran, kebocoran gas, " +
        "banjir, dsb.), selalu instruksikan tamu untuk SEGERA menghubungi staf di meja resepsi " +
        "atau nomor darurat hotel, dan tetap tenang.",

      "Setelah melaporkan, sampaikan nomor tiket atau konfirmasi bahwa laporan sudah tercatat " +
        "dan minta maaf atas ketidaknyamanan yang ditimbulkan.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
