/**
 * Loads the public City Guide catalog once per minute.
 * Sitemap, place pages, and legacy /explore-semarang redirects share this.
 */
import { supabasePublic } from "@/integrations/supabase/client.server";
import {
  collectCityGuidePlaces,
  type CityGuidePlace,
  type CityGuideSource,
} from "@/public/lib/city-guide";

const CACHE_MS = 60_000;

const ITEM_COLUMNS =
  "title, description, image_url, category, is_published, date_text, location_text, rating, created_at, updated_at";

let cache: { at: number; places: CityGuidePlace[] } | null = null;

type ExploreConfigShape = Pick<CityGuideSource, "destinations" | "culinary" | "events" | "news">;

/**
 * meta_description is additive. Until that column exists, retry the original
 * select so a missing column cannot empty the whole City Guide catalog.
 */
async function loadPublishedExploreItems() {
  const withMeta = await supabasePublic
    .from("explore_items")
    .select(`${ITEM_COLUMNS}, meta_description`)
    .eq("is_published", true);
  if (!withMeta.error) return withMeta.data ?? [];
  const message = String(withMeta.error.message ?? withMeta.error);
  if (!/meta_description/i.test(message)) throw withMeta.error;
  const fallback = await supabasePublic
    .from("explore_items")
    .select(ITEM_COLUMNS)
    .eq("is_published", true);
  if (fallback.error) throw fallback.error;
  return fallback.data ?? [];
}

export async function loadCityGuidePlaces(): Promise<CityGuidePlace[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.places;
  try {
    const [{ data: property }, items] = await Promise.all([
      supabasePublic.rpc("get_public_property" as never),
      loadPublishedExploreItems(),
    ]);
    const row = (property ?? null) as {
      updated_at?: string | null;
      created_at?: string | null;
      explore_config?: ExploreConfigShape | null;
    } | null;
    const config = row?.explore_config ?? {};
    const places = collectCityGuidePlaces({
      propertyUpdatedAt: row?.updated_at,
      propertyCreatedAt: row?.created_at,
      destinations: config.destinations,
      culinary: config.culinary,
      events: config.events,
      news: config.news,
      items,
    });
    cache = { at: now, places };
    return places;
  } catch (error) {
    console.warn(
      "[city-guide] catalog load failed:",
      error instanceof Error ? error.message : error,
    );
    return cache?.places ?? [];
  }
}
