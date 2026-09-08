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
export function publicSeoMeta(input: PublicSeoInput, fallback: { title: string; description: string }): PublicSeoMetaTag[] {
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

const BARE_ROOMS_LISTING = /^\/rooms\/?$/;

/**
 * Public sitemap paths. `/rooms` (no slug) 404s — omit it. `/explore` is
 * a real public page and must be listed.
 */
export function collectSitemapPaths(input: {
  pageSlugs?: Array<string | null | undefined>;
  roomSlugs?: Array<string | null | undefined>;
}): string[] {
  const urls = new Set<string>(["/", "/book", "/explore"]);
  for (const raw of input.pageSlugs ?? []) {
    if (!raw) continue;
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    if (BARE_ROOMS_LISTING.test(path)) continue;
    urls.add(path);
  }
  for (const raw of input.roomSlugs ?? []) {
    if (!raw) continue;
    const slug = raw.replace(/^\/+/, "");
    if (!slug || slug === "rooms") continue;
    urls.add(`/rooms/${slug}`);
  }
  return [...urls];
}
