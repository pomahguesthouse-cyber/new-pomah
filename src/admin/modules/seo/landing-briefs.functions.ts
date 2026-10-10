/**
 * Keyword briefs, landmark CRUD, and the grounded landing-page generator.
 * Queries for the new tables fail soft when the migration has not been applied.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingSchemaError } from "@/public/lib/lp-slug-redirects";
import { APPROVED_LP, CITY_GUIDE_ARTICLES } from "@/public/content/approved-seo";
import { HOMEPAGE_FAQS } from "@/public/lib/structured-data";
import { POMAH_GEO, POMAH_NAP_ADDRESS } from "@/public/lib/site-identity";
import { evaluateLandingQuality, type QualityLandmark, type QualityPage, type QualityRoom } from "@/public/lib/lp-quality";
import { assembleLandingDraft, buildGroundingPrompt, parseModelJson, type GroundingFacts } from "@/public/lib/lp-grounding";
import { chatCompletion, resolvePropertyAiConfig } from "@/services/ai-client.service";
import {
  loadPageSections,
  replacePageSections,
  type LPSection,
  type SeoLandingPage,
} from "@/admin/modules/seo/landing-page.functions";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export type LandingBrief = {
  id: string;
  primary_keyword: string;
  secondary_keywords: string[];
  intent: string;
  slug: string;
  target_audience: string;
  unique_angle: string;
  landmark_ids: string[];
  faq_seeds: string[];
  review_keywords: string[];
  explore_slugs: string[];
  room_type_ids: string[];
  min_capacity: number | null;
  status: "draft" | "approved" | "generated";
  landing_page_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export type LandmarkRow = {
  id: string;
  name: string;
  category: string;
  lat: number | null;
  lng: number | null;
  road_distance_km: number | null;
  travel_minutes: number | null;
  verified: boolean;
  notes: string | null;
  sort_order: number;
};

const briefShape = z.object({
  primary_keyword: z.string().min(1).max(200),
  secondary_keywords: z.array(z.string().max(120)).max(20).default([]),
  intent: z.string().max(200).default(""),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  target_audience: z.string().max(300).default(""),
  unique_angle: z.string().max(500).default(""),
  landmark_ids: z.array(z.string().uuid()).max(30).default([]),
  faq_seeds: z.array(z.string().max(300)).max(20).default([]),
  review_keywords: z.array(z.string().max(80)).max(12).default([]),
  explore_slugs: z.array(z.string().max(160)).max(12).default([]),
  room_type_ids: z.array(z.string().uuid()).max(20).default([]),
  min_capacity: z.number().int().min(1).max(20).nullable().default(null),
  status: z.enum(["draft", "approved", "generated"]).default("draft"),
});

function missing(error: { code?: string; message?: string } | null): boolean {
  return isMissingSchemaError(error);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

export const listLandingBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("seo_landing_briefs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      if (missing(error)) return { briefs: [] as LandingBrief[], missing: true };
      throw error;
    }
    return { briefs: (data ?? []) as LandingBrief[], missing: false };
  });

export const saveLandingBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional() }).merge(briefShape).parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { id, ...fields } = data;
    if (id) {
      const { error } = await sb.from("seo_landing_briefs").update(fields).eq("id", id);
      if (error) {
        if (missing(error)) throw new Error("Tabel seo_landing_briefs belum ada. Jalankan migrasi SQL setelah deploy.");
        throw error;
      }
      return { id };
    }
    const { data: row, error } = await sb.from("seo_landing_briefs").insert(fields).select("id").single();
    if (error) {
      if (missing(error)) throw new Error("Tabel seo_landing_briefs belum ada. Jalankan migrasi SQL setelah deploy.");
      throw error;
    }
    return { id: (row as { id: string }).id };
  });

export const deleteLandingBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).from("seo_landing_briefs").delete().eq("id", data.id);
    if (error && !missing(error)) throw error;
    return { ok: true };
  });

export const listSeoLandmarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("seo_landmarks")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      if (missing(error)) return { landmarks: [] as LandmarkRow[], missing: true };
      throw error;
    }
    return { landmarks: (data ?? []) as LandmarkRow[], missing: false };
  });

const landmarkShape = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(80).default("lainnya"),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  road_distance_km: z.number().nullable().default(null),
  travel_minutes: z.number().int().nullable().default(null),
  verified: z.boolean().default(false),
  notes: z.string().max(500).nullable().default(null),
  sort_order: z.number().int().default(0),
});

export const saveSeoLandmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional() }).merge(landmarkShape).parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { id, ...fields } = data;
    if (id) {
      const { error } = await sb.from("seo_landmarks").update(fields).eq("id", id);
      if (error) {
        if (missing(error)) throw new Error("Tabel seo_landmarks belum ada. Jalankan migrasi SQL setelah deploy.");
        throw error;
      }
      return { id };
    }
    const { data: row, error } = await sb.from("seo_landmarks").insert(fields).select("id").single();
    if (error) {
      if (missing(error)) throw new Error("Tabel seo_landmarks belum ada. Jalankan migrasi SQL setelah deploy.");
      throw error;
    }
    return { id: (row as { id: string }).id };
  });

export const deleteSeoLandmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).from("seo_landmarks").delete().eq("id", data.id);
    if (error && !missing(error)) throw error;
    return { ok: true };
  });

async function loadRooms(client: SupabaseClient): Promise<QualityRoom[]> {
  const { data, error } = await client
    .from("room_types")
    .select("id, name, slug, capacity, is_published");
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.is_published !== false && row.slug)
    .map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      name: row.name == null ? null : String(row.name),
      capacity: row.capacity == null ? null : Number(row.capacity),
    }));
}

async function loadLandmarks(client: SupabaseClient): Promise<QualityLandmark[]> {
  const { data, error } = await client.from("seo_landmarks").select("id, name, verified, road_distance_km, travel_minutes");
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    verified: row.verified === true,
    road_distance_km: row.road_distance_km == null ? null : Number(row.road_distance_km),
    travel_minutes: row.travel_minutes == null ? null : Number(row.travel_minutes),
  }));
}

export async function qualityReportForPage(client: SupabaseClient, pageId: string) {
  const { data: row, error } = await client.from("seo_landing_pages").select("*").eq("id", pageId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Halaman tidak ditemukan");
  const page = row as SeoLandingPage;
  const sections = (await loadPageSections(client, pageId)) ?? page.sections;
  const { data: others } = await client
    .from("seo_landing_pages")
    .select("id, slug, title, target_keyword, meta_title, meta_description, hero_headline, body_content");
  const otherPages: QualityPage[] = [];
  for (const item of (others ?? []) as Array<Record<string, unknown>>) {
    if (String(item.id) === pageId) continue;
    const id = String(item.id);
    let otherSections: unknown = null;
    try {
      otherSections = await loadPageSections(client, id);
    } catch {
      otherSections = null;
    }
    otherPages.push({
      id,
      slug: String(item.slug ?? ""),
      title: item.title == null ? null : String(item.title),
      target_keyword: item.target_keyword == null ? null : String(item.target_keyword),
      meta_title: item.meta_title == null ? null : String(item.meta_title),
      meta_description: item.meta_description == null ? null : String(item.meta_description),
      hero_headline: item.hero_headline == null ? null : String(item.hero_headline),
      body_content: item.body_content == null ? null : String(item.body_content),
      sections: otherSections,
    });
  }
  const report = evaluateLandingQuality({
    page: { ...page, sections },
    otherPages,
    landmarks: await loadLandmarks(client),
    rooms: await loadRooms(client),
  });
  return report;
}

export async function assertLandingPublishable(client: SupabaseClient, pageId: string): Promise<void> {
  const { data: row } = await client.from("seo_landing_pages").select("slug").eq("id", pageId).maybeSingle();
  if ((row as { slug?: string } | null)?.slug === APPROVED_LP.slug) return;
  const report = await qualityReportForPage(client, pageId);
  if (report.pass) return;
  const failed = report.checks.filter((check) => !check.pass).map((check) => `${check.label}: ${check.detail}`);
  throw new Error(`Quality gate belum lulus. ${failed.join(" ")}`);
}

export const getLandingQuality = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => qualityReportForPage(db(context.supabase), data.pageId));

function amenityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).map((item) => item.trim()).filter(Boolean);
}

export async function generateFromApprovedBrief(input: {
  briefId: string;
  client: SupabaseClient;
}): Promise<{ pageId: string; slug: string }> {
  const sb = input.client;
  const { data: briefRow, error: briefError } = await sb
    .from("seo_landing_briefs")
    .select("*")
    .eq("id", input.briefId)
    .maybeSingle();
  if (briefError) {
    if (missing(briefError)) throw new Error("Tabel seo_landing_briefs belum ada. Jalankan migrasi SQL setelah deploy.");
    throw briefError;
  }
  const brief = briefRow as LandingBrief | null;
  if (!brief) throw new Error("Brief tidak ditemukan.");
  if (brief.status !== "approved") {
    throw new Error("Setujui brief dulu. Generasi hanya berjalan dari status approved.");
  }

  const [{ data: prop }, roomsResult, landmarkResult] = await Promise.all([
    sb.from("properties").select("id, name, whatsapp_number, address").limit(1).maybeSingle(),
    sb.from("room_types").select("id, name, slug, capacity, base_rate, bed_type, amenities, is_published"),
    sb.from("seo_landmarks").select("id, name, category, road_distance_km, travel_minutes, verified"),
  ]);
  const property = (prop ?? {}) as { id?: string; name?: string | null; whatsapp_number?: string | null; address?: string | null };
  const rooms = ((roomsResult.data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.is_published !== false)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? "Kamar"),
      slug: String(row.slug ?? ""),
      capacity: row.capacity == null ? null : Number(row.capacity),
      baseRate: row.base_rate == null ? null : Number(row.base_rate),
      bedType: row.bed_type == null ? null : String(row.bed_type),
      amenities: amenityList(row.amenities),
    }))
    .filter((row) => row.slug);
  const landmarks = ((landmarkResult.error ? [] : landmarkResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    category: row.category == null ? null : String(row.category),
    roadDistanceKm: row.road_distance_km == null ? null : Number(row.road_distance_km),
    travelMinutes: row.travel_minutes == null ? null : Number(row.travel_minutes),
    verified: row.verified === true,
  }));
  const selected = new Set(asStringArray(brief.landmark_ids));
  const facts: GroundingFacts = {
    propertyName: property.name?.trim() || "Pomah Guesthouse",
    address: property.address?.trim() || POMAH_NAP_ADDRESS,
    lat: POMAH_GEO.latitude,
    lng: POMAH_GEO.longitude,
    whatsappDigits: String(property.whatsapp_number ?? "").replace(/\D/g, ""),
    checkIn: "14.00 WIB",
    checkOut: "12.00 WIB",
    rooms,
    landmarks: selected.size > 0 ? landmarks.filter((row) => selected.has(row.id)) : landmarks,
    explore: CITY_GUIDE_ARTICLES.map((article) => ({ slug: article.canonicalSlug, title: article.title })),
    propertyFaqs: HOMEPAGE_FAQS,
    brief: {
      primaryKeyword: brief.primary_keyword,
      secondaryKeywords: asStringArray(brief.secondary_keywords),
      intent: brief.intent ?? "",
      slug: brief.slug,
      targetAudience: brief.target_audience ?? "",
      uniqueAngle: brief.unique_angle ?? "",
      faqSeeds: asStringArray(brief.faq_seeds),
      reviewKeywords: asStringArray(brief.review_keywords),
      exploreSlugs: asStringArray(brief.explore_slugs),
      landmarkIds: asStringArray(brief.landmark_ids),
      roomTypeIds: asStringArray(brief.room_type_ids),
      minCapacity: brief.min_capacity,
    },
  };
  const prompt = buildGroundingPrompt(facts);
  const ai = await resolvePropertyAiConfig(sb, { lovableFallbackModel: "google/gemini-2.5-flash" });
  if (!ai) throw new Error("AI belum dikonfigurasi. Isi kunci di Settings atau LOVABLE_API_KEY.");
  const completion = await chatCompletion(
    { ...ai, timeoutMs: 55_000 },
    [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    { temperature: 0.3, maxTokens: 4000, responseFormat: { type: "json_object" } },
  );
  if (!completion.ok || !completion.content) {
    throw new Error(completion.error || "AI tidak mengembalikan draf.");
  }
  let model: Record<string, unknown>;
  try {
    model = parseModelJson(completion.content);
  } catch {
    throw new Error("AI mengembalikan format yang tidak valid. Coba lagi.");
  }
  const draft = assembleLandingDraft(facts, model);
  const sections = draft.sections as LPSection[];

  let pageId = brief.landing_page_id;
  if (pageId) {
    const { data: existing } = await sb.from("seo_landing_pages").select("id, published").eq("id", pageId).maybeSingle();
    if (existing && (existing as { published?: boolean }).published) {
      throw new Error("Halaman brief ini sudah tayang. Batalkan publikasi dulu sebelum membuat ulang draf.");
    }
    if (!existing) pageId = null;
  }
  if (!pageId) {
    const { data: clash } = await sb.from("seo_landing_pages").select("id").eq("slug", brief.slug).maybeSingle();
    if (clash) throw new Error(`Slug /lp/${brief.slug} sudah dipakai halaman lain.`);
    const inserted = await sb
      .from("seo_landing_pages")
      .insert({
        property_id: property.id ?? null,
        title: facts.brief.primaryKeyword,
        slug: brief.slug,
        target_keyword: facts.brief.primaryKeyword,
        hero_headline: sections.find((section) => section.type === "hero" && "headline" in section)
          ? (sections.find((section) => section.type === "hero") as { headline?: string }).headline ?? null
          : null,
        hero_cta_text: "Pesan kamar",
        hero_cta_url: "/book",
        meta_title: draft.metaTitle,
        meta_description: draft.metaDescription,
        published: false,
        noindex: true,
        brief_id: brief.id,
        json_ld_enabled: true,
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (missing(inserted.error) && /noindex|brief_id|related_explore/.test(inserted.error.message ?? "")) {
        const retry = await sb
          .from("seo_landing_pages")
          .insert({
            property_id: property.id ?? null,
            title: facts.brief.primaryKeyword,
            slug: brief.slug,
            target_keyword: facts.brief.primaryKeyword,
            hero_cta_text: "Pesan kamar",
            hero_cta_url: "/book",
            meta_title: draft.metaTitle,
            meta_description: draft.metaDescription,
            published: false,
          })
          .select("id")
          .single();
        if (retry.error || !retry.data) throw retry.error ?? new Error("Halaman gagal dibuat.");
        pageId = (retry.data as { id: string }).id;
      } else {
        throw inserted.error;
      }
    } else {
      pageId = (inserted.data as { id: string }).id;
    }
  } else {
    const updated = await sb
      .from("seo_landing_pages")
      .update({
        title: facts.brief.primaryKeyword,
        slug: brief.slug,
        target_keyword: facts.brief.primaryKeyword,
        meta_title: draft.metaTitle,
        meta_description: draft.metaDescription,
        published: false,
        noindex: true,
        brief_id: brief.id,
      })
      .eq("id", pageId);
    if (updated.error && missing(updated.error)) {
      await sb
        .from("seo_landing_pages")
        .update({
          title: facts.brief.primaryKeyword,
          slug: brief.slug,
          target_keyword: facts.brief.primaryKeyword,
          meta_title: draft.metaTitle,
          meta_description: draft.metaDescription,
          published: false,
        })
        .eq("id", pageId);
    } else if (updated.error) {
      throw updated.error;
    }
  }
  if (!pageId) throw new Error("Halaman gagal dibuat.");
  await replacePageSections(sb, pageId, sections);
  const briefUpdate = await sb
    .from("seo_landing_briefs")
    .update({ status: "generated", landing_page_id: pageId })
    .eq("id", brief.id);
  if (briefUpdate.error && !missing(briefUpdate.error)) throw briefUpdate.error;
  return { pageId, slug: brief.slug };
}

export const generateLandingFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ briefId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => generateFromApprovedBrief({ briefId: data.briefId, client: db(context.supabase) }));
