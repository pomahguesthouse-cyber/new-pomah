/**
 * Public href cleanup. `/rooms` (no slug) 404s — send "Kamar" links to the
 * homepage room list instead of inventing a listing page.
 */
export function rewritePublicHref(href: string | null | undefined): string {
  const raw = (href ?? "").trim();
  if (!raw) return "/";
  if (raw === "/rooms" || raw === "/rooms/") return "/#rooms";
  return raw;
}

/** Bare `/rooms` is not a page. Everything else is left alone. */
export function isBareRoomsHref(href: string | null | undefined): boolean {
  const raw = (href ?? "").trim();
  return raw === "/rooms" || raw === "/rooms/";
}
