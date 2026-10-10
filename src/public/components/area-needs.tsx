import { Link } from "@tanstack/react-router";
import type { IndexableLandingLink } from "@/public/lib/lp-dynamic";

/** Homepage list of published, indexable landing pages. Hidden when empty. */
export function AreaNeedsSection({ pages }: { pages: readonly IndexableLandingLink[] }) {
  if (pages.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6" aria-label="Area dan kebutuhan">
      <h2 className="font-serif text-2xl font-semibold text-stone-900 sm:text-3xl">Area & kebutuhan</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Halaman yang disusun untuk kebutuhan tamu tertentu.
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pages.map((page) => (
          <li key={page.slug} className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
            <Link
              to="/lp/$slug"
              params={{ slug: page.slug }}
              className="break-words text-base font-semibold text-stone-900 underline"
            >
              {page.title}
            </Link>
            {page.keyword ? <p className="mt-1 break-words text-sm text-stone-600">{page.keyword}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
