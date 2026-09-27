import { useEffect, useRef, useState } from "react";
import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  beginFullPageRedirect,
  clearAuthNext,
  loginDestination,
  loginReturnUrl,
  markStaffSessionHint,
  rememberAuthNext,
  resetFullPageRedirectGuard,
  safeNext,
} from "@/lib/auth-return";
import { oauthReturnLocation, wasOAuthReturnOnLoad } from "@/public/components/staff-oauth-return";
import { checkSession } from "@/lib/staff-auth-cleanup";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Staff sign in — Pomah Guesthouse" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const nextPath = safeNext(search.next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const fallbackTimer = useRef<number | null>(null);

  const goClient = (target: string) => {
    console.info("[auth] client navigate ->", target);
    router.history.push(target);
  };

  const armLoginFallback = (target: string) => {
    if (fallbackTimer.current != null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = window.setTimeout(() => {
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/login/") return;
      console.info("[auth] still on /login 3s after redirect, client fallback ->", target);
      toast("You're signed in", {
        description: (
          <a href="/admin" className="underline">
            Open admin
          </a>
        ),
        duration: 20000,
      });
      goClient(target);
    }, 3000);
  };

  /**
   * After a real sign-in, honor `next` (same-origin only) and otherwise go to
   * /admin. A stored session that getUser() rejects is wiped first so the form
   * stays put instead of looping. Full page load so a tab holding old hashed
   * chunks does not 404.
   */
  async function redirectAfterLogin(reason: string) {
    const oauthReturn =
      wasOAuthReturnOnLoad() && oauthReturnLocation.pathname === window.location.pathname;
    const status = await checkSession(oauthReturn ? `${reason} (oauth return)` : reason);
    if (status !== "valid") {
      if (status !== "anonymous") console.info("[auth] not leaving /login:", reason, status);
      return;
    }
    markStaffSessionHint();
    const target = loginDestination(nextPath);
    console.info("[auth] redirect after sign-in:", reason, "->", target);
    beginFullPageRedirect(target, () => goClient(target));
    armLoginFallback(target);
  }

  useEffect(() => {
    resetFullPageRedirectGuard();
    let cancelled = false;

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      if (!session) return;
      window.setTimeout(() => {
        if (!cancelled)
          void redirectAfterLogin(event === "SIGNED_IN" ? "signed in" : "initial session");
      }, 0);
    });

    const mountTimer = window.setTimeout(() => {
      if (cancelled) return;
      void redirectAfterLogin("login mount").finally(() => {
        if (!cancelled) setReady(true);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(mountTimer);
      data.subscription.unsubscribe();
    };
  }, [nextPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: loginReturnUrl(window.location.origin, nextPath),
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await redirectAfterLogin(mode === "signup" ? "sign up" : "password sign-in");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const onGoogle = async () => {
    const next = loginDestination(nextPath);
    rememberAuthNext(next);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: loginReturnUrl(window.location.origin, next),
      extraParams: { prompt: "select_account" },
    });
    if (result.error) {
      clearAuthNext();
      toast.error(result.error.message);
      return;
    }
    // Popup / preview flows set the session in-page instead of leaving.
    if (!result.redirected) void redirectAfterLogin("google in-page");
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden border-r border-border bg-card p-12 md:flex md:flex-col md:justify-between">
        <Link to="/" className="font-mono text-sm font-semibold">
          POMAH<span className="text-accent">.</span>
        </Link>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Staff
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">The ledger.</h1>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            Sign in to manage bookings, rooms, and the WhatsApp inbox — with the AI front office on
            standby.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Curated Ledger
        </p>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {mode === "signin" ? "Sign in" : "Create staff account"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin" ? "Welcome back." : "An admin will grant you access after signup."}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onGoogle}
            disabled={!ready || pending}
          >
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">or with email</span>
            </div>
          </div>

          {mode === "signup" && (
            <div className="grid gap-2">
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Password</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={!ready || pending}>
            {!ready ? "…" : pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
