/**
 * Public landing page route: /lp/[slug]
 * Serves SEO-optimised landing pages created in the AI SEO Control Room.
 * Design matches the main Pomah Guesthouse site.
 */
import { useState, useEffect } from "react";
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, ChevronDown, ChevronLeft, ChevronRight, Menu, X, Quote } from "lucide-react";
import { getGoogleReviews } from "@/public/functions/public.functions";
import {
  getSeoLandingPageBySlug,
  type SeoLandingPage,
  type LPSection,
  type LPHeroSection,
  type LPTextSection,
  type LPFeaturesSection,
  type LPGallerySection,
  type LPFaqSection,
  type LPCtaBannerSection,
  type LPTestimonialsSection,
  type LPHeaderSection,
  type LPSliderSection,
  type LPButtonSection,
} from "@/admin/modules/seo/landing-page.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/lp/$slug")({
  head: ({ loaderData }: any) => {
    const p = loaderData?.page as SeoLandingPage | undefined;
    if (!p) return {};
    return {
      meta: [
        { title: p.meta_title || p.title },
        { name: "description", content: p.meta_description || "" },
        { property: "og:title", content: p.meta_title || p.title },
        { property: "og:description", content: p.meta_description || "" },
        ...(p.og_image_url ? [{ property: "og:image", content: p.og_image_url }] : []),
      ],
    };
  },

  loader: async ({ params }: any) => {
    const result = await getSeoLandingPageBySlug({ data: { slug: params.slug } });
    if (!result.page) throw notFound();
    return result;
  },

  component: LandingPage,
});

/* ─── Page root ─────────────────────────────────────────────────── */
function LandingPage() {
  const { page } = Route.useLoaderData() as { page: SeoLandingPage };
  const sections = (page.sections ?? []) as LPSection[];
  const hasSections = sections.length > 0;

  return (
    <div className="min-h-screen bg-[#f6f1e8] text-stone-800">
      <LPNav ctaUrl={page.hero_cta_url} ctaText={page.hero_cta_text} />

      {hasSections ? (
        sections.map((s) => <LPSectionRenderer key={s.id} section={s} />)
      ) : (
        /* ── Legacy fallback for pages without sections ── */
        <>
          <section className="relative overflow-hidden bg-gradient-to-br from-teal-800 via-teal-700 to-stone-800 px-6 py-28 text-center text-white">
            <div className="mx-auto max-w-3xl">
              {page.target_keyword && (
                <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-teal-200">
                  {page.target_keyword}
                </p>
              )}
              <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                {page.hero_headline || page.title}
              </h1>
              {page.hero_subheadline && (
                <p className="mx-auto mt-6 max-w-xl text-lg text-teal-100">{page.hero_subheadline}</p>
              )}
              <a href={page.hero_cta_url}
                className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-teal-800 shadow-lg transition hover:bg-teal-50">
                {page.hero_cta_text}
              </a>
            </div>
          </section>

          {page.body_content && (
            <section className="mx-auto max-w-3xl px-6 py-16">
              <div className="prose prose-stone prose-headings:font-serif prose-a:text-teal-700 max-w-none"
                dangerouslySetInnerHTML={{ __html: page.body_content }} />
            </section>
          )}

          <section className="border-t border-stone-200 bg-white px-6 py-14 text-center">
            <p className="font-serif text-2xl font-bold text-teal-700">Siap Menginap?</p>
            <p className="mt-2 text-sm text-stone-500">Pomah Guesthouse — Gunungpati, Semarang</p>
            <a href={page.hero_cta_url}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-700 px-8 py-3 text-sm font-bold text-white shadow transition hover:bg-teal-800">
              {page.hero_cta_text}
            </a>
          </section>
        </>
      )}

      <LPFooter />

      {/* WhatsApp float */}
      <a href={`https://wa.me/628112651818`} target="_blank" rel="noopener noreferrer"
        aria-label="Hubungi via WhatsApp"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600">
        <MessageCircle className="h-7 w-7" />
      </a>
    </div>
  );
}

/* ─── Section dispatcher ────────────────────────────────────────── */
export function LPSectionRenderer({ section }: { section: LPSection }) {
  switch (section.type) {
    case "header":       return <HeaderSection       s={section} />;
    case "hero":         return <HeroSection         s={section} />;
    case "slider":       return <SliderSection       s={section} />;
    case "text":         return <TextSection          s={section} />;
    case "features":     return <FeaturesSection      s={section} />;
    case "gallery":      return <GallerySection       s={section} />;
    case "faq":          return <FaqSection           s={section} />;
    case "cta_banner":   return <CtaBannerSection     s={section} />;
    case "button":       return <ButtonSection        s={section} />;
    case "testimonials": return <TestimonialsSection  s={section} />;
    default:             return null;
  }
}

