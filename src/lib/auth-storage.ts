/**
 * Pure checks for leftover Supabase auth storage.
 * supabase-js keeps the session under `sb-<project-ref>-auth-token`.
 * An older project, or a refresh token the server no longer accepts, must not
 * count as signed in.
 */

const INVALID_SESSION_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "invalid_jwt",
  "user_not_found",
  "user_banned",
]);

export function projectRefFromSupabaseUrl(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    if (!ref || ref === "localhost") return null;
    return ref;
  } catch {
    return null;
  }
}

/** Default storage key supabase-js derives from the project URL. */
export function currentSupabaseAuthStorageKey(
  supabaseUrl: string | null | undefined,
): string | null {
  const ref = projectRefFromSupabaseUrl(supabaseUrl);
  if (!ref) return null;
  return `sb-${ref}-auth-token`;
}

export function isSupabaseAuthStorageKey(key: string): boolean {
  if (key.startsWith("sb-")) return true;
  const lower = key.toLowerCase();
  return lower.includes("supabase") && lower.includes("auth");
}

export function isCurrentAuthStorageKey(key: string, currentKey: string | null): boolean {
  if (!currentKey) return false;
  return key === currentKey || key.startsWith(`${currentKey}-`);
}

/** Keys to drop. `dropCurrent` also removes this project's session and PKCE verifier. */
export function authStorageKeysToRemove(
  keys: readonly string[],
  options: { currentKey: string | null; dropCurrent: boolean },
): string[] {
  return keys.filter((key) => {
    if (!isSupabaseAuthStorageKey(key)) return false;
    if (isCurrentAuthStorageKey(key, options.currentKey)) return options.dropCurrent;
    return true;
  });
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const part = accessToken.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = globalThis.atob(padded);
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function accessTokenProjectRef(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  if (typeof payload.ref === "string" && payload.ref) return payload.ref;
  if (typeof payload.iss === "string") {
    const match = payload.iss.match(/^https:\/\/([^.]+)\.supabase\.co(?:\/|$)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * True when the token names a different Supabase project than this app.
 * Custom domains are skipped: their hostname is not the project ref, and a
 * mismatch would wipe a valid session. getUser() still rejects those tokens.
 */
export function isForeignProjectAccessToken(
  accessToken: string | null | undefined,
  supabaseUrl: string | null | undefined,
): boolean {
  if (!supabaseUrl) return false;
  try {
    if (!new URL(supabaseUrl).hostname.endsWith(".supabase.co")) return false;
  } catch {
    return false;
  }
  const tokenRef = accessTokenProjectRef(accessToken);
  const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (!tokenRef || !projectRef) return false;
  return tokenRef !== projectRef;
}

export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; name?: unknown; status?: unknown };
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  if (name.includes("retryable")) return true;
  if (record.status === 0) return true;
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("aborted")
  );
}

/**
 * Rejected refresh token, expired/foreign JWT, or a session the auth server
 * no longer has. Network failures are not stale — those must keep the session.
 */
export function isInvalidSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (isTransientAuthError(error)) return false;
  const record = error as { message?: unknown; code?: unknown };
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  if (INVALID_SESSION_CODES.has(code)) return true;
  if (message.includes("refresh token")) return true;
  if (
    message.includes("invalid jwt") ||
    message.includes("jwt expired") ||
    message.includes("malformed jwt")
  ) {
    return true;
  }
  if (message.includes("invalid claim")) return true;
  if (message.includes("signature verification failed")) return true;
  if (message.includes("does not exist") && message.includes("user")) return true;
  if (
    message.includes("session") &&
    (message.includes("expired") || message.includes("not found") || message.includes("invalid"))
  ) {
    return true;
  }
  return false;
}

export function authErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "auth error";
}
