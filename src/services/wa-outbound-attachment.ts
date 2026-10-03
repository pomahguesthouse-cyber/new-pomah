/**
 * Validasi lampiran chat admin WhatsApp (murni, tanpa jaringan).
 * Browser mengunggah langsung ke bucket `wa-outbound`; server hanya
 * menerima path + metadata, lalu membuat signed URL.
 */
import { z } from "zod";
import { META_IMAGE_MAX_BYTES } from "@/services/meta-media";

export const WA_OUTBOUND_BUCKET = "wa-outbound";
/** Batas bucket / unggahan. */
export const WA_OUTBOUND_MAX_BYTES = 25 * 1024 * 1024;
/** Gambar di atas batas Cloud API dikirim sebagai dokumen. */
export const WA_IMAGE_INLINE_MAX_BYTES = META_IMAGE_MAX_BYTES;
/** Signed URL untuk Meta/Evolution dan pratinjau inbox. Lebih dari 1 jam. */
export const WA_SIGNED_URL_TTL_SECONDS = 2 * 60 * 60;
export const META_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WA_FILE_TOO_BIG_MESSAGE = "Ukuran berkas maksimal 25 MB.";
export const WA_FILE_TYPE_MESSAGE =
  "Jenis berkas tidak didukung. Gunakan JPG, PNG, PDF, TXT, Word, Excel, atau PowerPoint.";
export const WA_FILE_EMPTY_MESSAGE = "Berkas kosong tidak bisa dikirim.";
export const WA_ATTACHMENT_REQUIRED_MESSAGE = "Tulis pesan atau lampirkan berkas.";
export const WA_PATH_INVALID_MESSAGE = "Path lampiran tidak valid.";
export const META_WINDOW_CLOSED_MESSAGE =
  "Tamu belum chat dalam 24 jam, lampiran/pesan tidak bisa dikirim.";
export const WA_SEND_FAILED_MESSAGE = "Pesan gagal dikirim.";
export const WA_HEIC_UNSUPPORTED_MESSAGE =
  "Format HEIC tidak bisa dibaca di browser ini. Ubah ke JPEG lalu unggah lagi.";
export const WA_IMAGE_DECODE_MESSAGE = "Gambar tidak bisa dibaca. Coba JPG atau PNG.";
export const WA_IMAGE_STILL_TOO_BIG_MESSAGE =
  "Ukuran berkas masih lebih dari 25 MB setelah diperkecil.";

/** MIME yang boleh tersimpan di bucket dan dikirim ke server. */
export const WA_OUTBOUND_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type WaOutboundMime = (typeof WA_OUTBOUND_MIME_TYPES)[number];

const STORED_MIME = new Set<string>(WA_OUTBOUND_MIME_TYPES);

/** Jenis yang boleh dipilih di komputer, sebelum konversi gambar. */
const CLIENT_PICK_MIME = new Set<string>([
  ...WA_OUTBOUND_MIME_TYPES,
  "image/webp",
  "image/heic",
  "image/heif",
]);

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export const WA_FILE_INPUT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  "application/pdf",
  ".pdf",
  "text/plain",
  ".txt",
  "application/msword",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
].join(",");

export function isStoredOutboundMime(mime: string): mime is WaOutboundMime {
  return STORED_MIME.has(mime.toLowerCase());
}

export function extensionForMime(mime: string): string | null {
  return MIME_EXT[mime.toLowerCase()] ?? null;
}

export function mimeFromFilename(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? null;
}

/** Normalisasi MIME dari browser (termasuk HEIC/WebP yang nanti jadi JPEG). */
export function normalizeClientMime(type: string, name: string): string {
  let declared = type.toLowerCase().split(";")[0].trim();
  if (declared === "image/jpg" || declared === "image/pjpeg") declared = "image/jpeg";
  if (declared === "image/heic-sequence" || declared === "image/heif-sequence") declared = "image/heic";
  if (CLIENT_PICK_MIME.has(declared)) return declared;
  return mimeFromFilename(name) ?? declared;
}

export function needsImageCompress(mime: string): boolean {
  return (
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/heic" ||
    mime === "image/heif"
  );
}

export type ClientPickResult =
  | { ok: true; mime: string }
  | { ok: false; error: string };

export function validateClientPick(file: { name: string; type: string; size: number }): ClientPickResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: WA_FILE_EMPTY_MESSAGE };
  }
  if (file.size > WA_OUTBOUND_MAX_BYTES) {
    return { ok: false, error: WA_FILE_TOO_BIG_MESSAGE };
  }
  const mime = normalizeClientMime(file.type, file.name);
  if (!CLIENT_PICK_MIME.has(mime)) {
    return { ok: false, error: WA_FILE_TYPE_MESSAGE };
  }
  return { ok: true, mime };
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "berkas";
  const cleaned = base
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return cleaned || "berkas";
}

