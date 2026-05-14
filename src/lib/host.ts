/**
 * Host-based routing helpers.
 *
 * Two domains point at this single project:
 *   - pomahguesthouse.com        → public site (/, /rooms, /book, /login)
 *   - admin.pomahguesthouse.com  → admin dashboard (/admin/*)
 *
 * Lovable preview domains (*.lovable.app) and localhost are treated as
 * "developer" hosts where every route is reachable.
 */

export function isAdminHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return h.startsWith("admin.");
}

export function isDeveloperHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const h = host.toLowerCase().split(":")[0];
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovableproject.com")
  );
}
