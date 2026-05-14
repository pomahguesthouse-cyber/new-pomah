import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

/**
 * Client-side redirect guard:
 *   - admin.* + "/"             → /admin
 *   - public host + "/admin/*"  → /
 *   - developer hosts (lovable preview, localhost): no redirects
 *
 * Also flips <meta name="robots"> to "noindex" on admin hosts so search
 * engines don't index the dashboard if they happen to crawl it.
 */
export function useHostGuard() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const path = window.location.pathname;

    // SEO: noindex on admin host
    if (isAdminHost(host)) {
      let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = "robots";
        document.head.appendChild(tag);
      }
      tag.content = "noindex, nofollow";
    }

    if (isDeveloperHost(host)) return;

    if (isAdminHost(host)) {
      if (path === "/" || path === "") {
        router.navigate({ to: "/admin" });
      }
    } else {
      if (path.startsWith("/admin")) {
        router.navigate({ to: "/" });
      }
    }
  }, [router]);
}
