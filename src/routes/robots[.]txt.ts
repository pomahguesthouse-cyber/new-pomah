import { createFileRoute } from "@tanstack/react-router";
import { isAdminHost } from "@/lib/host";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const host = url.host;

        const body = isAdminHost(host)
          ? `User-agent: *\nDisallow: /\n`
          : `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\n\nSitemap: ${url.origin}/sitemap.xml\n`;

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
