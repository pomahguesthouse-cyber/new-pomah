/**
 * Wpp webhook body parser.
 *
 * Wpp may send either JSON or application/x-www-form-urlencoded.
 * This parser handles both and returns a normalised event or null if
 * the payload is missing required fields (sender / message).
 */

import type { WppWebhookPayload, ParsedWebhookEvent } from "./types";

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
    .replace(/@lid$/i, "")
    .replace(/[^​\d+]/g, "")
    .replace(/\u200b/g, "");
  return cleaned || undefined;
}

function normalizeIndonesianPhone(value: string | undefined): string {
  let p = String(value ?? "").replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

function samePhone(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeIndonesianPhone(a);
  const right = normalizeIndonesianPhone(b);
  return !!left && !!right && left === right;
}

function looksLikePublicPhone(value: string | undefined): boolean {
  const p = normalizeIndonesianPhone(value);
  // Indonesian WA numbers normally become 62 + 9-13 digits. LID values can be
  // long arbitrary digits and often do not start with 62.
  return /^62\d{8,14}$/.test(p);
}

function pickBestIdentity(...values: unknown[]): string | undefined {
  const candidates = values
    .map((v) => normalizePhoneCandidate(v))
    .filter((v): v is string => !!v);

  // Prefer the actual public phone number over LID/JID. WPPConnect multi-device
  // may send `from` / `sender.id` as a LID while `number` / `phone` still holds
  // the real 62xxx number. If we pick the LID first, managers and guests split
  // into different threads and lose context.
  const phone = candidates.find(looksLikePublicPhone);
  if (phone) return normalizeIndonesianPhone(phone);

  // Fallback: keep the first identity, usually a LID. Alias resolution in the DB
  // can map it back to a canonical phone when known.
  return candidates[0];
}

export async function parseWppWebhook(
  request: Request,
): Promise<ParsedWebhookEvent | null> {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return null;
  }

  if (!rawText.trim()) return null;

  let body: WppWebhookPayload;
  try {
    body = JSON.parse(rawText) as WppWebhookPayload;
  } catch {
    // Fall back to form-encoded
    const params = new URLSearchParams(rawText);
    body = Object.fromEntries(params.entries()) as unknown as WppWebhookPayload;
  }

  // WPPConnect emits many event types (onack, onpresencechanged, onreactionmessage…)
  // to the same webhook URL. Only message events carry a chat body we care about.
  const eventName = firstString((body as any).event)?.toLowerCase();
  if (eventName && !/message/.test(eventName)) return null;

  // WPPConnect nests the message id as an object ({ _serialized, id, ... })
  // whereas Wpp sends a plain string. Support both.
  const rawId = (body as any).id;
  const idValue =
    rawId && typeof rawId === "object"
      ? firstString((rawId as any)._serialized, (rawId as any).id)
      : firstString(rawId);

  const senderObj = (body as any).sender && typeof (body as any).sender === "object"
    ? ((body as any).sender as Record<string, unknown>)
    : null;

  // WPPConnect can send multiple identities for the same contact: public phone,
  // chat JID, and LID. Always prefer a public 62xxx phone when present; keep LID
  // only as fallback so existing alias mappings can resolve it.
  const sender = pickBestIdentity(
    senderObj?.phone,
    senderObj?.number,
    body.number,
    body.phone,
    body.pengirim,
    senderObj?.id,
    senderObj?._serialized,
    body.sender,
    body.from,
    (body as any).author,
  );

  // WPPConnect `type`: chat|image|video|document|audio|ptt|sticker|location.
  // For media messages the `body` field holds base64 data — NOT caption — so
  // it must not be treated as text.
  const messageType = firstString(body.type, (body as any).message_type, (body as any).msg_type);
  const typeLower = (messageType ?? "").toLowerCase();
  const isMediaType = typeLower !== "" && typeLower !== "chat" && typeLower !== "text";

  const caption = firstString((body as any).caption, (body as any).text);
  // WPPConnect text lives in `body`; Wpp in `message`/`pesan`.
  const textBody = firstString(body.message, body.pesan, isMediaType ? undefined : (body as any).body);
  const message = (isMediaType ? caption : (textBody ?? caption)) ?? "";

  // WPPConnect display name = `notifyName` or `sender.pushname`; Wpp = `name`/`pushname`.
  const name = firstString(body.name, body.pushname, (body as any).notifyName, senderObj?.pushname, sender) ?? "";
  const wppId = firstString(idValue, body.message_id, (body as any).messageId, (body as any).key_id);
  // `to`/`chatId` are WPPConnect fallbacks for our own device number.
  const device = pickBestIdentity(
    body.device,
    (body as any).device_number,
    (body as any).deviceNumber,
    body.to,
    (body as any).chatId,
  );
  const attachmentUrl = firstString(
    body.url,
    body.filepath,
    body.file,
    (body as any).media_url,
    (body as any).mediaUrl,
    (body as any).deprecatedMms3Url,
  );
  const attachmentName = firstString(body.filename, (body as any).file_name, (body as any).media_name);
  const attachmentMime = firstString(body.mimetype, body.mime_type, body.media_type, (body as any).content_type);

  const hasMedia = !!attachmentUrl || isMediaType || !!attachmentMime;
  if (!sender || (!message && !hasMedia)) return null;

  const target = pickBestIdentity(
    body.target,
    body.receiver,
    body.penerima,
    body.to,
    body.recipient,
    body.destination,
    body.tujuan,
    (body as any).remoteJid,
    (body as any).remote_jid,
  );
  const explicitOutgoing =
    boolish(body.fromMe) ||
    boolish(body.from_me) ||
    boolish(body.isFromMe) ||
    /^(out|outgoing|sent|send)$/i.test(firstString((body as any).direction, (body as any).event) ?? "");
  const isOutgoing = explicitOutgoing || (!!device && samePhone(sender, device));

  const customerPhone =
    isOutgoing
      ? (target && !samePhone(target, device) ? target : !samePhone(sender, device) ? sender : target ?? sender)
      : sender;

  return {
    sender,
    message: message ?? "",
    name:       name ?? sender,
    wppId,
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
