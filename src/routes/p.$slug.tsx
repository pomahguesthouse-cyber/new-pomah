/**
 * /p/$slug — public render route for published landing pages.
 *
 * Fetches the published document in a loader (so SEO meta is available
 * for SSR) and renders it through the shared builder renderer — the
 * exact same components shown in the editor canvas.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { getPublishedLandingPage } from "@/public/functions/public.functions";
import { PageRenderer } from "@/admin/modules/builder/renderer";
import type { PageContent } from "@/admin/modules/builder/types";

interface PublishedPage {
  title: string;
  slug: string;
  published_content: PageContent | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  noindex: boolean;
}

export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params }) => {
    const res = await getPublishedLandingPage({ data: { slug: params.slug } });
    if (!res.page) throw notFound();
    return { page: res.page as PublishedPage };
  },
  head: ({ loaderData }) => {
    const page = loaderData?.page;
    if (!page) return {};
    const title = page.seo_title || page.title;
    const meta: { name?: string; property?: string; content: string }[] = [
      { name: "description", content: page.seo_description ?? "" },
      { property: "og:title", content: title },
      { property: "og:description", content: page.seo_description ?? "" },
    ];
    if (page.og_image_url) meta.push({ property: "og:image", content: page.og_image_url });
    if (page.noindex) meta.push({ name: "robots", content: "noindex, nofollow" });
    return { meta: [{ title }, ...meta] };
  },
  component: PublicLandingPage,
});

function PublicLandingPage() {
  const { page } = Route.useLoaderData();
  const content: PageContent = page.published_content ?? { version: 1, nodes: [] };

  return (
    <div className="min-h-screen bg-white">
      <PageRenderer content={content} />
    </div>
  );
}
