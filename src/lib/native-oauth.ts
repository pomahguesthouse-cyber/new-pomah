/**
 * Google sign-in for the Capacitor shell.
 *
 * Google rejects OAuth inside an Android WebView. The app opens the Lovable
 * broker in Chrome Custom Tabs. That tab returns to /native-oauth-return on
 * the website, which bounces the session tokens to the pomahadmin:// scheme
 * the WebView is allowed to receive.
 */

export const NATIVE_OAUTH_SCHEME = "pomahadmin";
export const NATIVE_OAUTH_HOST = "oauth-callback";
export const NATIVE_OAUTH_STATE_KEY = "pomah.native-oauth-state";
export const NATIVE_OAUTH_RETURN_PATH = "/native-oauth-return";

export function buildNativeOAuthRedirectUri(origin: string): string {
  return new URL(NATIVE_OAUTH_RETURN_PATH, origin).toString();
}

export function buildOAuthBrokerUrl(input: {
  origin: string;
  state: string;
  redirectUri: string;
  provider?: "google";
}): string {
  const url = new URL("/~oauth/initiate", input.origin);
  url.searchParams.set("provider", input.provider ?? "google");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type NativeOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  state: string | null;
};

export type NativeOAuthCallback =
  | { ok: true; tokens: NativeOAuthTokens }
  | { ok: false; error: string };

/** Returns null when the URL is not our custom-scheme callback. */
export function parseNativeOAuthCallback(rawUrl: string): NativeOAuthCallback | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${NATIVE_OAUTH_SCHEME}:` || url.hostname !== NATIVE_OAUTH_HOST) {
    return null;
  }
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const pick = (key: string) => url.searchParams.get(key) || hash.get(key);
  const error = pick("error");
  if (error) return { ok: false, error: pick("error_description") || error };
  const accessToken = pick("access_token");
  const refreshToken = pick("refresh_token");
  if (!accessToken || !refreshToken) {
    return { ok: false, error: "Sign-in did not return a session." };
  }
  return {
    ok: true,
    tokens: { accessToken, refreshToken, state: pick("state") },
  };
}

export function buildCustomSchemeCallback(input: {
  accessToken: string;
  refreshToken: string;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}): string {
  const url = new URL(`${NATIVE_OAUTH_SCHEME}://${NATIVE_OAUTH_HOST}`);
  if (input.error) {
    url.searchParams.set("error", input.error);
    if (input.errorDescription) url.searchParams.set("error_description", input.errorDescription);
    if (input.state) url.searchParams.set("state", input.state);
    return url.toString();
  }
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("refresh_token", input.refreshToken);
  if (input.state) url.searchParams.set("state", input.state);
  return url.toString();
}

export function readOAuthParams(
  search: string,
  hash: string,
): {
  accessToken: string | null;
  refreshToken: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
  code: string | null;
} {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const pick = (key: string) => query.get(key) || fragment.get(key);
  return {
    accessToken: pick("access_token"),
    refreshToken: pick("refresh_token"),
    state: pick("state"),
    error: pick("error"),
    errorDescription: pick("error_description"),
    code: pick("code"),
  };
}
