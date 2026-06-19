/**
 * Service to generate vector embeddings using the configured AI Gateway.
 */
import type { AiClientConfig } from "./types";

export async function generateEmbedding(
  config: AiClientConfig,
  text: string
): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

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
    return json.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.error("[EmbeddingService] fetch error:", e);
    return null;
  }
}
