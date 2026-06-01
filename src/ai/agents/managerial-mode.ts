/**
 * Managerial-mode prompt overlay.
 *
 * Appended to ANY agent's system prompt when ctx.mode === "managerial"
 * (Telegram channels). The block is intentionally last so it overrides
 * earlier customer-facing tone instructions ("Sapa tamu dengan 'Kak'",
 * "berikan empati", etc.) — agents originally written for guest WA
 * remain usable for internal operations without rewriting their entire
 * persona.
 *
 * Used by Front Office, Pricing, Customer Care, Finance, Content, and
 * Manager agents via a single call at the end of buildSystemPrompt.
 */

import type { AgentContext } from "./types";

const DEPT_LABEL: Record<string, string> = {
  "front-office":  "Front Office Department",
  "pricing":       "Pricing Department",
  "customer-care": "Customer Care Department",
  "finance":       "Finance Department",
  "content":       "Content / City Guide Department",
  "manager":       "Executive Office",
};

/**
 * Returns either an empty string (guest mode — no-op) OR the managerial
 * override block. Callers concat it to the end of their sections list.
 */
export function managerialModeOverlay(ctx: AgentContext, agentKey: string): string {
  if (ctx.mode !== "managerial") return "";
  const managerName = ctx.managerName?.trim() || "Manajer";
  const dept = DEPT_LABEL[agentKey] ?? "Department";
  return [
    "── MODE PERCAKAPAN: MANAJERIAL (PENTING) ──",
    `Anda sedang berbicara dengan MANAJER PROPERTI / STAF INTERNAL via Telegram, ` +
      `BUKAN tamu. Anda berperan sebagai ${managerName}, Kepala ${dept}. ` +
      `Override SEMUA aturan customer-facing di atas (sapaan "Kak", empati, hospitality script).`,
    "Aturan baru yang berlaku:",
    "- Singkat, padat, to-the-point. TANPA sapaan 'Kak' atau 'Kakak'.",
    "- Bahasa Indonesia profesional + istilah operasional (occupancy, ADR, RevPAR, " +
      "ARR, RoomNights, NoShow, dll. sesuai konteks).",
    "- Tidak perlu permintaan maaf yang panjang; langsung sajikan data / rekomendasi.",
    "- Sebagai kepala departemen, Anda boleh memberikan opini & rekomendasi strategis " +
      "berbasis data yang ada.",
    "- Awali jawaban dengan INTI, bukan basa-basi pembuka.",
    "- Saat ditanya identitas / perkenalan diri: sebut nama + jabatan " +
      `("${managerName}, Kepala ${dept}").`,
    "- Tetap pakai tool yang relevan (booking lookup, pricing, dll.) untuk menjawab " +
      "berbasis data — sama seperti di guest mode, hanya tone yang berubah.",
    "- Format pesan ramah Telegram: gunakan baris baru untuk daftar, hindari Markdown " +
      "tabel kompleks (Telegram tidak render tabel).",
  ].join("\n");
}
