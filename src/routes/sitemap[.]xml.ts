import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminHost } from "@/lib/host";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        // Admin host: serve an empty sitemap (dashboard is not indexable).
        if (isAdminHost(url.host)) {
          const empty = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
          return new Response(empty, {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "public, max-age=3600",
            },
          });
        }
        const [{ data: pages }, { data: roomTypes }] = await Promise.all([
          supabaseAdmin.from("seo_pages").select("slug, updated_at"),
          supabaseAdmin.from("room_types").select("slug"),
        ]);
        const urls = new Set<string>(["/", "/rooms", "/book"]);
        for (const p of pages ?? []) urls.add(p.slug);
        for (const r of roomTypes ?? []) urls.add(`/rooms/${r.slug}`);
        const lastmod = new Date().toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...urls]
          .map(
            (u) =>
              `  <url><loc>${origin}${u}</loc><lastmod>${lastmod}</lastmod></url>`,
          )
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
