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

function isFonnteTokenValid(request: Request): boolean {
  const expected = process.env.FONNTE_WEBHOOK_TOKEN;
  if (!expected) return true;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expected) {
    return true;
  }

  const url = new URL(request.url);
  return url.searchParams.get("token") === expected;
}

export function verifyFonnteToken(request: Request): boolean {
  if (isFonnteTokenValid(request)) return true;

  console.warn("[Webhook] Unauthorized Fonnte webhook request blocked");
  throw new Response("Unauthorized", { status: 403 });
}
