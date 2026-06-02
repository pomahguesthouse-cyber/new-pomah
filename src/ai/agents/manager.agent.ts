/**
 * Manager Agent
 *
 * Always invoked in managerial mode — the multi-agent orchestrator routes
 * directly here when `isManager === true` (Telegram per-agent bot, or a
 * WhatsApp number registered in property_managers). Guests never reach
 * this agent, so the prompt is single-track managerial. No overlay, no
 * "Sapa tamu dengan Kak" leftovers.
 *
 * Special tool: `ask_agent` — delegate to a specialist agent and feed the
 * reply back as a tool result. The orchestrator intercepts the call.
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext, AgentKey } from "./types";
import { BOOKING_LIST_FORMAT_BLOCK } from "./booking-list-format";
import type { ToolDefinition } from "@/ai/types";
import { TOOL_DEFINITIONS } from "@/tools/registry";

/** Delegation tool — intercepted by the multi-agent orchestrator */
export const ASK_AGENT_TOOL_NAME = "ask_agent" as const;

export const MANAGER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: ASK_AGENT_TOOL_NAME,
      description:
        "Delegasikan pertanyaan spesifik ke agent spesialis lain dan dapatkan responsnya. " +
        "Gunakan ini saat masalah tamu membutuhkan keahlian agent tertentu " +
        "(misal: tanya harga → pricing, kerusakan → maintenance).",
      parameters: {
        type: "object",
        properties: {
          agent_key: {
            type: "string",
            description: "Agent yang akan ditanya.",
            enum: [
              "front-office",
              "pricing",
              "customer-care",
              "finance",
              "content",
            ] satisfies AgentKey[],
          },
          question: {
            type: "string",
            description:
              "Pertanyaan atau instruksi yang dikirimkan ke agent tersebut. " +
              "Tulis dengan jelas dan lengkap karena agent tidak tahu konteks percakapan ini.",
          },
        },
        required: ["agent_key", "question"],
      },
    },
  },
  ...TOOL_DEFINITIONS.filter((t) =>
    ["get_bookings", "update_booking_status", "change_booking_room", "reply_to_guest"].includes(t.function.name)
  ),
];

export const managerAgent: AgentDefinition = {
  key:         "manager",
  name:        "Manager Agent",
  description: "Always-managerial agent for property managers/staff.",
  handles:     ["complaint"],
  tools:       MANAGER_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Asisten Manajer";
    const propName = property.name ?? "Pomah Guesthouse";

    return [
      // ── Identity ────────────────────────────────────────────────────────
      `Anda adalah ${persona}, Asisten Digital Manajer Properti untuk ${propName}. ` +
        "Anda HANYA melayani manajer / staf internal (kanal ini sudah diautentikasi). " +
        "Tugas Anda: menjalankan instruksi operasional manajer secara cepat, tepat, dan profesional. " +
        "Saat memperkenalkan diri, sebut nama Anda.",

      // ── Tone (managerial — bukan customer-facing) ───────────────────────
      "TONE: Singkat, padat, peer-to-peer. TANPA sapaan 'Kak' atau 'Kakak' " +
        "(itu untuk tamu, bukan manajer). Bahasa Indonesia profesional dengan istilah " +
        "operasional perhotelan (occupancy, ADR, RoomNights, NoShow, dst. sesuai konteks). " +
        "Awali jawaban dengan INTI / data, bukan basa-basi pembuka. Tidak perlu permohonan " +
        "maaf panjang. Anda boleh memberikan opini & rekomendasi strategis berbasis data.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      // ── Workflows ───────────────────────────────────────────────────────
      "MERELAY BALASAN KE TAMU: Bila manajer minta 'balas tamu 0812...', 'kirim pesan ke " +
        "tamu', atau sejenisnya, panggil `reply_to_guest` dengan guest_phone + message. " +
        "Konfirmasi balik ke manajer setelah berhasil ('Sudah dikirim ke 6281...').",

      "DELEGASI KE AGENT SPESIALIS via `ask_agent`. Pakai saat manajer butuh data yang " +
        "dipegang agent lain (harga → pricing, status pembayaran detail → finance, dst.). " +
        "Setelah dapat jawaban, gabungkan dengan respons Anda — JANGAN pass-through mentah.",

      "PENANGANAN KELUHAN (saat manajer memforward komplain tamu): bantu manajer menyusun " +
        "respons — tawarkan draft kalimat, identifikasi akar masalah, sarankan tindakan " +
        "(refund partial, kompensasi non-tunai, eskalasi). JANGAN langsung membalas tamu " +
        "kecuali manajer memerintahkan via `reply_to_guest`.",

      "DARURAT: Untuk situasi yang manajer laporkan sebagai darurat (kebakaran, medis, " +
        "keamanan), beri saran tindakan operasional segera dan ingatkan kontak darurat " +
        "lokal — JANGAN suruh tamu menunggu balasan bot.",

      // ── Output formatting (Telegram-friendly) ───────────────────────────
      "FORMAT PESAN: Telegram — teks polos, gunakan baris baru untuk daftar, hindari " +
        "Markdown (*, _, #) dan tabel kompleks (Telegram tidak render tabel).",

      BOOKING_LIST_FORMAT_BLOCK,
    ].join("\n\n");
  },
};
