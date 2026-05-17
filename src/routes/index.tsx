/**
 * Public homepage (`/`).
 *
 * The homepage is data-driven: it renders through the visual editor's
 * `PageRenderer`. A published landing page with slug `home` (edited in
 * /admin/pages) takes precedence; otherwise the built-in `HOME_TEMPLATE`
 * is used as a safe fallback. A floating WhatsApp button is layered on
 * top from live property data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";
import { getPublicSiteData, getPublishedLandingPage } from "@/public/functions/public.functions";
import { PageRenderer } from "@/admin/modules/builder/renderer";
import { HOME_SLUG, HOME_TEMPLATE } from "@/admin/modules/builder/home-template";

export const Route = createFileRoute("/")({
  loader: async () => {
    const res = await getPublishedLandingPage({ data: { slug: HOME_SLUG } });
    return { homePage: res.page as { published_content?: unknown } | null };
  },
  head: () => ({
    meta: [
      { title: "Pomah Guesthouse Semarang | Hotel Murah & Nyaman di Semarang" },
      {
        name: "description",
        content:
          "Pomah Guesthouse — penginapan murah dan nyaman di Kota Semarang. Kamar bersih, pelayanan ramah, lokasi strategis.",
      },
      { property: "og:title", content: "Pomah Guesthouse Semarang" },
      { property: "og:description", content: "Penginapan murah & nyaman di Kota Semarang." },
    ],
  }),
  component: PomahHome,
});

function PomahHome() {
  const { homePage } = Route.useLoaderData();
  const content = homePage?.published_content ?? HOME_TEMPLATE;

  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const wa = data?.property?.whatsapp_number?.replace(/\D/g, "") ?? "";

  return (
    <div className="min-h-screen">
      <PageRenderer content={content} />

      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hubungi via WhatsApp"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}
    </div>
  );
}
