/**
 * WebP → JPEG untuk WhatsApp Cloud API.
 *
 * Codec WASM dimuat dari paket @jsquash (byte wasm dibaca dari disk supaya
 * tidak bergantung pada fetch(file://), yang gagal di sebagian runtime Node).
 * Di Cloudflare, bila file wasm tidak ada, fungsi mengembalikan null dan
 * pemanggil menolak URL WebP — atau memakai byte JPEG yang sudah dihasilkan
 * Image Resizing pada fetch `cf.image`.
 */

import { sniffImageMime } from "@/services/meta-media";

type ImageDataLike = { data: Uint8ClampedArray; width: number; height: number };
type DecodeFn = (input: ArrayBuffer) => Promise<ImageDataLike>;
type EncodeFn = (image: ImageDataLike, options?: { quality?: number }) => Promise<ArrayBuffer>;

let codecsPromise: Promise<{ decode: DecodeFn; encode: EncodeFn } | null> | null = null;

async function loadCodecs(): Promise<{ decode: DecodeFn; encode: EncodeFn } | null> {
  try {
    const { createRequire } = await import("node:module");
    const { readFileSync } = await import("node:fs");
    const require = createRequire(import.meta.url);
    const webpWasm = readFileSync(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"));
    const jpegWasm = readFileSync(require.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
    const webp = await import("@jsquash/webp/decode.js");
    const jpeg = await import("@jsquash/jpeg/encode.js");
    await webp.init({ wasmBinary: webpWasm });
    await jpeg.init({ wasmBinary: jpegWasm });
    return {
      decode: webp.default as DecodeFn,
      encode: jpeg.default as EncodeFn,
    };
  } catch (e) {
    console.warn("[MetaMedia] codec WebP/JPEG tidak tersedia:", e instanceof Error ? e.message : e);
    return null;
  }
}

function codecs(): Promise<{ decode: DecodeFn; encode: EncodeFn } | null> {
  if (!codecsPromise) codecsPromise = loadCodecs();
  return codecsPromise;
}

export async function transcodeWebpToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (sniffImageMime(bytes) === "image/jpeg") return bytes;
  if (sniffImageMime(bytes) !== "image/webp") return null;
  const loaded = await codecs();
  if (!loaded) return null;
  try {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const image = await loaded.decode(copy);
    if (!image?.width || !image?.height) return null;
    const encoded = await loaded.encode(image, { quality: 82 });
    const out = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    return sniffImageMime(out) === "image/jpeg" ? out : null;
  } catch (e) {
    console.warn("[MetaMedia] gagal konversi WebP ke JPEG:", e instanceof Error ? e.message : e);
    return null;
  }
}
