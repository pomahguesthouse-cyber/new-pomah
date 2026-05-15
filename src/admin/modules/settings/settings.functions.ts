import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Read domain settings from the first property row. */
export const getDomainSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("properties")
      .select("id, public_domain, admin_domain")
      .limit(1)
      .maybeSingle();
    return {
      id: data?.id ?? null,
      public_domain: (data as Record<string, unknown>)?.public_domain as string | null ?? null,
      admin_domain: (data as Record<string, unknown>)?.admin_domain as string | null ?? null,
    };
  });

/** Persist domain settings for the first property row. */
export const updateDomainSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        public_domain: z.string().max(253).nullable().optional(),
        admin_domain: z.string().max(253).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("properties")
      .update({
        public_domain: data.public_domain ?? null,
        admin_domain: data.admin_domain ?? null,
      } as Record<string, unknown>)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
