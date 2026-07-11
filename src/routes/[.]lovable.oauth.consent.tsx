import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Wrapper tipe minimal untuk namespace `supabase.auth.oauth` (masih beta di SDK).
type OAuthDetails = {
  client?: { name?: string | null; redirect_uris?: string[] | null } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };
type SupabaseAuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
const oauth = (supabase.auth as unknown as { oauth: SupabaseAuthOAuth }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Hanya browser: session Supabase disimpan di localStorage, tidak tersedia saat SSR.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) {
      throw new Error("Parameter authorization_id tidak ditemukan.");
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // Simpan URL consent sebagai relative path agar user kembali ke sini setelah login.
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id") ?? "";
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
    }
    return data;
  },
  component: ConsentPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Tidak dapat memuat permintaan otorisasi</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function ConsentPage() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "Aplikasi eksternal";
  const scopes = (details?.scope ?? "").split(/\s+/).filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Server otorisasi tidak mengembalikan URL redirect.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Hubungkan {clientName} ke akun Anda
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Aplikasi ini akan dapat memanggil tools Pomah Guesthouse yang aktif sebagai Anda.
        </p>

        <div className="mt-6 space-y-2 text-sm">
          <p className="font-medium">Izin yang diminta</p>
          <ul className="list-inside list-disc text-muted-foreground">
            <li>Membaca profil dasar Anda</li>
            <li>Memanggil tools MCP Pomah Guesthouse atas nama Anda</li>
            {scopes
              .filter((s: string) => !["openid", "email", "profile"].includes(s))
              .map((s: string) => (
                <li key={s}>Izin tambahan: {s}</li>
              ))}
          </ul>
          <p className="pt-2 text-xs text-muted-foreground">
            Izin backend & kebijakan data aplikasi tetap berlaku.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => decide(true)}
          >
            {busy ? "…" : "Setujui"}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Batal
          </Button>
        </div>
      </div>
    </main>
  );
}
