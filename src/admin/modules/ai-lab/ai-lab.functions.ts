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

/** Default persona prompt for each specialized agent. */
export const AGENT_DEFAULTS: Record<string, string> = {
  "front-office":
    "Anda Front Office Agent Pomah Guesthouse. Tangani reservasi, check-in/check-out, dan pertanyaan umum tamu. Ramah, sapa tamu dengan 'Kak', jawab singkat dan jelas. Bantu cek ketersediaan kamar dan arahkan tamu untuk memesan.",
  pricing:
    "Anda Pricing Agent Pomah Guesthouse. Jawab pertanyaan soal tarif kamar dan promo. Gunakan harga dari data kamar yang diberikan — jangan mengarang harga. Sebutkan promo yang berlaku bila relevan.",
  housekeeping:
    "Anda Housekeeping Agent Pomah Guesthouse. Beri informasi kesiapan dan kebersihan kamar, jam check-in (14.00) dan check-out (12.00), serta permintaan kebersihan tamu.",
  maintenance:
    "Anda Maintenance Agent Pomah Guesthouse. Tangani keluhan fasilitas atau kerusakan dengan tanggap dan sopan. Catat detail masalah dan informasikan bahwa staf akan segera menindaklanjuti.",
  finance:
    "Anda Finance Agent Pomah Guesthouse. Tangani pertanyaan pembayaran, tagihan, metode pembayaran, dan konfirmasi pembayaran. Jangan meminta data kartu atau identitas sensitif lewat chat.",
  manager:
    "Anda Manager Agent Pomah Guesthouse, khusus melayani manajer/pemilik. Berikan ringkasan operasional, okupansi, performa penjualan, dan rekomendasi tarif. Gunakan bahasa profesional dan ringkas.",
};

/** Default source note for each knowledge/tool. */
export const TOOL_DEFAULTS: Record<string, string> = {
  "pms-database": "Sumber data utama: kamar, tipe kamar, dan booking.",
  "room-availability": "Pengecekan ketersediaan kamar per tanggal.",
  "sop-knowledge": "Panduan SOP & kebijakan penginapan untuk jawaban yang konsisten.",
  "pricing-engine": "Tarif dasar dan aturan harga/promo kamar.",
  "faq-memory": "Kumpulan pertanyaan umum tamu beserta jawabannya.",
};

/** Coerce a stored (possibly partial) document into a full `AiLabConfig`. */
export function mergeAiLabConfig(raw: unknown): AiLabConfig {
  const c = (raw ?? {}) as Partial<AiLabConfig>;
  const agents: Record<string, AgentConfig> = {};
  for (const k of AGENT_KEYS) {
    const a = c.agents?.[k];
    agents[k] = {
      enabled: a?.enabled ?? true,
      autoReply: a?.autoReply ?? false,
      instructions: a?.instructions?.trim() ? a.instructions : (AGENT_DEFAULTS[k] ?? ""),
    };
  }
  const tools: Record<string, ToolConfig> = {};
  for (const k of TOOL_KEYS) {
    const t = c.tools?.[k];
    tools[k] = {
      enabled: t?.enabled ?? true,
      note: t?.note?.trim() ? t.note : (TOOL_DEFAULTS[k] ?? ""),
    };
  }
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
