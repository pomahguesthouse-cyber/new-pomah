const AUTH_HEADER_RE = /^Bearer\s+/i;

export function getInternalRouteSecret(): string | undefined {
  return process.env.INTERNAL_ROUTE_SECRET || process.env.CRON_SECRET || process.env.FONNTE_WEBHOOK_TOKEN;
}

export function isInternalRouteAuthorized(request: Request): boolean {
  const secret = getInternalRouteSecret();
  if (!secret) return false;

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");
  const authHeader = request.headers.get("Authorization")?.replace(AUTH_HEADER_RE, "");
  const cronHeader = request.headers.get("x-cron-secret");

  return tokenParam === secret || authHeader === secret || cronHeader === secret;
}

export function unauthorizedInternalRouteResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
