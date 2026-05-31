/**
 * Reply post-processing utilities — shared between the WhatsApp autoreply
 * worker and the AI Lab simulator so they produce identical output.
 *
 * Includes:
 *   - Session-gap detection (findSessionStartIndex, SESSION_GAP_MS)
 *   - Brochure-request detection + brosur-doc filter
 *   - Brochure attachment selection
 *   - Trailing-URL stripping (PDFs become attachments; raw image URLs removed)
 */

/** Gap (ms) between two consecutive messages that marks a new session boundary. */
export const SESSION_GAP_MS = 15 * 60 * 1000;

/**
 * Index of the first message in the most recent session — the message right
 * after the last inter-message gap larger than SESSION_GAP_MS. Returns 0 when
 * no such gap exists (everything is one session).
 */
export function findSessionStartIndex(
  messages: Array<{ sent_at?: string }>,
): number {
  for (let i = messages.length - 1; i > 0; i--) {
    const cur = messages[i];
    const prev = messages[i - 1];
    if (!cur.sent_at || !prev.sent_at) continue;
    const diffMs = new Date(cur.sent_at).getTime() - new Date(prev.sent_at).getTime();
    if (diffMs > SESSION_GAP_MS) return i;
  }
  return 0;
}

// ─── Brochure handling ────────────────────────────────────────────────────────

/**
 * A sendable brochure lives ONLY in the dedicated public `brosur` bucket
 * (uploaded via the Brosur tab). Media Library assets — room photos,
 * banners — share doc_category='brosur' but live in the `room-images`
 * bucket and must NOT be sent as brochures.
 */
export function isBrosurDoc(d: { storage_bucket?: string | null }): boolean {
  const bucket = (d.storage_bucket ?? "").trim().toLowerCase();
  return bucket === "brosur";
}

const BROCHURE_REQUEST_PATTERNS: RegExp[] = [
  /\b(brosur|brochure|katalog|catalogue|catalog)(?:nya)?\b/i,
  /\b(gambar|foto|photo|picture|image)(?:nya)?\b.*\b(kamar|hotel|room|tipe|type|penginapan)(?:nya)?\b/i,
  /\b(kamar|room|tipe|type)(?:nya)?\b.*\b(gambar|foto|photo|picture|image)(?:nya)?\b/i,
  /\b(lihat|minta|kirim|kirimin|kasih|tunjuk(?:kan|in)?|ada|boleh|bisa)\b.*\b(gambar|foto|brosur|brochure)(?:nya)?\b/i,
  /\b(gambar|foto|brosur)(?:nya)?\b.*\b(lihat|minta|kirim|dong|ya|kak|nya)\b/i,
];

export function isBrochureRequest(text: string): boolean {
  return BROCHURE_REQUEST_PATTERNS.some((p) => p.test(text));
}

export interface BrosurFile {
  name: string;
  url: string;
}

export interface AttachmentPick {
  url?: string;
  name?: string;
}

/**
 * Pick the brochure attachment for a reply. Three layers, in order:
 *   1. Guest explicitly asked for brosur/foto → prefer PDF, else any file.
 *   2. The LLM mentioned a brosur file by name in its reply.
 *   3. The LLM emitted a direct PDF URL (e.g. invoice) — extract it, the
 *      caller should strip it from the reply body.
 */
export function pickAttachment(
  guestMessage: string,
  reply: string,
  brosurFiles: BrosurFile[],
): AttachmentPick {
  // 1. Explicit brochure request
  if (brosurFiles.length > 0 && isBrochureRequest(guestMessage)) {
    const brosur =
      brosurFiles.find((f) => /\.pdf(\?|$)/i.test(f.url)) ?? brosurFiles[0];
    if (brosur) return { url: brosur.url, name: brosur.name };
  }
  // 2. LLM mentioned a brosur file
  if (brosurFiles.length > 0) {
    const lowered = reply.toLowerCase();
    for (const f of brosurFiles) {
      const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
      if (
        lowered.includes(f.name.toLowerCase()) ||
        lowered.includes(baseName.toLowerCase())
      ) {
        return { url: f.url, name: f.name };
      }
    }
  }
  // 3. Direct PDF URL in reply (invoice, etc.)
  const pdfMatch = reply.match(/(https?:\/\/[^\s]+?\.pdf)/i);
  if (pdfMatch) return { url: pdfMatch[1], name: "Invoice.pdf" };
  return {};
}

/**
 * Clean a reply body before sending to WhatsApp:
 *   - Remove the PDF URL we just turned into an attachment (if any).
 *   - Strip bare image URLs so WA doesn't render a photo unexpectedly.
 *   - Collapse trailing-whitespace lines and triple+ newlines.
 */
export function cleanReplyBody(reply: string, attachedPdfUrl?: string): string {
  let out = reply;
  if (attachedPdfUrl) out = out.replace(attachedPdfUrl, "");
  return out
    .replace(/https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
