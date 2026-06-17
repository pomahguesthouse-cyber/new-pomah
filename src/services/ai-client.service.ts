export type AiChatRole = "system" | "user" | "assistant" | "tool" | string;

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
}

export interface AiChatResult {
  ok: boolean;
  content: string | null;
  status?: number;
  error?: string;
  raw?: unknown;
}

export const LOVABLE_AI_BASE_URL = "https://ai.gateway.lovable.dev/v1";
export const DEFAULT_LOVABLE_MODEL = "google/gemini-3-flash-preview";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_AI_TIMEOUT_MS = 22_000;

export function normalizeAiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function getLovableAiConfig(model = DEFAULT_LOVABLE_MODEL): AiClientConfig | null {
  const apiKey = process.env.LOVABLE_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: LOVABLE_AI_BASE_URL,
    model,
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
  };
}

export async function resolvePropertyAiConfig(
  client: any,
  options?: {
    lovableFallbackModel?: string;
    openAiFallbackModel?: string;
  },
): Promise<AiClientConfig | null> {
  const { data: prop } = await client
    .from("properties")
    .select("ai_api_key, ai_base_url, ai_model")
    .limit(1)
    .maybeSingle();

  const p = (prop ?? {}) as { ai_api_key?: string; ai_base_url?: string; ai_model?: string };
  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey;
  if (!apiKey) return null;

  const cfgModel = p.ai_model?.trim();
  const lovableFallbackModel = options?.lovableFallbackModel ?? DEFAULT_LOVABLE_MODEL;
  const openAiFallbackModel = options?.openAiFallbackModel ?? DEFAULT_OPENAI_MODEL;

  return {
    apiKey,
    baseUrl: useLovable
      ? LOVABLE_AI_BASE_URL
      : normalizeAiBaseUrl(p.ai_base_url || "https://api.openai.com/v1"),
    model: useLovable
      ? cfgModel?.includes("/")
        ? cfgModel
        : lovableFallbackModel
      : cfgModel || openAiFallbackModel,
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
  };
}

function buildAbortSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function chatCompletion(
  config: AiClientConfig,
  messages: AiChatMessage[],
  options: AiChatOptions = {},
): Promise<AiChatResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const { signal, cleanup } = buildAbortSignal(timeoutMs, options.signal);

  try {
    const res = await fetch(`${normalizeAiBaseUrl(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens,
        response_format: options.responseFormat,
      }),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON error body; preserve as plain text below.
    }

    if (!res.ok) {
      return {
        ok: false,
        content: null,
        status: res.status,
        error: json?.error?.message ?? text ?? `AI request failed with ${res.status}`,
        raw: json ?? text,
      };
    }

    return {
      ok: true,
      status: res.status,
      content: json?.choices?.[0]?.message?.content?.trim?.() ?? null,
      raw: json,
    };
  } catch (error) {
    return {
      ok: false,
      content: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cleanup();
  }
}

export async function chatCompletionText(
  config: AiClientConfig,
  messages: AiChatMessage[],
  options: AiChatOptions = {},
): Promise<string | null> {
  const result = await chatCompletion(config, messages, options);
  if (!result.ok) {
    console.error("[AI Client] chat completion failed", result.status, result.error);
    return null;
  }
  return result.content;
}

export function extractJsonObject(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const direct = cleaned.startsWith("{") && cleaned.endsWith("}") ? cleaned : null;
  if (direct) return direct;
  return cleaned.match(/\{[\s\S]*\}/)?.[0] ?? null;
}
