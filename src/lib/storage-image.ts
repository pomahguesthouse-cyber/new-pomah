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

/**
 * First-slide hero. Phones get 480w (about 70 KB WebP at quality 70 on the
 * live welcome photo). Tablets get 768w, desktops 1080w. Each breakpoint is
 * its own file so a high-DPR phone cannot upgrade itself to the desktop file.
 */
export const HERO_IMAGE_WIDTHS = [480, 768, 1080] as const;
export const HERO_IMAGE_QUALITY = 70;
export const HERO_IMAGE_SIZES = "(max-width: 767px) 100vw, (max-width: 1279px) 100vw, 1080px";

export type HeroImageVariant = {
  width: number;
  media: string;
  url: string;
};

const HERO_VARIANT_MEDIA: Record<(typeof HERO_IMAGE_WIDTHS)[number], string> = {
  480: "(max-width: 767px)",
  768: "(min-width: 768px) and (max-width: 1279px)",
  1080: "(min-width: 1280px)",
};

export function heroImageVariants(url: string): HeroImageVariant[] | null {
  if (!url || !isSupabasePublicObject(url)) return null;
  return HERO_IMAGE_WIDTHS.map((width) => ({
    width,
    media: HERO_VARIANT_MEDIA[width],
    url: buildStorageImageUrl(url, { width, quality: HERO_IMAGE_QUALITY, format: "webp" }),
  }));
}

export function heroImageSrcSet(url: string): string | undefined {
  return buildStorageImageSrcSet(url, [...HERO_IMAGE_WIDTHS], {
    quality: HERO_IMAGE_QUALITY,
    format: "webp",
  });
}

/** One preload per breakpoint. A phone only fetches the 480w WebP. */
export function heroPreloadLinks(url: string | null | undefined): Array<{
  rel: "preload";
  as: "image";
  media: string;
  imageSrcSet: string;
  imageSizes: string;
  fetchPriority: "high";
}> {
  const variants = heroImageVariants(url || "");
  if (!variants) return [];
  return variants.map((variant) => ({
    rel: "preload" as const,
    as: "image" as const,
    media: variant.media,
    imageSrcSet: `${variant.url} ${variant.width}w`,
    imageSizes: "100vw",
    fetchPriority: "high" as const,
  }));
}
