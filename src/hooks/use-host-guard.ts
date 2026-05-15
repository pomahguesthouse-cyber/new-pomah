import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

/**
 * Paths that only exist in the ADMIN domain (admin.pomahguesthouse.com).
 * Visiting these from the public domain redirects to "/".
 */
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

/**
 * Paths that only exist in the PUBLIC domain (pomahliving.com).
 * Visiting these from the admin domain redirects to "/".
 */
const PUBLIC_ONLY_PATHS = ["/book", "/rooms"];

/**
 * Client-side host-based routing guard — runs on every navigation.
 *
 * Rules (dev/preview hosts are exempt):
 *  - Admin host visiting a public-only path  → redirect to "/"
 *  - Public host visiting an admin-only path → redirect to "/"
 *
 * Shared paths ("/", "/login") are intentionally NOT listed in either
 * set: "/" bifurcates internally per host; "/login" is reachable from
 * both domains (public footer has a Staff Login link that cross-domain
 * redirects to admin after successful authentication).
 *
 * Note: this guard is client-side only — it runs after the initial render.
 * Server-side protection of admin data is handled by Supabase RLS.
 * The AdminLayout component (_admin.tsx) also runs its own host check to
 * prevent a flash of admin UI on the public domain.
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

    if (isAdminHost(host)) {
      // Admin domain: block public-only paths
      if (PUBLIC_ONLY_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
        router.navigate({ to: "/" });
      }
    } else {
      // Public domain: block admin-only paths
      if (
        path.startsWith("/admin") ||
        ADMIN_ONLY_PATHS.some((p) => path === p || path.startsWith(p + "/"))
      ) {
        router.navigate({ to: "/" });
      }
    }
  }, [router]);
}
