/**
 * Same-origin return paths for staff sign-in.
 *
 * Google OAuth leaves the page and comes back through the Lovable broker.
 * `next` must stay a relative path on this origin — never an open redirect.
 */

export const AUTH_NEXT_STORAGE_KEY = "pomah.auth-next";
export const ADMIN_ASSIGN_STORAGE_KEY = "pomah.admin-assign";
export const STAFF_SESSION_HINT_COOKIE = "pomah_staff";
const STAFF_HINT_MAX_AGE = 60 * 60 * 24 * 14;

let fullPageRedirectStarted = false;

/** Allow another full-page redirect after the login screen is shown again. */
export function resetFullPageRedirectGuard(): void {
  fullPageRedirectStarted = false;
}

/** Relative path only: starts with a single "/", no scheme, no backslash tricks. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const value = next.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\") || value.includes("://")) return null;
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.startsWith("/\\") ||
      decoded.includes("\\") ||
      decoded.includes("://")
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

function pathOnly(path: string): string {
  return path.split("?")[0]?.split("#")[0] ?? path;
}

function isLoginPath(path: string): boolean {
  const only = pathOnly(path);
  return only === "/login" || only === "/login/";
}

export function isAdminPath(path: string): boolean {
  const only = pathOnly(path);
  return only === "/admin" || only.startsWith("/admin/");
}

/** Where to send a signed-in staff user. `/login` as next would loop. */
export function loginDestination(next: string | null | undefined): string {
  const safe = safeNext(next);
  if (!safe || isLoginPath(safe)) return "/admin";
  return safe;
}

/**
 * OAuth return URL. The broker is asked to come back to the login page with
 * `next` preserved, so a session established there can continue to /admin.
 */
export function loginReturnUrl(origin: string, next: string | null | undefined): string {
  const url = new URL("/login", origin);
  url.searchParams.set("next", loginDestination(next));
  return url.toString();
}

/** Implicit-grant hash or a long PKCE `code`. Short unrelated query values are ignored. */
export function isOAuthReturnLocation(search: string, hash: string): boolean {
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (hashParams.get("access_token") || hashParams.get("refresh_token")) return true;
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const code = query.get("code");
  return !!code && /^[A-Za-z0-9._-]{20,}$/.test(code);
}

export function isOAuthErrorLocation(search: string, hash: string): boolean {
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (hashParams.get("error") || hashParams.get("error_description")) return true;
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return query.has("error") || query.has("error_description");
}

/**
 * Homepage recovery: only leave `/` when this tab started staff sign-in
 * or the URL is an OAuth callback. A normal visit while already signed in stays put.
 */
export function resolveAuthReturnTarget(input: {
  next: string | null | undefined;
  remembered: string | null | undefined;
  oauthReturn: boolean;
  hasSession: boolean;
}): string | null {
  if (!input.hasSession) return null;
  const next = safeNext(input.next) ?? safeNext(input.remembered);
  if (next && !isLoginPath(next)) return next;
  if (input.oauthReturn || safeNext(input.remembered)) return "/admin";
  return null;
}

export function staffHintFromCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => {
    const [name, ...rest] = part.trim().split("=");
    return name === STAFF_SESSION_HINT_COOKIE && rest.join("=") === "1";
  });
}

export function rememberAuthNext(path: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, loginDestination(path));
  } catch {
    /* private mode */
  }
}

export function readAuthNext(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return safeNext(sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearAuthNext(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAdminAssignFlag(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(ADMIN_ASSIGN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Lets SSR see that this browser just signed in, without putting the JWT in a cookie. */
export function markStaffSessionHint(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${STAFF_SESSION_HINT_COOKIE}=1; Path=/; Max-Age=${STAFF_HINT_MAX_AGE}; SameSite=Lax${secure}`;
}

export function clearStaffSessionHint(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${STAFF_SESSION_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Full document load so a stale tab picks up the new hashed chunks.
 * If /admin's SSR gate bounces back to /login (hint cookie missing), the
 * second pass uses `onAdminBounce` — that document is already a fresh load.
 */
export function beginFullPageRedirect(target: string, onAdminBounce?: () => void): void {
  if (fullPageRedirectStarted) {
    console.info("[auth] full-page redirect skipped, already started ->", target);
    return;
  }
  fullPageRedirectStarted = true;
  clearAuthNext();
  if (isAdminPath(target)) {
    try {
      if (sessionStorage.getItem(ADMIN_ASSIGN_STORAGE_KEY) === "1") {
        sessionStorage.removeItem(ADMIN_ASSIGN_STORAGE_KEY);
        if (onAdminBounce) {
          console.info("[auth] /admin bounced once, client navigate ->", target);
          onAdminBounce();
          return;
        }
      } else {
        sessionStorage.setItem(ADMIN_ASSIGN_STORAGE_KEY, "1");
      }
    } catch {
      /* assign anyway */
    }
  }
  console.info("[auth] full-page redirect ->", target);
  window.location.assign(target);
}
