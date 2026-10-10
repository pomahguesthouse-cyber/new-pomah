/**
 * Pure filters for landing-page blocks. Rendering stays in the React components.
 */

export type DynamicRoom = {
  id: string;
  name: string;
  slug: string;
  capacity?: number | null;
  base_rate?: number | string | null;
  hero_image_url?: string | null;
  amenities?: string[] | null;
};

export type DynamicLandmark = {
  id: string;
  name: string;
  category?: string | null;
  lat?: number | null;
  lng?: number | null;
  road_distance_km?: number | null;
  travel_minutes?: number | null;
  verified: boolean;
};

export type DynamicReview = { author: string; text: string; rating: number };

export type DynamicExplore = { slug: string; name: string; category?: string | null };

export function formatIdr(value: number): string {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

export function roomRate(room: DynamicRoom): number | null {
  const n = Number(room.base_rate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function filterRooms(
  rooms: readonly DynamicRoom[],
  input: { roomTypeIds?: readonly string[] | null; minCapacity?: number | null },
): DynamicRoom[] {
  let pool = rooms.filter((room) => room.slug && room.name);
  const ids = (input.roomTypeIds ?? []).filter(Boolean);
  if (ids.length > 0) {
    const wanted = new Set(ids);
    pool = pool.filter((room) => wanted.has(room.id));
  }
  const min = input.minCapacity;
  if (typeof min === "number" && min > 0) {
    pool = pool.filter((room) => (room.capacity ?? 0) >= min);
  }
  return pool;
}

export function startingRate(rooms: readonly DynamicRoom[]): number | null {
  const rates = rooms.map(roomRate).filter((rate): rate is number => rate != null);
  if (rates.length === 0) return null;
  return Math.min(...rates);
}

export function filterReviews(
  reviews: readonly DynamicReview[],
  keywords: readonly string[],
  limit = 3,
): DynamicReview[] {
  const cap = Math.max(1, limit);
  const keys = keywords.map((word) => word.trim().toLowerCase()).filter(Boolean);
  if (keys.length === 0) return reviews.slice(0, cap);
  const matched = reviews.filter((review) => {
    const hay = `${review.text} ${review.author}`.toLowerCase();
    return keys.some((key) => hay.includes(key));
  });
  return (matched.length > 0 ? matched : reviews).slice(0, cap);
}

export function selectLandmarks(
  landmarks: readonly DynamicLandmark[],
  ids: readonly string[],
): DynamicLandmark[] {
  const wanted = new Set(ids);
  return landmarks.filter((row) => wanted.has(row.id));
}

export function selectExplore(
  places: readonly DynamicExplore[],
  input: { slugs?: readonly string[] | null; tag?: string | null },
): DynamicExplore[] {
  const slugs = (input.slugs ?? []).map((slug) => slug.trim().toLowerCase()).filter(Boolean);
  if (slugs.length > 0) {
    const wanted = new Set(slugs);
    return places.filter((place) => wanted.has(place.slug.toLowerCase()));
  }
  const tag = (input.tag ?? "").trim().toLowerCase();
  if (!tag) return [];
  return places.filter(
    (place) =>
      (place.category ?? "").toLowerCase() === tag ||
      place.name.toLowerCase().includes(tag) ||
      place.slug.toLowerCase().includes(tag),
  );
}

export function mapsDirectionsUrl(lat: number, lng: number, originLat: number, originLng: number): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${originLat},${originLng}`,
    destination: `${lat},${lng}`,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function mapsEmbedUrl(lat: number, lng: number): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=14&output=embed`;
}

export type IndexableLandingLink = {
  slug: string;
  title: string;
  keyword: string | null;
};

export function matchLandingForExplore(
  exploreSlug: string,
  pages: ReadonlyArray<{ slug: string; title: string; exploreSlugs?: ReadonlyArray<string> | null }>,
): { slug: string; title: string } | null {
  const wanted = exploreSlug.trim().toLowerCase();
  if (!wanted) return null;
  const hit = pages.find((page) =>
    (page.exploreSlugs ?? []).some((slug) => slug.trim().toLowerCase() === wanted),
  );
  return hit ? { slug: hit.slug, title: hit.title } : null;
}
