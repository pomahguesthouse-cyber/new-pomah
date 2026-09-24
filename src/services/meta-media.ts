/**
 * WhatsApp Cloud API hanya menerima gambar JPEG dan PNG (bukan WebP/GIF/HEIC).
 * Mengirim URL `.webp` menghasilkan error 131053. Modul ini murni: memutuskan
 * apakah URL aman, dan — lewat dependency yang disuntik — mengunduh, mengkonversi,
 * lalu mengembalikan URL JPEG/PNG publik sebelum `sendMetaMessage`.
 */

const UNSAFE_EXT = "webp|gif|heic|heif|bmp|avif|tiff?";
const UNSAFE_EXT_RE = new RegExp(`\\.(${UNSAFE_EXT})(\\?|#|$)`, "i");
const SAFE_EXT_RE = /\.(jpe?g|png)(\?|#|$)/i;

export const META_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type MetaSafeImageMime = "image/jpeg" | "image/png";

export interface PreparedMetaImage {
  url: string;
  filename: string;
}

export interface MetaImageDeps {
  fetch: typeof fetch;
  probeContentType: (url: string) => Promise<string | null>;
  /** URL JPEG/PNG yang sudah di-cache untuk sumber ini, bila ada. */
  cachedUrl: (sourceUrl: string) => Promise<string | null>;
  transcodeToJpeg: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  uploadPublicImage: (
    bytes: Uint8Array,
    contentType: MetaSafeImageMime,
    sourceUrl: string,
  ) => Promise<string | null>;
}

export function isMetaSafeRasterUrl(url: string): boolean {
  return SAFE_EXT_RE.test(stripUrl(url));
}

export function isUnsupportedMetaImage(url: string, filename?: string): boolean {
  if (UNSAFE_EXT_RE.test(stripUrl(url))) return true;
  return Boolean(filename && UNSAFE_EXT_RE.test(filename));
}

export function isMetaSafeImageContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("image/jpeg") || ct.includes("image/jpg") || ct.includes("image/png");
}

export function metaImageCacheKey(url: string): string {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + i;
    h2 = Math.imul(h2, 2246822519);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

export function metaSafeObjectPath(sourceUrl: string, ext: "jpg" | "png"): string {
  return `meta-safe/${metaImageCacheKey(sourceUrl)}.${ext}`;
}

/** Ganti ekstensi tidak didukung dengan kandidat JPEG/PNG di path yang sama. */
export function siblingRasterCandidates(url: string): string[] {
  if (!UNSAFE_EXT_RE.test(url)) return [];
  const swap = (ext: string) =>
    url.replace(new RegExp(`\\.(${UNSAFE_EXT})(?=(\\?|#|$))`, "i"), `.${ext}`);
  return [swap("jpg"), swap("jpeg"), swap("png")];
}

export function metaSafeImageFilename(filename: string | undefined, url: string): string {
  const raw = (filename || url.split("/").pop() || "foto").split("?")[0]?.split("#")[0] ?? "foto";
  const stem = raw.replace(/\.(webp|gif|heic|heif|bmp|avif|tiff?|jpe?g|png)$/i, "") || "foto";
  if (/\.png(\?|#|$)/i.test(url)) return `${stem}.png`;
  return `${stem}.jpg`;
}

export function sniffImageMime(
  bytes: Uint8Array,
): MetaSafeImageMime | "image/webp" | "image/gif" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  return null;
}

/**
 * Pastikan link yang dikirim ke Meta adalah JPEG/PNG.
 * URL yang sudah `.jpg`/`.png` dikembalikan apa adanya (tanpa unduh).
 * WebP dan format lain tidak pernah diteruskan sebagai `link`.
 */
export async function prepareMetaImageForSend(
  fileUrl: string,
  filename: string | undefined,
  deps: MetaImageDeps,
): Promise<PreparedMetaImage | null> {
  if (!isUnsupportedMetaImage(fileUrl, filename)) {
    return { url: fileUrl, filename: metaSafeImageFilename(filename, fileUrl) };
  }

  const cached = await deps.cachedUrl(fileUrl);
  if (cached && isMetaSafeRasterUrl(cached)) {
    return { url: cached, filename: metaSafeImageFilename(filename, cached) };
  }

  for (const candidate of siblingRasterCandidates(fileUrl)) {
    const ct = await deps.probeContentType(candidate);
    if (ct && isMetaSafeImageContentType(ct)) {
      return { url: candidate, filename: metaSafeImageFilename(filename, candidate) };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let bytes: Uint8Array;
  try {
    const res = await deps.fetch(fileUrl, {
      headers: { Accept: "image/jpeg,image/png;q=0.8,*/*;q=0.1" },
      signal: controller.signal,
      // Di Cloudflare, Image Resizing mengubah WebP menjadi JPEG pada fetch ini.
      // Di runtime lain opsi ini diabaikan dan byte asli yang dipakai.
      cf: { image: { format: "jpeg", quality: 82, width: 1600, fit: "scale-down" } },
    } as RequestInit);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return null;
    bytes = buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const sniffed = sniffImageMime(bytes);
  let payload: Uint8Array | null = null;
  let mime: MetaSafeImageMime = "image/jpeg";
  if (sniffed === "image/jpeg" || sniffed === "image/png") {
    payload = bytes;
    mime = sniffed;
  } else {
    payload = await deps.transcodeToJpeg(bytes);
    mime = "image/jpeg";
  }
  if (!payload || payload.byteLength === 0 || payload.byteLength > META_IMAGE_MAX_BYTES)
    return null;
  if (
    sniffImageMime(payload) !== mime &&
    mime === "image/jpeg" &&
    sniffImageMime(payload) !== "image/jpeg"
  ) {
    return null;
  }

  const uploaded = await deps.uploadPublicImage(payload, mime, fileUrl);
  if (!uploaded || !isMetaSafeRasterUrl(uploaded)) return null;
  return { url: uploaded, filename: metaSafeImageFilename(filename, uploaded) };
}

function stripUrl(url: string): string {
  return String(url ?? "").trim();
}
