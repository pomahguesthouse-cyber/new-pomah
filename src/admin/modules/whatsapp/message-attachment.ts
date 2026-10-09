/**
 * Lampiran di gelembung chat admin (web dan aplikasi Android memakai payload yang sama).
 * URL diutamakan dari signed URL yang sudah diisi server (`media_url`),
 * dengan cadangan URL publik lama.
 */

export type AttachmentInfo = {
  url: string;
  kind: "image" | "video" | "audio" | "file";
  name: string;
  mime: string;
};

function metaOf(message: { metadata?: unknown } | null | undefined): Record<string, any> {
  const meta = message?.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as Record<string, any>;
}

export function getMessageAttachment(
  message: { metadata?: unknown; body?: string | null } | null | undefined,
  signedUrls?: ReadonlyMap<string, string> | null,
): AttachmentInfo | null {
  const meta = metaOf(message);
  const media = (meta.media ?? meta.attachment ?? null) as Record<string, any> | null;
  const storagePath = typeof meta.storage_path === "string" ? meta.storage_path : "";
  const signed = storagePath && signedUrls?.get(storagePath) ? signedUrls.get(storagePath)! : null;
  const url =
    signed ??
    meta.media_url ??
    meta.mediaUrl ??
    meta.attachment_url ??
    meta.file_url ??
    meta.fileUrl ??
    meta.url ??
    media?.url ??
    media?.link ??
    null;
  if (!url || typeof url !== "string") return null;

  const mime = String(
    meta.mime_type ?? meta.mimetype ?? meta.content_type ?? media?.mime_type ?? media?.type ?? "",
  ).toLowerCase();
  const name =
    String(meta.file_name ?? meta.filename ?? meta.media_name ?? media?.file_name ?? media?.filename ?? "") ||
    (url.split("?")[0].split("/").pop() ?? "file");
  const ext = (name.split(".").pop() ?? url.split("?")[0].split(".").pop() ?? "").toLowerCase();
  const mediaType = String(meta.media_type ?? "").toLowerCase();

  const isImg =
    mime.startsWith("image/") ||
    mime === "image" ||
    mediaType === "image" ||
    mediaType === "sticker" ||
    ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"].includes(ext);
  const isVid =
    mime.startsWith("video/") ||
    mime === "video" ||
    mediaType === "video" ||
    ["mp4", "webm", "mov", "avi", "mkv", "3gp"].includes(ext);
  const isAud =
    mime.startsWith("audio/") ||
    mime === "audio" ||
    mediaType === "audio" ||
    ["mp3", "ogg", "opus", "wav", "m4a", "aac"].includes(ext);
  const kind: AttachmentInfo["kind"] = isImg ? "image" : isVid ? "video" : isAud ? "audio" : "file";
  return { url, kind, name, mime: mime || mediaType };
}
