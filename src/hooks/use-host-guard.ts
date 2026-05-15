import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

const ADMIN_ONLY_PATHS = [
  "/calendar",
  "/bookings",
  "/pricing",
  "/whatsapp",
  "/ai",
  "/training",
  "/analytics",
  "/seo",
  "/settings",
];

const PUBLIC_ONLY_PATHS = ["/book"];

/**
 * Client-side redirect guard:
 *   - admin host visiting public-only paths   → /
 *   - public host visiting admin-only paths   → /
 *   - developer hosts (lovable preview, localhost): no redirects
 *
 * "/" and "/rooms" are shared and host-switch internally.
 */
export function useHostGuard() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const path = window.location.pathname;

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
      if (PUBLIC_ONLY_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        router.navigate({ to: "/" });
      }
    } else {
      if (
        path.startsWith("/admin") ||
        ADMIN_ONLY_PATHS.some((p) => path === p || path.startsWith(p + "/"))
      ) {
        router.navigate({ to: "/" });
      }
    }
  }, [router]);
}
