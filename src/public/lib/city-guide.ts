/**
 * Public City Guide catalog.
 *
 * Places come from the property's explore_config (destinations, culinary,
 * events, news) and from published explore_items. Slugs are derived from
 * the title so a new row becomes /explore/<slug> without a manual list.
 * Dated events that have already ended are omitted. Recurring labels stay.
 */
import { isPublicExploreEventVisible } from "@/lib/explore-event-date";
import { canonicalUrlForPath } from "@/public/lib/public-seo";
import { placeSlugMatches, slugifyPlaceName } from "@/public/lib/seo-redirects";

export type CityGuideCategory = "destinasi" | "kuliner" | "event" | "berita" | "tips";

export type CityGuidePlace = {
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: CityGuideCategory;
  location: string | null;
  rating: string | null;
  dateText: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

export type CityGuideItemSource = {
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  category?: string | null;
  is_published?: boolean | null;
  date_text?: string | null;
  location_text?: string | null;
  rating?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CityGuideSource = {
  propertyUpdatedAt?: string | null;
  propertyCreatedAt?: string | null;
  destinations?: Array<{
    name?: string | null;
    desc?: string | null;
    image?: string | null;
    rating?: string | null;
    address?: string | null;
    nearby_distance?: string | null;
  }> | null;
  culinary?: Array<{
    name?: string | null;
    desc?: string | null;
    image?: string | null;
    rating?: string | null;
    address?: string | null;
    category?: string | null;
  }> | null;
  events?: Array<{
    title?: string | null;
    date?: string | null;
    desc?: string | null;
    image?: string | null;
    location?: string | null;
  }> | null;
  news?: Array<{
    title?: string | null;
    date?: string | null;
    desc?: string | null;
    image?: string | null;
    location?: string | null;
  }> | null;
  items?: CityGuideItemSource[] | null;
  todayWib?: string;
};

type Draft = Omit<CityGuidePlace, "slug"> & { slugBase: string };

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function orNull(value: string | null | undefined): string | null {
  const trimmed = text(value);
  return trimmed || null;
}

function laterStamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isNaN(at)) return b;
  if (Number.isNaN(bt)) return a;
  return at >= bt ? a : b;
}

function categoryOfItem(raw: string | null | undefined): CityGuideCategory {
  const value = text(raw).toLowerCase();
  if (value === "destinasi" || value === "destination" || value === "dest") return "destinasi";
  if (value === "kuliner" || value === "culinary") return "kuliner";
  if (value === "event" || value === "events") return "event";
  if (value === "berita" || value === "news") return "berita";
  return "tips";
}

function isVisibleEvent(dateText: string | null, todayWib: string | undefined): boolean {
  return isPublicExploreEventVisible(dateText, todayWib);
}

function pushDraft(out: Draft[], draft: Omit<Draft, "slugBase"> & { name: string }) {
  const slugBase = slugifyPlaceName(draft.name);
  if (!slugBase) return;
  out.push({ ...draft, slugBase });
}

