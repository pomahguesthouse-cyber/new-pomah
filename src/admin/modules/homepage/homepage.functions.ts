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

/** Persist the homepage config onto the property row. */
export const updateHomepageConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        config: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("properties")
      .update({ homepage_config: data.config } as never)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
