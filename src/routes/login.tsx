import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  beginFullPageRedirect,
  clearAuthNext,
  clearStaffSessionHint,
  loginDestination,
  loginReturnUrl,
  markStaffSessionHint,
  rememberAuthNext,
  resetFullPageRedirectGuard,
  safeNext,
} from "@/lib/auth-return";

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
  const navigate = useNavigate();
  const search = Route.useSearch();
  const nextPath = safeNext(search.next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  /**
   * Setelah login sukses — termasuk balik dari Google OAuth — hormati `next`
   * (path same-origin saja) dan fallback ke /admin. Full load supaya tab yang
   * masih memegang bundle lama tidak 404 pada chunk yang sudah tidak ada.
   */
  async function redirectAfterLogin() {
    const { data } = await supabase.auth.getSession();
    if (data.session) markStaffSessionHint();
    else clearStaffSessionHint();
    const target = loginDestination(nextPath);
    beginFullPageRedirect(target, () => {
      navigate({ to: "/admin" });
    });
  }

  useEffect(() => {
    resetFullPageRedirectGuard();
    let cancelled = false;
    const sendIfSignedIn = (hasSession: boolean) => {
      if (cancelled || !hasSession) return;
      redirectAfterLogin();
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) sendIfSignedIn(true);
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      sendIfSignedIn(!!session);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [navigate, nextPath]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await redirectAfterLogin();
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
    if (!result.redirected) redirectAfterLogin();
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

          <Button type="button" variant="outline" className="w-full" onClick={onGoogle}>
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

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
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
