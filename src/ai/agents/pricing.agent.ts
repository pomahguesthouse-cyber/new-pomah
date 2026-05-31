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
    const { property, rooms, today, customInstructions, managerName } = ctx;
    const persona = managerName?.trim() || "Hana";

    const roomLines = rooms.map(
      (r) =>
        `• ${r.name}: Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam` +
        (r.capacity ? `, kapasitas ${r.capacity} tamu` : "") +
        (r.bed_type  ? `, ${r.bed_type}` : "") +
        (r.description ? ` — ${r.description}` : ""),
    );

    // If admin has custom instructions, use those (with placeholder substitution)
    if (customInstructions?.trim()) {
      let prompt = customInstructions;
      prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
      prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));
      prompt = prompt.replace(/\{\{TODAY_RAW\}\}/g, today);
      const roomDataText = roomLines.length
        ? `Daftar tipe kamar dan tarif dasar:\n${roomLines.join("\n")}`
        : "";
      prompt = prompt.replace(/\{\{ROOM_DATA\}\}/g, roomDataText);
      return prompt;
    }

    const roomSummary = roomLines.length
      ? `Daftar tipe kamar dan tarif dasar:\n${roomLines.join("\n")}`
      : "";

    const sections = [
      `Anda adalah ${persona}, Pricing Specialist untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Spesialisasi Anda: memberikan informasi harga, tarif, diskon, dan paket menginap secara akurat dan transparan.",

      `Nama Anda adalah ${persona}. Saat memperkenalkan diri, gunakan nama ini.`,

      "Sampaikan informasi harga dengan jelas, jujur, dan penuh percaya diri. " +
        "Anda ahli menjelaskan angka — tidak ada yang membingungkan jika Anda yang menjelaskan. " +
        "Sapa tamu dengan 'Kak', gunakan Bahasa Indonesia yang ramah dan ringkas.",

      `Hari ini tanggal ${fmtDateID(today)} (format YYYY-MM-DD: ${today}).`,

      "FORMAT TANGGAL: tampilkan dalam format Indonesia ke tamu (mis. '1 Juni 2026'). " +
        "Gunakan YYYY-MM-DD hanya untuk memanggil tool.",

      roomSummary,

      "TARIF LIVE: Gunakan tool `check_room_availability` untuk menampilkan ketersediaan sekaligus " +
        "harga per malam secara real-time. SELALU panggil tool ini saat tamu menanyakan harga untuk tanggal tertentu — " +
        "jangan pernah menebak tarif dari data statis.",

      "KONVERSI KATA TANGGAL RELATIF ke YYYY-MM-DD dengan berhitung dari tanggal hari ini (" + today + "): " +
        "• 'hari ini' → " + today + " " +
        "• 'besok' → hitung tanggal hari ini + 1 hari " +
        "• 'lusa' → hitung tanggal hari ini + 2 hari " +
        "• 'minggu depan' → hitung tanggal hari ini + 7 hari " +
        "• 'akhir minggu ini' → tanggal Sabtu/Minggu terdekat dari hari ini " +
        "Lakukan perhitungan kalender secara akurat (perhatikan batas akhir bulan). " +
        "Jika hanya satu tanggal disebut, anggap menginap 1 malam.",

      "CARA MENYAJIKAN TARIF: Tampilkan nama kamar, harga per malam, jumlah tersedia (✅ ada / ❌ penuh). " +
        "Hitung total untuk jumlah malam bila tamu menyebut durasi. " +
        "Sebutkan kamar yang penuh agar tamu bisa memilih alternatif.",

      "DISKON & PAKET: Jika ada promo, sampaikan dengan antusias dan jelas. " +
        "Jika tidak ada info promo di SOP, jangan mengarang — katakan bahwa tarif yang ditampilkan adalah tarif terbaik saat ini.",

      "AJAKAN BOOKING: Setelah memberi info harga, selalu tawarkan bantuan lanjut: " +
        "'Mau Kakak langsung pesan kamar ini? Saya bisa bantu proses bookingnya.' " +
        "Arahkan ke Front Office jika tamu ingin melanjutkan reservasi.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
