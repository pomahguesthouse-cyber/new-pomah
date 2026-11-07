/**
 * Penerimaan tawaran media (kasus Sofiah, 8 Nov 2026).
 *
 * Kebijakan properti: permintaan foto/lihat kamar dibalas dengan PDF brosur
 * lewat pipeline brosur yang sudah ada. Jadi "boleh kak" setelah tawaran
 * foto ATAU brosur → kirim dokumen brosur sungguhan, bukan janji/handoff.
 */

import { isBrochureOfferAcceptance, photoOfferAcceptanceText } from "@/services/room-comparison";
import { BROCHURE_CAPTION } from "@/services/wa-media-dedup";

type Message = { direction: string; body?: string };

export type BrochureDocument = { name: string; url: string };

export type BrochureDispatchOutcome<F extends BrochureDocument = BrochureDocument> =
  | { status: "sent"; file: F }
  | { status: "failed"; file: F; error: string | null }
  | { status: "unavailable" };

export type BrochureDispatchDeps<F extends BrochureDocument = BrochureDocument> = {
  loadBrochure: () => Promise<F | null>;
  sendDocument: (
    phone: string,
    caption: string,
    opts: { fileUrl: string; filename: string },
  ) => Promise<{ ok: boolean; channel?: string; error?: string | null }>;
};

/** Tamu menerima tawaran brosur atau tawaran foto kamar → kirim brosur PDF. */
export function isMediaOfferAcceptance(messages: Message[]): boolean {
  return isBrochureOfferAcceptance(messages) || photoOfferAcceptanceText(messages) != null;
}

/** Kirim brosur PDF sebagai dokumen lewat transport yang diberikan. */
export async function dispatchBrochureDocument<F extends BrochureDocument>(
  phone: string,
  deps: BrochureDispatchDeps<F>,
): Promise<BrochureDispatchOutcome<F>> {
  const file = await deps.loadBrochure();
  if (!file) return { status: "unavailable" };
  const result = await deps.sendDocument(phone, BROCHURE_CAPTION, {
    fileUrl: file.url,
    filename: file.name,
  });
  if (!result.ok) return { status: "failed", file, error: result.error ?? null };
  return { status: "sent", file };
}

/**
 * Bila burst tamu menerima tawaran media, kirim brosur. `null` = bukan
 * penerimaan (mis. "nggak usah kak") → tidak ada dispatch.
 */
export async function dispatchOfferAcceptance<F extends BrochureDocument>(
  messages: Message[],
  phone: string,
  deps: BrochureDispatchDeps<F>,
): Promise<BrochureDispatchOutcome<F> | null> {
  if (!isMediaOfferAcceptance(messages)) return null;
  return dispatchBrochureDocument(phone, deps);
}
