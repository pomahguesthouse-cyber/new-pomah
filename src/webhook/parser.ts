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

  if (!sender || !message) return null;

  // For outgoing messages from Fonnte, the recipient is usually in 'target', 'receiver', 'penerima', or 'to'
  const target = (body as any).target ?? (body as any).receiver ?? (body as any).penerima ?? (body as any).to;

  // Fonnte might not send `device` for native outgoing messages.
  // If `target` is present and different from sender, it strongly indicates an outgoing message payload.
  const isOutgoing = (!!device && sender === device) || (!!target && target !== sender);
  
  // For incoming messages, the sender is the customer
  const customerPhone = isOutgoing ? (target ?? sender) : sender;

  return {
    sender,
    message,
    name:       name ?? sender,
    fonnteId,
    device,
    isOutgoing,
    customerPhone,
    rawBody: body, // Include raw body for debugging
  };
}
