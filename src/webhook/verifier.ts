/**
 * Webhook token verification.
 *
 * Accepts the token via:
 *   - `Authorization: Bearer <token>` header, OR
 *   - `?token=<token>` query param
 *
 * If FONNTE_WEBHOOK_TOKEN is not set, all requests are accepted
 * (useful for local development).
 */

export function verifyFonnteToken(request: Request): boolean {
  const expected = process.env.FONNTE_WEBHOOK_TOKEN;
  if (!expected) return true;

  // Header-based
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expected) {
    return true;
  }

  // Query param-based
  const url = new URL(request.url);
  if (url.searchParams.get("token") === expected) {
    return true;
  }

  return false;
}
