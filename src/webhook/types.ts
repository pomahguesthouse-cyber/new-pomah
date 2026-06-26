/**
 * Webhook domain types.
 *
 * Keep this file free of external dependencies so it can be imported
 * from any layer without pulling in heavy modules.
 */

/** Raw payload that Fonnte sends to the webhook endpoint. */
export interface FonntePayload {
  /** Sender phone number (e.g. "628123456789") */
  sender?:     string;
  /** Alternate field name Fonnte sometimes uses */
  pengirim?:   string;
  /** Message body */
  message?:    string;
  /** Alternate field name */
  pesan?:      string;
  /** Sender's display name */
  name?:       string;
  /** WhatsApp pushname */
  pushname?:   string;
  /** Fonnte-assigned message ID (used for deduplication) */
  id?:         string;
  message_id?: string;
  /** The WhatsApp device (phone number of our gateway).
   *  When sender === device the webhook is for an outgoing message. */
  device?:     string;
  /** URL lampiran (image/file) yang dikirim tamu */
  url?:        string;
  filename?:   string;
  filepath?:   string;
  file?:       string;
  mimetype?:   string;
  mime_type?:  string;
  media_type?: string;
  /** Tipe pesan (text|image|document|...) bila tersedia */
  type?:       string;
  /** Receiver/target fields vary between Fonnte event types. */
  target?:     string;
  receiver?:   string;
  penerima?:   string;
  to?:         string;
  recipient?:  string;
  destination?: string;
  tujuan?:     string;
  /** Outgoing/native-device markers from gateway variants. */
  fromMe?:     boolean | string | number;
  from_me?:    boolean | string | number;
  isFromMe?:   boolean | string | number;
  from?:       string;
  number?:     string;
  phone?:      string;
}

/** Normalised, validated event after parsing the raw Fonnte body. */
export interface ParsedWebhookEvent {
  /** Guest phone number */
  sender:     string;
  /** Message body text */
  message:    string;
  /** Display name (falls back to sender) */
  name:       string;
  /** Fonnte message ID when available; undefined otherwise */
  fonnteId:   string | undefined;
  /** The WhatsApp device phone */
  device:     string | undefined;
  /** True when this webhook fires for a message WE sent (should be skipped) */
  isOutgoing: boolean;
  /** The customer's phone number (receiver if outgoing, sender if incoming) */
  customerPhone: string;
  /** URL lampiran (gambar/file) bila pesan mengandung media */
  attachmentUrl?: string;
  /** Nama file lampiran (opsional) */
  attachmentName?: string;
  /** MIME / media type attachment when provided by Fonnte. */
  attachmentMime?: string;
  /** Raw media/message type. */
  messageType?: string;
  /** The raw body payload */
  rawBody: any;
}
