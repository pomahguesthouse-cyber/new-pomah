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
): Promise<SendResult> {
  try {
    const form = new URLSearchParams();
    form.append("target",  phone);
    form.append("message", message);

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

    return { ok: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[WhatsApp] Fonnte fetch exception:", msg);
    return { ok: false, error: msg };
  }
}
