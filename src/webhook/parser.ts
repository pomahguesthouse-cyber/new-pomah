/**
 * Fonnte webhook body parser.
 *
 * Fonnte may send either JSON or application/x-www-form-urlencoded.
 * This parser handles both and returns a normalised event or null if
 * the payload is missing required fields (sender / message).
 */

import type { FonntePayload, ParsedWebhookEvent } from "./types";

export async function parseFonnteBody(
  request: Request,
): Promise<ParsedWebhookEvent | null> {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return null;
  }

  if (!rawText.trim()) return null;

  let body: FonntePayload;
  try {
    body = JSON.parse(rawText) as FonntePayload;
  } catch {
    // Fall back to form-encoded
    const params = new URLSearchParams(rawText);
    body = Object.fromEntries(params.entries()) as unknown as FonntePayload;
  }

  const sender  = body.sender  ?? body.pengirim;
  const message = body.message ?? body.pesan;
  const name    = body.name    ?? body.pushname ?? sender;
  const fonnteId = body.id ?? body.message_id;
  const device  = body.device;
  const attachmentUrl = body.url ?? (body as any).filepath ?? (body as any).file;
  const attachmentName = body.filename;

  if (!sender || (!message && !attachmentUrl)) return null;

  const target = (body as any).target ?? (body as any).receiver ?? (body as any).penerima ?? (body as any).to;
  const isOutgoing = (!!device && sender === device) || (!!target && target !== sender);
  const customerPhone = isOutgoing ? (target ?? sender) : sender;

  return {
    sender,
    message: message ?? "",
    name:       name ?? sender,
    fonnteId,
    device,
    isOutgoing,
    customerPhone,
    attachmentUrl: attachmentUrl || undefined,
    attachmentName: attachmentName || undefined,
    rawBody: body,
  };
}
