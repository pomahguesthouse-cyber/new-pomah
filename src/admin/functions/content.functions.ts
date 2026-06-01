/**
 * Admin server functions for the Content Manager dashboard.
 *
 * - runContentDiscovery: invokes Content Manager Agent end-to-end with a
 *   category + extra keywords. Returns the agent's final summary + a
 *   refreshed list of explore_items (draft + published).
 * - listExploreItemsForAdmin: read-only fetch used by the UI table.
 * - toggleExplorePublish / deleteExploreItem: admin moderation actions.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runMultiAgentOrchestration } from "@/ai/multi-agent-orchestrator";
import { todayWIB } from "@/lib/date";
import { generateExploreImage } from "@/tools/content/generate-explore-image.tool";

async function resolveLlm() {
  const { data: p } = await (supabaseAdmin as any)
    .from("properties").select("*").limit(1).maybeSingle();
  const prop = (p ?? {}) as any;
  const explicitKey = prop.ai_api_key?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const apiKey      = explicitKey || lovableKey;
  if (!apiKey) return { prop, llm: null as any };
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (prop.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = prop.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";
  return { prop, llm: { apiKey, baseUrl, model } };
}

export const runContentDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      category: z.enum(["event", "destinasi", "kuliner", "tips"]),
      extra_keywords: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { prop, llm } = await resolveLlm();
    if (!llm) return { ok: false as const, error: "AI API key belum dikonfigurasi." };

    const instruction =
      `Cari ${data.category === "event" ? "event terbaru" :
              data.category === "destinasi" ? "destinasi wisata" :
              data.category === "kuliner" ? "kuliner khas" : "tips wisata"} di Semarang` +
      (data.extra_keywords ? ` dengan fokus: ${data.extra_keywords}` : "") +
      `. Tambahkan 2-5 entri baru ke City Guide (default draft, publish=false). Ringkas hasilnya.`;

    const result = await runMultiAgentOrchestration({
      phone:     "admin:content-discovery",
      isManager: true,
      messages:  [
        { direction: "in", body: `Tolong delegasikan ke Content Manager: ${instruction}` },
      ],
      agentCtx: {
        property: prop,
        rooms:    [],
        sopText:  "",
        today:    todayWIB(),
      },
      toolCtx: {
        supabasePublic: supabasePublic as any,
        supabaseAdmin:  supabaseAdmin  as any,
        rooms:          [],
        property:       prop,
        today:          todayWIB(),
      },
      llmConfig: llm,
    });

    return {
      ok: !!result.reply,
      reply: result.reply ?? null,
      error: result.error ?? null,
      toolsUsed: result.toolsUsed,
    };
  });

export const listExploreItemsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("explore_items")
      .select("id, title, category, description, date_text, location_text, image_url, badge, is_published, sort_order, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const toggleExplorePublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), publish: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("explore_items")
      .update({ is_published: data.publish })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteExploreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("explore_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const generateExploreImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const result = await generateExploreImage(
      { id: data.id },
      {
        supabasePublic: supabasePublic as any,
        supabaseAdmin: supabaseAdmin as any,
        rooms: [],
        property: {} as any,
        today: todayWIB(),
      }
    );
    const parsed = JSON.parse(result);
    if (!parsed.ok) throw new Error(parsed.error ?? "Gagal generate gambar");
    return { ok: true as const, image_url: parsed.item?.image_url ?? null };
  });
