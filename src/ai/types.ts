/**
 * Core AI / orchestration types.
 *
 * These interfaces define the contracts between:
 *   - the orchestrator and LLM gateway
 *   - the orchestrator and tool executor
 *   - the webhook pipeline and the orchestrator
 */

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface AiMessage {
  role:    "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present only when role === "assistant" with tool calls */
  tool_calls?: AiToolCall[];
  /** Present only when role === "tool" */
  tool_call_id?: string;
}

export interface AiToolCall {
  id:       string;
  type:     "function";
  function: {
    name:      string;
    arguments: string; // JSON-encoded
  };
}

// ─── Tool definitions (OpenAI function-calling schema) ────────────────────────

export interface ToolParameter {
  type?:       string;
  description: string;
  enum?:       string[];
  /** JSON Schema union — used when a param can be one of several shapes
   *  (e.g. string OR array of strings). When set, `type` can be omitted. */
  oneOf?:      Array<Record<string, unknown>>;
  /** For array params: schema of each item. */
  items?:      Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name:        string;
    description: string;
    parameters: {
      type:       "object";
      properties: Record<string, ToolParameter>;
      required?:  string[];
    };
  };
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface AiClientConfig {
  apiKey:  string;
  baseUrl: string;
  model:   string;
}

export interface AgentConfig {
  enabled:      boolean;
  autoReply:    boolean;
  instructions: string;
}

export interface ToolConfig {
  enabled: boolean;
  note:    string;
}

export interface AiLabConfig {
  agents: Record<string, AgentConfig>;
  tools:  Record<string, ToolConfig>;
}

// ─── Orchestration I/O ────────────────────────────────────────────────────────

export interface OrchestrationInput {
  /** Conversation history from `whatsapp_messages` (ascending) */
  messages: Array<{ direction: string; body: string }>;
  /** Pre-built system prompt string */
  systemPrompt: string;
  /** AI gateway configuration */
  client: AiClientConfig;
  /** Tool definitions to pass to the LLM */
  tools: ToolDefinition[];
  /** Max tool-call rounds (default 4) */
  maxTurns?: number;
}

export interface OrchestrationResult {
  /** The assistant's final text reply; null means the LLM did not produce one */
  reply:      string | null;
  /** Names of tools invoked during this orchestration */
  toolsUsed:  string[];
  /** Error message if the pipeline failed */
  error?:     string;
}

// ─── LLM response shape ───────────────────────────────────────────────────────

export interface LlmResponse {
  choices?: Array<{
    message?: {
      content?:     string | null;
      tool_calls?:  AiToolCall[];
    };
  }>;
  error?: { message?: string };
}
