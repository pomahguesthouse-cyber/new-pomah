/**
 * Service to generate vector embeddings using the configured AI Gateway.
 */
import type { AiClientConfig } from "./types";

// ─── LRU cache per-isolate ───────────────────────────────────────────────────
// Pertanyaan tamu sangat repetitif ("ada kamar kosong?", "alamatnya dimana?")
// — tanpa cache, tiap pesan membayar 1 round-trip API embedding (~200-600ms).
// Map JS menjaga insertion order → entri tertua = key pertama (LRU sederhana).
const EMBED_CACHE_MAX = 50;
const embedCache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function generateEmbedding(
  config: AiClientConfig,
  text: string
): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  const key = cacheKey(text);
  const cached = embedCache.get(key);
  if (cached) {
    // Refresh posisi LRU: hapus lalu set ulang agar jadi entri termuda.
    embedCache.delete(key);
    embedCache.set(key, cached);
    return cached;
  }

  try {
    // For Lovable gateway or OpenAI, we call /embeddings
    // Some gateways use a different model string for embeddings, e.g. text-embedding-3-small
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small", // Lovable AI Gateway requires provider prefix
        input: text.trim(),
      }),
    });

    if (!res.ok) {
      console.error(
        "[EmbeddingService] HTTP error:",
        res.status,
        await res.text()
      );
      return null;
    }

    const json = await res.json();
    const embedding = (json.data?.[0]?.embedding ?? null) as number[] | null;
    if (embedding) {
      embedCache.set(key, embedding);
      if (embedCache.size > EMBED_CACHE_MAX) {
        const oldest = embedCache.keys().next().value;
        if (oldest !== undefined) embedCache.delete(oldest);
      }
    }
    return embedding;
  } catch (e) {
    console.error("[EmbeddingService] fetch error:", e);
    return null;
  }
}
