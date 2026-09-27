/**
 * Cache-Control for public HTML documents.
 *
 * Browser and edge caches may reuse the SSR document. Admin, login, API,
 * and booking confirmations stay uncached because they are private or
 * one-off. The HTML itself is still rendered on the origin, so crawlers
 * that miss the cache see the same SEO markup.
 */

const PUBLIC_DOCUMENT = [
  /^\/$/,
  /^\/book$/,
  /^\/connect$/,
  /^\/explore$/,
  /^\/explore\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^\/rooms\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /^\/lp\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
];

export const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=60, s-maxage=120, stale-while-revalidate=300";

export function publicHtmlCacheControl(input: {
  method: string;
  pathname: string;
  status: number;
  contentType: string | null;
  setCookie?: string | null;
}): string | null {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  if (input.status !== 200) return null;
  if (!(input.contentType ?? "").toLowerCase().includes("text/html")) return null;
  if (input.setCookie && /auth|sb-access-token|sb-refresh-token/i.test(input.setCookie)) return null;
  const path =
    input.pathname.length > 1 ? input.pathname.replace(/\/+$/, "") : input.pathname || "/";
  if (!PUBLIC_DOCUMENT.some((pattern) => pattern.test(path))) return null;
  return PUBLIC_HTML_CACHE_CONTROL;
}
