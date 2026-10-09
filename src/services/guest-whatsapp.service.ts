/**
 * Kirim WhatsApp proaktif ke tamu (invoice, pengingat, tautan form, brosur).
 *
 * Satu-satunya kanal adalah Meta Cloud API (`sendMetaMessage`), termasuk
 * nomor yang belum punya baris `whatsapp_threads`.
 */
import {
  isMetaConfigured,
  sendMetaMessage,
  sendMetaTemplateMessage,
  toMetaRecipient,
  type MetaSendResult,
} from "./whatsapp-meta.service";

/** Pesan admin bila jendela 24 jam tertutup dan template invoice belum di-set. */
export const INVOICE_TEMPLATE_MISSING_ERROR =
  "Tamu belum chat dalam 24 jam; template WhatsApp invoice belum dikonfigurasi. Kirim manual via tombol Kirim Whatsapp.";

const WINDOW_CLOSED_ERROR =
  "Tamu belum chat dalam 24 jam, jadi pesan bebas ditolak WhatsApp. Kirim manual via tombol Kirim Whatsapp.";

export const CHANNEL_UNAVAILABLE_ERROR =
  "WhatsApp tamu belum terkonfigurasi. WhatsApp Business (Meta) belum terhubung.";

/** Kode Cloud API untuk re-engagement / di luar jendela 24 jam. */
const REENGAGEMENT_CODES = [131047, 131026, 470] as const;

export interface InvoiceTemplateVariables {
  guestName: string;
  bookingCode: string;
  total: string;
  invoiceUrl: string;
}

export interface SendGuestWhatsAppOptions {
  fileUrl?: string;
  filename?: string;
  /**
   * Variabel template invoice (nama, kode booking, total, URL).
   * Dipakai hanya bila pesan bebas ditolak jendela 24 jam dan
   * `WHATSAPP_INVOICE_TEMPLATE_NAME` di-set.
   */
  invoiceTemplate?: InvoiceTemplateVariables;
}

export interface GuestSendResult {
  ok: boolean;
  error: string | null;
  status?: number;
  raw?: unknown;
  messageId?: string | null;
  channel: "meta" | "none";
}

export interface GuestWhatsAppDeps {
  isMetaConfigured: () => boolean;
  toRecipient: (phone: string) => string;
  sendMeta: (
    phone: string,
    message: string,
    fileUrl?: string,
    filename?: string,
  ) => Promise<MetaSendResult>;
  sendTemplate: (
    phone: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[],
    logBody?: string,
  ) => Promise<MetaSendResult>;
  isReengagement: (result: { error?: string | null; raw?: unknown }) => boolean;
  templateName: () => string;
  templateLang: () => string;
}

function asCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Deteksi 131047 / 131026 / 470 di body error Meta (angka atau teks). */
export function isMetaReengagementError(result: { error?: string | null; raw?: unknown }): boolean {
  const found = new Set<number>();
  const mark = (value: unknown) => {
    const code = asCode(value);
    if (code != null && (REENGAGEMENT_CODES as readonly number[]).includes(code)) found.add(code);
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      for (const code of REENGAGEMENT_CODES) {
        if (new RegExp(`\\b${code}\\b`).test(value)) found.add(code);
      }
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "code" || key === "error_code" || key === "error_subcode") mark(child);
      else visit(child, depth + 1);
    }
  };
  visit(result.raw, 0);
  if (result.error) visit(result.error, 0);
  return found.size > 0;
}

export function guestWhatsAppAvailable(): boolean {
  return isMetaConfigured();
}

const defaultDeps: GuestWhatsAppDeps = {
  isMetaConfigured,
  toRecipient: toMetaRecipient,
  sendMeta: sendMetaMessage,
  sendTemplate: sendMetaTemplateMessage,
  isReengagement: isMetaReengagementError,
  templateName: () => (process.env.WHATSAPP_INVOICE_TEMPLATE_NAME ?? "").trim(),
  templateLang: () => (process.env.WHATSAPP_INVOICE_TEMPLATE_LANG ?? "").trim() || "id",
};

function withChannel(
  result: {
    ok: boolean;
    error: string | null;
    status?: number;
    raw?: unknown;
    messageId?: string | null;
  },
  channel: GuestSendResult["channel"],
): GuestSendResult {
  return {
    ok: result.ok,
    error: result.error,
    status: result.status,
    raw: result.raw,
    messageId: result.messageId ?? null,
    channel,
  };
}

/**
 * Kirim ke tamu lewat Meta. `deps` hanya untuk tes — produksi memakai adapter Meta.
 * Tes tidak boleh memanggil fungsi ini tanpa deps palsu.
 */
export async function sendGuestWhatsApp(
  phone: string,
  message: string,
  opts?: SendGuestWhatsAppOptions,
  deps: GuestWhatsAppDeps = defaultDeps,
): Promise<GuestSendResult> {
  const to = deps.toRecipient(phone);

  if (!deps.isMetaConfigured()) {
    return { ok: false, error: CHANNEL_UNAVAILABLE_ERROR, channel: "none" };
  }

  const textResult = await deps.sendMeta(to, message, opts?.fileUrl, opts?.filename);
  if (textResult.ok || !deps.isReengagement(textResult)) {
    return withChannel(textResult, "meta");
  }

  const templateName = deps.templateName();
  const variables = opts?.invoiceTemplate;
  if (!templateName) {
    console.warn("[GuestWhatsApp] jendela 24 jam tertutup dan template invoice belum di-set");
    return {
      ok: false,
      error: INVOICE_TEMPLATE_MISSING_ERROR,
      status: textResult.status,
      raw: textResult.raw,
      channel: "meta",
    };
  }
  if (!variables) {
    console.warn("[GuestWhatsApp] jendela 24 jam tertutup; pesan ini bukan kiriman invoice");
    return {
      ok: false,
      error: WINDOW_CLOSED_ERROR,
      status: textResult.status,
      raw: textResult.raw,
      channel: "meta",
    };
  }

  const lang = deps.templateLang();
  console.warn(
    `[GuestWhatsApp] jendela 24 jam tertutup, mengirim template ${templateName} (${lang})`,
  );
  const templateResult = await deps.sendTemplate(
    to,
    templateName,
    lang,
    [variables.guestName, variables.bookingCode, variables.total, variables.invoiceUrl],
    message,
  );
  return withChannel(templateResult, "meta");
}
