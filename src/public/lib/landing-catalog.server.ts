/**
 * Public reads for landing briefs. A missing table or column returns empty
 * data so pages keep rendering before the migration is applied.
 */
import { supabasePublic } from "@/integrations/supabase/client.server";
import { filterIndexableLandingRows } from "@/public/lib/landing-page-seo";
import { isMissingSchemaError } from "@/public/lib/lp-slug-redirects";
import { matchLandingForExplore, type DynamicLandmark, type IndexableLandingLink } from "@/public/lib/lp-dynamic";

type LooseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => LooseQuery;
      order: (column: string, options?: { ascending?: boolean }) => LooseQuery;
    };
  };
};

type LooseQuery = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> & {
  eq: (column: string, value: unknown) => LooseQuery;
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery;
};

function client(): LooseClient {
  return supabasePublic as unknown as LooseClient;
}

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export async function listIndexableLandingPages(): Promise<IndexableLandingLink[]> {
  try {
    const withFlag = await client()
      .from("seo_landing_pages")
      .select("slug, title, target_keyword, noindex, published")
      .eq("published", true)
      .order("title", { ascending: true });
    if (withFlag.error) {
      if (!isMissingSchemaError(withFlag.error)) return [];
      const plain = await client()
        .from("seo_landing_pages")
        .select("slug, title, target_keyword")
        .eq("published", true);
      if (plain.error) return [];
      return rowsOf(plain.data).map(toLink);
    }
    return filterIndexableLandingRows(
      rowsOf(withFlag.data).map((row) => ({
        ...toLink(row),
        noindex: row.noindex === true,
      })),
    ).map(({ slug, title, keyword }) => ({ slug, title, keyword }));
  } catch {
    return [];
  }
}

function toLink(row: Record<string, unknown>): IndexableLandingLink {
  return {
    slug: String(row.slug ?? ""),
    title: String(row.title ?? row.slug ?? "Landing"),
    keyword: row.target_keyword == null ? null : String(row.target_keyword),
  };
}

export async function loadVerifiedLandmarks(): Promise<DynamicLandmark[]> {
  try {
    const result = await client()
      .from("seo_landmarks")
      .select("id, name, category, lat, lng, road_distance_km, travel_minutes, verified")
      .eq("verified", true)
      .order("sort_order", { ascending: true });
    if (result.error) return [];
    return rowsOf(result.data).map(toLandmark);
  } catch {
    return [];
  }
}

function toLandmark(row: Record<string, unknown>): DynamicLandmark {
  const num = (value: unknown): number | null => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    category: row.category == null ? null : String(row.category),
    lat: num(row.lat),
    lng: num(row.lng),
    road_distance_km: num(row.road_distance_km),
    travel_minutes: num(row.travel_minutes),
    verified: row.verified === true,
  };
}

export async function findLandingForExploreSlug(
  exploreSlug: string,
): Promise<{ slug: string; title: string } | null> {
  try {
    const result = await client()
      .from("seo_landing_pages")
      .select("slug, title, noindex, published, related_explore_slugs")
      .eq("published", true);
    if (result.error) return null;
    const pages = filterIndexableLandingRows(
      rowsOf(result.data).map((row) => ({
        slug: String(row.slug ?? ""),
        title: String(row.title ?? ""),
        noindex: row.noindex === true,
        exploreSlugs: Array.isArray(row.related_explore_slugs)
          ? row.related_explore_slugs.map((slug) => String(slug))
          : [],
      })),
    );
    return matchLandingForExplore(exploreSlug, pages);
  } catch {
    return null;
  }
}
