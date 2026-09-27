/**
 * Shared public-page SEO helpers.
 *
 * Title / description / H1 / Twitter cards on `/`, `/explore`, and
 * `/rooms/:slug` must come from saved fields (homepage_config.seo,
 * explore_config.seo, room_types.seo_*), using the approved copy as
 * fallback. A later edit in admin is kept. Known older defaults are
 * replaced so the approved sentences show before the SQL file is run.
 */
import {
  APPROVED_HOME,
  approvedRoomSeo,
  isLegacyHomepageH1,
  isLegacyHomepageMeta,
  isLegacyHomepageTitle,
} from "@/public/content/approved-seo";

/** Visible homepage H1. Stored configs that still have an older default use this. */
export const HOMEPAGE_H1 = APPROVED_HOME.h1;

export function resolveHomepageH1(stored?: string | null): string {
  const value = stored?.trim() ?? "";
  if (!value || isLegacyHomepageH1(value)) return HOMEPAGE_H1;
  return value;
}

export function resolveHomepageTitle(stored?: string | null): string {
  const value = stored?.trim() ?? "";
  if (!value || isLegacyHomepageTitle(value)) return HOME_SEO.title;
  return value;
}

export function resolveHomepageMeta(stored?: string | null): string {
  const value = stored?.trim() ?? "";
  if (!value || isLegacyHomepageMeta(value)) return HOME_SEO.description;
  return value;
}

export const HOME_SEO = {
  h1: HOMEPAGE_H1,
  title: APPROVED_HOME.title,
  description: APPROVED_HOME.meta,
} as const;

export const EXPLORE_SEO = {
  h1: "Jelajahi Semarang",
  title: "Jelajahi Semarang | Panduan Tamu Penginapan Dekat UNNES",
  description:
    "Panduan wisata dan kuliner Semarang untuk tamu penginapan dekat UNNES. Destinasi, tempat makan, dan event dari Pomah Guesthouse.",
} as const;

export type PublicSeoInput = {
  title?: string | null;
  description?: string | null;
  twitterTitle?: string | null;
  twitterDescription?: string | null;
  ogImageUrl?: string | null;
  robots?: string | null;
};

export type PublicSeoMetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** Unsplash and similar placeholders are not the property's own photos. */
export function isStockImageUrl(url: string | null | undefined): boolean {
  return /images\.unsplash\.com|images\.pexels\.com|source\.unsplash\.com/i.test(url ?? "");
}

/** First candidate that is a real photo, skipping empty and stock URLs. */
export function preferredOgImage(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && !isStockImageUrl(value)) return value;
  }
  return "";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Build title / description / OG / Twitter tags from saved SEO fields. */
export function publicSeoMeta(
  input: PublicSeoInput,
  fallback: { title: string; description: string },
): PublicSeoMetaTag[] {
  const title = firstNonEmpty(input.title, fallback.title);
  const description = firstNonEmpty(input.description, fallback.description);
  const twitterTitle = firstNonEmpty(input.twitterTitle, title);
  const twitterDescription = firstNonEmpty(input.twitterDescription, description);
  const tags: PublicSeoMetaTag[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: twitterTitle },
    { name: "twitter:description", content: twitterDescription },
  ];
  if (input.ogImageUrl?.trim()) {
    tags.push({ property: "og:image", content: input.ogImageUrl.trim() });
    tags.push({ name: "twitter:image", content: input.ogImageUrl.trim() });
  }
  if (input.robots?.trim()) {
    tags.push({ name: "robots", content: input.robots.trim() });
  }
  return tags;
}

export type RoomSeoSource = {
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  seo_h1?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  hero_image_url?: string | null;
};

const LEGACY_ROOM_TITLE = /penginapan dekat unnes/i;

/** Drop the old shared "Penginapan Dekat UNNES" title template. Custom copy is kept. */
function roomSeoField(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || LEGACY_ROOM_TITLE.test(trimmed)) return "";
  return trimmed;
}

/** Default document title when a room has no custom SEO title yet. */
export function defaultRoomSeoTitle(name: string): string {
  return `${name} – Pomah Guesthouse Semarang`;
}

/** Resolve a room page's H1 / title / meta from saved room_types SEO columns. */
export function resolveRoomPublicSeo(room: RoomSeoSource): {
  h1: string;
  title: string;
  description: string;
  twitterTitle: string;
  twitterDescription: string;
  ogImageUrl: string;
} {
  const name = firstNonEmpty(room.name, "Kamar");
  const approved = approvedRoomSeo(room.slug);
  const title = firstNonEmpty(roomSeoField(room.seo_title), approved?.title, defaultRoomSeoTitle(name));
  const description = firstNonEmpty(
    room.meta_description,
    approved?.meta,
    room.description,
    `${name} di Pomah Guesthouse Semarang.`,
  );
  return {
    h1: firstNonEmpty(roomSeoField(room.seo_h1), approved?.h1, name),
    title,
    description,
    twitterTitle: title,
    twitterDescription: description,
    ogImageUrl: preferredOgImage(room.hero_image_url),
  };
}

/** Apex host. Canonicals, Open Graph, sitemap, and robots must use this origin. */
export const CANONICAL_ORIGIN = "https://pomahguesthouse.com";

