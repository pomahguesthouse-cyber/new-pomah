/**
 * Fonnte webhook body parser.
 *
 * Fonnte may send either JSON or application/x-www-form-urlencoded.
 * This parser handles both and returns a normalised event or null if
 * the payload is missing required fields (sender / message).
 */

import type { FonntePayload, ParsedWebhookEvent } from "./types";

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function boolish(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return /^(true|1|yes|ya)$/i.test(value.trim());
  return false;
}

function normalizePhoneCandidate(value: unknown): string | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/@(?:c|s)\.whatsapp\.net$/i, "")
    .replace(/[^\d+]/g, "");
  return cleaned || undefined;
}

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

  const sender = normalizePhoneCandidate(firstString(body.sender, body.pengirim, body.from, body.number, body.phone));
  const message = firstString(body.message, body.pesan, (body as any).caption, (body as any).text) ?? "";
  const name = firstString(body.name, body.pushname, sender) ?? "";
  const fonnteId = firstString(body.id, body.message_id, (body as any).messageId, (body as any).key_id);
  const device = normalizePhoneCandidate(firstString(body.device, (body as any).device_number, (body as any).deviceNumber));
  const attachmentUrl = firstString(body.url, body.filepath, body.file, (body as any).media_url, (body as any).mediaUrl);
  const attachmentName = firstString(body.filename, (body as any).file_name, (body as any).media_name);
  const attachmentMime = firstString(body.mimetype, body.mime_type, body.media_type, (body as any).content_type);
  const messageType = firstString(body.type, (body as any).message_type, (body as any).msg_type);

  if (!sender || (!message && !attachmentUrl)) return null;

  const target = normalizePhoneCandidate(
    firstString(
      body.target,
      body.receiver,
      body.penerima,
      body.to,
      body.recipient,
      body.destination,
      body.tujuan,
      (body as any).remoteJid,
      (body as any).remote_jid,
    ),
  );
  const explicitOutgoing =
    boolish(body.fromMe) ||
    boolish(body.from_me) ||
    boolish(body.isFromMe) ||
    /^(out|outgoing|sent|send)$/i.test(firstString((body as any).direction, (body as any).event) ?? "");
  const isOutgoing = explicitOutgoing || (!!device && sender === device) || (!!target && target !== sender);

  const customerPhone =
    isOutgoing
      ? (target && target !== device ? target : sender !== device ? sender : target ?? sender)
      : sender;

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
    attachmentMime: attachmentMime || undefined,
    messageType: messageType || undefined,
    rawBody: body,
  };
}
