/**
 * Landing-page slug renames. Pure so tests can prove chains collapse and
 * loops are refused before any database call.
 *
 * A missing `seo_slug_redirects` table must not throw: callers treat a
 * schema error as "no redirects yet".
 */

export type SlugRedirectRow = { from_slug: string; to_slug: string };

const MAX_HOPS = 8;

export function normalizeLandingSlug(slug: string | null | undefined): string {
  return (slug ?? "").trim().toLowerCase();
}

/** `/lp/some-slug` → `some-slug`. Trailing slash is ignored. Other paths return null. */
export function landingSlugFromPath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = /^\/lp\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path);
  return match?.[1] ?? null;
}

export function isMissingSchemaError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toUpperCase();
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the") ||
    message.includes("undefined column") ||
    message.includes("undefined table")
  );
}

function redirectMap(rows: readonly SlugRedirectRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const from = normalizeLandingSlug(row.from_slug);
    const to = normalizeLandingSlug(row.to_slug);
    if (!from || !to || from === to) continue;
    map.set(from, to);
  }
  return map;
}

/**
 * Follow from → to until a slug that is not itself a source.
 * A cycle or a chain longer than MAX_HOPS returns null so the request is
 * not sent into a loop.
 */
export function resolveLandingSlugRedirect(
  requested: string,
  rows: readonly SlugRedirectRow[],
): string | null {
  const map = redirectMap(rows);
  let current = normalizeLandingSlug(requested);
  if (!map.has(current)) return null;
  const seen = new Set<string>([current]);
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = map.get(current);
    if (!next || next === current) return null;
    if (seen.has(next)) return null;
    if (!map.has(next)) return next;
    seen.add(next);
    current = next;
  }
  return null;
}

/**
 * Record old → new and retarget anything that still pointed at old, so
 * A→B plus a rename B→C becomes A→C and B→C (one hop). The live slug is
 * never left as a redirect source.
 */
export function planSlugRedirectUpdates(
  existing: readonly SlugRedirectRow[],
  oldSlug: string,
  newSlug: string,
): { upserts: SlugRedirectRow[]; deletes: string[] } {
  const from = normalizeLandingSlug(oldSlug);
  const to = normalizeLandingSlug(newSlug);
  if (!from || !to || from === to) return { upserts: [], deletes: [] };

  const map = redirectMap(existing);
  for (const [source, target] of [...map.entries()]) {
    if (target === from) map.set(source, to);
  }
  map.delete(to);
  map.set(from, to);
  for (const [source, target] of [...map.entries()]) {
    if (source === target) map.delete(source);
  }

  const rows = [...map.entries()].map(([from_slug, to_slug]) => ({ from_slug, to_slug }));
  if (!resolveLandingSlugRedirect(from, rows)) map.delete(from);

  const previous = new Map(
    existing.map((row) => [normalizeLandingSlug(row.from_slug), normalizeLandingSlug(row.to_slug)]),
  );
  const deletes: string[] = [];
  for (const source of previous.keys()) {
    if (source && !map.has(source)) deletes.push(source);
  }
  const upserts: SlugRedirectRow[] = [];
  for (const [source, target] of map) {
    if (previous.get(source) !== target) upserts.push({ from_slug: source, to_slug: target });
  }
  return { upserts, deletes };
}
