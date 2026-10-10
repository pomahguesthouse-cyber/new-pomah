import type { AiClientConfig } from "@/ai/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Konfigurasi gateway yang sama dengan jalur embedding lain. */
export async function loadTrainingAiConfig(): Promise<AiClientConfig | null> {
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("ai_api_key, ai_base_url, ai_model")
    .limit(1)
    .maybeSingle();
  const row = (prop ?? {}) as { ai_api_key?: string; ai_base_url?: string; ai_model?: string };
  const explicitKey = row.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey || null;
  if (!apiKey) return null;
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (row.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = row.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";
  return { apiKey, baseUrl, model };
}
