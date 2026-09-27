import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { HOME_SEO } from "@/public/lib/public-seo";
import { siteIdentityGraph } from "@/public/lib/structured-data";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 text-center">
      {/* noindex — halaman ini tidak boleh terindeks mesin pencari */}
      <meta name="robots" content="noindex, follow" />
      <title>404 – Halaman Tidak Ditemukan | Pomah Guesthouse</title>

      {/* Angka 404 berlapis */}
      <div className="relative mb-4 select-none">
        <span className="block font-mono text-[120px] font-extrabold leading-none tracking-tighter text-stone-200">
          404
        </span>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-5xl font-extrabold tracking-tight text-amber-700">
          404
        </span>
      </div>

      <h1 className="text-2xl font-bold text-stone-800">Halaman Tidak Ditemukan</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-500">
        Maaf, halaman yang kamu cari tidak ada atau telah dipindahkan.
        Coba kembali ke beranda atau lihat pilihan kamar kami.
      </p>

      {/* Tombol navigasi */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50"
        >
          ← Kembali ke Beranda
        </Link>
        <Link
          to="/" hash="rooms"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800"
        >
          Lihat Kamar
        </Link>
      </div>

      {/* Divider dekoratif */}
      <div className="mt-12 flex items-center gap-4 text-stone-300">
        <span className="h-px w-16 bg-stone-200" />
        <span className="text-xs uppercase tracking-widest text-stone-400">Pomah Guesthouse</span>
        <span className="h-px w-16 bg-stone-200" />
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    try {
      const { getBranding } = await import("@/lib/branding.functions");
      return await getBranding();
    } catch {
      return { faviconUrl: null, logoUrl: null };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Fallback title only. Page routes set title, description, and Twitter
      // cards from saved SEO fields so this root copy cannot leak onto them.
      { title: HOME_SEO.title },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(loaderData?.faviconUrl
        ? [{ rel: "icon", href: loaderData.faviconUrl }]
        : []),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteIdentityGraph()) }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthSync() {
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // TOKEN_REFRESHED fires every jam pada auto-refresh — skip agar tidak reload.
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      // Saat sign-out: kosongkan cache & arahkan ke /login. JANGAN invalidate
      // (akan memicu refetch serverFn tanpa token -> 401 blank screen).
      if (event === "SIGNED_OUT") {
        qc.clear();
        router.navigate({ to: "/login", search: { next: undefined } });
        return;
      }
      router.invalidate();
      qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, qc]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSync />
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
