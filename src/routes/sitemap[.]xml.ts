import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { cityGuideSitemapUrls, renderSitemapXml, type SitemapUrl } from "@/public/lib/city-guide";
import { CITY_GUIDE_ARTICLES } from "@/public/content/approved-seo";
import { loadCityGuidePlaces } from "@/public/lib/city-guide.server";
import { canonicalUrlForPath, collectSitemapPaths, sitemapLastmodForPath } from "@/public/lib/public-seo";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [{ data: pages }, { data: roomTypes }, landingResult, propertyResult, places] =
          await Promise.all([
            supabasePublic.from("seo_pages").select("slug, updated_at"),
            supabasePublic.from("room_types").select("slug, updated_at").eq("is_published", true),
            supabasePublic.from("seo_landing_pages").select("slug, updated_at").eq("published", true),
            supabasePublic.rpc("get_public_property" as never),
            loadCityGuidePlaces(),
          ]);
        const landings = landingResult.error ? [] : (landingResult.data ?? []);
        const paths = collectSitemapPaths({
          pageSlugs: (pages ?? []).map((p) => p.slug),
          roomSlugs: (roomTypes ?? []).map((r) => r.slug),
          landingSlugs: landings.map((p) => p.slug),
        });
        const propertyUpdatedAt = (propertyResult.data as { updated_at?: string | null } | null)
          ?.updated_at;
        const stamps = {
          propertyUpdatedAt,
          rooms: roomTypes ?? [],
          landings,
          pages: pages ?? [],
        };
        const guideEntries = cityGuideSitemapUrls(places);
        const guideLocs = new Set(guideEntries.map((entry) => entry.loc));
        for (const article of CITY_GUIDE_ARTICLES) {
          const loc = canonicalUrlForPath(`/explore/${article.canonicalSlug}`);
          if (!guideLocs.has(loc)) guideEntries.push({ loc });
        }
        const entries: SitemapUrl[] = [
          ...paths.map((path) => ({
            loc: canonicalUrlForPath(path),
            lastmod: sitemapLastmodForPath(path, stamps),
          })),
          ...guideEntries,
        ];
        const xml = renderSitemapXml(entries);
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
