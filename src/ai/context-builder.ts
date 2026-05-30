/**
 * System prompt builder.
 *
 * Assembles the hotel-specific system prompt from structured data.
 * Pure function — no I/O, easy to unit-test.
 */

import { fmtDateID, todayWIB } from "@/lib/date";
import type { AiLabConfig } from "./types";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RoomTypeRow {
  id:          string;
  name:        string;
  base_rate:   number | null;
  capacity:    number | null;
  bed_type:    string | null;
  description: string | null;
  amenities?:  string[] | null;
  extrabed_capacity?: number | null;
  extrabed_rate?:     number | null;
}

export interface PropertyRow {
  name?:                   string;
  payment_bank_name?:      string;
  payment_account_number?: string;
  payment_account_holder?: string;
}

export interface SystemPromptParams {
  property:   PropertyRow;
  aiLabConfig: AiLabConfig;
  rooms:      RoomTypeRow[];
  /** SOP text already fetched & trimmed (pass "" if disabled or unavailable) */
  sopText:    string;
}

// ─── Agent key order ──────────────────────────────────────────────────────────

const AGENT_KEYS = [
  "front-office",
  "pricing",
  "customer-care",
  "maintenance",
  "finance",
  "manager",
] as const;

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { property, aiLabConfig, rooms, sopText } = params;
  const today = todayWIB();

  // Active agent instructions
  const agentLines = AGENT_KEYS
    .filter((k) => aiLabConfig.agents[k]?.enabled && aiLabConfig.agents[k]?.instructions?.trim())
    .map((k) => `• ${k}: ${aiLabConfig.agents[k].instructions.trim()}`);

  // Room catalogue
  const roomLines = rooms.map(
    (r) =>
      `• ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam, ` +
      `kapasitas ${r.capacity ?? "-"} tamu${r.bed_type ? `, ${r.bed_type}` : ""}` +
      `${r.amenities && r.amenities.length ? `, Fasilitas: ${r.amenities.join(", ")}` : ""}` +
      `${r.description ? `, Deskripsi: ${r.description}` : ""}`,
  );

  const sections: string[] = [
    `Anda adalah asisten AI untuk ${property.name ?? "Pomah Guesthouse"}, sebuah penginapan. ` +
      "Anda membalas pesan WhatsApp.",

    "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",

    `Hari ini tanggal ${fmtDateID(today)}.`,

    "FORMAT TANGGAL: selalu tampilkan tanggal ke tamu dalam format Indonesia, " +
      "contoh '19 Mei 2026'. JANGAN tampilkan format YYYY-MM-DD.",

    agentLines.length
      ? `Panduan tiap agent:\n${agentLines.join("\n")}`
      : "",

    roomLines.length
      ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
      : "",

    sopText
      ? "Cuplikan Pengetahuan SOP (hasil pencarian relevan, rujuk untuk menjawab kebijakan, prosedur, lokasi & info " +
        "lainnya). Sebagian cuplikan menyertakan '(Tautan: <url>)'. Bila tamu meminta link, " +
        "lokasi, peta/Google Maps, alamat, atau panduan tertentu, KIRIMKAN URL lengkap dari " +
        "cuplikan SOP yang relevan. Tulis URL-nya POLOS dan UTUH — salin persis, jangan " +
        "dipotong, jangan dibungkus tanda kurung/markdown, dan jangan beri tanda baca " +
        `menempel di akhir URL. Jangan pernah mengarang URL.\n${sopText}`
      : "",

    "KETERSEDIAAN KAMAR: Anda memiliki tool `check_room_availability`. Setiap kali tamu " +
      "menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin " +
      "booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak ketersediaan. " +
      "Jika tamu tidak menyebut tanggal, anggap untuk hari ini (check-in hari ini, 1 malam).",

    "Saat menyampaikan hasil tool: awali dengan baris 'Ketersediaan kamar untuk <tanggal>'. " +
      "Lalu tiap tipe kamar satu baris — gunakan ✅ bila ada kamar tersedia atau ❌ bila penuh, " +
      "diikuti nama kamar, jumlah kamar tersedia, dan harga per malam. " +
      "Tutup dengan ajakan memilih kamar untuk lanjut booking.",

    "BOOKING VIA CHAT: Anda dapat membuatkan pesanan kamar langsung. Alurnya: (1) cek " +
      "ketersediaan dengan tool, (2) setelah tamu memilih satu tipe kamar, minta nama " +
      "lengkap, email, dan nomor HP tamu, (3) setelah SEMUA data lengkap baru panggil tool " +
      "`create_booking`. JANGAN pernah mengarang data tamu — bila ada yang belum diberikan, " +
      "tanyakan dulu dan jangan panggil tool.",

    "Setelah `create_booking` berhasil: sampaikan sapaan dengan nama tamu, kode booking, " +
      "total harga, lalu instruksi transfer ke rekening (bank, nomor rekening, atas nama) " +
      "bila tersedia, dan minta tamu mengirim bukti pembayaran. Bila info rekening kosong, " +
      "beritahu tamu bahwa detail pembayaran akan dikirim staf. Bila tool gagal, sampaikan " +
      "alasannya dengan sopan.",

    "Ini percakapan WhatsApp — gunakan format teks biasa, hindari Markdown " +
      "(jangan pakai *, _, atau #).",
  ];

  return sections.filter(Boolean).join("\n\n");
}
