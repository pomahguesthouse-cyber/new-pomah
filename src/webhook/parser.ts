/**
 * Wpp webhook body parser.
 *
 * Wpp may send either JSON or application/x-www-form-urlencoded.
 * This parser handles both and returns a normalised event or null if
 * the payload is missing required fields (sender / message).
 */

import type {
  EvolutionWebhookPayload,
  WppWebhookPayload,
  ParsedWebhookEvent,
  WaIdentityResolution,
  WaIdentityType,
} from "./types";

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

function rawString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function isLidIdentity(value: unknown): boolean {
  const raw = rawString(value);
  return !!raw && /@lid(?:\b|[_@.-]|$)/i.test(raw);
}

export function isJidIdentity(value: unknown): boolean {
  const raw = rawString(value);
  return !!raw && /@(c|s)\.whatsapp\.net$/i.test(raw);
}

function stripWaSuffix(value: string): string {
  return value
    .replace(/@(?:c|s)\.whatsapp\.net$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "");
}

function normalizeDigits(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  return cleaned || undefined;
}

export function normalizeWaPhone(value: string | undefined): string | undefined {
  let p = normalizeDigits(value);
  if (!p) return undefined;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

export function extractPublicPhoneCandidate(value: unknown): string | undefined {
  const raw = rawString(value);
  if (!raw || isLidIdentity(raw)) return undefined;
  const normalized = normalizeWaPhone(stripWaSuffix(raw));
  return looksLikePublicWaPhone(normalized) ? normalized : undefined;
}

export function looksLikePublicWaPhone(value: unknown): boolean {
  const p = normalizeWaPhone(rawString(value));
  // Pomah uses Indonesian numbers. Do not treat arbitrary long non-62 digits as
  // public phone because WPPConnect LID values look exactly like that.
  return !!p && /^62\d{8,14}$/.test(p);
}

function normalizeIdentityCandidate(value: unknown): string | undefined {
  const raw = rawString(value);
  if (!raw) return undefined;
  return normalizeWaPhone(stripWaSuffix(raw));
}

function identityTypeOf(raw: string | undefined, normalized: string | undefined): WaIdentityType {
  if (!raw && !normalized) return "unknown";
  if (isLidIdentity(raw)) return "lid";
  if (isJidIdentity(raw)) return "jid";
  if (looksLikePublicWaPhone(normalized)) return "phone";
  return "unknown";
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

export function pickBestWaIdentity(...values: unknown[]): WaIdentityResolution {
  const rawValues = values.map(rawString).filter((v): v is string => !!v);
  const candidates = unique(rawValues.map(normalizeIdentityCandidate));
  const lidAlias = rawValues.find(isLidIdentity);
  const normalizedLidAlias = normalizeIdentityCandidate(lidAlias);

  for (const raw of rawValues) {
    const phone = extractPublicPhoneCandidate(raw);
    if (phone) {
      return {
        phone,
        rawIdentity: raw,
        identityType: isJidIdentity(raw) ? "jid" : "phone",
        identityCandidates: candidates,
        lidAlias: normalizedLidAlias,
        publicPhoneCandidate: phone,
        identityUnresolved: false,
      };
    }
  }

  const fallbackRaw = rawValues[0];
  const fallback = normalizeIdentityCandidate(fallbackRaw);
  const fallbackType = identityTypeOf(fallbackRaw, fallback);
  return {
    phone: fallback,
    rawIdentity: fallbackRaw,
    identityType: fallbackType,
    identityCandidates: candidates,
    lidAlias: normalizedLidAlias,
    identityUnresolved: fallbackType === "lid" || !looksLikePublicWaPhone(fallback),
  };
}

function externalChatIdOf(identity: WaIdentityResolution): string | undefined {
  const raw = identity.rawIdentity;
  const embedded = raw?.match(/([0-9]{8,18})@(lid|c\.us|s\.whatsapp\.net)/i);
  if (embedded) return `${embedded[1]}@${embedded[2]}`.toLowerCase();
  if (raw && /@(lid|c\.us|s\.whatsapp\.net)$/i.test(raw)) return raw.toLowerCase();
  if (identity.identityType === "lid" && identity.phone) return `${identity.phone}@lid`;
  if (looksLikePublicWaPhone(identity.phone)) return `${identity.phone}@c.us`;
  return raw;
}

function samePhone(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeWaPhone(a);
  const right = normalizeWaPhone(b);
  return !!left && !!right && left === right;
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
    const params = new URLSearchParams(rawText);
    body = Object.fromEntries(params.entries()) as unknown as WppWebhookPayload;
  }

  const eventName = firstString((body as any).event)?.toLowerCase();
  if (eventName && !/message/.test(eventName)) return null;

  const rawId = (body as any).id;
  const idValue =
    rawId && typeof rawId === "object"
      ? firstString((rawId as any)._serialized, (rawId as any).id)
      : firstString(rawId);

  const senderObj = (body as any).sender && typeof (body as any).sender === "object"
    ? ((body as any).sender as Record<string, unknown>)
    : null;

  const senderIdentity = pickBestWaIdentity(
    senderObj?.phone,
    senderObj?.number,
    body.number,
    body.phone,
    body.pengirim,
    senderObj?.id,
    senderObj?._serialized,
    body.sender,
    body.from,
    (body as any).chatId,
    (body as any).remoteJid,
    (body as any).remote_jid,
    (body as any).author,
    idValue,
  );
  const sender = senderIdentity.phone;

  const messageType = firstString(body.type, (body as any).message_type, (body as any).msg_type);
  const typeLower = (messageType ?? "").toLowerCase();
  const isMediaType = typeLower !== "" && typeLower !== "chat" && typeLower !== "text";

  const caption = firstString((body as any).caption, (body as any).text);
  const textBody = firstString(body.message, body.pesan, isMediaType ? undefined : (body as any).body);
  const message = (isMediaType ? caption : (textBody ?? caption)) ?? "";

  const name = firstString(body.name, body.pushname, (body as any).notifyName, senderObj?.pushname, sender) ?? "";
  const wppId = firstString(idValue, body.message_id, (body as any).messageId, (body as any).key_id);

  const deviceIdentity = pickBestWaIdentity(
    body.device,
    (body as any).device_number,
    (body as any).deviceNumber,
    body.to,
    (body as any).chatId,
  );
  const device = deviceIdentity.phone;

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

  const targetIdentity = pickBestWaIdentity(
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
  const target = targetIdentity.phone;

  const explicitOutgoing =
    boolish(body.fromMe) ||
    boolish(body.from_me) ||
    boolish(body.isFromMe) ||
    /^(out|outgoing|sent|send)$/i.test(firstString((body as any).direction, (body as any).event) ?? "");
  const isOutgoing = explicitOutgoing || (!!device && samePhone(sender, device));

  const customerIdentity =
    isOutgoing
      ? (target && !samePhone(target, device) ? targetIdentity : !samePhone(sender, device) ? senderIdentity : targetIdentity.phone ? targetIdentity : senderIdentity)
      : senderIdentity;
  const customerPhone = customerIdentity.phone ?? sender;
  const externalChatId = externalChatIdOf(customerIdentity);

  return {
    sender,
    message: message ?? "",
    name: name ?? sender,
    wppId,
    device,
    isOutgoing,
    customerPhone,
    attachmentUrl: attachmentUrl || undefined,
    attachmentName: attachmentName || undefined,
    attachmentMime: attachmentMime || undefined,
    messageType: messageType || undefined,
    senderIdentity,
    customerIdentity,
    deviceIdentity,
    externalChatId,
    rawBody: body,
  };
}

function objectAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstEvolutionMessage(payload: EvolutionWebhookPayload): Record<string, unknown> | null {
  const data = (payload as any).data;
  if (Array.isArray(data)) return objectAt(data[0]);
  const dataObj = objectAt(data);
  if (!dataObj) return null;

  const message = dataObj.message;
  if (Array.isArray(message)) {
    return { ...dataObj, message: message[0] };
  }

  return dataObj;
}

function textFromEvolutionMessage(data: Record<string, unknown>): string {
  const message = objectAt(data.message);
  const type = firstString(data.messageType, data.type, data.message_type)?.toLowerCase();

  const candidates = [
    message?.conversation,
    objectAt(message?.extendedTextMessage)?.text,
    objectAt(message?.imageMessage)?.caption,
    objectAt(message?.videoMessage)?.caption,
    objectAt(message?.documentMessage)?.caption,
    objectAt(message?.buttonsResponseMessage)?.selectedDisplayText,
    objectAt(message?.listResponseMessage)?.title,
    objectAt(message?.templateButtonReplyMessage)?.selectedDisplayText,
    objectAt(message?.interactiveResponseMessage)?.body,
    data.text,
    data.body,
    data.messageText,
  ];

  const text = firstString(...candidates);
  if (text) return text;

  if (type && !["conversation", "extendedtextmessage", "text"].includes(type)) {
    return `[Lampiran ${type}]`;
  }

  return "";
}

function evolutionAttachment(data: Record<string, unknown>): {
  url?: string;
  name?: string;
  mime?: string;
  type?: string;
} {
  const message = objectAt(data.message);
  const image = objectAt(message?.imageMessage);
  const video = objectAt(message?.videoMessage);
  const audio = objectAt(message?.audioMessage);
  const document = objectAt(message?.documentMessage);
  const media = image ?? video ?? audio ?? document ?? objectAt((data as any).media);
  const type = firstString(data.messageType, data.type, data.message_type);

  return {
    url: firstString(
      data.mediaUrl,
      data.media_url,
      data.url,
      media?.url,
      media?.mediaUrl,
      media?.directPath,
    ),
    name: firstString(data.fileName, data.filename, media?.fileName, media?.filename),
    mime: firstString(data.mimeType, data.mimetype, data.mime_type, media?.mimetype, media?.mimeType),
    type: type || (image ? "image" : video ? "video" : audio ? "audio" : document ? "document" : undefined),
  };
}

function evolutionMessageId(data: Record<string, unknown>): string | undefined {
  const key = objectAt(data.key);
  return firstString(
    key?.id,
    data.id,
    data.messageId,
    data.message_id,
    data.keyId,
  );
}

/**
 * Parse Evolution API v2 webhook payloads into the same domain event used by
 * WPPConnect. The important LID rule: when `remoteJid` is `...@lid` and
 * `remoteJidAlt` is a public WhatsApp JID, store the public phone as
 * customerPhone while preserving the LID in externalChatId/metadata.
 */
export async function parseEvolutionWebhook(
  request: Request,
): Promise<ParsedWebhookEvent | null> {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return null;
  }

  if (!rawText.trim()) return null;

  let body: EvolutionWebhookPayload;
  try {
    body = JSON.parse(rawText) as EvolutionWebhookPayload;
  } catch {
    return null;
  }

  const eventName = firstString(body.event)?.toLowerCase();
  if (eventName && !/(message|send\.message|messages\.)/.test(eventName)) return null;

  const data = firstEvolutionMessage(body);
  if (!data) return null;

  const key = objectAt(data.key);
  const remoteJid = firstString(key?.remoteJid, data.remoteJid, data.remote_jid);
  const remoteJidAlt = firstString(key?.remoteJidAlt, data.remoteJidAlt, data.remote_jid_alt);
  const participant = firstString(key?.participant, data.participant);
  const participantAlt = firstString(key?.participantAlt, data.participantAlt);
  const fromMe = boolish(key?.fromMe) || boolish(data.fromMe);

  const senderIdentity = pickBestWaIdentity(
    remoteJidAlt,
    participantAlt,
    remoteJid,
    participant,
    body.sender,
    data.sender,
    data.from,
    data.phone,
    data.number,
  );

  const targetIdentity = pickBestWaIdentity(
    data.to,
    data.recipient,
    data.destination,
    body.destination,
  );

  const customerIdentity = fromMe && targetIdentity.phone ? targetIdentity : senderIdentity;
  const customerPhone = customerIdentity.phone;
  const message = textFromEvolutionMessage(data);
  const attachment = evolutionAttachment(data);
  const hasMedia = !!attachment.url || !!attachment.mime || (!!attachment.type && !/conversation|text/i.test(attachment.type));

  if (!customerPhone || (!message && !hasMedia)) return null;

  const publicExternal = looksLikePublicWaPhone(customerPhone) ? `${customerPhone}@s.whatsapp.net` : undefined;
  const externalChatId =
    isLidIdentity(remoteJid)
      ? remoteJid?.toLowerCase()
      : remoteJid?.toLowerCase() || publicExternal;

  const wppId = evolutionMessageId(data);
  const name = firstString(data.pushName, data.pushname, data.notifyName, data.name, customerPhone) ?? customerPhone;

  return {
    sender: customerPhone,
    message,
    name,
    wppId: wppId ? `evo:${body.instance ?? "default"}:${wppId}` : undefined,
    device: undefined,
    isOutgoing: fromMe,
    customerPhone,
    attachmentUrl: attachment.url,
    attachmentName: attachment.name,
    attachmentMime: attachment.mime,
    messageType: attachment.type,
    senderIdentity,
    customerIdentity,
    deviceIdentity: undefined,
    externalChatId,
    rawBody: body,
  };
}
