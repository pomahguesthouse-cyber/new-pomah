import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { collectSitemapPaths } from "@/public/lib/public-seo";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const [{ data: pages }, { data: roomTypes }] = await Promise.all([
          supabasePublic.from("seo_pages").select("slug, updated_at"),
          supabasePublic.from("room_types").select("slug"),
        ]);
        const urls = collectSitemapPaths({
          pageSlugs: (pages ?? []).map((p) => p.slug),
          roomSlugs: (roomTypes ?? []).map((r) => r.slug),
        });
        const lastmod = new Date().toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
          ...urls,
        ]
          .map((u) => {
            const cleanPath = u.startsWith("/") ? u : `/${u}`;
            // Avoid double slash if path is just "/"
            const locUrl = cleanPath === "/" ? origin : `${origin}${cleanPath}`;
            return `  <url><loc>${locUrl}</loc><lastmod>${lastmod}</lastmod></url>`;
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
