/**
 * Server functions for managing SEO Landing Pages.
 * These are manually-crafted, keyword-targeted pages distinct from
 * the auto-generated programmatic_seo_pages.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { createClient } from "@supabase/supabase-js";
import { mergeHomepageConfig } from "@/admin/modules/homepage/homepage.config";

/** Cast to an untyped client — seo_landing_pages is not in the generated types yet. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/* ─── Page-builder section types ──────────────────────────────────── */

export type LPHeroSection = {
  id: string; type: "hero";
  headline: string; subheadline?: string;
  image_url?: string; overlay?: number;          // overlay 0-100
  cta_text?: string; cta_url?: string;
};
export type LPTextSection = {
  id: string; type: "text";
  title?: string; content: string;               // supports HTML
  align?: "left" | "center";
};
export type LPFeaturesSection = {
  id: string; type: "features";
  title?: string; columns?: 2 | 3 | 4;
  items: { title: string; description: string }[];
};
export type LPGallerySection = {
  id: string; type: "gallery";
  title?: string; columns?: 2 | 3 | 4;
  images: string[];
};
export type LPFaqSection = {
  id: string; type: "faq";
  title?: string;
  items: { question: string; answer: string }[];
};
export type LPCtaBannerSection = {
  id: string; type: "cta_banner";
  headline: string; subheadline?: string;
  cta_text: string; cta_url: string;
  style?: "teal" | "dark" | "light";
};
export type LPTestimonialsSection = {
  id: string; type: "testimonials";
  title?: string;
  /** "manual" = use items below; "google" = pull live Google reviews. */
  source?: "manual" | "google";
  items: { name: string; text: string }[];
};
export type LPHeaderSection = {
  id: string; type: "header";
  logo_url?: string;                              // logo image (media library)
  brand?: string;                                 // brand / logo text fallback
  links?: { label: string; url: string }[];
  cta_text?: string; cta_url?: string;
  sticky?: boolean;
};
/** Room carousel — same data & behaviour as the homepage "Our Room". */
export type LPRoomSliderSection = {
  id: string; type: "room_slider";
  title?: string;
  subheading?: string;
  cardsPerView?: 1 | 2 | 3 | 4;
  autoplay?: boolean;
  slideMs?: number;
};
/** Availability date picker — same flow as the homepage widget. */
export type LPDatePickerSection = {
  id: string; type: "datepicker";
  heading?: string;
  buttonLabel?: string;
};
/** Mirrors the homepage hero slider exactly (HomepageConfig["hero"]). */
export type LPSliderSection = {
  id: string; type: "slider";
  slides: {
    imageUrl: string;
    videoUrl: string;                             // takes precedence over image
    heading: string;
    subheading: string;
  }[];
  autoplayMs: number;                             // 0 = disable autoplay
  height: number;                                 // px
  transition: "fade" | "slide" | "zoom" | "none";
  fontFamily: "sans" | "serif" | "mono";
  fontSize: number;
  fontStyle: "normal" | "bold" | "italic";
};
export type LPButtonSection = {
  id: string; type: "button";
  text: string; url: string;
  align?: "left" | "center" | "right";
  variant?: "solid" | "outline";
  color?: "teal" | "dark" | "light";
};
export type LPElementStyles = {
  fontSize?: string;
  textSize?: string; // line-height
  fontWeight?: string;
  alignment?: "left" | "center" | "right" | "justify";
  width?: string;
  height?: string;
  padding?: string;
  margin?: string;
  borderRadius?: string;
  bgColor?: string;
  textColor?: string;
  display?: "block" | "none";
  visibility?: "visible" | "hidden";
  fullWidth?: boolean;
  order?: number;
};

export type LPSection = (
  | LPHeroSection
  | LPTextSection
  | LPFeaturesSection
  | LPGallerySection
  | LPFaqSection
  | LPCtaBannerSection
  | LPTestimonialsSection
  | LPHeaderSection
  | LPSliderSection
  | LPButtonSection
  | LPRoomSliderSection
  | LPDatePickerSection
) & {
  styles?: {
    desktop?: LPElementStyles;
    mobile?: LPElementStyles;
  };
};

