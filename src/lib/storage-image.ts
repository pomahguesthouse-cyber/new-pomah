/**
 * Helper untuk membangun URL Supabase Storage Image Transformation.
 *
 * Mengubah URL `/storage/v1/object/public/...` menjadi
 * `/storage/v1/render/image/public/...?width=...&quality=...&format=webp`
 * sehingga gambar disajikan dalam ukuran yang tepat dan format modern
 * (WebP/AVIF) sesuai negosiasi Accept browser.
 *
 * Bila URL bukan dari Supabase Storage public path, URL dikembalikan apa adanya.
 */

const OBJECT_PUBLIC = "/storage/v1/object/public/";
const RENDER_PUBLIC = "/storage/v1/render/image/public/";

export interface StorageImageOptions {
  width?: number;
  height?: number;
  quality?: number; // 1-100
  resize?: "cover" | "contain" | "fill";
  /**
   * Supabase transform format. `origin` forces the uploaded file (often a
   * multi-megabyte PNG). `webp` is the default so crawlers get a small file
   * even when they do not send Accept: image/webp.
   */
  format?: "webp" | "avif" | "origin";
}

/** Cek apakah URL adalah Supabase Storage public object. */
function isSupabasePublicObject(url: string): boolean {
  return typeof url === "string" && url.includes(OBJECT_PUBLIC);
}

/** Bangun URL transformasi. Fallback ke URL asli untuk non-Supabase. */
export function buildStorageImageUrl(url: string, opts: StorageImageOptions = {}): string {
  if (!url || !isSupabasePublicObject(url)) return url;
  const transformed = url.replace(OBJECT_PUBLIC, RENDER_PUBLIC);
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(Math.round(opts.width)));
  if (opts.height) params.set("height", String(Math.round(opts.height)));
  params.set("quality", String(opts.quality ?? 60));
  params.set("resize", opts.resize ?? "cover");
  // Do not use format=origin: that serves the original PNG/JPEG (1MB+).
  params.set("format", opts.format ?? "webp");
  return `${transformed}?${params.toString()}`;
}

/**
 * Current header mark (`branding/1779972746377-83dfkm.png`) is 1362×944.
 * The box uses this ratio so width/height are set even when the file changes.
 */
export const BRAND_LOGO_ASPECT = 1362 / 944;

/** Small WebP for the header mark. Never the original PNG. */
export function buildLogoImageUrl(url: string, displayHeight: number): string {
  const height = Math.max(48, Math.round(displayHeight * 2));
  const width = Math.max(48, Math.round(height * BRAND_LOGO_ASPECT));
  return buildStorageImageUrl(url, {
    width,
    height,
    quality: 60,
    resize: "contain",
    format: "webp",
  });
}

export function logoDisplaySize(displayHeight: number): { width: number; height: number } {
  const height = Math.max(24, Math.round(displayHeight));
  return {
    height,
    width: Math.max(24, Math.round(height * BRAND_LOGO_ASPECT)),
  };
}

/** Bangun srcset multi-lebar untuk responsive images. */
export function buildStorageImageSrcSet(
  url: string,
  widths: number[],
  opts: Omit<StorageImageOptions, "width"> = {},
): string | undefined {
  if (!url || !isSupabasePublicObject(url)) return undefined;
  return widths
    .map((w) => `${buildStorageImageUrl(url, { ...opts, width: w })} ${w}w`)
    .join(", ");
}
