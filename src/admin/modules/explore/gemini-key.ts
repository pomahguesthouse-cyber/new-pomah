/** Read the explore Gemini key on the server. Never return this to the browser. */
export function resolveGeminiApiKey(
  row: {
    gemini_api_key?: string | null;
    explore_config?: { gemini_api_key?: string | null } | null;
  } | null | undefined,
): string | null {
  const fromConfig = row?.explore_config?.gemini_api_key?.trim();
  const fromColumn = row?.gemini_api_key?.trim();
  return fromConfig || fromColumn || null;
}
