import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/admin/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  clearAdminAssignFlag,
  clearStaffSessionHint,
  markStaffSessionHint,
} from "@/lib/auth-return";
import { authErrorText, isInvalidSessionError, isTransientAuthError } from "@/lib/auth-storage";
import { checkSession, clearStaleStaffAuth } from "@/lib/staff-auth-cleanup";
import {
  LAYOUT_REUSE_MS,
  SESSION_TRUST_MS,
  markSessionValidated,
  resetSessionValidated,
  sessionValidatedWithin,
} from "@/lib/admin-session-trust";
import { isPbFixtureRequest } from "@/admin/modules/seo/builder-layout";

/**
 * beforeLoad runs on every /admin/* navigation. A full checkSession() calls the
 * auth server (getUser), which made each page switch wait on the network.
 * After one successful check we trust the local session for a few minutes
 * (SESSION_TRUST_MS, state in @/lib/admin-session-trust).
 * The first check, expired tokens, and sign-out still take the full path.
 *
 * supabase-js runs getSession() and getUser() under one lock, and every server
 * function call awaits getSession() first (auth-attacher). A second getUser()
 * fired by the layout right after beforeLoad's getUser() therefore queued the
 * dashboard's first requests behind one more auth round trip. When beforeLoad
 * validated the session moments ago (LAYOUT_REUSE_MS), the layout reuses that result.
 */

/** Warm the TCP+TLS connection to Supabase while the admin scripts download. */
function supabaseOriginLinks(): Array<{ rel: string; href: string; crossOrigin: "anonymous" }> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (typeof url !== "string" || !url.startsWith("https://")) return [];
  try {
    return [{ rel: "preconnect", href: new URL(url).origin, crossOrigin: "anonymous" }];
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/admin")({
  // The session lives in localStorage, so a server render cannot call getUser().
  // Gating the document on the pomah_staff cookie bounced a good sign-in back
  // to /login whenever that cookie was missing or stale. Render admin in the
  // browser and check the user there. Server functions still require a bearer token.
  ssr: false,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
    links: supabaseOriginLinks(),
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    // Local layout preview only. import.meta.env.DEV is false in production builds.
    if (isPbFixtureRequest()) return;
    if (sessionValidatedWithin(SESSION_TRUST_MS)) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) return;
      } catch {
        /* fall through to the full check */
      }
    }
    resetSessionValidated();
    const status = await checkSession("admin beforeLoad");
    if (status === "valid") {
      markSessionValidated();
      markStaffSessionHint();
      return;
    }
    if (status === "unavailable") {
      console.info("[auth] admin beforeLoad getUser unavailable, staying");
      return;
    }
    console.info("[auth] admin beforeLoad redirect to /login:", status);
    clearStaffSessionHint();
    throw redirect({ to: "/login", search: { next: undefined } });
  },
  component: AdminLayout,
});

/**
 * Layout wrapper for all /admin/* routes.
 *
 * The app runs on a single domain (pomahliving.com). Admin pages live
 * under the /admin/* path prefix and require authentication, which is
 * enforced in beforeLoad. Server-side authorization is handled by
 * Supabase RLS.
 */
function AdminLayout() {
  useEffect(() => {
    if (isPbFixtureRequest()) return;
    let cancelled = false;
    let decided = false;
    let leaveTimer: number | null = null;

    const cancelLeave = () => {
      if (leaveTimer == null) return;
      window.clearTimeout(leaveTimer);
      leaveTimer = null;
    };

    const keep = (reason: string) => {
      if (cancelled || decided) return;
      cancelLeave();
      decided = true;
      console.info("[auth] admin session kept:", reason);
      markStaffSessionHint();
      clearAdminAssignFlag();
    };

    const leave = (reason: string) => {
      if (cancelled || decided) return;
      decided = true;
      cancelLeave();
      console.info("[auth] admin redirect to /login:", reason);
      clearStaffSessionHint();
      clearAdminAssignFlag();
      window.location.assign("/login");
    };

    // A null INITIAL_SESSION can arrive before SIGNED_IN while the OAuth hash
    // is still being saved. Wait briefly so that session can cancel the bounce.
    const scheduleLeave = (reason: string) => {
      if (cancelled || decided || leaveTimer != null) return;
      leaveTimer = window.setTimeout(() => leave(reason), 1000);
    };

    const consider = (session: { access_token?: string } | null, reason: string) => {
      if (!session) {
        scheduleLeave(reason);
        return;
      }
      cancelLeave();
      if (
        (reason === "INITIAL_SESSION" || reason.startsWith("session check")) &&
        sessionValidatedWithin(LAYOUT_REUSE_MS)
      ) {
        keep(`${reason} (validated by beforeLoad)`);
        return;
      }
      void supabase.auth.getUser().then(({ data, error }) => {
        if (cancelled || decided) return;
        if (data.user && !isInvalidSessionError(error)) {
          keep(reason);
          return;
        }
        // getUser waits until the OAuth hash has been read. A network failure
        // is not a reason to bounce a session that was just established.
        if (isTransientAuthError(error)) {
          keep(`${reason} (getUser unavailable)`);
          return;
        }
        void clearStaleStaffAuth(`${reason}: ${authErrorText(error)}`).then(() => {
          if (cancelled || decided) return;
          leave(authErrorText(error));
        });
      });
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event !== "INITIAL_SESSION" &&
        event !== "SIGNED_IN" &&
        event !== "SIGNED_OUT" &&
        event !== "TOKEN_REFRESHED"
      ) {
        return;
      }
      window.setTimeout(() => {
        if (cancelled || decided) return;
        if (event === "SIGNED_OUT") {
          scheduleLeave("signed out");
          return;
        }
        consider(session, event);
      }, 0);
    });

    // beforeLoad usually awaits init, so INITIAL_SESSION has already fired
    // before this effect subscribes. A session here means we stay. An empty
    // read must not bounce — getSession() can still be null for a moment after
    // the OAuth hash is accepted, and SIGNED_IN arrives on the listener above.
    const backup = window.setTimeout(() => {
      if (cancelled || decided) return;
      void supabase.auth.getSession().then(({ data: sessionData }) => {
        if (cancelled || decided || !sessionData.session) return;
        consider(sessionData.session, "session check after auth init");
      });
    }, 0);

    return () => {
      cancelled = true;
      cancelLeave();
      window.clearTimeout(backup);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
