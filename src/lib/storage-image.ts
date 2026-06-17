/**
 * Helper untuk membangun URL Supabase Storage Image Transformation.
 *
 * Mengubah URL `/storage/v1/object/public/...` menjadi
 * `/storage/v1/render/image/public/...?width=...&quality=...&format=origin`
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
  params.set("quality", String(opts.quality ?? 75));
  params.set("resize", opts.resize ?? "cover");
  // format=origin → Supabase pilih format optimal (WebP) berdasarkan Accept header
  params.set("format", "origin");
  return `${transformed}?${params.toString()}`;
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
