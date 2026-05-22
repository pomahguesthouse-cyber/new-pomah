/**
 * WhatsApp messaging service (Fonnte gateway).
 *
 * Single responsibility: send a message via the Fonnte REST API.
 * All callers receive a typed result — never raw fetch responses.
 */

export interface SendResult {
  ok:    boolean;
  error: string | null;
}

/**
 * Send a WhatsApp message via Fonnte.
 *
 * @param token   Fonnte API token (stored in properties.fonnte_token)
 * @param phone   Recipient phone number in international format, e.g. "628123456789"
 * @param message Text to send (plain text; Fonnte handles WhatsApp formatting)
 */
export async function sendWhatsAppMessage(
  token:   string,
  phone:   string,
  message: string,
  fileUrl?: string,
  filename?: string,
): Promise<SendResult> {
  try {
    const form = new URLSearchParams();
    form.append("target",  phone);
    form.append("message", message);
    if (fileUrl) {
      form.append("url", fileUrl);
    }
    if (filename) {
      form.append("filename", filename);
    }

    const res = await fetch("https://api.fonnte.com/send", {
      method:  "POST",
      headers: { Authorization: token },
      body:    form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error("[WhatsApp] Fonnte send error:", res.status, body);
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    // Fonnte always returns HTTP 200, even for logical errors. We must check the JSON body.
    const data = await res.json().catch(() => null);
    if (data && data.status === false) {
      const reason = data.reason || data.detail || JSON.stringify(data);
      console.error("[WhatsApp] Fonnte API logic error:", reason);
      return { ok: false, error: `Fonnte API Error: ${reason}` };
    }

    return { ok: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[WhatsApp] Fonnte fetch exception:", msg);
    return { ok: false, error: msg };
  }
}
