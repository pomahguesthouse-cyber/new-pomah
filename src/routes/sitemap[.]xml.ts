import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { cityGuideSitemapUrls, renderSitemapXml, type SitemapUrl } from "@/public/lib/city-guide";
import { loadCityGuidePlaces } from "@/public/lib/city-guide.server";
import { canonicalUrlForPath, collectSitemapPaths } from "@/public/lib/public-seo";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [{ data: pages }, { data: roomTypes }, landingResult, places] = await Promise.all([
          supabasePublic.from("seo_pages").select("slug"),
          supabasePublic.from("room_types").select("slug").eq("is_published", true),
          supabasePublic.from("seo_landing_pages").select("slug").eq("published", true),
          loadCityGuidePlaces(),
        ]);
        const paths = collectSitemapPaths({
          pageSlugs: (pages ?? []).map((p) => p.slug),
          roomSlugs: (roomTypes ?? []).map((r) => r.slug),
          landingSlugs: landingResult.error ? [] : (landingResult.data ?? []).map((p) => p.slug),
        });
        const staticLastmod = new Date().toISOString();
        const entries: SitemapUrl[] = [
          ...paths.map((path) => ({ loc: canonicalUrlForPath(path), lastmod: staticLastmod })),
          ...cityGuideSitemapUrls(places),
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