/* ─── Header / Navbar ───────────────────────────────────────────── */
function HeaderSection({ s }: { s: LPHeaderSection }) {
  const [open, setOpen] = useState(false);
  const links = s.links ?? [];
  return (
    <nav className={`${s.sticky ?? true ? "sticky top-0" : ""} z-40 border-b border-stone-200 bg-white/95 backdrop-blur-sm shadow-sm`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-baseline gap-1">
          <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">{s.brand || "Pomah"}</span>
        </a>
        <div className="hidden items-center gap-6 md:flex">
          {links.map((l, i) => (
            <a key={i} href={l.url} className="text-sm text-stone-500 transition hover:text-stone-900">{l.label}</a>
          ))}
          {s.cta_text && (
            <a href={s.cta_url ?? "/book"}
              className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-800">
              {s.cta_text}
            </a>
          )}
        </div>
        <button className="md:hidden text-stone-700" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-stone-100 bg-white px-6 py-4 md:hidden space-y-3">
          {links.map((l, i) => (
            <a key={i} href={l.url} className="block text-sm text-stone-600" onClick={() => setOpen(false)}>{l.label}</a>
          ))}
          {s.cta_text && (
            <a href={s.cta_url ?? "/book"} className="block rounded-full bg-teal-700 py-2 text-center text-sm font-semibold text-white">
              {s.cta_text}
            </a>
          )}
        </div>
      )}
    </nav>
  );
}

/* ─── Hero Slider — identical to the homepage hero slider ──────────── */
const HERO_ANIM: Record<string, string> = {
  fade: "animate-in fade-in duration-700",
  slide: "animate-in slide-in-from-right-full duration-500 ease-out",
  zoom: "animate-in zoom-in-95 duration-700",
  none: "",
};

function SliderSection({ s }: { s: LPSliderSection }) {
  const slides = s.slides.length
    ? s.slides
    : [{ imageUrl: "", videoUrl: "", heading: "Selamat Datang", subheading: "" }];
  const [i, setI] = useState(0);

  useEffect(() => {
    if (slides.length < 2 || s.autoplayMs <= 0) return;
    const t = setInterval(() => setI((v) => (v + 1) % slides.length), s.autoplayMs);
    return () => clearInterval(t);
  }, [slides.length, s.autoplayMs]);

  const active = slides[i % slides.length];
  const go = (d: number) => setI((v) => (v + d + slides.length) % slides.length);

  return (
    <header className="relative w-full overflow-hidden" style={{ height: s.height }}>
      <div key={i} className={`absolute inset-0 ${HERO_ANIM[s.transition] ?? ""}`}>
        {active.videoUrl ? (
          <video src={active.videoUrl} autoPlay muted loop playsInline
            className="absolute inset-0 h-full w-full object-cover" />
        ) : active.imageUrl ? (
          <img src={active.imageUrl} alt={active.heading} loading="lazy"
            className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-teal-800 via-teal-700 to-teal-900" />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          <h1
            className={`max-w-3xl tracking-tight text-white drop-shadow ${
              s.fontFamily === "mono" ? "font-mono" : s.fontFamily === "sans" ? "font-sans" : "font-serif"
            }`}
            style={{
              fontSize: s.fontSize,
              lineHeight: 1.1,
              fontStyle: s.fontStyle === "italic" ? "italic" : "normal",
              fontWeight: s.fontStyle === "bold" ? 700 : 400,
            }}
          >
            {active.heading}
          </h1>
          {active.subheading && (
            <>
              <span className="my-4 h-px w-40 bg-white/70" />
              <p className="text-base text-white/90 md:text-lg">{active.subheading}</p>
            </>
          )}
        </div>
      </div>
      {slides.length > 1 && (
        <>
          <button onClick={() => go(-1)} aria-label="Sebelumnya"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white hover:bg-white/40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={() => go(1)} aria-label="Berikutnya"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white hover:bg-white/40">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((_, d) => (
              <button key={d} onClick={() => setI(d)} aria-label={`Slide ${d + 1}`}
                className={`h-2 rounded-full transition-all ${d === i % slides.length ? "w-6 bg-white" : "w-2 bg-white/50"}`} />
            ))}
          </div>
        </>
      )}
    </header>
  );
}

