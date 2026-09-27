/**
 * Pure host + legacy URL redirect rules for the public site.
 *
 * Production host is https://pomahguesthouse.com (no www). Preview hosts
 * (*.lovable.app), localhost, and /api routes are never sent to that host
 * so Meta/Lovable webhooks and local dev keep working.
 *
 * Explore places are public pages at /explore/<slug>, built from the same
 * City Guide catalog (explore_config + published explore_items).
 */
import { canonicalUrlForPath } from "@/public/lib/public-seo";

export const CANONICAL_HOST = "pomahguesthouse.com";

export const DELUXE_OCEAN_VIEW_FALLBACK = "/rooms/deluxe";

export type ExplorePlaceRef = { name: string; slug?: string | null };

export type SeoRedirect = { location: string; reason: string };

export type SeoRedirectInput = {
  requestUrl: string;
  deluxeRoomPath?: string;
  explorePlaces?: ExplorePlaceRef[];
};

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

export function isApiPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/api" || path.startsWith("/api/");
}

export function isLocalOrPreviewHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".lovable.app")) return true;
  return false;
}

export function isProductionHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === CANONICAL_HOST || host === `www.${CANONICAL_HOST}`;
}

/** www or http on the production host. Preview and localhost are skipped. */
export function shouldCanonicalizeHost(url: URL): boolean {
  if (isLocalOrPreviewHost(url.hostname)) return false;
  const host = normalizeHost(url.hostname);
  if (host === `www.${CANONICAL_HOST}`) return true;
  if (host === CANONICAL_HOST && url.protocol === "http:") return true;
  return false;
}

/**
 * Duplicate City Guide URLs that should 301 to the page we keep.
 * The source row is left in the database; listings and the sitemap skip it.
 */
export const EXPLORE_SLUG_ALIASES: Record<string, string> = {
  "eksplorasi-sejarah-kota-lama-semarang": "kota-lama-semarang",
};

export function exploreAliasTarget(pathname: string): string | null {
  const path = normalizePathname(pathname);
  if (!path.startsWith("/explore/")) return null;
  const slug = path.slice("/explore/".length);
  const target = EXPLORE_SLUG_ALIASES[slug];
  return target ? `/explore/${target}` : null;
}

export function isRetiredExploreSlug(slug: string | null | undefined): boolean {
  const clean = (slug ?? "").trim().replace(/^\/+/, "");
  return Boolean(clean && Object.prototype.hasOwnProperty.call(EXPLORE_SLUG_ALIASES, clean));
}

export type LegacyKind = "explore-index" | "explore-slug" | "deluxe-ocean-view" | "explore-alias";

export function legacyKindForPath(pathname: string): LegacyKind | null {
  const path = normalizePathname(pathname);
  if (path === "/explore-semarang") return "explore-index";
  if (path.startsWith("/explore-semarang/")) return "explore-slug";
  if (path === "/rooms/deluxe-ocean-view") return "deluxe-ocean-view";
  if (exploreAliasTarget(path)) return "explore-alias";
  return null;
}

export function slugifyPlaceName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Exact slug, or a multi-word slug that is a whole token sequence inside the
 * place name ("goa-kreo" matches "Obyek Wisata Goa Kreo").
 */
export function placeSlugMatches(requestedSlug: string, placeName: string): boolean {
  const req = slugifyPlaceName(requestedSlug);
  const full = slugifyPlaceName(placeName);
  if (!req || !full) return false;
  if (req === full) return true;
  if (!req.includes("-")) return false;
  return full.endsWith(`-${req}`) || full.startsWith(`${req}-`) || full.includes(`-${req}-`);
}

export function resolveExploreLegacyTarget(
  requestedSlug: string,
  places: readonly ExplorePlaceRef[],
): string {
  const req = slugifyPlaceName(requestedSlug);
  if (!req) return "/explore";
  const catalog = places
    .map((place) => ({
      name: place.name,
      slug: (place.slug?.trim() || slugifyPlaceName(place.name)).replace(/^\/+/, ""),
    }))
    .filter((place) => place.slug);
  const exact = catalog.find((place) => place.slug === req);
  if (exact) return `/explore/${exact.slug}`;
  const matches = catalog.filter((place) => placeSlugMatches(req, place.name));
  if (matches.length === 0) return "/explore";
  matches.sort((a, b) => a.slug.length - b.slug.length);
  return `/explore/${matches[0].slug}`;
}

/** Current Deluxe room page. "Grand Deluxe" must not win. */
export function resolveDeluxeRoomPath(
  rooms: readonly { name?: string | null; slug?: string | null; is_published?: boolean | null }[],
): string {
  const exact = rooms.find((room) => {
    if (room.is_published === false) return false;
    const name = (room.name ?? "").trim().toLowerCase();
    const slug = (room.slug ?? "").trim().toLowerCase();
    if (!slug) return false;
    if (name.includes("grand") || slug.includes("grand")) return false;
    return slug === "deluxe" || name === "deluxe" || name === "kamar deluxe";
  });
  if (exact?.slug) return `/rooms/${exact.slug.trim()}`;
  return DELUXE_OCEAN_VIEW_FALLBACK;
}

export function buildSeoRedirect(input: SeoRedirectInput): SeoRedirect | null {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return null;
  }
  const rawPath = url.pathname || "/";
  const pathname = normalizePathname(rawPath);
  if (isApiPath(rawPath) || isApiPath(pathname)) return null;

  const hasTrailingSlash = rawPath.length > 1 && rawPath.endsWith("/");
  const kind = legacyKindForPath(pathname);
  const canonicalizeHost = shouldCanonicalizeHost(url);
  if (!kind && !canonicalizeHost && !hasTrailingSlash) return null;

  let path = pathname;
  if (kind === "explore-index") path = "/explore";
  else if (kind === "explore-alias") path = exploreAliasTarget(pathname) ?? "/explore";
  else if (kind === "explore-slug") {
    const slug = pathname.slice("/explore-semarang/".length);
    path = resolveExploreLegacyTarget(slug, input.explorePlaces ?? []);
  } else if (kind === "deluxe-ocean-view") {
    path = input.deluxeRoomPath?.trim() || DELUXE_OCEAN_VIEW_FALLBACK;
  }

  const search = url.search;
  const onProduction = isProductionHost(url.hostname);
  const location = onProduction
    ? `${canonicalUrlForPath(path)}${search}`
    : kind
      ? `${path}${search}`
      : hasTrailingSlash
        ? `${url.origin}${pathname}${search}`
        : null;
  if (!location) return null;

  const current = `${url.origin}${rawPath}${search}`;
  if (location === url.href || location === current || location === `${rawPath}${search}`) return null;

  const reason = [
    canonicalizeHost ? "host-canonical" : null,
    hasTrailingSlash ? "trailing-slash" : null,
    kind ? "legacy-url" : null,
  ]
    .filter(Boolean)
    .join("+");
  return { location, reason };
}
