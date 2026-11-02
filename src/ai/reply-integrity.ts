/** Never salvage a partial JSON string: it may omit prices or booking terms. */
export function parseCompleteReply(content: string | null | undefined, finishReason?: string | null): string | null {
  if (isTruncatedFinish(finishReason)) return null;
  const raw = content?.trim();
  if (!raw) return null;
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (clean.startsWith("{") || clean.startsWith("[")) {
    try {
      const parsed = JSON.parse(clean);
      return typeof parsed.reply === "string" ? parsed.reply.trim() || null : null;
    } catch {
      return null;
    }
  }
  return clean;
}

/** OpenAI: "length"; Gemini via gateway: "MAX_TOKENS"/"max_tokens"; filters too. */
export function isTruncatedFinish(finishReason?: string | null): boolean {
  const f = (finishReason ?? "").toLowerCase();
  return f === "length" || f === "max_tokens" || f === "content_filter" || f === "safety" || f === "recitation";
}
