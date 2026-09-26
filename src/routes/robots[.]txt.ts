import { createFileRoute } from "@tanstack/react-router";
import { canonicalUrlForPath } from "@/public/lib/public-seo";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\n\nSitemap: ${canonicalUrlForPath("/sitemap.xml")}\n`;

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
