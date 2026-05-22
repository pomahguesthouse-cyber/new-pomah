/**
 * Client-side image → WebP conversion via the browser Canvas API.
 *
 * Used before uploading images to Supabase Storage so all stored images
 * are WebP — smaller files, faster loads, better Core Web Vitals / SEO.
 */

/**
 * Convert an image File to WebP format.
 * - Falls back to the original file if the browser doesn't support WebP
 *   encoding, the input is already WebP, or anything goes wrong.
 * - Preserves original dimensions (no resizing).
 *
 * @param file    The image file to convert.
 * @param quality WebP quality 0–1 (default 0.85).
 */
export async function convertToWebP(file: File, quality = 0.85): Promise<File> {
  // Skip non-images and already-WebP files — nothing to do.
  if (!file.type.startsWith("image/") || file.type === "image/webp") return file;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          // Keep original base name, swap extension to .webp
          const baseName = file.name.replace(/\.[^.]+$/, "");
          resolve(new File([blob], `${baseName}.webp`, { type: "image/webp" }));
        },
        "image/webp",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Fall back to original on error
    };

    img.src = objectUrl;
  });
}

/** True if the file is a raster image that can be converted (i.e. not already WebP). */
export function isConvertibleImage(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/webp";
}
