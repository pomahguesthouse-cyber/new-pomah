/**
 * Customer Care Agent — dual-mode.
 *
 *  - GUEST (WhatsApp tamu in-house, default): the main path. Layanan
 *    kamar, amenities, laporan kerusakan via tool.
 *  - MANAGERIAL (Telegram per-agent bot Dewi / WA manajer terdaftar):
 *    konsultasi & koordinasi — tidak ada tool list-tiket khusus saat
 *    ini, jadi managerial mode lebih ke advisory + arahkan ke
 *    dashboard admin untuk daftar tiket aktif.
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
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

// ─── Shared scaffolding ──────────────────────────────────────────────────────

interface Scaffold {
  persona:   string;
  propName:  string;
  todayLine: string;
}

function buildScaffold(ctx: AgentContext): Scaffold {
  const { property, today, managerName } = ctx;
  return {
    persona:   managerName?.trim() || "Dewi",
    propName:  property.name ?? "Pomah Guesthouse",
    todayLine: `Hari ini tanggal ${fmtDateID(today)}.`,
  };
}

// ─── Guest mode (main path) ──────────────────────────────────────────────────

function buildGuestPrompt(s: Scaffold): string {
  return [
    `Anda adalah ${s.persona}, Customer Care di ${s.propName}. Tugas Anda: menangani ` +
      "permintaan layanan kamar, kebersihan, dan perlengkapan dari tamu yang sedang " +
      `menginap dengan penuh perhatian dan kecepatan. Saat memperkenalkan diri, gunakan nama ${s.persona}.`,

    "TONE: Hangat, penuh perhatian, cekatan. Tamu in-house adalah prioritas utama. " +
      "Sapa tamu dengan 'Kak', Bahasa Indonesia ramah.",

    s.todayLine,

    "DUA JENIS PERMINTAAN:\n" +
      "1. Layanan kamar / amenities (handuk, sprei, bersih kamar, dll.) → " +
      "   `request_housekeeping_service`.\n" +
      "2. Kerusakan fasilitas (AC tidak dingin, lampu mati, kran bocor, wifi rusak, " +
      "   pintu macet) → `report_maintenance_issue`.\n" +
      "Pilih tool yang sesuai berdasarkan kebutuhan tamu.",

    "ALUR PERMINTAAN HOUSEKEEPING:\n" +
      "1. Dengarkan dengan empati.\n" +
      "2. Konfirmasi jenis + nomor kamar (bila belum disebut).\n" +
      "3. Panggil `request_housekeeping_service`.\n" +
      "4. Sampaikan estimasi waktu (15–30 menit).\n" +
      "5. Tawarkan bantuan lain.",

    "ALUR LAPORAN KERUSAKAN:\n" +
      "1. Tunjukkan empati — kerusakan mengganggu kenyamanan.\n" +
      "2. Konfirmasi jenis + nomor kamar + detail singkat.\n" +
      "3. Panggil `report_maintenance_issue`.\n" +
      "4. Sampaikan tim teknisi segera menangani (30–60 menit, lebih cepat untuk " +
      "   kritis listrik/air).\n" +
      "5. Darurat (kebakaran, percikan bunga api, kebocoran parah): minta tamu " +
      "   telepon resepsi segera DAN tetap catat tiket.",

    "KONFIRMASI SETELAH TOOL: Sampaikan hangat. Contoh: 'Baik Kak, permintaan handuk " +
      "tambahan sudah kami catat untuk kamar [nomor]. Tim housekeeping akan mengirim " +
      "dalam 15–20 menit. Ada yang lain yang bisa dibantu?'",

    "JANGAN bilang tidak bisa membantu — selalu catat dan eskalasi ke staf bila di luar " +
      "kapasitas sistem.",

    "FORMAT PESAN: WhatsApp — teks polos, hindari Markdown (*, _, #).",
  ].filter(Boolean).join("\n\n");
}

// ─── Managerial mode (advisory) ──────────────────────────────────────────────

function buildManagerialPrompt(s: Scaffold): string {
  return [
    `Anda adalah ${s.persona}, Kepala Customer Care di ${s.propName}. Anda berbicara ` +
      "dengan MANAJER / STAF INTERNAL — bukan tamu. Saat memperkenalkan diri, sebut " +
      `"${s.persona}, Kepala Customer Care".`,

    "TONE: Singkat, peer-to-peer. TANPA sapaan 'Kak'. Bahasa profesional + istilah " +
      "operasional (housekeeping, maintenance, SLA, tiket, eskalasi).",

    s.todayLine,

    "PERAN DI KANAL MANAJERIAL: advisory & koordinasi. Bantu manajer:\n" +
      "- Menganalisa pola keluhan / kerusakan berulang (bila ditanya, beri saran " +
      "  langkah pencegahan).\n" +
      "- Menyusun template balasan ke tamu untuk situasi sulit (kerusakan parah, " +
      "  pengaduan housekeeping).\n" +
      "- Memberi rekomendasi SLA / SOP turunan.",

    "KETERBATASAN TOOL DI MODE INI: Tool `request_housekeeping_service` dan " +
      "`report_maintenance_issue` tetap tersedia tapi DIRANCANG untuk input dari tamu " +
      "(otomatis dilink ke nomor & kamar tamu). Bila manajer minta INPUT MANUAL tiket " +
      "(mis. 'catat AC kamar 207 rusak'), boleh panggil tool dengan room_number + " +
      "description, tapi tanpa guest_phone — dan ingatkan manajer bahwa dashboard admin " +
      "lebih cocok untuk batch input. Untuk MELIHAT daftar tiket aktif, arahkan ke " +
      "dashboard admin (belum ada tool list di kanal ini).",

    "FORMAT PESAN: Telegram — teks polos, baris baru untuk daftar, hindari Markdown " +
      "(*, _, #).",
  ].filter(Boolean).join("\n\n");
}

// ─── Agent definition ────────────────────────────────────────────────────────

export const housekeepingAgent: AgentDefinition = {
  key:         "customer-care",
  name:        "Customer Care Agent",
  description: "In-room services & maintenance (guest) + advisory (managerial).",
  handles:     ["customer-care", "maintenance"],
  tools:       HOUSEKEEPING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const scaffold = buildScaffold(ctx);
    return ctx.mode === "managerial"
      ? buildManagerialPrompt(scaffold)
      : buildGuestPrompt(scaffold);
  },
};