export function collectCityGuidePlaces(source: CityGuideSource): CityGuidePlace[] {
  const todayWib = source.todayWib;
  const configUpdated = orNull(source.propertyUpdatedAt);
  const configCreated = orNull(source.propertyCreatedAt);
  const drafts: Draft[] = [];

  for (const row of source.destinations ?? []) {
    const name = text(row?.name);
    if (!name) continue;
    pushDraft(drafts, {
      name,
      description: text(row.desc),
      imageUrl: orNull(row.image),
      category: "destinasi",
      location: orNull(row.address) || orNull(row.nearby_distance),
      rating: orNull(row.rating),
      dateText: null,
      updatedAt: configUpdated,
      createdAt: configCreated,
    });
  }

  for (const row of source.culinary ?? []) {
    const name = text(row?.name);
    if (!name) continue;
    pushDraft(drafts, {
      name,
      description: text(row.desc),
      imageUrl: orNull(row.image),
      category: "kuliner",
      location: orNull(row.address),
      rating: orNull(row.rating),
      dateText: null,
      updatedAt: configUpdated,
      createdAt: configCreated,
    });
  }

  for (const row of source.events ?? []) {
    const name = text(row?.title);
    const dateText = orNull(row?.date);
    if (!name || !isVisibleEvent(dateText, todayWib)) continue;
    pushDraft(drafts, {
      name,
      description: text(row.desc),
      imageUrl: orNull(row.image),
      category: "event",
      location: orNull(row.location),
      rating: null,
      dateText,
      updatedAt: configUpdated,
      createdAt: configCreated,
    });
  }

  for (const row of source.news ?? []) {
    const name = text(row?.title);
    if (!name) continue;
    pushDraft(drafts, {
      name,
      description: text(row.desc),
      imageUrl: orNull(row.image),
      category: "berita",
      location: orNull(row.location),
      rating: null,
      dateText: orNull(row.date),
      updatedAt: configUpdated,
      createdAt: configCreated,
    });
  }

  for (const row of source.items ?? []) {
    if (row?.is_published !== true) continue;
    const name = text(row.title);
    if (!name) continue;
    const category = categoryOfItem(row.category);
    const dateText = orNull(row.date_text);
    if (category === "event" && !isVisibleEvent(dateText, todayWib)) continue;
    const rating = row.rating == null || row.rating === "" ? null : String(row.rating);
    pushDraft(drafts, {
      name,
      description: text(row.description),
      imageUrl: orNull(row.image_url),
      category,
      location: orNull(row.location_text),
      rating,
      dateText,
      updatedAt: orNull(row.updated_at) || orNull(row.created_at),
      createdAt: orNull(row.created_at),
    });
  }

  const merged = new Map<string, Draft>();
  for (const draft of drafts) {
    const existing = merged.get(draft.slugBase);
    if (!existing) {
      merged.set(draft.slugBase, draft);
      continue;
    }
    merged.set(draft.slugBase, {
      ...existing,
      description: existing.description || draft.description,
      imageUrl: existing.imageUrl || draft.imageUrl,
      location: existing.location || draft.location,
      rating: existing.rating || draft.rating,
      dateText: existing.dateText || draft.dateText,
      updatedAt: laterStamp(existing.updatedAt, draft.updatedAt),
      createdAt: existing.createdAt || draft.createdAt,
    });
  }

  const used = new Set<string>();
  const places: CityGuidePlace[] = [];
  for (const draft of merged.values()) {
    let slug = draft.slugBase;
    let n = 2;
    while (used.has(slug)) slug = `${draft.slugBase}-${n++}`;
    used.add(slug);
    places.push({
      slug,
      name: draft.name,
      description: draft.description,
      imageUrl: draft.imageUrl,
      category: draft.category,
      location: draft.location,
      rating: draft.rating,
      dateText: draft.dateText,
      updatedAt: draft.updatedAt,
      createdAt: draft.createdAt,
    });
  }
  return places;
}

export function cityGuideLastmod(
  place: Pick<CityGuidePlace, "updatedAt" | "createdAt">,
): string | null {
  return place.updatedAt || place.createdAt || null;
}

/** Exact slug first, then a clearly equivalent name ("goa-kreo" ≈ "Obyek Wisata Goa Kreo"). */
export function findCityGuidePlace(
  places: readonly CityGuidePlace[],
  requestedSlug: string,
): CityGuidePlace | null {
  const req = slugifyPlaceName(requestedSlug);
  if (!req) return null;
  const exact = places.find((place) => place.slug === req);
  if (exact) return exact;
  const matches = places.filter(
    (place) => placeSlugMatches(req, place.name) || placeSlugMatches(req, place.slug),
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const aName = slugifyPlaceName(a.name) === req ? 0 : 1;
    const bName = slugifyPlaceName(b.name) === req ? 0 : 1;
    if (aName !== bName) return aName - bName;
    return a.slug.length - b.slug.length;
  })[0];
}

export function cityGuidePathForSlug(
  requestedSlug: string,
  places: readonly CityGuidePlace[],
): string {
  const place = findCityGuidePlace(places, requestedSlug);
  return place ? `/explore/${place.slug}` : "/explore";
}

export type SitemapUrl = { loc: string; lastmod?: string };

export function cityGuideSitemapUrls(places: readonly CityGuidePlace[]): SitemapUrl[] {
  return places
    .map((place) => {
      const loc = canonicalUrlForPath(`/explore/${place.slug}`);
      const lastmod = cityGuideLastmod(place);
      return lastmod ? { loc, lastmod } : { loc };
    })
    .sort((a, b) => a.loc.localeCompare(b.loc));
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sitemapLastmod(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Valid urlset. Locs must already be absolute https://pomahguesthouse.com URLs. */
export function renderSitemapXml(entries: readonly SitemapUrl[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.loc.startsWith("https://pomahguesthouse.com")) continue;
    if (entry.loc.includes("www.")) continue;
    if (seen.has(entry.loc)) continue;
    seen.add(entry.loc);
    const lastmod = entry.lastmod ? sitemapLastmod(entry.lastmod) : null;
    const last = lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
    lines.push(`  <url><loc>${xmlEscape(entry.loc)}</loc>${last}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>`;
}
