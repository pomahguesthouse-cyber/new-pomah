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

/**
 * The Lovable OAuth broker sometimes returns to `/` and drops `redirect_uri`'s
 * path and query. If this tab started on the staff login page, continue to /admin
 * once the session exists (hash tokens or `?code=`).
 */
export function StaffOAuthReturn() {
  useEffect(() => {
    if (window.location.pathname !== "/") return;

    resetFullPageRedirectGuard();
    let cancelled = false;
    const search = window.location.search;
    const hash = window.location.hash;
    const oauthReturn = isOAuthReturnLocation(search, hash);
    const remembered = readAuthNext();
    if (!oauthReturn && !remembered) return;

    const go = (hasSession: boolean) => {
      if (cancelled || !hasSession) return;
      const target = resolveAuthReturnTarget({
        next: null,
        remembered: readAuthNext(),
        oauthReturn,
        hasSession: true,
      });
      if (!target) return;
      markStaffSessionHint();
      beginFullPageRedirect(target);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        go(true);
        return;
      }
      if (isOAuthErrorLocation(search, hash)) clearAuthNext();
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      go(!!session);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
