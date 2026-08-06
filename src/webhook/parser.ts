/**
 * Parser body webhook WhatsApp (Evolution API).
 *
 * Mengubah payload mentah gateway menjadi event domain yang ternormalisasi,
 * atau null bila payload tidak mengandung pesan tamu yang valid.
 */

import type {
  EvolutionWebhookPayload,
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
  // public phone because LID values look exactly like that.
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
 * Event non-pesan dari Evolution/Baileys yang TIDAK boleh diperlakukan sebagai
 * pesan tamu baru: reaction emoji (🙏/👍 ke pesan bot), protocol message
 * (hapus/edit/ephemeral), poll update, dan status broadcast. Dulu event ini
 * lolos ke queue sehingga bot membalas "Sebentar Kak..." tanpa ada pertanyaan.
 */
function nonContentEvolutionReason(
  data: Record<string, unknown>,
  remoteJid: string | undefined,
): string | null {
  const message = objectAt(data.message);
  const type = firstString(data.messageType, data.type, data.message_type)?.toLowerCase() ?? "";

  if (message?.reactionMessage || type.includes("reaction")) return "reactionMessage";
  if (message?.protocolMessage || type.includes("protocol")) return "protocolMessage";
  if (message?.pollUpdateMessage || type.includes("pollupdate")) return "pollUpdateMessage";
  if (message?.pollCreationMessage) return "pollCreationMessage";
  if (message?.ephemeralMessage && !objectAt(message?.ephemeralMessage)?.message) {
    return "ephemeralSettingMessage";
  }
  if ((remoteJid ?? "").toLowerCase().startsWith("status@broadcast")) return "statusBroadcast";

  return null;
}

/** Media inbound yang tetap wajib diproses (mis. bukti transfer). */
function hasEvolutionContentMedia(data: Record<string, unknown>): boolean {
  const message = objectAt(data.message);
  return !!(
    message?.imageMessage ||
    message?.documentMessage ||
    message?.documentWithCaptionMessage ||
    message?.audioMessage ||
    message?.videoMessage ||
    message?.stickerMessage
  );
}


/**
 * Parse Evolution API v2 webhook payloads into the domain event.
 * The important LID rule: when `remoteJid` is `...@lid` and
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

  // Guard event non-pesan SEBELUM apa pun masuk ke queue/orchestrator.
  const nonContentReason = nonContentEvolutionReason(data, remoteJid);
  if (nonContentReason) {
    console.log(`⏭️ [EvolutionParser] Skipping ${nonContentReason} event`);
    return null;
  }

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
  const hasContentMedia = hasEvolutionContentMedia(data);
  const hasMedia =
    hasContentMedia ||
    !!attachment.url ||
    !!attachment.mime ||
    (!!attachment.type && !/conversation|text/i.test(attachment.type));

  // Payload tanpa teks dan tanpa media (messageContextInfo-only, status update).
  if (!message.trim() && !hasMedia) {
    console.log("⏭️ [EvolutionParser] Skipping empty/non-content event");
    return null;
  }

  if (!customerPhone) return null;


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
