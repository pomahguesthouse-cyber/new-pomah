/**
 * Request-time SEO redirects. Database lookups run only for legacy paths
 * that need them (Deluxe room slug, explore place names).
 */
import { supabasePublic } from "@/integrations/supabase/client.server";
import { loadCityGuidePlaces } from "@/public/lib/city-guide.server";
import {
  isMissingSchemaError,
  landingSlugFromPath,
  type SlugRedirectRow,
} from "@/public/lib/lp-slug-redirects";
import {
  buildSeoRedirect,
  isApiPath,
  legacyKindForPath,
  normalizePathname,
  resolveDeluxeRoomPath,
  shouldCanonicalizeHost,
  type ExplorePlaceRef,
  type SeoRedirect,
} from "@/public/lib/seo-redirects";

const CACHE_MS = 60_000;

let deluxeCache: { at: number; path: string } | null = null;
let slugRedirectCache: { at: number; rows: SlugRedirectRow[] } | null = null;

/**
 * Old landing slugs. A missing table (migration not applied yet) caches an
 * empty list for a minute and never throws.
 */
export async function lookupLandingSlugRedirects(): Promise<SlugRedirectRow[]> {
  const now = Date.now();
  if (slugRedirectCache && now - slugRedirectCache.at < CACHE_MS) return slugRedirectCache.rows;
  try {
    const client = supabasePublic as unknown as {
      from: (table: string) => {
        select: (columns: string) => Promise<{
          data: SlugRedirectRow[] | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    const { data, error } = await client.from("seo_slug_redirects").select("from_slug, to_slug");
    if (error) {
      if (isMissingSchemaError(error)) {
        slugRedirectCache = { at: now, rows: [] };
        return [];
      }
      console.warn("[seo-redirect] slug redirect lookup failed:", error.message);
      return slugRedirectCache?.rows ?? [];
    }
    const rows = data ?? [];
    slugRedirectCache = { at: now, rows };
    return rows;
  } catch (error) {
    console.warn(
      "[seo-redirect] slug redirect lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return slugRedirectCache?.rows ?? [];
  }
}

export async function lookupDeluxeRoomPath(): Promise<string> {
  const now = Date.now();
  if (deluxeCache && now - deluxeCache.at < CACHE_MS) return deluxeCache.path;
  try {
    const { data, error } = await supabasePublic
      .from("room_types")
      .select("name, slug, is_published");
    if (error) throw error;
    const path = resolveDeluxeRoomPath(data ?? []);
    deluxeCache = { at: now, path };
    return path;
  } catch (error) {
    console.warn(
      "[seo-redirect] deluxe room lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return resolveDeluxeRoomPath([]);
  }
}

export async function lookupDeluxeRoomSlug(): Promise<string> {
  const path = await lookupDeluxeRoomPath();
  return path.replace(/^\/rooms\//, "") || "deluxe";
}

export async function lookupExplorePlaces(): Promise<ExplorePlaceRef[]> {
  const places = await loadCityGuidePlaces();
  return places.map((place) => ({ name: place.name, slug: place.slug }));
}

export async function resolveSeoRedirect(request: Request): Promise<SeoRedirect | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const pathname = normalizePathname(url.pathname);
  if (isApiPath(pathname)) return null;
  const kind = legacyKindForPath(pathname);
  const lpSlug = landingSlugFromPath(pathname);
  if (!kind && !shouldCanonicalizeHost(url) && !lpSlug) return null;

  const deluxeRoomPath = kind === "deluxe-ocean-view" ? await lookupDeluxeRoomPath() : undefined;
  const explorePlaces = kind === "explore-slug" ? await lookupExplorePlaces() : undefined;
  const landingRedirects = lpSlug ? await lookupLandingSlugRedirects() : undefined;
  return buildSeoRedirect({
    requestUrl: request.url,
    deluxeRoomPath,
    explorePlaces,
    landingRedirects,
  });
}
