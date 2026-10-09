/**
 * Signed URL singkat untuk lampiran WhatsApp di inbox admin.
 * Path `wa-inbound` dan `wa-outbound` ditandatangani terpisah.
 * Bucket yang belum ada dicatat di log; pesan tetap dikembalikan (placeholder).
 */
import { WA_OUTBOUND_BUCKET, WA_SIGNED_URL_TTL_SECONDS } from "@/services/wa-outbound-attachment";
import { WA_INBOUND_BUCKET } from "@/services/wa-inbound-media";

export type WaMediaBucket = typeof WA_INBOUND_BUCKET | typeof WA_OUTBOUND_BUCKET;

export function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

export function storageBucketForMessage(meta: Record<string, unknown> | null): WaMediaBucket {
  const explicit = meta?.storage_bucket;
  if (explicit === WA_INBOUND_BUCKET || explicit === WA_OUTBOUND_BUCKET) return explicit;
  const path = typeof meta?.storage_path === "string" ? meta.storage_path : "";
  if (/^\d{6,16}\/\d{4}-\d{2}\//.test(path)) return WA_INBOUND_BUCKET;
  return WA_OUTBOUND_BUCKET;
}

export interface SignedUrlStorage {
  from(bucket: string): {
    createSignedUrls(
      paths: string[],
      expiresIn: number,
    ): Promise<{
      data: Array<{ path?: string | null; signedUrl?: string | null; error?: string | null }> | null;
      error: { message: string } | null;
    }>;
  };
}

function usablePath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !path.includes("..");
}

/**
 * Isi `metadata.media_url` dari `storage_path` bila signed URL berhasil.
 * URL lama (media_url) dibiarkan bila penandatanganan gagal.
 */
export async function withSignedWhatsAppMedia<T extends { metadata?: unknown }>(
  messages: T[],
  storage: SignedUrlStorage,
  ttlSeconds = WA_SIGNED_URL_TTL_SECONDS,
): Promise<T[]> {
  const groups = new Map<WaMediaBucket, Set<string>>();
  for (const message of messages) {
    const meta = metadataRecord(message.metadata);
    const path = meta?.storage_path;
    if (!usablePath(path)) continue;
    const bucket = storageBucketForMessage(meta);
    const set = groups.get(bucket) ?? new Set<string>();
    set.add(path);
    groups.set(bucket, set);
  }
  if (groups.size === 0) return messages;

  const signed = new Map<string, string>();
  for (const [bucket, paths] of groups) {
    const list = [...paths];
    try {
      for (let i = 0; i < list.length; i += 100) {
        const slice = list.slice(i, i + 100);
        const { data, error } = await storage.from(bucket).createSignedUrls(slice, ttlSeconds);
        if (error) {
          console.warn(
            `[Admin WhatsApp] signed URL ${bucket} gagal (${error.message}). Placeholder tetap ditampilkan.`,
          );
          continue;
        }
        slice.forEach((requested, index) => {
          const row = data?.[index];
          const url = row?.signedUrl;
          if (!url || row?.error) return;
          signed.set(`${bucket}:${requested}`, url);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Admin WhatsApp] signed URL ${bucket} gagal (${message}). Placeholder tetap ditampilkan.`,
      );
    }
  }

  if (signed.size === 0) return messages;

  return messages.map((message) => {
    const meta = metadataRecord(message.metadata);
    const path = meta?.storage_path;
    if (!usablePath(path) || !meta) return message;
    const bucket = storageBucketForMessage(meta);
    const url = signed.get(`${bucket}:${path}`);
    if (!url) return message;
    return { ...message, metadata: { ...meta, media_url: url } };
  });
}
