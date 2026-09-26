/**
 * Request-time SEO redirects. Database lookups run only for legacy paths
 * that need them (Deluxe room slug, explore place names).
 */
import { supabasePublic } from "@/integrations/supabase/client.server";
import {
  EXPLORE_DETAIL_PATHS,
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
let placesCache: { at: number; places: ExplorePlaceRef[] } | null = null;

type ExploreConfigShape = {
  destinations?: Array<{ name?: string | null }>;
  culinary?: Array<{ name?: string | null }>;
  events?: Array<{ title?: string | null }>;
  news?: Array<{ title?: string | null }>;
};

function pushName(out: ExplorePlaceRef[], name: string | null | undefined) {
  const trimmed = name?.trim();
  if (trimmed) out.push({ name: trimmed });
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
  const now = Date.now();
  if (placesCache && now - placesCache.at < CACHE_MS) return placesCache.places;
  const places: ExplorePlaceRef[] = [];
  try {
    const [{ data: property }, { data: items, error: itemsError }] = await Promise.all([
      supabasePublic.rpc("get_public_property" as never),
      supabasePublic.from("explore_items").select("title").eq("is_published", true),
    ]);
    if (itemsError) throw itemsError;
    const config = ((property as { explore_config?: ExploreConfigShape } | null)?.explore_config ??
      {}) as ExploreConfigShape;
    for (const row of config.destinations ?? []) pushName(places, row.name);
    for (const row of config.culinary ?? []) pushName(places, row.name);
    for (const row of config.events ?? []) pushName(places, row.title);
    for (const row of config.news ?? []) pushName(places, row.title);
    for (const row of items ?? []) pushName(places, row.title);
    placesCache = { at: now, places };
    return places;
  } catch (error) {
    console.warn(
      "[seo-redirect] explore place lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return places;
  }
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
  if (!kind && !shouldCanonicalizeHost(url)) return null;

  const deluxeRoomPath = kind === "deluxe-ocean-view" ? await lookupDeluxeRoomPath() : undefined;
  const explorePlaces = kind === "explore-slug" ? await lookupExplorePlaces() : undefined;
  return buildSeoRedirect({
    requestUrl: request.url,
    deluxeRoomPath,
    explorePlaces,
    exploreDetailPaths: EXPLORE_DETAIL_PATHS,
  });
}
