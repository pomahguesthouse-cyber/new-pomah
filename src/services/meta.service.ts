/**
 * WhatsApp Cloud API (Meta) messaging service.
 *
 * Single responsibility: send a message via the Official Meta REST API.
 * All callers receive a typed result — never raw fetch responses.
 */

export interface SendResult {
  ok:    boolean;
  error: string | null;
}

/**
 * Send a WhatsApp message via Meta Cloud API.
 *
 * @param accessToken   Meta API permanent access token
 * @param phoneNumberId Meta Phone Number ID
 * @param phone         Recipient phone number in international format, e.g. "628123456789"
 * @param message       Text to send
 * @param fileUrl       Optional URL for image or document
 * @param filename      Optional filename for the document
 */
export async function sendWhatsAppMetaMessage(
  accessToken:   string,
  phoneNumberId: string,
  phone:         string,
  message:       string,
  fileUrl?:      string,
  filename?:     string,
): Promise<SendResult> {
  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    
    // Default payload for text message
    let payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: {
        preview_url: true,
        body: message,
      },
    };

    // If there's a file, we send it as a document (or image) with caption
    if (fileUrl) {
      const isImage = fileUrl.match(/\.(jpeg|jpg|gif|png)$/i) != null;
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: isImage ? "image" : "document",
      };
      
      if (isImage) {
        payload.image = { link: fileUrl, caption: message };
      } else {
        payload.document = { link: fileUrl, caption: message, filename: filename || "document" };
      }
    }

    const res = await fetch(url, {
      method:  "POST",
      headers: { 
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errDetail = data?.error?.message || JSON.stringify(data) || `HTTP ${res.status}`;
      console.error("[WhatsApp Meta] Send error:", res.status, errDetail);
      return { ok: false, error: errDetail };
    }

    return { ok: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[WhatsApp Meta] Fetch exception:", msg);
    return { ok: false, error: msg };
  }
}
