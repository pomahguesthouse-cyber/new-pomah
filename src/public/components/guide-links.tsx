/**
 * Crawlable City Guide links. Cards and this list use real <a href>
 * so Google can discover /explore/<slug> without executing onClick.
 */
import { cityGuideArticleForSlug } from "@/public/content/approved-seo";
import { isRetiredExploreSlug, slugifyPlaceName } from "@/public/lib/seo-redirects";

export const LP_PENGINAPAN_DEKAT_UNNES = "/lp/penginapan-dekat-unnes";

/** Pages that had zero inlinks in the 27 Sep 2026 audit. Always linked. */
export const ORPHAN_GUIDE_LINKS: Array<{ href: string; label: string }> = [
  { href: "/explore/gedongsongo-festival", label: "Gedongsongo Festival" },
  {
    href: "/explore/lawang-sewu-short-film-festival-loff-2026",
    label: "Lawang Sewu Short Film Festival (LOFF) 2026",
  },
  {
    href: "/explore/rute-bus-trans-semarang-baru-resmi-dibuka",
    label: "Rute Bus Trans Semarang",
  },
  { href: LP_PENGINAPAN_DEKAT_UNNES, label: "Penginapan dekat UNNES" },
];

export type GuideLinkPlace = { slug: string; name: string; category?: string | null };

export function exploreHrefForSlug(slug: string | null | undefined): string | null {
  const clean = (slug ?? "").trim().replace(/^\/+/, "");
  if (!clean || clean.includes("/")) return null;
  return `/explore/${clean}`;
}

export function exploreHrefForName(name: string | null | undefined): string | null {
  const article = cityGuideArticleForSlug(name);
  if (article) return exploreHrefForSlug(article.canonicalSlug);
  const slug = slugifyPlaceName(name ?? "");
  return exploreHrefForSlug(slug);
}

/**
 * Homepage /explore text links: a handful of catalog places, then the
 * previously orphaned URLs, without repeating the same href.
 */
export function buildGuideTextLinks(
  places: readonly GuideLinkPlace[] | null | undefined,
  limit = 8,
): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (href: string, label: string) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ href, label });
  };
  for (const place of places ?? []) {
    const href = exploreHrefForSlug(place.slug);
    if (!href || isRetiredExploreSlug(place.slug)) continue;
    push(href, place.name);
    if (out.length >= limit) break;
  }
  for (const link of ORPHAN_GUIDE_LINKS) push(link.href, link.label);
  return out;
}

export function GuideTextLinks({
  places,
  heading = "Panduan Semarang",
}: {
  places?: readonly GuideLinkPlace[] | null;
  heading?: string;
}) {
  const links = buildGuideTextLinks(places);
  if (links.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-6 py-12" aria-label={heading}>
      <h2 className="font-serif text-2xl font-semibold text-stone-900">{heading}</h2>
      <p className="mt-2 max-w-2xl text-sm text-stone-500">
        Destinasi, kuliner, dan event di Semarang untuk tamu Pomah Guesthouse.
      </p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="inline-flex rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:border-amber-600 hover:text-amber-800"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FALLBACK_STAY_ROOMS: Array<{ name: string; slug: string }> = [
  { name: "Family Suite 100", slug: "family-suite-100" },
  { name: "Family Room 222", slug: "family-room-222" },
  { name: "Kamar Deluxe", slug: "deluxe" },
];

export function StayNearby({
  rooms,
}: {
  rooms?: Array<{ name?: string | null; slug?: string | null }> | null;
}) {
  const live = (rooms ?? [])
    .map((room) => ({
      name: (room.name ?? "").trim(),
      slug: (room.slug ?? "").trim(),
    }))
    .filter((room) => room.name && room.slug && !room.slug.includes("/"));
  const picks = (live.length > 0 ? live : FALLBACK_STAY_ROOMS).slice(0, 3);
  return (
    <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-bold text-stone-900">Menginap dekat sini</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Setelah berkunjung, menginap di Pomah Guesthouse, Sampangan, Semarang.
      </p>
      <ul className="mt-4 space-y-2 text-sm font-semibold">
        <li>
          <a href="/" className="text-emerald-800 hover:underline">
            Pomah Guesthouse
          </a>
        </li>
        {picks.map((room) => (
          <li key={room.slug}>
            <a href={`/rooms/${room.slug}`} className="text-emerald-800 hover:underline">
              {room.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
