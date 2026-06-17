import { chatCompletionText, extractJsonObject, type AiChatMessage, type AiClientConfig } from "@/services/ai-client.service";

export async function generateJsonObject<T = Record<string, unknown>>(
  config: AiClientConfig,
  messages: AiChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  },
): Promise<T | null> {
  const raw = await chatCompletionText(config, messages, {
    temperature: options?.temperature ?? 0.2,
    maxTokens: options?.maxTokens,
    responseFormat: { type: "json_object" },
  });

  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText) as T;
  } catch (error) {
    console.error("[AI JSON] failed to parse model output", error);
    return null;
  }
}

export async function generatePlainText(
  config: AiClientConfig,
  messages: AiChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string | null> {
  return chatCompletionText(config, messages, {
    temperature: options?.temperature ?? 0.3,
    maxTokens: options?.maxTokens,
  });
}
