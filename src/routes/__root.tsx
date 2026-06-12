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
import appCss from "../styles.css?url";

const pomahStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pomahguesthouse.com/#organization",
      name: "Pomah Guesthouse",
      url: "https://pomahguesthouse.com",
      logo: "https://gofvxeiulaljwyfyhnww.supabase.co/storage/v1/object/public/room-images/branding/1779972746377-83dfkm.png",
      email: "info@pomahguesthouse.com",
      telephone: "+6281227271799",
    },
    {
      "@type": "WebSite",
      "@id": "https://pomahguesthouse.com/#website",
      url: "https://pomahguesthouse.com",
      name: "Pomah Guesthouse",
      publisher: {
        "@id": "https://pomahguesthouse.com/#organization",
      },
    },
    {
      "@type": "LodgingBusiness",
      "@id": "https://pomahguesthouse.com/#lodging",
      name: "Pomah Guesthouse",
      description:
        "Guesthouse nyaman di Semarang dekat Universitas Diponegoro (UNDIP), Universitas Negeri Semarang (UNNES), Simpang Lima, dan pusat kota. Cocok untuk keluarga, wisatawan, maupun perjalanan bisnis.",
      url: "https://pomahguesthouse.com",
      image:
        "https://gofvxeiulaljwyfyhnww.supabase.co/storage/v1/object/public/room-images/branding/1779972746377-83dfkm.png",
      telephone: "+6281227271799",
      email: "info@pomahguesthouse.com",
      priceRange: "IDR 180000 - 500000",
      checkinTime: "14:00",
      checkoutTime: "12:00",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Jl. Dewi Sartika IV No. 71 Sampangan",
        addressLocality: "Semarang",
        addressRegion: "Jawa Tengah",
        postalCode: "50232",
        addressCountry: "ID",
      },
      hasMap: "https://maps.google.com/maps?q=Pomah+Guesthouse+Semarang",
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "WiFi Gratis", value: true },
        { "@type": "LocationFeatureSpecification", name: "AC", value: true },
        { "@type": "LocationFeatureSpecification", name: "Smart TV", value: true },
        { "@type": "LocationFeatureSpecification", name: "Mini Kitchen", value: true },
        { "@type": "LocationFeatureSpecification", name: "Dapur Bersama", value: true },
        { "@type": "LocationFeatureSpecification", name: "Parkir Gratis", value: true },
      ],
      containsPlace: [
        { "@id": "https://pomahguesthouse.com/#single-room" },
        { "@id": "https://pomahguesthouse.com/#deluxe-room" },
        { "@id": "https://pomahguesthouse.com/#grand-deluxe-room" },
        { "@id": "https://pomahguesthouse.com/#family-room" },
      ],
    },
    {
      "@type": "HotelRoom",
      "@id": "https://pomahguesthouse.com/#single-room",
      name: "Single Room",
      description:
        "Kamar praktis dan nyaman untuk satu orang, ideal untuk solo traveler di Semarang.",
      occupancy: { "@type": "QuantitativeValue", value: 1 },
      bed: { "@type": "BedDetails", typeOfBed: "Single Bed" },
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "AC", value: true },
        { "@type": "LocationFeatureSpecification", name: "WiFi", value: true },
        { "@type": "LocationFeatureSpecification", name: "Dapur Bersama", value: true },
      ],
      offers: {
        "@type": "Offer",
        price: 180000,
        priceCurrency: "IDR",
        availability: "https://schema.org/InStock",
        url: "https://pomahguesthouse.com",
      },
    },
    {
      "@type": "HotelRoom",
      "@id": "https://pomahguesthouse.com/#deluxe-room",
      name: "Deluxe Room",
      description:
        "Kamar nyaman untuk dua orang dengan fasilitas modern dan suasana tenang di Semarang.",
      occupancy: { "@type": "QuantitativeValue", value: 2 },
      bed: { "@type": "BedDetails", typeOfBed: "Queen Bed" },
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "AC", value: true },
        { "@type": "LocationFeatureSpecification", name: "WiFi", value: true },
        { "@type": "LocationFeatureSpecification", name: "Shower", value: true },
        { "@type": "LocationFeatureSpecification", name: "View Taman", value: true },
      ],
      offers: {
        "@type": "Offer",
        price: 250000,
        priceCurrency: "IDR",
        availability: "https://schema.org/InStock",
        url: "https://pomahguesthouse.com",
      },
    },
    {
      "@type": "HotelRoom",
      "@id": "https://pomahguesthouse.com/#grand-deluxe-room",
      name: "Grand Deluxe Room",
      description:
        "Kamar premium untuk dua orang dengan kenyamanan ekstra untuk pengalaman menginap lebih maksimal.",
      occupancy: { "@type": "QuantitativeValue", value: 2 },
      bed: { "@type": "BedDetails", typeOfBed: "Double Bed" },
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "AC", value: true },
        { "@type": "LocationFeatureSpecification", name: "WiFi", value: true },
        { "@type": "LocationFeatureSpecification", name: "Air Panas", value: true },
      ],
      offers: {
        "@type": "Offer",
        price: 300000,
        priceCurrency: "IDR",
        availability: "https://schema.org/InStock",
        url: "https://pomahguesthouse.com",
      },
    },
    {
      "@type": "HotelRoom",
      "@id": "https://pomahguesthouse.com/#family-room",
      name: "Family Room 222",
      description:
        "Suite luas untuk keluarga atau kelompok dengan dua kamar tidur, dua kamar mandi, dan ruang keluarga.",
      occupancy: { "@type": "QuantitativeValue", value: 4 },
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "WiFi", value: true },
        { "@type": "LocationFeatureSpecification", name: "2 Kamar Tidur", value: true },
        { "@type": "LocationFeatureSpecification", name: "2 Kamar Mandi", value: true },
        { "@type": "LocationFeatureSpecification", name: "Ruang Keluarga", value: true },
      ],
      offers: {
        "@type": "Offer",
        price: 500000,
        priceCurrency: "IDR",
        availability: "https://schema.org/InStock",
        url: "https://pomahguesthouse.com",
      },
    },
    {
      "@type": "FAQPage",
      "@id": "https://pomahguesthouse.com/#faq",
      mainEntity: [
        {
          "@type": "Question",
          name: "Di mana lokasi Pomah Guesthouse?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Pomah Guesthouse berlokasi di Jl. Dewi Sartika IV No. 71 Sampangan, Semarang, Jawa Tengah.",
          },
        },
        {
          "@type": "Question",
          name: "Jam berapa check-in dan check-out?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Check-in mulai pukul 14.00 WIB dan check-out maksimal pukul 12.00 WIB.",
          },
        },
        {
          "@type": "Question",
          name: "Apakah tersedia WiFi gratis?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Ya, Pomah Guesthouse menyediakan WiFi gratis untuk tamu.",
          },
        },
        {
          "@type": "Question",
          name: "Apakah tersedia parkir?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Ya, tersedia area parkir untuk tamu Pomah Guesthouse.",
          },
        },
        {
          "@type": "Question",
          name: "Tipe kamar apa saja yang tersedia?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Pomah Guesthouse menyediakan beberapa tipe kamar seperti Single Room, Deluxe Room, Grand Deluxe Room, dan Family Room.",
          },
        },
        {
          "@type": "Question",
          name: "Bagaimana cara booking kamar?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Tamu dapat melakukan pemesanan melalui website resmi Pomah Guesthouse atau menghubungi WhatsApp resmi di +62 812-2727-1799.",
          },
        },
      ],
    },
  ],
};

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
          to="/rooms"
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
      { title: "Pomah Guesthouse — Penginapan Nyaman dan Murah Di Semarang" },
      {
        name: "description",
        content:
          "Penginapan nyaman dan murah di Gunungpati, Semarang. Dekat UNNES, parkir luas, suasana tenang. Pesan langsung lewat WhatsApp.",
      },
      { property: "og:title", content: "Pomah Guesthouse — Penginapan Nyaman dan Murah Di Semarang" },
      {
        property: "og:description",
        content:
          "Penginapan nyaman dan murah di Gunungpati, Semarang. Dekat UNNES, parkir luas, suasana tenang. Pesan langsung lewat WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pomah Guesthouse — Penginapan Nyaman dan Murah Di Semarang" },
      {
        name: "twitter:description",
        content:
          "Penginapan nyaman dan murah di Gunungpati, Semarang. Dekat UNNES, parkir luas, suasana tenang. Pesan langsung lewat WhatsApp.",
      },
      {
        property: "og:image",
        content: "https://pomahguesthouse.com/og-home.jpg",
      },
      {
        name: "twitter:image",
        content: "https://pomahguesthouse.com/og-home.jpg",
      },
      { name: "description", content: "- Pomah Guesthouse is an AI-powered hospitality operating system for guesthouse management." },
      { property: "og:description", content: "- Pomah Guesthouse is an AI-powered hospitality operating system for guesthouse management." },
      { name: "twitter:description", content: "- Pomah Guesthouse is an AI-powered hospitality operating system for guesthouse management." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/5Qu1z4UKkvcNIYafDWtJ5fj5CEg2/social-images/social-1781137954731-og-picture.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/5Qu1z4UKkvcNIYafDWtJ5fj5CEg2/social-images/social-1781137954731-og-picture.webp" },
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(pomahStructuredData) }}
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
        router.navigate({ to: "/login" });
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
