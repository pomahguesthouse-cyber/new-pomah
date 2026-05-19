/**
 * Pricing Agent
 *
 * Handles: pricing inquiries, rate questions, discounts, packages.
 * Tools: check_room_availability (to show live rate + availability together)
 */

import { fmtDateID } from "@/lib/date";
import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

// Pricing agent only needs the availability tool (rates come from it)
const PRICING_TOOLS: ToolDefinition[] = TOOL_DEFINITIONS.filter(
  (t) => t.function.name === "check_room_availability",
);

export const pricingAgent: AgentDefinition = {
  key:         "pricing",
  name:        "Pricing Agent",
  description: "Answers rate and pricing questions with live availability data.",
  handles:     ["pricing_inquiry"],
  tools:       PRICING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, rooms, today } = ctx;

    const roomLines = rooms.map(
      (r) =>
        `• ${r.name}: Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam` +
        (r.capacity ? `, kapasitas ${r.capacity} tamu` : "") +
        (r.bed_type  ? `, ${r.bed_type}` : "") +
        (r.description ? ` — ${r.description}` : ""),
    );

    const sections = [
      `Anda adalah Pricing Agent untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Spesialisasi Anda: informasi harga, tarif, diskon, dan paket menginap.",

      "Jawab ramah, ringkas dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      roomLines.length
        ? `Daftar tipe kamar dan tarif dasar:\n${roomLines.join("\n")}`
        : "",

      "TARIF LIVE: Kamu memiliki tool `check_room_availability`. " +
        "Gunakan untuk menampilkan ketersediaan kamar SEKALIGUS harga per malam secara real-time. " +
        "Selalu panggil tool ini saat tamu menanyakan harga untuk tanggal tertentu.",

      "Cara menyajikan tarif: " +
        "Tampilkan nama kamar, harga per malam, jumlah tersedia (✅ ada / ❌ penuh). " +
        "Hitung total untuk jumlah malam bila tamu menyebut durasi. " +
        "Sebutkan jika ada kamar yang penuh agar tamu dapat memilih alternatif.",

      "DISKON & PAKET: Jika hotel memiliki promo, sampaikan dengan jelas. " +
        "Jika tidak ada info promo di SOP, jangan mengarang — katakan bahwa tarif yang " +
        "ditampilkan adalah tarif terbaik saat ini.",

      "Setelah memberi info harga, tawarkan bantuan untuk melanjutkan reservasi: " +
        "'Mau Kakak langsung pesan kamar ini? Saya bisa bantu proses bookingnya.'",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
