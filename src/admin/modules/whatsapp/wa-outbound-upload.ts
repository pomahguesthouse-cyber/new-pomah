/**
 * Unggah lampiran chat dari browser staf langsung ke Storage.
 * Byte berkas tidak lewat server function.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  WA_HEIC_UNSUPPORTED_MESSAGE,
  WA_IMAGE_DECODE_MESSAGE,
  WA_IMAGE_STILL_TOO_BIG_MESSAGE,
  WA_OUTBOUND_BUCKET,
  WA_OUTBOUND_MAX_BYTES,
  fileNameForMime,
  needsImageCompress,
  validateClientPick,
} from "@/services/wa-outbound-attachment";

const MAX_IMAGE_SIDE = 1600;

export type PreparedOutboundFile = {
  blob: Blob;
  name: string;
  mime: string;
  previewUrl: string | null;
};

function loadHtmlImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

async function compressImage(file: File, mime: string): Promise<{ blob: Blob; mime: string }> {
  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(file);
  } catch {
    if (mime === "image/heic" || mime === "image/heif") {
      throw new Error(WA_HEIC_UNSUPPORTED_MESSAGE);
    }
    throw new Error(WA_IMAGE_DECODE_MESSAGE);
  }

  const longest = Math.max(img.width, img.height);
  const scale = longest > 0 ? Math.min(1, MAX_IMAGE_SIDE / longest) : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gagal memproses gambar.");

  const outMime = mime === "image/png" ? "image/png" : "image/jpeg";
  if (outMime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), outMime, outMime === "image/jpeg" ? 0.8 : undefined);
  });
  if (!blob) throw new Error("Gagal memproses gambar.");
  if (blob.size > WA_OUTBOUND_MAX_BYTES) throw new Error(WA_IMAGE_STILL_TOO_BIG_MESSAGE);
  return { blob, mime: outMime };
}

export async function prepareOutboundFile(file: File): Promise<PreparedOutboundFile> {
  const checked = validateClientPick(file);
  if (!checked.ok) throw new Error(checked.error);

  if (!needsImageCompress(checked.mime)) {
    return {
      blob: file,
      name: fileNameForMime(file.name, checked.mime),
      mime: checked.mime,
      previewUrl: null,
    };
  }

  const compressed = await compressImage(file, checked.mime);
  return {
    blob: compressed.blob,
    name: fileNameForMime(file.name, compressed.mime),
    mime: compressed.mime,
    previewUrl: URL.createObjectURL(compressed.blob),
  };
}

function storageEndpoint(path: string): { url: string; key: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(
    /\/+$/,
    "",
  );
  const key = String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  );
  if (!url || !key) throw new Error("Supabase belum terhubung.");
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  return { url: `${url}/storage/v1/object/${WA_OUTBOUND_BUCKET}/${objectPath}`, key };
}

function uploadErrorMessage(status: number, body: string): string {
  if (status === 404 || /bucket not found/i.test(body)) {
    return "Penyimpanan lampiran belum aktif. Jalankan migrasi bucket wa-outbound.";
  }
  if (/mime|content.type|invalid file/i.test(body)) {
    return "Jenis berkas tidak didukung. Gunakan JPG, PNG, PDF, TXT, Word, Excel, atau PowerPoint.";
  }
  if (/size|too large|payload|entity/i.test(body)) {
    return "Ukuran berkas maksimal 25 MB.";
  }
  return "Gagal mengunggah berkas. Coba lagi.";
}

/** Unggah dengan sesi staf yang sedang login. `abort` membatalkan XHR. */
export function uploadOutboundObject(
  path: string,
  body: Blob,
  mime: string,
  onProgress: (pct: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let aborted = false;
  const promise = (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (aborted) throw new DOMException("aborted", "AbortError");
    const token = data.session?.access_token;
    if (error || !token) {
      throw new Error("Sesi staf tidak ditemukan. Masuk ulang lalu coba lagi.");
    }
    const { url, key } = storageEndpoint(path);
    if (aborted) throw new DOMException("aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", key);
      xhr.setRequestHeader("Content-Type", mime);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
      };
      xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
      xhr.onerror = () => reject(new Error("Gagal mengunggah berkas. Coba lagi."));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve();
          return;
        }
        console.error("[wa-outbound] upload failed", xhr.status, xhr.responseText.slice(0, 300));
        reject(new Error(uploadErrorMessage(xhr.status, xhr.responseText)));
      };
      xhr.send(body);
    });
  })();
  return {
    promise,
    abort: () => {
      aborted = true;
      if (xhr.readyState !== XMLHttpRequest.UNSENT && xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort();
      }
    },
  };
}

export async function removeOutboundObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(WA_OUTBOUND_BUCKET).remove([path]);
  if (error) console.warn("[wa-outbound] remove", error.message);
}
