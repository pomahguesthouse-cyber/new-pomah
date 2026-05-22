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

/** AI-powered landing page content generation. */
export const generateLandingPageContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ keyword: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY tidak dikonfigurasi. Tambahkan di Settings.");

    const slug = data.keyword
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);

    const systemMsg =
      "You are an expert SEO content writer for Pomah Guesthouse, a budget-friendly guesthouse in Gunungpati, Semarang, Indonesia, near UNNES (Universitas Negeri Semarang). " +
      "You write compelling, keyword-optimised landing pages in Bahasa Indonesia. " +
      "Always respond with valid JSON only — no markdown fences, no extra text.";

    const userMsg =
      `Generate a complete SEO landing page targeting the keyword: "${data.keyword}"\n\n` +
      `Return ONLY a JSON object with these exact fields:\n` +
      `{\n` +
      `  "title": "page title in Bahasa Indonesia, max 80 chars",\n` +
      `  "slug": "${slug}",\n` +
      `  "target_keyword": "${data.keyword}",\n` +
      `  "hero_headline": "compelling headline, max 80 chars, include keyword naturally",\n` +
      `  "hero_subheadline": "supporting subtitle 1–2 sentences, max 150 chars",\n` +
      `  "hero_cta_text": "CTA button text, max 30 chars, e.g. Pesan Sekarang",\n` +
      `  "body_content": "4–6 HTML sections using h2, h3, p, ul, li, strong tags. 500–800 words. Cover: why choose Pomah, facilities, location benefits, FAQs. Include the keyword naturally at least 3 times.",\n` +
      `  "meta_title": "50–60 chars, keyword first, ends with | Pomah Guesthouse",\n` +
      `  "meta_description": "120–160 chars, include keyword, mention location, compelling call to action"\n` +
      `}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user",   content: userMsg   },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${txt}`);
    }

    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip possible markdown fences that some models add
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("AI mengembalikan format yang tidak valid. Coba lagi.");
    }

    return {
      page: {
        title:            (parsed.title            ?? "").slice(0, 200),
        slug:             (parsed.slug             ?? slug).toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        target_keyword:   parsed.target_keyword    ?? data.keyword,
        hero_headline:    (parsed.hero_headline    ?? "").slice(0, 300),
        hero_subheadline: (parsed.hero_subheadline ?? "").slice(0, 500),
        hero_cta_text:    (parsed.hero_cta_text    ?? "Pesan Sekarang").slice(0, 100),
        hero_cta_url:     "/book",
        body_content:     parsed.body_content      ?? "",
        meta_title:       (parsed.meta_title       ?? "").slice(0, 60),
        meta_description: (parsed.meta_description ?? "").slice(0, 160),
        og_image_url:     null as string | null,
        published:        false,
      },
    };
  });

/** Fetch a single landing page by slug (public — no auth required). */
export const getSeoLandingPageBySlug = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data }) => {
    // Public function — create an anon Supabase client.
    // Key may be named ANON_KEY (local) or PUBLISHABLE_KEY (production/Lovable).
    const supabaseUrl  = process.env.SUPABASE_URL  ?? process.env.VITE_SUPABASE_URL  ?? "";
    const supabaseAnon =
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
      "";
    const client = createClient(supabaseUrl, supabaseAnon) as unknown as SupabaseClient;
    const { data: row } = await client
      .from("seo_landing_pages")
      .select("*")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    return { page: (row as unknown as SeoLandingPage) ?? null };
  });
