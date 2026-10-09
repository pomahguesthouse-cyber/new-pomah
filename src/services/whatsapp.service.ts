/**
 * Outbound WhatsApp.
 *
 * Every send goes through Meta Cloud API (Lovable connector). Callers still
 * pass a legacy token argument; Meta auth is LOVABLE_API_KEY and
 * WHATSAPP_API_KEY inside `sendMetaMessage`. Presence indicators are not
 * available on this connector, so seen/typing helpers are no-ops.
 */
import { sendMetaMessage, type MetaSendResult } from "./whatsapp-meta.service";

export interface SendResult {
  ok: boolean;
  error: string | null;
  status?: number;
  raw?: unknown;
  /** Id pesan dari Meta (`messages[0].id`). */
  messageId?: string | null;
}

function asSendResult(result: MetaSendResult): SendResult {
  return {
    ok: result.ok,
    error: result.error,
    status: result.status,
    raw: result.raw,
    messageId: result.messageId ?? null,
  };
}

/**
 * Send a WhatsApp message via Meta Cloud API.
 *
 * @param _token  Unused. Kept so existing callers compile.
 * @param phone   Recipient phone, e.g. "628123456789"
 * @param message Text to send
 * @param fileUrl Optional public URL of a file/image to attach
 * @param filename Optional filename shown to the recipient
 */
export async function sendWhatsAppMessage(
  _token: string,
  phone: string,
  message: string,
  fileUrl?: string,
  filename?: string,
  hint?: { mediaType?: "image" | "document"; mimetype?: string },
): Promise<SendResult> {
  return asSendResult(await sendMetaMessage(phone, message, fileUrl, filename, hint?.mediaType));
}

/** Meta connector has no read-receipt API here. Best-effort no-op. */
export async function markWaSeen(_token: string, _phone: string): Promise<void> {}

/** Meta connector has no typing indicator here. Best-effort no-op. */
export async function setWaTyping(
  _token: string,
  _phone: string,
  _value: boolean,
): Promise<void> {}
