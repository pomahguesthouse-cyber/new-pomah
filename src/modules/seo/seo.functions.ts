import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSeoPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("seo_pages")
      .select("*")
      .order("slug");
    return { pages: data ?? [] };
  });

export const upsertSeoPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug: z.string().min(1).max(200).regex(/^\/[a-zA-Z0-9/_-]*$/),
        title: z.string().min(1).max(200),
        description: z.string().max(400).nullable().optional(),
        og_image_url: z.string().url().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      slug: data.slug,
      title: data.title,
      description: data.description ?? null,
      og_image_url: data.og_image_url ?? null,
    };
    if (data.id) {
      const { error } = await context.supabase.from("seo_pages").update(payload).eq("id", data.id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase.from("seo_pages").upsert(payload, { onConflict: "slug" });
      if (error) throw error;
    }
    return { ok: true };
  });
