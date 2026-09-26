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

let cache: { at: number; places: CityGuidePlace[] } | null = null;

type ExploreConfigShape = Pick<CityGuideSource, "destinations" | "culinary" | "events" | "news">;

export async function loadCityGuidePlaces(): Promise<CityGuidePlace[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.places;
  try {
    const [{ data: property }, itemsResult] = await Promise.all([
      supabasePublic.rpc("get_public_property" as never),
      supabasePublic
        .from("explore_items")
        .select(
          "title, description, image_url, category, is_published, date_text, location_text, rating, created_at, updated_at",
        )
        .eq("is_published", true),
    ]);
    if (itemsResult.error) throw itemsResult.error;
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
      items: itemsResult.data ?? [],
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
