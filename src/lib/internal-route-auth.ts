const AUTH_HEADER_RE = /^Bearer\s+/i;

type TokenRow = { fonnte_token?: string | null } | null;
type TokenDb = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => {
        maybeSingle: () => Promise<{ data: TokenRow; error?: { message?: string } | null }>;
      };
    };
  };
};

export function getInternalRouteSecret(): string | undefined {
  return process.env.INTERNAL_ROUTE_SECRET || process.env.CRON_SECRET || process.env.FONNTE_WEBHOOK_TOKEN;
}

export function getProvidedInternalRouteToken(request: Request): string | undefined {
  const url = new URL(request.url);
  return (
    url.searchParams.get("token") ||
    request.headers.get("Authorization")?.replace(AUTH_HEADER_RE, "") ||
    request.headers.get("x-cron-secret") ||
    undefined
  );
}

export function isInternalRouteAuthorized(request: Request): boolean {
  const secret = getInternalRouteSecret();
  const providedToken = getProvidedInternalRouteToken(request);
  return !!secret && !!providedToken && providedToken === secret;
}

export async function isInternalRouteAuthorizedWithDbToken(
  request: Request,
  db: TokenDb,
): Promise<boolean> {
  if (isInternalRouteAuthorized(request)) return true;

  const providedToken = getProvidedInternalRouteToken(request);
  if (!providedToken) return false;

  const { data } = await db
    .from("properties")
    .select("fonnte_token")
    .limit(1)
    .maybeSingle();

  const dbToken = data?.fonnte_token?.trim();
  return !!dbToken && providedToken === dbToken;
}

export function unauthorizedInternalRouteResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
