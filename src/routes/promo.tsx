import { createFileRoute, Link } from "@tanstack/react-router";
import { PomahFooter } from "@/public/components/public-shell";
import { PromoSection } from "@/public/components/promo-section";
import { PROMO_TERMS_NOTE } from "@/public/content/promos";
import { canonicalHeadTags, publicSeoMeta } from "@/public/lib/public-seo";

export const PROMO_PATH = "/promo";

const PROMO_SEO = {
  title: "Promo Menginap | Pomah Guesthouse Semarang",
  description: `Promo hari kerja, paket wisuda, menginap tiga malam, tamu lama, dan upgrade kamar di Pomah Guesthouse Sampangan, Semarang. ${PROMO_TERMS_NOTE}`,
};

export const Route = createFileRoute("/promo")({
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => {
    const canonical = canonicalHeadTags(PROMO_PATH);
    return {
      meta: [
        ...publicSeoMeta(
          { title: PROMO_SEO.title, description: PROMO_SEO.description, robots: "index, follow" },
          PROMO_SEO,
        ),
        { property: "og:type", content: "website" },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: PromoPage,
});

function PromoPage() {
  const data = Route.useLoaderData() as {
    property?: { name?: string | null; whatsapp_number?: string | null } | null;
    roomTypes?: unknown[];
  };
  const name = data?.property?.name?.trim() || "Pomah Guesthouse";
  return (
    <div className="min-h-screen bg-[#f3ece0]">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="font-serif text-xl font-bold text-stone-900">{name}</Link>
          <Link to="/book" className="rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800">
            Pesan kamar
          </Link>
        </div>
      </header>
      <main>
        <nav aria-label="Breadcrumb" className="mx-auto max-w-6xl px-4 pt-8 text-sm text-stone-500 sm:px-6">
          <Link to="/" className="hover:text-amber-800">Beranda</Link> <span aria-hidden>›</span> <span>Promo</span>
        </nav>
        <PromoSection whatsappNumber={data?.property?.whatsapp_number} headingLevel="h1" />
      </main>
      <PomahFooter name={name} property={(data?.property as never) ?? null} rooms={(data?.roomTypes as never) ?? []} />
    </div>
  );
}
