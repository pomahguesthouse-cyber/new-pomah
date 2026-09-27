/**
 * /explore/$slug — one published City Guide place.
 * Unknown slugs 404. Equivalent legacy slugs 301 to the canonical slug.
 */
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { PublicFooter, PublicNav } from "@/public/components/public-shell";
import { StayNearby } from "@/public/components/guide-links";
import { CityGuideArticleBody } from "@/public/components/city-guide-article";
import { cityGuideArticleForSlug, type CityGuideArticle } from "@/public/content/approved-seo";
import { cityGuideGraph } from "@/public/lib/structured-data";
import { cityGuideMetaContent, findCityGuidePlace, type CityGuidePlace } from "@/public/lib/city-guide";
import { buildStorageImageUrl } from "@/lib/storage-image";
import { canonicalHeadTags, preferredOgImage } from "@/public/lib/public-seo";
import { exploreAliasTarget, slugifyPlaceName } from "@/public/lib/seo-redirects";

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
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    const alias = exploreAliasTarget(`/explore/${params.slug}`);
    if (alias) {
      throw redirect({
        to: "/explore/$slug",
        params: { slug: alias.replace(/^\/explore\//, "") },
        statusCode: 301,
      });
    }
    const [places, site] = await Promise.all([loadCityGuidePlaces(), getPublicSiteData()]);
    const requested = slugifyPlaceName(params.slug);
    const article = cityGuideArticleForSlug(requested);
    if (article && requested !== article.canonicalSlug) {
      throw redirect({
        to: "/explore/$slug",
        params: { slug: article.canonicalSlug },
        statusCode: 301,
      });
    }
    const catalog = article
      ? places.find((item) => item.slug === article.canonicalSlug) ??
        places.find((item) => cityGuideArticleForSlug(item.name)?.canonicalSlug === article.canonicalSlug) ??
        findCityGuidePlace(places, requested)
      : findCityGuidePlace(places, params.slug);
    if (article) {
      const place: CityGuidePlace = {
        slug: article.canonicalSlug,
        name: catalog?.name ?? article.names[0],
        description: article.cardIntro,
        metaDescription: article.meta,
        imageUrl: catalog?.imageUrl ?? null,
        category: catalog?.category ?? "destinasi",
        location: catalog?.location ?? null,
        rating: catalog?.rating ?? null,
        dateText: catalog?.dateText ?? null,
        updatedAt: catalog?.updatedAt ?? null,
        createdAt: catalog?.createdAt ?? null,
      };
      return { place, article, rooms: site.roomTypes ?? [] };
    }
    if (!catalog) throw notFound();
    if (catalog.slug !== requested) {
      throw redirect({
        to: "/explore/$slug",
        params: { slug: catalog.slug },
        statusCode: 301,
      });
    }
    return { place: catalog, article: null as CityGuideArticle | null, rooms: site.roomTypes ?? [] };
  },
  head: ({ loaderData }) => {
    const place = loaderData?.place;
    const article = loaderData?.article;
    if (!place) {
      return {
        meta: [
          { title: "Tidak ditemukan | Pomah Guesthouse" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = article?.title || `${place.name} | Jelajahi Semarang`;
    const description = article?.meta || cityGuideMetaContent(place);
    const canonical = canonicalHeadTags(`/explore/${article?.canonicalSlug || place.slug}`);
    const ogImage = preferredOgImage(place.imageUrl);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        ...(ogImage
          ? [{ property: "og:image", content: buildStorageImageUrl(ogImage, { width: 1200, quality: 60 }) }]
          : []),
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: ExplorePlacePage,
});

function ExplorePlacePage() {
  const { place, article, rooms } = Route.useLoaderData();
  const image = displayImageUrl(place.imageUrl);
  const heading = article?.h1 || place.name;
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav showBackHome />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            cityGuideGraph({
              ...place,
              slug: article?.canonicalSlug || place.slug,
              name: article?.names[0] || place.name,
              description: article?.meta || place.description,
            }),
          ),
        }}
      />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          <Link to="/explore" className="hover:underline">
            Jelajahi Semarang
          </Link>
          <span className="mx-2 text-stone-300">/</span>
          {categoryLabel(place.category)}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-950">{heading}</h1>
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
            alt={heading}
            className="mt-6 aspect-[16/9] w-full rounded-2xl border border-stone-200 object-cover"
          />
        )}
        {article ? (
          <CityGuideArticleBody article={article} />
        ) : (
          place.description && (
            <p className="mt-6 text-base leading-relaxed text-stone-700">{place.description}</p>
          )
        )}
        <StayNearby rooms={rooms} />
        <Link
          to="/explore"
          className="mt-8 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          ← Semua panduan Semarang
        </Link>
      </main>
      <PublicFooter rooms={rooms} />
    </div>
  );
}
