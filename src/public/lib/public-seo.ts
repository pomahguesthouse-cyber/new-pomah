/**
 * Shared public-page SEO helpers.
 *
 * Title / description / H1 / Twitter cards on `/`, `/explore`, and
 * `/rooms/:slug` must come from saved fields (homepage_config.seo,
 * explore_config.seo, room_types.seo_*), using the seeded copy as
 * fallback. Do not invent new marketing strings here.
 */

export const HOME_SEO = {
  h1: "Penginapan Dekat UNNES Semarang",
  title: "Pomah Guesthouse | Penginapan Dekat UNNES Semarang",
  description:
    "Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.",
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
  const title = firstNonEmpty(room.seo_title, `${name} | Penginapan Dekat UNNES Semarang`);
  const description = firstNonEmpty(
    room.meta_description,
    room.description,
    `${name} di Pomah Guesthouse, penginapan dekat UNNES Semarang.`,
  );
  return {
    h1: firstNonEmpty(room.seo_h1, `${name}, Penginapan Dekat UNNES`),
    title,
    description,
    twitterTitle: title,
    twitterDescription: description,
    ogImageUrl: firstNonEmpty(room.hero_image_url),
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
