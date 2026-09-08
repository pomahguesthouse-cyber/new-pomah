/**
 * Homepage Builder — server functions.
 *
 * The configuration model lives in `homepage.config.ts` (pure, shared
 * with the public homepage). This module only adds the authenticated
 * read/write server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergeHomepageConfig } from "./homepage.config";

export {
  DEFAULT_HOMEPAGE_CONFIG,
  mergeHomepageConfig,
  type HomepageConfig,
  type HeroSlide,
  type NavLink,
} from "./homepage.config";

/** Untyped client view — `homepage_config` is not in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/** Read the homepage config from the first property row. */
export const getHomepageConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("properties")
      .select("id, homepage_config")
      .limit(1)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: (row.id as string | undefined) ?? null,
      config: mergeHomepageConfig(row.homepage_config),
    };
  });

/**
 * Persist the homepage config onto the property row.
 *
 * `id` bersifat opsional: bila klien tidak mengirim UUID yang valid
 * (mis. properti belum termuat saat panel dibuka), id properti pertama
 * diambil di server sehingga penyimpanan tidak gagal.
 */
export const updateHomepageConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().optional().nullable(),
        config: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const isUuid = (v: unknown): v is string =>
      typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    let propertyId = isUuid(data.id) ? data.id : null;
    if (!propertyId) {
      const { data: row } = await client.from("properties").select("id").limit(1).maybeSingle();
      propertyId = ((row ?? {}) as Record<string, unknown>).id as string | undefined ?? null;
    }
    if (!propertyId) throw new Error("Properti tidak ditemukan.");

    const { error } = await client
      .from("properties")
      .update({ homepage_config: data.config } as never)
      .eq("id", propertyId);
    if (error) throw error;
    return { ok: true };
  });

