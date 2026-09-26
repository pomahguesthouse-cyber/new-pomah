/**
 * /explore/$slug — one published City Guide place.
 * Unknown slugs 404. Equivalent legacy slugs 301 to the canonical slug.
 */
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { PublicFooter, PublicNav } from "@/public/components/public-shell";
import { findCityGuidePlace, type CityGuidePlace } from "@/public/lib/city-guide";
import { canonicalHeadTags } from "@/public/lib/public-seo";
import { slugifyPlaceName } from "@/public/lib/seo-redirects";

const CATEGORY_LABEL: Record<CityGuidePlace["category"], string> = {
  destinasi: "Destinasi",
  kuliner: "Kuliner",
  event: "Event",
  berita: "Berita",
  tips: "Tips",
};

function categoryLabel(category: CityGuidePlace["category"]): string {
  return CATEGORY_LABEL[category];
}

function displayImageUrl(url: string | null): string {
  if (!url) return "";
  if (!url.includes("maps.googleapis.com/maps/api/place/photo")) return url;
  try {
    const photoReference = new URL(url).searchParams.get("photo_reference");
    if (photoReference)
      return `/api/place-photo?photo_reference=${encodeURIComponent(photoReference)}`;
  } catch {
    /* keep the original url */
  }
  return url;
}

export const Route = createFileRoute("/explore/$slug")({
  loader: async ({ params }) => {
    const { loadCityGuidePlaces } = await import("@/public/lib/city-guide.server");
    const places = await loadCityGuidePlaces();
    const place = findCityGuidePlace(places, params.slug);
    if (!place) throw notFound();
    if (place.slug !== slugifyPlaceName(params.slug)) {
      throw redirect({
        to: "/explore/$slug",
        params: { slug: place.slug },
        statusCode: 301,
      });
    }
    return { place };
  },
  head: ({ loaderData }) => {
    const place = loaderData?.place;
    if (!place) {
      return {
        meta: [
          { title: "Tidak ditemukan | Pomah Guesthouse" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${place.name} | Jelajahi Semarang`;
    const description =
      place.description || `${place.name} di Semarang. Panduan tamu Pomah Guesthouse.`;
    const canonical = canonicalHeadTags(`/explore/${place.slug}`);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        ...(place.imageUrl ? [{ property: "og:image", content: place.imageUrl }] : []),
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: ExplorePlacePage,
});

function ExplorePlacePage() {
  const { place } = Route.useLoaderData();
  const image = displayImageUrl(place.imageUrl);
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav showBackHome />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          <Link to="/explore" className="hover:underline">
            Jelajahi Semarang
          </Link>
          <span className="mx-2 text-stone-300">/</span>
          {categoryLabel(place.category)}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-950">{place.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-600">
          {place.rating && (
            <span className="inline-flex items-center gap-1 font-semibold text-stone-800">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {place.rating}
            </span>
          )}
          {place.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4 text-emerald-600" />
              {place.location}
            </span>
          )}
          {place.dateText && <span>{place.dateText}</span>}
        </div>
        {image && (
          <img
            src={image}
            alt={place.name}
            className="mt-6 aspect-[16/9] w-full rounded-2xl border border-stone-200 object-cover"
          />
        )}
        {place.description && (
          <p className="mt-6 text-base leading-relaxed text-stone-700">{place.description}</p>
        )}
        <Link
          to="/explore"
          className="mt-8 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          ← Semua panduan Semarang
        </Link>
      </main>
      <PublicFooter />
    </div>
  );
}