/** Nama berkas yang dikirim ke WhatsApp, selalu dengan ekstensi yang cocok. */
export function fileNameForMime(originalName: string, mime: string): string {
  const stem = sanitizeFilename(originalName).replace(/\.[^.]+$/, "") || "berkas";
  const ext = extensionForMime(mime);
  return ext ? `${stem}.${ext}` : stem;
}

export function buildOutboundObjectPath(threadId: string, fileName: string): string {
  const safe = sanitizeFilename(fileName);
  return `${threadId}/${crypto.randomUUID()}-${safe}`;
}

const OBJECT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^/]+$/i;

export function attachmentPathForThread(path: string, threadId: string): boolean {
  if (!path || path !== path.trim()) return false;
  if (path.includes("\\") || path.includes("..") || path.includes("//")) return false;
  const prefix = `${threadId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return OBJECT_NAME.test(rest);
}

/**
 * JPG/PNG sampai 5MB dikirim sebagai image. Lebih besar, atau jenis lain,
 * dikirim sebagai document. Ekstensi nama berkas tetap dipertahankan.
 */
export function selectOutboundMediaType(input: {
  mime: string;
  size: number;
  name?: string;
}): "image" | "document" {
  const mime = input.mime.toLowerCase();
  const imageMime = mime === "image/jpeg" || mime === "image/png";
  const imageExt = /\.(jpe?g|png)$/i.test(input.name ?? "");
  if (imageMime && imageExt && input.size <= WA_IMAGE_INLINE_MAX_BYTES) return "image";
  if (imageMime && !input.name && input.size <= WA_IMAGE_INLINE_MAX_BYTES) return "image";
  return "document";
}

export function threadPreview(caption: string, fileName?: string | null): string {
  const text = caption.trim();
  if (text) return text.slice(0, 120);
  if (fileName) return `📎 ${fileName}`.slice(0, 120);
  return "";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function lastInboundAt(
  messages: Array<{ direction?: string | null; sent_at?: string | null }>,
): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;
  for (const message of messages) {
    if (message.direction !== "in" || !message.sent_at) continue;
    const ms = Date.parse(message.sent_at);
    if (!Number.isFinite(ms) || ms < latestMs) continue;
    latestMs = ms;
    latest = message.sent_at;
  }
  return latest;
}

/** Jendela 24 jam Meta sudah tutup bila tidak ada pesan masuk, atau sudah lewat. */
export function metaCustomerWindowClosed(lastInboundIso: string | null, now = Date.now()): boolean {
  if (!lastInboundIso) return true;
  const at = Date.parse(lastInboundIso);
  if (!Number.isFinite(at)) return true;
  return now - at >= META_CUSTOMER_WINDOW_MS;
}

export function adminSendFailureMessage(isReengagement: boolean, gatewayError: string | null): string {
  if (isReengagement) return META_WINDOW_CLOSED_MESSAGE;
  const err = gatewayError?.trim();
  return err || WA_SEND_FAILED_MESSAGE;
}

const attachmentSchema = z.object({
  path: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(180),
  mime: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
});

export const adminSendMessageSchema = z
  .object({
    threadId: z.string().uuid(),
    body: z.string().max(4000).optional().default(""),
    attachment: attachmentSchema.optional(),
    /**
     * Id lokal untuk mencocokkan gelembung optimistis dengan baris tersimpan.
     * Tidak dikirim ke tamu dan tidak mengubah routing provider.
     */
    clientId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.body.trim() && !value.attachment) {
      ctx.addIssue({
        code: "custom",
        message: WA_ATTACHMENT_REQUIRED_MESSAGE,
        path: ["body"],
      });
    }
    if (!value.attachment) return;
    if (!isStoredOutboundMime(value.attachment.mime)) {
      ctx.addIssue({
        code: "custom",
        message: WA_FILE_TYPE_MESSAGE,
        path: ["attachment", "mime"],
      });
    }
    if (value.attachment.size > WA_OUTBOUND_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: WA_FILE_TOO_BIG_MESSAGE,
        path: ["attachment", "size"],
      });
    }
    if (!attachmentPathForThread(value.attachment.path, value.threadId)) {
      ctx.addIssue({
        code: "custom",
        message: WA_PATH_INVALID_MESSAGE,
        path: ["attachment", "path"],
      });
    }
  });

export type AdminSendInput = z.infer<typeof adminSendMessageSchema>;

export function parseAdminSendInput(data: unknown): AdminSendInput {
  const parsed = adminSendMessageSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Data pesan tidak valid.");
  }
  return { ...parsed.data, body: parsed.data.body.trim() };
}