export function ensureResponsiveStyles(section: LPSection): LPSection & {
  styles: {
    desktop: LPElementStyles;
    mobile: LPElementStyles;
  };
} {
  return {
    ...section,
    styles: {
      desktop: {
        fontSize: "",
        textSize: "",
        fontWeight: "",
        alignment: undefined,
        width: "",
        height: "",
        padding: "",
        margin: "",
        borderRadius: "",
        bgColor: "",
        textColor: "",
        display: undefined,
        visibility: undefined,
        fullWidth: false,
        order: 0,
        ...section.styles?.desktop,
      },
      mobile: {
        fontSize: "",
        textSize: "",
        fontWeight: "",
        alignment: undefined,
        width: "",
        height: "",
        padding: "",
        margin: "",
        borderRadius: "",
        bgColor: "",
        textColor: "",
        display: undefined,
        visibility: undefined,
        fullWidth: false,
        order: 0,
        ...section.styles?.mobile,
      },
    },
  } as any;
}

export type LPSplitSections = {
  split: boolean;
  desktop: LPSection[];
  mobile: LPSection[];
};

export type LPSectionsData = LPSection[] | LPSplitSections;

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
  sections: LPSectionsData | null;
  /** Bila terisi, halaman dirender memakai komponen homepage asli (hasil duplikasi Home). */
  homepage_config: Json | null;
  /* ── Advanced SEO ── */
  custom_head: string | null;
  custom_robots: string | null;
  json_ld_enabled: boolean;
  custom_json_ld: string | null;
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
  page_type:        z.enum(["home", "booking", "landing"]).default("landing"),
  is_system:        z.boolean().default(false),
  sections:         z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).optional().nullable(),
  custom_head:      z.string().max(20000).optional().nullable(),
  custom_robots:    z.string().max(10000).optional().nullable(),
  json_ld_enabled:  z.boolean().optional(),
  custom_json_ld:   z.string().max(20000).optional().nullable(),
});

type PageSectionRow = {
  id: string;
  page_id: string;
  type: LPSection["type"];
  sort_order: number;
  desktop_config: Record<string, unknown>;
  mobile_config: Record<string, unknown>;
  is_mobile_custom: boolean;
};

type PageElementRow = {
  id: string;
  page_id: string;
  section_id: string;
  type: LPSection["type"];
  content: Record<string, unknown>;
  desktop_style: LPElementStyles;
  mobile_style: LPElementStyles;
  sort_order: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {};
}

function buildSection(row: PageSectionRow, element: PageElementRow | undefined, mode: "desktop" | "mobile"): LPSection {
  const config = mode === "mobile" && row.is_mobile_custom
    ? row.mobile_config
    : row.desktop_config;
  const content = element?.content ?? config;
  return {
    ...asRecord(content),
    ...asRecord(config),
    id: row.id,
    type: row.type,
    styles: {
      desktop: element?.desktop_style ?? {},
      mobile: element?.mobile_style ?? {},
    },
  } as LPSection;
}

async function loadPageSections(client: SupabaseClient, pageId: string): Promise<LPSectionsData | null> {
  const { data: sectionData, error: sectionError } = await client
    .from("page_sections")
    .select("id, page_id, type, sort_order, desktop_config, mobile_config, is_mobile_custom")
    .eq("page_id", pageId)
    .order("sort_order", { ascending: true });
  if (sectionError) throw sectionError;
  const rows = (sectionData ?? []) as unknown as PageSectionRow[];
  if (rows.length === 0) return null;

  const { data: elementData, error: elementError } = await client
    .from("page_elements")
    .select("id, page_id, section_id, type, content, desktop_style, mobile_style, sort_order")
    .eq("page_id", pageId)
    .order("sort_order", { ascending: true });
  if (elementError) throw elementError;
  const elements = (elementData ?? []) as unknown as PageElementRow[];
  const bySection = new Map(elements.map((element) => [element.section_id, element]));
  const desktop = rows.map((row) => buildSection(row, bySection.get(row.id), "desktop"));
  if (!rows.some((row) => row.is_mobile_custom)) return desktop;
  return {
    split: true,
    desktop,
    mobile: rows.map((row) => buildSection(row, bySection.get(row.id), "mobile")),
  };
}

