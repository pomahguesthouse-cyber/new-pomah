/**
 * Webhook token verification.
 *
 * Accepts the token via:
 *   - `Authorization: Bearer <token>` header, OR
 *   - `?token=<token>` query param
 *
 * If WPP_WEBHOOK_TOKEN is not set, all requests are accepted
 * (useful for local development). Legacy FONNTE_WEBHOOK_TOKEN masih
 * dibaca sebagai fallback selama transisi env di Cloudflare.
 *
 * IMPORTANT — soft mode by design.
 * The caller in src/routes/api.fonnte.ts has historically chosen to log
 * "token mismatch — processing anyway" and continue, because Wpp's
 * webhook setting can drop the token (account migration, dashboard
 * reset, MD upgrade) and we'd rather risk a noisy log than silently
 * drop every guest message. Returning a boolean keeps that policy
 * decision in the caller. Do NOT throw a Response from here — a prior
 * hardening attempt did, and it took the bot offline by short-circuiting
 * the caller's "process anyway" branch.
 */

function isWppTokenValid(request: Request): boolean {
  const expected = process.env.WPP_WEBHOOK_TOKEN ?? process.env.FONNTE_WEBHOOK_TOKEN;
  if (!expected) return true;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expected) {
    return true;
  }

  const url = new URL(request.url);
  return url.searchParams.get("token") === expected;
}

export function verifyWppToken(request: Request): boolean {
  if (isWppTokenValid(request)) return true;

  console.warn("[Webhook] Wpp token mismatch — caller decides whether to proceed");
  return false;
}