/**
 * Homepage keeps a trailing slash. Every other public path does not.
 * Query strings and hashes are dropped — canonicals never include tracking params.
 */
export function canonicalUrlForPath(pathname: string): string {
  const raw = pathname.split("?")[0]?.split("#")[0] ?? "/";
  let path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path || path === "/") return `${CANONICAL_ORIGIN}/`;
  return `${CANONICAL_ORIGIN}${path}`;
}

export function canonicalHeadTags(pathname: string): {
  meta: Array<{ property: "og:url"; content: string }>;
  links: Array<{ rel: "canonical"; href: string }>;
} {
  const href = canonicalUrlForPath(pathname);
  return {
    meta: [{ property: "og:url", content: href }],
    links: [{ rel: "canonical", href }],
  };
}

const BARE_ROOMS_LISTING = /^\/rooms\/?$/;
const ROOM_PATH = /^\/rooms\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANDING_PATH = /^\/lp\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXPLORE_PLACE_PATH = /^\/explore\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/** Turn a stored slug or absolute URL into a path, dropping non-apex hosts. */
function normalizeCandidatePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (normalizeHost(url.hostname) !== "pomahguesthouse.com") return null;
      return url.pathname || "/";
    } catch {
      return null;
    }
  }
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Paths that are allowed in the public sitemap: live indexable routes on the
 * apex host. Bare `/rooms` 404s. Legacy redirects and www/http URLs are omitted.
 */
export function isIndexableSitemapPath(pathname: string): boolean {
  const path = normalizeCandidatePath(pathname);
  if (!path) return false;
  if (path === "/rooms/deluxe-ocean-view") return false;
  if (path === "/explore/eksplorasi-sejarah-kota-lama-semarang") return false;
  if (path === "/explore-semarang" || path.startsWith("/explore-semarang/")) return false;
  if (path === "/" || path === "/book" || path === "/explore") return true;
  if (BARE_ROOMS_LISTING.test(path)) return false;
  if (ROOM_PATH.test(path)) return true;
  if (LANDING_PATH.test(path)) return true;
  if (EXPLORE_PLACE_PATH.test(path)) return true;
  return false;
}

/**
 * Public sitemap paths. `/rooms` (no slug) 404s — omit it. `/explore` is
 * a real public page and must be listed. Published landing pages under `/lp`
 * are included when supplied. Legacy and off-host URLs are not.
 */
export function collectSitemapPaths(input: {
  pageSlugs?: Array<string | null | undefined>;
  roomSlugs?: Array<string | null | undefined>;
  landingSlugs?: Array<string | null | undefined>;
  exploreSlugs?: Array<string | null | undefined>;
}): string[] {
  const urls = new Set<string>(["/", "/book", "/explore"]);
  const consider = (path: string | null) => {
    if (!path || !isIndexableSitemapPath(path)) return;
    const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
    urls.add(normalized === "" ? "/" : normalized);
  };
  for (const raw of input.pageSlugs ?? []) consider(normalizeCandidatePath(raw));
  for (const raw of input.roomSlugs ?? []) {
    if (!raw) continue;
    const slug = raw
      .trim()
      .replace(/^\/+/, "")
      .replace(/^rooms\//, "");
    if (!slug || slug === "rooms" || slug.includes("/")) continue;
    consider(`/rooms/${slug}`);
  }
  for (const raw of input.landingSlugs ?? []) {
    if (!raw) continue;
    const slug = raw.trim().replace(/^\/+/, "").replace(/^lp\//, "");
    if (!slug || slug.includes("/")) continue;
    consider(`/lp/${slug}`);
  }
  for (const raw of input.exploreSlugs ?? []) {
    if (!raw) continue;
    const slug = raw
      .trim()
      .replace(/^\/+/, "")
      .replace(/^explore\//, "");
    if (!slug || slug.includes("/")) continue;
    consider(`/explore/${slug}`);
  }
  return [...urls];
}

export type SitemapStamp = {
  slug?: string | null;
  updated_at?: string | null;
};

function stampForSlug(rows: SitemapStamp[] | undefined, slug: string): string | undefined {
  const wanted = slug.trim().toLowerCase();
  const row = (rows ?? []).find((item) => (item.slug ?? "").trim().toLowerCase() === wanted);
  const value = row?.updated_at?.trim();
  return value || undefined;
}

/**
 * lastmod from stored updated_at. Missing dates are omitted so the sitemap
 * does not pretend the page changed at request time.
 */
export function sitemapLastmodForPath(
  path: string,
  input: {
    propertyUpdatedAt?: string | null;
    rooms?: SitemapStamp[];
    landings?: SitemapStamp[];
    pages?: SitemapStamp[];
  },
): string | undefined {
  if (path === "/" || path === "/book" || path === "/explore") {
    return input.propertyUpdatedAt?.trim() || undefined;
  }
  const room = path.match(/^\/rooms\/([^/]+)$/);
  if (room) return stampForSlug(input.rooms, room[1]);
  const landing = path.match(/^\/lp\/([^/]+)$/);
  if (landing) return stampForSlug(input.landings, landing[1]);
  const pageSlug = path.replace(/^\//, "");
  return stampForSlug(input.pages, pageSlug) || stampForSlug(input.pages, path);
}
