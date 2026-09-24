/**
 * I/O untuk menyiapkan gambar Meta: probe URL saudara, cache publik
 * `room-images/meta-safe/`, dan unggah JPEG/PNG.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { transcodeWebpToJpeg } from "@/services/meta-image-transcode";
import {
  isMetaSafeImageContentType,
  metaSafeObjectPath,
  type MetaImageDeps,
  type MetaSafeImageMime,
} from "@/services/meta-media";

const BUCKET = "room-images";

function publicObjectUrl(path: string): string | null {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function probeContentType(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    return res.headers.get("content-type");
  } catch {
    return null;
  }
}

async function cachedUrl(sourceUrl: string): Promise<string | null> {
  for (const ext of ["jpg", "png"] as const) {
    const url = publicObjectUrl(metaSafeObjectPath(sourceUrl, ext));
    if (!url) return null;
    const ct = await probeContentType(url);
    if (ct && isMetaSafeImageContentType(ct)) return url;
  }
  return null;
}

async function uploadPublicImage(
  bytes: Uint8Array,
  contentType: MetaSafeImageMime,
  sourceUrl: string,
): Promise<string | null> {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const path = metaSafeObjectPath(sourceUrl, ext);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, copy, {
      contentType,
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) {
      console.warn("[MetaMedia] upload gambar aman gagal:", error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || publicObjectUrl(path);
  } catch (e) {
    console.warn("[MetaMedia] upload gambar aman exception:", e instanceof Error ? e.message : e);
    return null;
  }
}

export function createMetaImageDeps(): MetaImageDeps {
  return {
    fetch,
    probeContentType,
    cachedUrl,
    transcodeToJpeg: transcodeWebpToJpeg,
    uploadPublicImage,
  };
}
