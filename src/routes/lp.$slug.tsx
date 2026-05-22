/**
 * Public landing page route: /lp/[slug]
 * Serves SEO-optimised landing pages created in the AI SEO Control Room.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { getSeoLandingPageBySlug } from "@/admin/modules/seo/landing-page.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/lp/$slug")({
  head: ({ loaderData }) => {
    const p = loaderData?.page;
    if (!p) return {};
    return {
      meta: [
        { title: p.meta_title || p.title },
        { name: "description", content: p.meta_description || "" },
        { property: "og:title", content: p.meta_title || p.title },
        { property: "og:description", content: p.meta_description || "" },
        ...(p.og_image_url ? [{ property: "og:image", content: p.og_image_url }] : []),
      ],
    };
  },

  loader: async ({ params }) => {
    const result = await getSeoLandingPageBySlug({ data: { slug: params.slug } });
    if (!result.page) throw notFound();
    return result;
  },

  component: LandingPage,
});

function LandingPage() {
  const { page } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-teal-800 via-teal-700 to-stone-800 px-6 py-24 text-center text-white">
        <div className="mx-auto max-w-3xl">
          {page.target_keyword && (
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-teal-200">
              {page.target_keyword}
            </p>
          )}
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {page.hero_headline || page.title}
          </h1>
          {page.hero_subheadline && (
            <p className="mx-auto mt-6 max-w-xl text-lg text-teal-100">
              {page.hero_subheadline}
            </p>
          )}
          <a
            href={page.hero_cta_url}
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-teal-800 shadow-lg transition hover:bg-teal-50"
          >
            {page.hero_cta_text}
          </a>
        </div>
      </section>

      {/* Body */}
      {page.body_content && (
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div
            className="prose prose-stone prose-headings:font-bold prose-a:text-teal-700 max-w-none"
            dangerouslySetInnerHTML={{ __html: page.body_content }}
          />
        </section>
      )}

      {/* Footer CTA strip */}
      <section className="border-t border-stone-100 bg-stone-50 px-6 py-12 text-center">
        <p className="text-sm text-stone-500">Pomah Guesthouse — Gunungpati, Semarang</p>
        <a
          href={page.hero_cta_url}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-700 px-8 py-3 text-sm font-bold text-white shadow transition hover:bg-teal-800"
        >
          {page.hero_cta_text}
        </a>
      </section>
    </div>
  );
}
