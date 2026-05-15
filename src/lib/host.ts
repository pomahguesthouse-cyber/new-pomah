/**
 * Host-based routing helpers.
 *
 * Two domains point at this single project:
 *   - pomahliving.com           → public site (/, /rooms, /book, /login)
 *   - admin.pomahguesthouse.com → admin dashboard (/bookings, /calendar, /settings, …)
 *
 * Lovable preview domains (*.lovable.app) and localhost are treated as
 * "developer" hosts where every route is reachable without redirection.
 */

/** The production public domain (guests). */
export const PUBLIC_DOMAIN = "pomahliving.com";

/** The production admin domain (staff). */
export const ADMIN_DOMAIN = "admin.pomahguesthouse.com";

/** Return true when `host` is the admin dashboard domain. */
export function isAdminHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  // Exact match for the known admin domain, OR any "admin.*" subdomain for
  // dev/staging environments (e.g. admin.localhost, admin.preview.xxx).
  return h === ADMIN_DOMAIN || h.startsWith("admin.");
}

/** Return true for developer / preview hosts that bypass domain routing. */
export function isDeveloperHost(host: string | null | undefined): boolean {
  if (!host) return true; // SSR with no Host header → unrestricted
  const h = host.toLowerCase().split(":")[0];
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovableproject.com")
  );
}

/**
 * Build the full URL for the admin domain.
 * Preserves the current path/query when called from a redirect context.
 */
export function adminUrl(path = "/"): string {
  return `https://${ADMIN_DOMAIN}${path}`;
}

/**
 * Build the full URL for the public domain.
 */
export function publicUrl(path = "/"): string {
  return `https://${PUBLIC_DOMAIN}${path}`;
}
