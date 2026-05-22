/**
 * Server functions for managing SEO Landing Pages.
 * These are manually-crafted, keyword-targeted pages distinct from
 * the auto-generated programmatic_seo_pages.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";

/** Cast to an untyped client — seo_landing_pages is not in the generated types yet. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export type SeoLandingPage = {
  id: string;
  property_id: string | null;
  title: string;
  slug: string;
  target_keyword: string | null;
  hero_headline: string | null;
  hero_subheadline: string | null;
  hero_cta_text: string;
  hero_cta_url: string;
  body_content: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
};

const pageShape = z.object({
  title:            z.string().min(1).max(200),
  slug:             z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, "Slug hanya boleh huruf kecil, angka, dan tanda hubung"),
  target_keyword:   z.string().max(200).optional().nullable(),
  hero_headline:    z.string().max(300).optional().nullable(),
  hero_subheadline: z.string().max(500).optional().nullable(),
  hero_cta_text:    z.string().max(100).default("Pesan Sekarang"),
  hero_cta_url:     z.string().max(300).default("/book"),
  body_content:     z.string().max(100000).optional().nullable(),
  meta_title:       z.string().max(60).optional().nullable(),
  meta_description: z.string().max(160).optional().nullable(),
  og_image_url:     z.string().url().max(500).optional().nullable(),
  published:        z.boolean().default(false),
});

/** List all landing pages ordered by creation (newest first). */
export const listSeoLandingPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("seo_landing_pages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { pages: (data ?? []) as unknown as SeoLandingPage[] };
  });

/** Create a new landing page. */
export const createSeoLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => pageShape.parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { data: prop } = await sb
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();
    const { error, data: row } = await sb
      .from("seo_landing_pages")
      .insert({ ...data, property_id: (prop as { id: string } | null)?.id ?? null })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: (row as { id: string }).id };
  });

/** Update an existing landing page (partial update supported). */
export const updateSeoLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid() }).merge(pageShape.partial()).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const { error } = await db(context.supabase)
      .from("seo_landing_pages")
      .update(fields)
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

/** Toggle the published state of a landing page. */
export const publishSeoLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), published: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("seo_landing_pages")
      .update({ published: data.published })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Delete a landing page permanently. */
export const deleteSeoLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("seo_landing_pages")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Fetch a single landing page by slug (public — no auth required). */
export const getSeoLandingPageBySlug = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data }) => {
    // Public function — create an anon Supabase client
    const supabaseUrl  = process.env.SUPABASE_URL  ?? process.env.VITE_SUPABASE_URL  ?? "";
    const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
    const client = createClient(supabaseUrl, supabaseAnon) as unknown as SupabaseClient;
    const { data: row } = await client
      .from("seo_landing_pages")
      .select("*")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    return { page: (row as unknown as SeoLandingPage) ?? null };
  });
