/**
 * Logika murni tombol "Kirim Brosur" di kotak balasan admin WhatsApp.
 *
 * Kiriman staf TIDAK dibatasi aturan anti-spam bot (30 menit / 3x per 24 jam),
 * tapi tetap dicatat dengan caption `BROCHURE_CAPTION` + `media_type: document`
 * supaya `loadThreadBrochureSendTimes` menghitungnya dan bot tidak mengirim
 * ulang brosur tepat setelah staf.
 */
import { BROCHURE_CAPTION } from "@/services/wa-media-dedup";

export const ADMIN_BROCHURE_SOURCE = "admin_brochure";

export function canSendBrochure(input: {
  hasThread: boolean;
  metaWindowClosed: boolean;
  sending: boolean;
}): boolean {
  return input.hasThread && !input.metaWindowClosed && !input.sending;
}

/** Teks cadangan bila dokumen PDF gagal dikirim (non-24-jam). */
export function adminBrochureLinkText(url: string): string {
  return `${BROCHURE_CAPTION}\nBrosur Pomah Guesthouse bisa dibuka lewat tautan ini:\n${url}`;
}

export function adminBrochureMetadata(input: {
  fileName: string;
  url: string;
  delivery: "document" | "link";
}): Record<string, unknown> {
  return {
    is_manual_admin: true,
    source: ADMIN_BROCHURE_SOURCE,
    agent_key: "admin-brochure",
    ...(input.delivery === "document"
      ? {
          media_type: "document",
          mime_type: "application/pdf",
          file_name: input.fileName,
          media_url: input.url,
        }
      : { brochure_link: input.url }),
  };
}
