/**
 * WhatsApp messaging service (WPPConnect gateway).
 *
 * Single responsibility: send a message via a self-hosted WPPConnect server.
 * All callers receive a typed result — never raw fetch responses.
 *
 * Migration note (Fonnte -> WPPConnect):
 *   The public signature is unchanged, so all 13 call sites keep working:
 *     sendWhatsAppMessage(token, phone, message, fileUrl?, filename?)
 *   - `token`   -> the WPPConnect session Bearer token (stored, as before, in
 *                 properties.fonnte_token). "Bearer " prefix is added here.
 *   - base URL + session name come from env:
 *       WPP_BASE_URL  e.g. "http://IP_VPS:21465" or "https://wa.domain.com"
 *       WPP_SESSION   e.g. "pomah"
 *   Text  -> POST {base}/api/{session}/send-message      { phone, message }
 *   Media -> POST {base}/api/{session}/send-file-base64  { phone, base64, filename, message }
 */

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";

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

const SEND_TIMEOUT_MS = 12_000;

/** WPPConnect wants the raw MSISDN in digits, e.g. "628123456789". */
function normalizeWppPhone(phone: string): string {
  let p = String(phone ?? "").replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "");
  p = p.replace(/[^\d]/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  return p;
}

function bearer(token: string): string {
  const t = String(token ?? "").trim();
  return /^bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

function endpoint(path: string): string {
  return `${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/${path}`;
}

/**
 * WPPConnect returns HTTP 200/201 with a JSON body. Success bodies carry
 * `status: "success"`; logical failures carry `status: "error"` / an `error`
 * field even on HTTP 2xx.
 */
function parseWppLogicalError(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const status = String(data.status ?? "").toLowerCase();
  if (status === "error") {
    return data.message || data.response || JSON.stringify(data);
  }
  if (data.error) {
    return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  }
  return null;
}

/** Fetch a remote file and turn it into a `data:` URI for send-file-base64. */
async function toDataUri(fileUrl: string, signal: AbortSignal): Promise<{ dataUri: string; mime: string }> {
  const res = await fetch(fileUrl, { signal });
  if (!res.ok) throw new Error(`fetch attachment HTTP ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  const b64 = btoa(binary);
  return { dataUri: `data:${mime};base64,${b64}`, mime };
}

/**
 * Send a WhatsApp message via WPPConnect.
 *
 * @param token   WPPConnect session token (stored in properties.fonnte_token)
 * @param phone   Recipient phone in international format, e.g. "628123456789"
 * @param message Text to send (plain text; WhatsApp formatting supported)
 * @param fileUrl Optional public URL of a file/image to attach
 * @param filename Optional filename shown to the recipient
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

async function sendWhatsAppMessageWithOptions(
  input: SendWhatsAppMessageInput,
): Promise<SendResult> {
  if (!WPP_BASE_URL || !WPP_SESSION) {
    const msg = "WPPConnect not configured: set WPP_BASE_URL and WPP_SESSION";
    console.error("[WhatsApp]", msg);
    return { ok: false, error: msg };
  }
  if (!input.token) {
    return { ok: false, error: "WPPConnect token kosong (properties.fonnte_token belum diisi)" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  const phone = normalizeWppPhone(input.phone);

  try {
    let url: string;
    let payload: Record<string, unknown>;

    if (input.fileUrl) {
      const { dataUri } = await toDataUri(input.fileUrl, controller.signal);
      url = endpoint("send-file-base64");
      payload = {
        phone,
        isGroup: false,
        base64: dataUri,
        filename: input.filename ?? "file",
        // In WPPConnect send-file, `message` is the caption.
        message: input.message ?? "",
        caption: input.message ?? "",
      };
    } else {
      url = endpoint("send-message");
      payload = { phone, isGroup: false, message: input.message };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: bearer(input.token),
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseText = await res.text().catch(() => "");
    let responseJson: any = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      // WPPConnect normally returns JSON; keep non-JSON body for diagnostics.
    }
    const raw = responseJson ?? responseText;

    if (!res.ok) {
      const body = responseText || "(no body)";
      console.error("[WhatsApp] WPPConnect send error:", res.status, body);
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${body}`, raw };
    }

    const logicalError = parseWppLogicalError(responseJson);
    if (logicalError) {
      console.error("[WhatsApp] WPPConnect API logic error:", logicalError);
      return { ok: false, status: res.status, error: `WPPConnect API Error: ${logicalError}`, raw };
    }

    return { ok: true, status: res.status, error: null, raw };
  } catch (e) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    const msg = isAbort
      ? `WPPConnect timeout setelah ${SEND_TIMEOUT_MS}ms`
      : e instanceof Error ? e.message : String(e);
    console.error("[WhatsApp] WPPConnect fetch exception:", msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeoutId);
  }
}
