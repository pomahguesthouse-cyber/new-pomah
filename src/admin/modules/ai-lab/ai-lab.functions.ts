/**
 * AI LAB — per-agent and per-tool configuration.
 *
 * Stored as a single JSONB document (`ai_lab_config`) on the property.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Untyped client view — `ai_lab_config` is not in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export const AGENT_KEYS = [
  "front-office",
  "pricing",
  "housekeeping",
  "maintenance",
  "finance",
  "manager",
] as const;
export const TOOL_KEYS = [
  "pms-database",
  "room-availability",
  "sop-knowledge",
  "pricing-engine",
  "faq-memory",
] as const;

/** Settings for one specialized AI agent. */
export interface AgentConfig {
  /** Whether the agent participates in conversations. */
  enabled: boolean;
  /** Reply automatically (true) or queue for human approval (false). */
  autoReply: boolean;
  /** Persona / behaviour instructions for this agent. */
  instructions: string;
}

/** Settings for one knowledge source / tool. */
export interface ToolConfig {
  /** Whether agents may use this tool. */
  enabled: boolean;
  /** Endpoint, source note or free-form configuration. */
  note: string;
}

export interface AiLabConfig {
  agents: Record<string, AgentConfig>;
  tools: Record<string, ToolConfig>;
}

const defaultAgent = (): AgentConfig => ({ enabled: true, autoReply: false, instructions: "" });
const defaultTool = (): ToolConfig => ({ enabled: true, note: "" });

/** Coerce a stored (possibly partial) document into a full `AiLabConfig`. */
export function mergeAiLabConfig(raw: unknown): AiLabConfig {
  const c = (raw ?? {}) as Partial<AiLabConfig>;
  const agents: Record<string, AgentConfig> = {};
  for (const k of AGENT_KEYS) agents[k] = { ...defaultAgent(), ...c.agents?.[k] };
  const tools: Record<string, ToolConfig> = {};
  for (const k of TOOL_KEYS) tools[k] = { ...defaultTool(), ...c.tools?.[k] };
  return { agents, tools };
}

/** Read the AI LAB configuration from the first property row. */
export const getAiLabConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("properties")
      .select("id, ai_lab_config")
      .limit(1)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: (row.id as string | undefined) ?? null,
      config: mergeAiLabConfig(row.ai_lab_config),
    };
  });

/** Persist the AI LAB configuration onto the property row. */
export const updateAiLabConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), config: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("properties")
      .update({ ai_lab_config: data.config } as never)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