async function replacePageSections(client: SupabaseClient, pageId: string, sections: LPSectionsData | null): Promise<void> {
  const desktop = Array.isArray(sections) ? sections : sections?.desktop ?? [];
  const mobile = Array.isArray(sections) ? [] : sections?.mobile ?? [];
  const isSplit = !Array.isArray(sections) && sections?.split === true;
  const mobileById = new Map(mobile.map((section) => [section.id, section]));

  const { error: deleteError } = await client.from("page_sections").delete().eq("page_id", pageId);
  if (deleteError) throw deleteError;
  if (desktop.length === 0) return;

  for (const [sortOrder, desktopSection] of desktop.entries()) {
    const mobileSection = mobileById.get(desktopSection.id) ?? mobile[sortOrder];
    const { id: _desktopId, type, styles, ...desktopConfig } = desktopSection;
    const { id: _mobileId, type: _mobileType, styles: _mobileStyles, ...mobileConfig } = mobileSection ?? desktopSection;
    const { data: inserted, error: sectionError } = await client
      .from("page_sections")
      .insert({
        page_id: pageId,
        type,
        sort_order: sortOrder,
        desktop_config: desktopConfig,
        mobile_config: isSplit ? mobileConfig : {},
        is_mobile_custom: isSplit,
      })
      .select("id")
      .single();
    if (sectionError || !inserted) throw sectionError ?? new Error("Section gagal dibuat");
    const sectionId = (inserted as { id: string }).id;
    const { error: elementError } = await client.from("page_elements").insert({
      page_id: pageId,
      section_id: sectionId,
      type,
      content: desktopConfig,
      desktop_style: styles?.desktop ?? {},
      mobile_style: (mobileSection?.styles?.mobile ?? styles?.mobile) ?? {},
      sort_order: 0,
    });
    if (elementError) throw elementError;
  }
}

/** Load only the selected page's independent section and element rows. */
export const getPageBuilderSections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => ({
    sections: (await loadPageSections(db(context.supabase), data.pageId)) ?? [],
  }));

/** Replace only the selected page's section tree. */
export const savePageBuilderSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    pageId: z.string().uuid(),
    sections: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await replacePageSections(db(context.supabase), data.pageId, data.sections as LPSectionsData | null);
    return { ok: true };
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
    const pages = (data ?? []) as unknown as SeoLandingPage[];
    const hydrated = await Promise.all(pages.map(async (page) => ({
      ...page,
      sections: (await loadPageSections(db(context.supabase), page.id)) ?? page.sections,
    })));
    return { pages: hydrated };
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
        model: "google/gemini-2.5-flash",
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
    if (!row) return { page: null };
    const page = row as unknown as SeoLandingPage;
    return {
      page: {
        ...page,
        sections: (await loadPageSections(client, page.id)) ?? page.sections,
      },
    };
  });

/** Duplicate a landing page — deep-clone semua konfigurasi, buat slug unik. */
export const duplicateSeoLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);

    // 1. Ambil halaman asli (semua kolom)
    const { data: original, error: fetchErr } = await sb
      .from("seo_landing_pages")
      .select("*")
      .eq("id", data.id)
      .single();
    if (fetchErr || !original) throw new Error("Halaman tidak ditemukan");

    // 2. Ambil semua slug yang ada untuk generate slug unik
    const { data: allPages } = await sb
      .from("seo_landing_pages")
      .select("slug");
    const existingSlugs = new Set((allPages ?? []).map((p: { slug: string }) => p.slug));

    // 3. Generate slug unik
    const baseSlug = `${original.slug}-copy`;
    let finalSlug = baseSlug;
    let counter = 2;
    while (existingSlugs.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    // ── Helper: generate random section id ──
    const genId = () => Math.random().toString(36).slice(2, 10);

    // ── Helper: deep-clone sections dan regenerate semua section id ──
    const deepCloneSections = (sections: unknown): unknown => {
      if (sections == null) return null;

      // Deep clone via JSON round-trip — memastikan semua nested object
      // (styles, items, slides, images, dll.) adalah salinan independen.
      const cloned = JSON.parse(JSON.stringify(sections));

      // Regenerate section id untuk setiap section
      const regenIds = (list: Array<Record<string, unknown>>) => {
        for (const section of list) {
          if (section && typeof section === "object" && "id" in section) {
            section.id = genId();
          }
        }
      };

      // Handle split sections (desktop + mobile terpisah)
      if (
        cloned &&
        typeof cloned === "object" &&
        !Array.isArray(cloned) &&
        cloned.split === true
      ) {
        if (Array.isArray(cloned.desktop)) regenIds(cloned.desktop);
        if (Array.isArray(cloned.mobile)) regenIds(cloned.mobile);
      } else if (Array.isArray(cloned)) {
        // Handle flat section array
        regenIds(cloned);
      }

      return cloned;
    };

    // 4. Deep-clone seluruh halaman — pastikan semua data terpisah dari aslinya
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = original as Record<string, unknown>;

    // Deep-clone semua field JSONB/object agar tidak share referensi
    const clonedRest = JSON.parse(JSON.stringify(rest));

    // Regenerate section IDs di dalam sections
    clonedRest.sections = deepCloneSections(clonedRest.sections);

    const newPage = {
      ...clonedRest,
      // Hanya field berikut yang boleh berbeda dari halaman asal:
      // id (auto), slug, title, created_at, updated_at.
      // Semua field lain (published/status, sections, SEO metadata, custom
      // CSS, global settings, media reference, dll.) di-clone apa adanya
      // agar tampilan hasil duplikasi sama persis dengan halaman asal.
      title: `${original.title} Copy`,
      slug: finalSlug,
      created_at: now,
      updated_at: now,
    };

    // 5. Insert
    const { data: inserted, error: insertErr } = await sb
      .from("seo_landing_pages")
      .insert(newPage)
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    const insertedId = (inserted as { id: string }).id;
    const sourceSections = (await loadPageSections(sb, data.id)) ?? (original.sections as LPSectionsData | null);
    await replacePageSections(sb, insertedId, sourceSections);

    return { ok: true, id: insertedId, slug: finalSlug };
  });

