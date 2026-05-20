/**
 * Front Office Agent
 *
 * Handles: greetings, booking inquiries, availability checks, general questions.
 * Tools: check_room_availability, create_booking
 */

import { fmtDateID } from "@/lib/date";
import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { AgentDefinition, AgentContext } from "./types";

export const frontOfficeAgent: AgentDefinition = {
  key:         "front-office",
  name:        "Front Office Agent",
  description: "Handles guest greetings, room inquiries, booking creation, and general questions.",
  handles:     ["greeting", "booking_inquiry", "availability_check", "general"],
  tools:       TOOL_DEFINITIONS, // check_room_availability + create_booking

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, rooms, sopText, today } = ctx;

    const roomLines = rooms.map(
      (r) =>
        `• ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam, ` +
        `kapasitas ${r.capacity ?? "-"} tamu${r.bed_type ? `, ${r.bed_type}` : ""}`,
    );

    const sections = [
      `Anda adalah Front Office Agent untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda menangani pertanyaan kamar, reservasi, dan info umum hotel via WhatsApp.",

      "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "FORMAT TANGGAL: tampilkan selalu dalam format Indonesia, contoh '19 Mei 2026'. " +
        "JANGAN tampilkan format YYYY-MM-DD kepada tamu.",

      roomLines.length
        ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
        : "",

      "KETERSEDIAAN KAMAR: Kamu memiliki tool `check_room_availability`. Setiap kali tamu " +
        "menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin " +
        "booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak. " +
        "Jika tamu tidak menyebut tanggal, anggap hari ini (check-in hari ini, 1 malam).",

      "Saat menyampaikan hasil ketersediaan: awali dengan 'Ketersediaan kamar untuk <tanggal>'. " +
        "Tiap tipe kamar satu baris — gunakan ✅ bila tersedia atau ❌ bila penuh, " +
        "diikuti nama kamar, jumlah tersedia, dan harga per malam. " +
        "Tutup dengan ajakan memilih kamar untuk lanjut booking.",

      "BOOKING VIA CHAT: Alurnya: " +
        "(1) cek ketersediaan dengan tool, " +
        "(2) setelah tamu memilih tipe kamar, minta nama lengkap, email, dan nomor HP, " +
        "(3) setelah SEMUA data lengkap baru panggil tool `create_booking`. " +
        "JANGAN mengarang data tamu — bila belum diberikan, tanyakan dulu.",

      "Setelah `create_booking` berhasil: sampaikan sapaan nama tamu, kode booking, " +
        "total harga, lalu instruksi transfer ke rekening (bank, nomor, atas nama) bila tersedia, " +
        "dan minta bukti pembayaran. Bila info rekening kosong, beritahu bahwa staf akan mengirim detail.",

      sopText
        ? "Basis Pengetahuan SOP:\n" +
          "Gunakan untuk menjawab kebijakan, prosedur, lokasi & info lainnya. " +
          "Bila ada URL di entri SOP, kirimkan URL POLOS dan UTUH — jangan potong atau bungkus markdown. " +
          `Jangan mengarang URL.\n${sopText}`
        : "",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
    let prompt = customInstructions || "Anda adalah Front Office Agent.";
    
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));
    
    const roomDataText = roomLines.length
      ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
      : "";
    prompt = prompt.replace(/\{\{ROOM_DATA\}\}/g, roomDataText);
    
    const sopDataText = sopText
      ? "Basis Pengetahuan SOP:\n" +
        "Gunakan untuk menjawab kebijakan, prosedur, lokasi & info lainnya. " +
        "Bila ada URL di entri SOP, kirimkan URL POLOS dan UTUH — jangan potong atau bungkus markdown. " +
        `Jangan mengarang URL.\n${sopText}`
      : "";
    prompt = prompt.replace(/\{\{SOP_DATA\}\}/g, sopDataText);

    return prompt;
  },
};
