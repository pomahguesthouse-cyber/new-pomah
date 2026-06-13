import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type GlobalConfig, mergeGlobalConfig } from "./global.config";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/**
 * Get the global configuration (header, footer, WA widget, cookie banner)
 * from the properties table.
 */
export const getGlobalConfig = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = db(supabaseAdmin);
    const { data, error } = await sb
      .from("properties")
      .select("id, global_config")
      .limit(1)
      .maybeSingle();

    if (error) return { id: null, config: mergeGlobalConfig(null) };

    return {
      id: data?.id ?? null,
      config: mergeGlobalConfig(data?.global_config),
    };
  });

/**
 * Update the global configuration in the properties table.
 */
export const updateGlobalConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.custom<GlobalConfig>().parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);

    // Get the first property id
    const { data: prop, error: propErr } = await sb
      .from("properties")
      .select("id")
      .limit(1)
      .single();

    if (propErr || !prop) {
      throw new Error("Properti tidak ditemukan.");
    }

    const { error: updateErr } = await sb
      .from("properties")
      .update({ global_config: data as unknown as Record<string, unknown> })
      .eq("id", prop.id);

    if (updateErr) {
      throw new Error("Gagal menyimpan konfigurasi global.");
    }

    return { ok: true };
  });