/** Duplikasi halaman sistem (Home atau Booking) menghasilkan landing page baru. */
export const duplicateSystemPageToLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ type: z.enum(["home", "book"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);

    // 1. Ambil properties.homepage_config dan property id
    const { data: prop, error: propErr } = await sb
      .from("properties")
      .select("id, homepage_config")
      .limit(1)
      .maybeSingle();

    if (propErr || !prop) throw new Error("Property config tidak ditemukan");
    
    const config = mergeHomepageConfig(prop.homepage_config);

    // 2. Fetch existing slugs to generate unique slug
    const { data: allPages } = await sb
      .from("seo_landing_pages")
      .select("slug");
    const existingSlugs = new Set((allPages ?? []).map((p: { slug: string }) => p.slug));

    // 3. Set page attributes based on system page type (home or book)
    const systemType = data.type;
    const baseSlug = `${systemType === "home" ? "home" : "booking"}-copy`;
    let finalSlug = baseSlug;
    let counter = 2;
    while (existingSlugs.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const title = systemType === "home" ? "Home Copy" : "Booking Page Copy";
    
    // Map seo settings
    const seo = systemType === "home" ? config.seo : config.bookingSeo;
    
    // Generate sections list based on HomepageConfig
    const lpSections: LPSection[] = [];
    
    // Header section
    if (config.header) {
      lpSections.push({
        id: "header",
        type: "header",
        brand: "Pomah Guesthouse",
        links: config.header.links.map((l) => ({ label: l.label, url: l.href })),
        cta_text: config.header.bookLabel,
        cta_url: "/book"
      });
    }

    if (systemType === "home") {
      // Hero Section
      if (config.hero) {
        lpSections.push({
          id: "hero-slider",
          type: "slider",
          slides: config.hero.slides.map(s => ({
            imageUrl: s.imageUrl,
            videoUrl: s.videoUrl,
            heading: s.heading,
            subheading: s.subheading,
          })),
          autoplayMs: config.hero.autoplayMs,
          height: config.hero.height,
          transition: config.hero.transition,
          fontFamily: config.hero.fontFamily === "brother-signature" ? "serif" : config.hero.fontFamily,
          fontSize: config.hero.fontSize,
          fontStyle: config.hero.fontStyle,
        });
      }

      // DatePicker Section
      if (config.datePicker?.enabled) {
        lpSections.push({
          id: "date-picker",
          type: "datepicker",
          heading: config.datePicker.heading,
          buttonLabel: config.datePicker.buttonLabel,
        });
      }

      // Loop over sectionOrder and map them in that order
      const order = config.sectionOrder || [];
      for (const key of order) {
        if (key === "badges" && config.badges) {
          lpSections.push({
            id: "badges",
            type: "features",
            title: config.badges.heading,
            columns: 3,
            items: config.badges.items.map(item => ({
              title: item.title,
              description: item.desc
            }))
          });
        } else if (key === "story" && config.story) {
          lpSections.push({
            id: "story",
            type: "text",
            title: config.story.heading,
            content: config.story.paragraphs.map(p => `<p>${p}</p>`).join(""),
            align: "center"
          });
        } else if (key === "reviews" && config.reviews) {
          lpSections.push({
            id: "reviews",
            type: "testimonials",
            title: config.reviews.heading,
            source: "google",
            items: []
          });
        } else if (key === "rooms" && config.roomCarousel) {
          lpSections.push({
            id: "rooms",
            type: "room_slider",
            title: config.roomCarousel.heading,
            subheading: config.roomCarousel.subheading,
            cardsPerView: (config.roomCarousel.cardsPerView === 1 || config.roomCarousel.cardsPerView === 2 || config.roomCarousel.cardsPerView === 3 || config.roomCarousel.cardsPerView === 4) ? config.roomCarousel.cardsPerView as 1 | 2 | 3 | 4 : 3,
            autoplay: config.roomCarousel.autoplay,
            slideMs: config.roomCarousel.slideMs,
          });
        } else if (key === "facilities" && config.facilities) {
          lpSections.push({
            id: "facilities",
            type: "text",
            title: config.facilities.heading,
            content: `<p>${config.facilities.subheading || ""}</p>`,
            align: "center"
          });
        } else if (key === "lokasi" && config.lokasi) {
          lpSections.push({
            id: "lokasi",
            type: "text",
            title: config.lokasi.heading,
            content: `<p>${config.lokasi.subheading || ""}</p><h4>${config.lokasi.nearbyTitle || ""}</h4><ul>` + 
              (config.lokasi.nearby || []).map(n => `<li><strong>${n.name}</strong> (${n.type}) - ${n.distance} / ${n.time}</li>`).join("") + "</ul>",
            align: "left"
          });
        } else if (key === "news" && config.news) {
          lpSections.push({
            id: "news",
            type: "text",
            title: config.news.heading,
            content: `<p>${config.news.subheading || ""}</p>`,
            align: "center"
          });
        } else if (key === "cta" && config.cta) {
          lpSections.push({
            id: "cta",
            type: "text",
            title: config.cta.heading,
            content: "",
            align: "center"
          });
        }
      }
    } else if (systemType === "book") {
      // Slider/Hero Section (using bookingHero)
      if (config.bookingHero) {
        lpSections.push({
          id: "hero-slider",
          type: "slider",
          slides: config.bookingHero.slides.map(s => ({
            imageUrl: s.imageUrl,
            videoUrl: s.videoUrl,
            heading: s.heading,
            subheading: s.subheading,
          })),
          autoplayMs: config.bookingHero.autoplayMs,
          height: config.bookingHero.height,
          transition: config.bookingHero.transition,
          fontFamily: config.bookingHero.fontFamily === "brother-signature" ? "serif" : config.bookingHero.fontFamily,
          fontSize: config.bookingHero.fontSize,
          fontStyle: config.bookingHero.fontStyle,
        });
      }

      // DatePicker Section
      if (config.datePicker) {
        lpSections.push({
          id: "date-picker",
          type: "datepicker",
          heading: config.datePicker.heading,
          buttonLabel: config.datePicker.buttonLabel,
        });
      }

      // Room carousel (usually good on booking page)
      if (config.roomCarousel) {
        lpSections.push({
          id: "rooms",
          type: "room_slider",
          title: config.roomCarousel.heading,
          subheading: config.roomCarousel.subheading,
          cardsPerView: (config.roomCarousel.cardsPerView === 1 || config.roomCarousel.cardsPerView === 2 || config.roomCarousel.cardsPerView === 3 || config.roomCarousel.cardsPerView === 4) ? config.roomCarousel.cardsPerView as 1 | 2 | 3 | 4 : 3,
          autoplay: config.roomCarousel.autoplay,
          slideMs: config.roomCarousel.slideMs,
        });
      }
    }

    const now = new Date().toISOString();
    // Untuk type=home: simpan SELURUH homepage_config (deep clone) supaya
    // halaman hasil duplikasi dirender memakai komponen homepage asli dan
    // tampilannya identik dengan halaman Home.
    const clonedHomepageConfig =
      systemType === "home" && prop.homepage_config
        ? JSON.parse(JSON.stringify(prop.homepage_config))
        : null;

    const newPage = {
      property_id: prop.id,
      title,
      slug: finalSlug,
      target_keyword: seo?.targetKeyword || null,
      hero_headline: systemType === "home" ? (config.hero?.slides[0]?.heading || null) : (config.bookingHero?.slides[0]?.heading || null),
      hero_subheadline: systemType === "home" ? (config.hero?.slides[0]?.subheading || null) : (config.bookingHero?.slides[0]?.subheading || null),
      hero_cta_text: config.header?.bookLabel || "Pesan Sekarang",
      hero_cta_url: "/book",
      body_content: "",
      meta_title: seo?.metaTitle || null,
      meta_description: seo?.metaDescription || null,
      og_image_url: seo?.ogImageUrl || null,
      published: false,
      sections: clonedHomepageConfig ? [] : lpSections,
      homepage_config: clonedHomepageConfig,
      custom_head: seo?.customHead || null,
      custom_robots: seo?.customRobots || null,
      json_ld_enabled: seo?.jsonLdEnabled ?? true,
      custom_json_ld: seo?.customJsonLd || null,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error: insertErr } = await sb
      .from("seo_landing_pages")
      .insert(newPage)
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    const insertedId = (inserted as { id: string }).id;
    await replacePageSections(sb, insertedId, lpSections);

    return { ok: true, id: insertedId, slug: finalSlug };
  });

