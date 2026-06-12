import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/admin/lib/auth-middleware";
import { type GlobalConfig, mergeGlobalConfig } from "./global.config";

/**
 * Get the global configuration (header, footer, WA widget, cookie banner)
 * from the properties table.
 */
export const getGlobalConfig = createServerFn({ method: "GET" })
  .handler(async ({ context }) => {
    // If auth is needed, this function should be updated. Usually global config is public.
    const sb = db(context?.supabase); // Context may be undefined if called directly, wait, actually let's use the standard setup
    // We'll use the service role if no context, or just standard anonymous fetch.
    const { data, error } = await sb
      .from("properties")
      .select("id, global_config")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error fetching global config:", error);
      return { id: null, config: mergeGlobalConfig(null) };
    }

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
      .update({ global_config: data as any })
      .eq("id", prop.id);

    if (updateErr) {
      throw new Error("Gagal menyimpan konfigurasi global.");
    }

    return { ok: true };
  });
