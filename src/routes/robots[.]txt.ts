import { createFileRoute } from "@tanstack/react-router";
import { publicCacheHeaderRecord } from "@/public/lib/public-cache";
import { canonicalUrlForPath } from "@/public/lib/public-seo";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\nDisallow: /native-oauth-return\n\nSitemap: ${canonicalUrlForPath("/sitemap.xml")}\n`;

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...publicCacheHeaderRecord(),
          },
        });
      },
    },
  },
});
