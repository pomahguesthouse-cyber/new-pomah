import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

/**
 * Paths that are admin-only when accessed via DIRECT route (e.g., /bookings on admin.pomahguesthouse.com).
 * These paths are now ALSO accessible via /admin/* prefix from ANY domain.
 * This array is only used for blocking direct access from non-admin domains.
 */
const LEGACY_ADMIN_PATHS = [
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

/**
 * Paths that only exist in the PUBLIC domain (pomahliving.com).
 * Visiting these from the admin domain redirects to "/".
 */
const PUBLIC_ONLY_PATHS = ["/book", "/rooms"];

/**
 * Client-side host-based routing guard — runs on every navigation.
 *
 * Rules (dev/preview hosts are exempt):
 *  - /admin/* paths are accessible from ANY domain (path-based routing)
 *  - Admin host visiting a public-only path  → redirect to "/"
 *  - Public host visiting legacy admin paths (e.g., /bookings) → redirect to "/"
 *
 * Shared paths ("/", "/login") are accessible from both domains.
 *
 * Note: this guard is client-side only — it runs after the initial render.
 * Server-side protection of admin data is handled by Supabase RLS.
 */
export function useHostGuard() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const path = window.location.pathname;

    // Add noindex to all admin-host pages so they don't get indexed
    if (isAdminHost(host)) {
      let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = "robots";
        document.head.appendChild(tag);
      }
      tag.content = "noindex, nofollow";
    }

    // Developer/preview hosts: no restrictions
    if (isDeveloperHost(host)) return;

    // /admin/* paths are accessible from ANY domain (path-based routing)
    if (path.startsWith("/admin")) return;

    if (isAdminHost(host)) {
      // Admin domain: block public-only paths
      if (PUBLIC_ONLY_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        router.navigate({ to: "/" });
      }
    } else {
      // Public domain: block legacy admin paths (direct access, not /admin/*)
      if (LEGACY_ADMIN_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        router.navigate({ to: "/" });
      }
    }
  }, [router]);
}