/* ─── Button ────────────────────────────────────────────────────── */
function ButtonSection({ s }: { s: LPButtonSection }) {
  const justify = s.align === "left" ? "justify-start" : s.align === "right" ? "justify-end" : "justify-center";
  const color = s.color ?? "teal";
  const outline = s.variant === "outline";
  const solidCls =
    color === "dark"  ? "bg-stone-800 text-white hover:bg-stone-900" :
    color === "light" ? "bg-white text-stone-800 hover:bg-stone-100 border border-stone-200" :
                        "bg-teal-700 text-white hover:bg-teal-800";
  const outlineCls =
    color === "dark"  ? "border border-stone-800 text-stone-800 hover:bg-stone-800 hover:text-white" :
    color === "light" ? "border border-white text-white hover:bg-white hover:text-stone-800" :
                        "border border-teal-700 text-teal-700 hover:bg-teal-700 hover:text-white";
  return (
    <section className="px-6 py-10">
      <div className={`mx-auto flex max-w-6xl ${justify}`}>
        <a href={s.url}
          className={`inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold shadow-sm transition ${outline ? outlineCls : solidCls}`}>
          {s.text}
        </a>
      </div>
    </section>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────── */
function HeroSection({ s }: { s: LPHeroSection }) {
  const overlay = Math.min(80, Math.max(0, s.overlay ?? 40));
  return (
    <section className="relative overflow-hidden py-28 text-center text-white"
      style={{ minHeight: 480 }}>
      {/* Background */}
      {s.image_url ? (
        <img src={s.image_url} alt={s.headline}
          className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-teal-800 via-teal-700 to-stone-800" />
      )}
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${overlay / 100})` }} />

      {/* Content */}
      <div className="relative mx-auto max-w-3xl px-6">
        <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl drop-shadow">
          {s.headline}
        </h1>
        {s.subheadline && (
          <p className="mx-auto mt-6 max-w-xl text-lg text-white/90">{s.subheadline}</p>
        )}
        {s.cta_text && (
          <a href={s.cta_url ?? "/book"}
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-teal-800 shadow-lg transition hover:bg-teal-50">
            {s.cta_text}
          </a>
        )}
      </div>
    </section>
  );
}

/* ─── Text / Paragraf ───────────────────────────────────────────── */
function TextSection({ s }: { s: LPTextSection }) {
  const center = s.align === "center";
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      {s.title && (
        <div className={`mb-8 flex flex-col ${center ? "items-center" : "items-start"}`}>
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
        </div>
      )}
      <div className={`prose prose-stone prose-headings:font-serif prose-a:text-teal-700 max-w-none ${center ? "text-center" : ""}`}
        dangerouslySetInnerHTML={{ __html: s.content }} />
    </section>
  );
}

/* ─── Features grid ─────────────────────────────────────────────── */
function FeaturesSection({ s }: { s: LPFeaturesSection }) {
  const cols = s.columns ?? 3;
  const gridCls = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {s.title && (
        <div className="mb-10 flex flex-col items-center text-center">
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
        </div>
      )}
      <div className={`grid grid-cols-1 gap-5 ${gridCls}`}>
        {(s.items ?? []).map((item, i) => (
          <div key={i} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-700 font-serif font-bold">
              {i + 1}
            </div>
            <h3 className="font-serif text-lg font-semibold text-stone-900">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Gallery ───────────────────────────────────────────────────── */
function GallerySection({ s }: { s: LPGallerySection }) {
  const cols = s.columns ?? 3;
  const gridCls = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  const images = (s.images ?? []).filter(Boolean);
  if (images.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      {s.title && (
        <div className="mb-10 flex flex-col items-center text-center">
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 ${gridCls}`}>
        {images.map((url, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-stone-200 bg-teal-50 shadow-sm aspect-[4/3]">
            <img src={url} alt={`${s.title ?? "Foto"} ${i + 1}`}
              className="h-full w-full object-cover transition hover:scale-105" />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── FAQ accordion ─────────────────────────────────────────────── */
function FaqSection({ s }: { s: LPFaqSection }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      {s.title && (
        <div className="mb-10 flex flex-col items-center text-center">
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
        </div>
      )}
      <div className="space-y-2">
        {(s.items ?? []).map((item, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <button type="button" onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-stone-50">
              <span className="font-medium text-stone-800">{item.question}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-teal-600 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            {open === i && (
              <div className="border-t border-stone-100 px-5 py-4 text-sm leading-relaxed text-stone-600">
                {item.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── CTA Banner ────────────────────────────────────────────────── */
function CtaBannerSection({ s }: { s: LPCtaBannerSection }) {
  const bgCls =
    s.style === "dark"  ? "bg-stone-800 text-white" :
    s.style === "light" ? "bg-white text-stone-800 border-t border-b border-stone-200" :
                          "bg-teal-700 text-white";
  const btnCls =
    s.style === "dark"  ? "bg-white text-stone-900 hover:bg-stone-100" :
    s.style === "light" ? "bg-teal-700 text-white hover:bg-teal-800" :
                          "bg-white text-teal-800 hover:bg-teal-50";
  return (
    <section className={`px-6 py-16 text-center ${bgCls}`}>
      <div className="mx-auto max-w-2xl">
        <h2 className="font-serif text-3xl font-bold">{s.headline}</h2>
        {s.subheadline && <p className="mt-3 text-base opacity-80">{s.subheadline}</p>}
        <a href={s.cta_url}
          className={`mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold shadow-lg transition ${btnCls}`}>
          {s.cta_text}
        </a>
      </div>
    </section>
  );
}

/* ─── Testimonials ──────────────────────────────────────────────── */
function TestimonialsSection({ s }: { s: LPTestimonialsSection }) {
  const [i, setI] = useState(0);
  const useGoogle = (s.source ?? "manual") === "google";

  const reviewsFn = useServerFn(getGoogleReviews);
  const { data: gr } = useQuery({
    queryKey: ["lp-google-reviews"],
    queryFn: () => reviewsFn(),
    enabled: useGoogle,
  });

  // Source: live Google reviews, with a graceful fallback to manual items.
  const googleItems = (gr?.reviews ?? []).map((rv) => ({ name: rv.author, text: rv.text }));
  const items = useGoogle
    ? (googleItems.length > 0 ? googleItems : (s.items ?? []))
    : (s.items ?? []);

  if (items.length === 0) return null;
  const cur = items[i % items.length];
  return (
    <section className="bg-stone-50 px-6 py-16">
      <div className="mx-auto max-w-3xl">
        {s.title && (
          <div className="mb-10 flex flex-col items-center text-center">
            <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800">{s.title}</h2>
            <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
          </div>
        )}
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
          <Quote className="mx-auto h-7 w-7 text-teal-600/40" />
          <p className="mt-4 text-base leading-relaxed text-stone-600">&ldquo;{cur.text}&rdquo;</p>
          {cur.name && <p className="mt-5 text-sm font-semibold text-stone-700">— {cur.name}</p>}
        </div>
        {items.length > 1 && (
          <div className="mt-5 flex justify-center gap-2">
            {items.map((_, d) => (
              <button key={d} onClick={() => setI(d)} aria-label={`Testimoni ${d + 1}`}
                className={`h-2 rounded-full transition-all ${d === i % items.length ? "w-6 bg-teal-700" : "w-2 bg-stone-300"}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Nav ───────────────────────────────────────────────────────── */
function LPNav({ ctaUrl, ctaText }: { ctaUrl: string; ctaText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-baseline gap-1">
          <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">Pomah</span>
          <span className="font-serif text-xl font-light text-teal-700">Guesthouse</span>
        </Link>
        <div className="hidden items-center gap-6 md:flex">
          <Link to="/" className="text-sm text-stone-500 transition hover:text-stone-900">Beranda</Link>
          <Link to="/rooms" className="text-sm text-stone-500 transition hover:text-stone-900">Kamar</Link>
          <a href={ctaUrl}
            className="rounded-full bg-teal-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-800">
            {ctaText || "Pesan Sekarang"}
          </a>
        </div>
        <button className="md:hidden text-stone-700" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-stone-100 bg-white px-6 py-4 md:hidden space-y-3">
          <Link to="/" className="block text-sm text-stone-600" onClick={() => setOpen(false)}>Beranda</Link>
          <Link to="/rooms" className="block text-sm text-stone-600" onClick={() => setOpen(false)}>Kamar</Link>
          <a href={ctaUrl} className="block rounded-full bg-teal-700 py-2 text-center text-sm font-semibold text-white">
            {ctaText || "Pesan Sekarang"}
          </a>
        </div>
      )}
    </nav>
  );
}

/* ─── Footer ────────────────────────────────────────────────────── */
function LPFooter() {
  return (
    <footer className="border-t border-stone-200 bg-teal-800 text-teal-100">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-serif text-xl font-bold text-white">Pomah <span className="font-light">Guesthouse</span></p>
            <p className="mt-2 text-sm text-teal-200/80">Penginapan nyaman & terjangkau di Gunungpati, Semarang.</p>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-teal-300">Quick Links</p>
            <ul className="space-y-2 text-sm">
              {[
                { href: "/", label: "Beranda" },
                { href: "/rooms", label: "Kamar" },
                { href: "/book", label: "Reservasi" },
              ].map((l) => (
                <li key={l.href}><a href={l.href} className="transition hover:text-white">{l.label}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-teal-300">Kontak</p>
            <p className="text-sm text-teal-200/80">Gunungpati, Semarang, Jawa Tengah</p>
          </div>
        </div>
        <div className="mt-10 border-t border-teal-700/60 pt-6 text-center text-xs text-teal-300/70">
          © {new Date().getFullYear()} Pomah Guesthouse. Semua hak dilindungi.
        </div>
      </div>
    </footer>
  );
}
