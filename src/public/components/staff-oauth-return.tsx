import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  beginFullPageRedirect,
  clearAuthNext,
  isOAuthErrorLocation,
  isOAuthReturnLocation,
  markStaffSessionHint,
  readAuthNext,
  resetFullPageRedirectGuard,
  resolveAuthReturnTarget,
} from "@/lib/auth-return";
import { checkSession } from "@/lib/staff-auth-cleanup";

function captureOAuthLocation(): { pathname: string; search: string; hash: string } {
  if (typeof window === "undefined") {
    return { pathname: "", search: "", hash: "" };
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

/**
 * Captured when this module is first evaluated, before supabase-js (initialized
 * later, including by the consent route's top-level `supabase.auth` access)
 * strips the OAuth hash. A useEffect read is too late — the URL is already clean.
 */
export const oauthReturnLocation = captureOAuthLocation();

export function wasOAuthReturnOnLoad(): boolean {
  return isOAuthReturnLocation(oauthReturnLocation.search, oauthReturnLocation.hash);
}

/**
 * The Lovable OAuth broker sometimes returns to `/` and drops `redirect_uri`'s
 * path and query. If this tab started on the staff login page, continue to /admin
 * once a session the auth server still accepts exists.
 */
export function StaffOAuthReturn() {
  useEffect(() => {
    const { pathname, search, hash } = oauthReturnLocation;
    if (pathname !== "/") return;

    resetFullPageRedirectGuard();
    let cancelled = false;
    const oauthReturn = isOAuthReturnLocation(search, hash);
    const remembered = readAuthNext();
    if (!oauthReturn && !remembered) return;

    const go = (reason: string) => {
      void (async () => {
        if (cancelled) return;
        const status = await checkSession(reason);
        if (cancelled || status !== "valid") {
          if (!cancelled && status !== "anonymous") {
            console.info("[auth] oauth return not redirecting:", reason, status);
          }
          if (!cancelled && status === "anonymous" && isOAuthErrorLocation(search, hash)) {
            clearAuthNext();
          }
          return;
        }
        const target = resolveAuthReturnTarget({
          next: null,
          remembered: readAuthNext(),
          oauthReturn,
          hasSession: true,
        });
        if (!target) return;
        markStaffSessionHint();
        console.info("[auth] oauth return redirect:", reason, "->", target);
        beginFullPageRedirect(target);
      })();
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session || oauthReturn) go("homepage session");
      else if (isOAuthErrorLocation(search, hash)) clearAuthNext();
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      if (!session) return;
      // Don't call getUser inside the auth callback — that deadlocks the client lock.
      window.setTimeout(() => go(`homepage ${event}`), 0);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
