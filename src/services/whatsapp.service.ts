/**
 * WhatsApp messaging service (Fonnte gateway).
 *
 * Single responsibility: send a message via the Fonnte REST API.
 * All callers receive a typed result — never raw fetch responses.
 */

const FONNTE_SEND_URL = "https://api.fonnte.com/send";

export interface SendResult {
  ok: boolean;
  error: string | null;
  status?: number;
  raw?: unknown;
}

export interface SendWhatsAppMessageInput {
  token: string;
  phone: string;
  message: string;
  fileUrl?: string;
  filename?: string;
}

function buildFonnteSendForm(input: SendWhatsAppMessageInput): URLSearchParams {
  const form = new URLSearchParams();
  form.append("target", input.phone);
  form.append("message", input.message);
  if (input.fileUrl) {
    form.append("url", input.fileUrl);
  }
  if (input.filename) {
    form.append("filename", input.filename);
  }
  return form;
}

function parseFonnteLogicalError(data: any): string | null {
  if (!data || data.status !== false) return null;
  return data.reason || data.detail || JSON.stringify(data);
}

/**
 * Send a WhatsApp message via Fonnte.
 *
 * @param token   Fonnte API token (stored in properties.fonnte_token)
 * @param phone   Recipient phone number in international format, e.g. "628123456789"
 * @param message Text to send (plain text; Fonnte handles WhatsApp formatting)
 */
export async function sendWhatsAppMessage(
  token: string,
  phone: string,
  message: string,
  fileUrl?: string,
  filename?: string,
): Promise<SendResult> {
  return sendWhatsAppMessageWithOptions({ token, phone, message, fileUrl, filename });
}

export async function sendWhatsAppMessageWithOptions(
  input: SendWhatsAppMessageInput,
): Promise<SendResult> {
  try {
    const res = await fetch(FONNTE_SEND_URL, {
      method: "POST",
      headers: { Authorization: input.token },
      body: buildFonnteSendForm(input),
    });

    const responseText = await res.text().catch(() => "");
    let responseJson: any = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Fonnte normally returns JSON; keep non-JSON body as text for diagnostics.
    }

    const raw = responseJson ?? responseText;

    if (!res.ok) {
      const body = responseText || "(no body)";
      console.error("[WhatsApp] Fonnte send error:", res.status, body);
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${body}`, raw };
    }

    // Fonnte may return HTTP 200 even for logical errors. Check the response body.
    const logicalError = parseFonnteLogicalError(responseJson);
    if (logicalError) {
      console.error("[WhatsApp] Fonnte API logic error:", logicalError);
      return { ok: false, status: res.status, error: `Fonnte API Error: ${logicalError}`, raw };
    }

    return { ok: true, status: res.status, error: null, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[WhatsApp] Fonnte fetch exception:", msg);
    return { ok: false, error: msg };
  }
}
