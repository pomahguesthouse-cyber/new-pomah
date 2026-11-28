/**
 * Cache headers for anonymous public GET documents.
 *
 * Browsers revalidate immediately (`max-age=0`). Shared caches may keep the
 * document for 5 minutes. `s-maxage` implies `proxy-revalidate`, which makes
 * Cloudflare ignore `stale-while-revalidate` on Cache-Control, so the edge
 * headers below carry the same 5-minute TTL without `s-maxage` and allow a
 * stale copy for a day while the origin revalidates.
 *
 * Prices in a cached document can be about 5 minutes behind. Admin, API,
 * booking, auth, and any response that sets a cookie stay uncached.
 */

export const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

/** CDN TTL. No `s-maxage`, so stale-while-revalidate stays in effect. */
export const PUBLIC_CDN_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";

export const PRIVATE_NO_STORE = "private, no-store";

const CDN_HEADER_NAMES = ["CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"] as const;

const SENSITIVE_SEARCH_KEYS = new Set([
  "preview",
  "builder",
  "token",
  "code",
  "access_token",
  "refresh_token",
]);

/** Cloudflare sets these on anonymous visitors. They are not a user session. */
const INFRASTRUCTURE_COOKIES = new Set(["__cf_bm", "cf_clearance", "__cflb", "_cfuvid"]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type PublicCacheInput = {
  method: string;
  pathname: string;
  search?: string;
  status: number;
  contentType: string | null;
  setCookie?: string | null;
  cookie?: string | null;
  authorization?: string | null;
};

export type PublicCacheMode = "public" | "private" | "skip";

export function publicCacheHeaderRecord(): Record<string, string> {
  return {
    "Cache-Control": PUBLIC_HTML_CACHE_CONTROL,
    "CDN-Cache-Control": PUBLIC_CDN_CACHE_CONTROL,
    "Cloudflare-CDN-Cache-Control": PUBLIC_CDN_CACHE_CONTROL,
  };
}

export function privateNoStoreHeaderRecord(): Record<string, string> {
  return { "Cache-Control": PRIVATE_NO_STORE };
}

export function normalizePublicPath(pathname: string): string {
  let path = pathname || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    return "/__invalid__";
  }
  if (path.includes("\\") || path.includes("\0")) return "/__invalid__";
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return "/__invalid__";
    parts.push(part);
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function isPublicCachePath(pathname: string): boolean {
  const path = normalizePublicPath(pathname);
  if (path === "/" || path === "/rooms" || path === "/explore" || path === "/promo") return true;
  if (path === "/sitemap.xml" || path === "/robots.txt") return true;
  const rooms = /^\/rooms\/([^/]+)$/.exec(path);
  if (rooms) return SLUG.test(rooms[1]);
  const explore = /^\/explore\/([^/]+)$/.exec(path);
  if (explore) return SLUG.test(explore[1]);
  const lp = /^\/lp\/([^/]+)$/.exec(path);
  if (lp) return SLUG.test(lp[1]);
  return false;
}

export function searchIsSensitive(search: string | undefined | null): boolean {
  if (!search) return false;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return false;
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) {
    if (SENSITIVE_SEARCH_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

export function searchRecordIsSensitive(search: unknown): boolean {
  if (!search || typeof search !== "object") return false;
  for (const [key, value] of Object.entries(search as Record<string, unknown>)) {
    if (!SENSITIVE_SEARCH_KEYS.has(key.toLowerCase())) continue;
    if (value == null || value === "") continue;
    return true;
  }
  return false;
}

/** True when the request carries a cookie other than Cloudflare's bot cookies. */
export function hasPersonalizedCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const name = part.split("=", 1)[0]?.trim();
    if (!name) continue;
    if (INFRASTRUCTURE_COOKIES.has(name)) continue;
    return true;
  }
  return false;
}

function contentTypeMatches(pathname: string, contentType: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (!type) return false;
  const path = normalizePublicPath(pathname);
  if (path === "/sitemap.xml") return type.includes("xml");
  if (path === "/robots.txt") return type.includes("text/plain");
  return type.includes("text/html");
}

/**
 * `public` — anonymous document, safe for a shared cache.
 * `private` — a public URL that must not be stored (cookie, error, preview).
 * `skip` — not one of our documents; leave the response headers alone.
 */
export function publicCacheMode(input: PublicCacheInput): PublicCacheMode {
  const method = input.method.toUpperCase();
  if (!isPublicCachePath(input.pathname)) return "skip";
  if (method !== "GET" && method !== "HEAD") return "private";
  if (input.status !== 200) return "private";
  if (!contentTypeMatches(input.pathname, input.contentType)) return "private";
  if (input.setCookie) return "private";
  if (hasPersonalizedCookie(input.cookie)) return "private";
  if (input.authorization) return "private";
  if (searchIsSensitive(input.search)) return "private";
  return "public";
}

export function publicHtmlCacheControl(input: PublicCacheInput): string | null {
  return publicCacheMode(input) === "public" ? PUBLIC_HTML_CACHE_CONTROL : null;
}

export function headerRecordForMode(mode: PublicCacheMode): Record<string, string> | null {
  if (mode === "public") return publicCacheHeaderRecord();
  if (mode === "private") return privateNoStoreHeaderRecord();
  return null;
}

export function cdnHeaderNames(): readonly string[] {
  return CDN_HEADER_NAMES;
}
