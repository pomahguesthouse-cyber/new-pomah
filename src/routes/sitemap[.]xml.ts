import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { canonicalUrlForPath, collectSitemapPaths } from "@/public/lib/public-seo";

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [{ data: pages }, { data: roomTypes }, landingResult] = await Promise.all([
          supabasePublic.from("seo_pages").select("slug"),
          supabasePublic.from("room_types").select("slug").eq("is_published", true),
          supabasePublic.from("seo_landing_pages").select("slug").eq("published", true),
        ]);
        const urls = collectSitemapPaths({
          pageSlugs: (pages ?? []).map((p) => p.slug),
          roomSlugs: (roomTypes ?? []).map((r) => r.slug),
          landingSlugs: landingResult.error ? [] : (landingResult.data ?? []).map((p) => p.slug),
        });
        const lastmod = new Date().toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => {
            const locUrl = canonicalUrlForPath(u);
            return `  <url><loc>${xmlEscape(locUrl)}</loc><lastmod>${lastmod}</lastmod></url>`;
          })
          .join("\n")}\n</urlset>`;
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
