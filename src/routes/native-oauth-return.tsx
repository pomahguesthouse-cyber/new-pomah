import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { buildCustomSchemeCallback, readOAuthParams } from "@/lib/native-oauth";

export const Route = createFileRoute("/native-oauth-return")({
  head: () => ({
    meta: [{ title: "Pomah Admin sign-in" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: NativeOAuthReturnPage,
});

/**
 * Loaded inside Chrome Custom Tabs after Google sign-in, not inside the
 * WebView. Forwards the session to pomahadmin://oauth-callback so the app
 * can store it. Tokens are not rendered.
 */
function NativeOAuthReturnPage() {
  const [message, setMessage] = useState("Mengembalikan ke Pomah Admin…");

  useEffect(() => {
    let cancelled = false;
    const go = (target: string) => {
      if (cancelled) return;
      window.location.replace(target);
    };

    const immediateParams = readOAuthParams(window.location.search, window.location.hash);
    if (immediateParams.error) {
      go(
        buildCustomSchemeCallback({
          accessToken: "",
          refreshToken: "",
          state: immediateParams.state,
          error: immediateParams.error,
          errorDescription: immediateParams.errorDescription,
        }),
      );
      return;
    }
    if (immediateParams.accessToken && immediateParams.refreshToken) {
      go(
        buildCustomSchemeCallback({
          accessToken: immediateParams.accessToken,
          refreshToken: immediateParams.refreshToken,
          state: immediateParams.state,
        }),
      );
      return;
    }

    const params = readOAuthParams(window.location.search, window.location.hash);
    if (params.code && !params.accessToken) {
      setMessage("Menyelesaikan masuk…");
    }

    const finishFromSession = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.access_token || !session.refresh_token) return false;
      go(
        buildCustomSchemeCallback({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          state: params.state,
        }),
      );
      return true;
    };

    void finishFromSession().then((done) => {
      if (done || cancelled) return;
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      if (!session) return;
      window.setTimeout(() => {
        void finishFromSession();
      }, 0);
    });

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setMessage(
        "Tidak bisa kembali ke aplikasi. Tutup jendela ini dan coba lagi dari Pomah Admin.",
      );
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1b3f3f] px-6 text-center text-[#f6f3ee]">
      <p className="max-w-sm text-sm">{message}</p>
    </div>
  );
}
