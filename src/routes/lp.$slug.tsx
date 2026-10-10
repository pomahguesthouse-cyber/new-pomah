/**
 * Public landing page route: /lp/[slug]
 * Serves SEO-optimised landing pages created in the AI SEO Control Room.
 * Design matches the main Pomah Guesthouse site.
 */
import { Suspense, useState, useEffect, createContext, useContext, useMemo } from "react";
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, ChevronDown, ChevronLeft, ChevronRight, Menu, X, Quote, Star } from "lucide-react";
import {
  getPublicSiteData,
  checkRoomTypeAvailability,
} from "@/public/functions/public.functions";
import { getGoogleReviews, type GoogleReview, type GoogleReviewsResult } from "@/public/functions/google-reviews.functions";
import { DatePickerID } from "@/public/components/lazy-public-widgets";
import { publicCopy } from "@/public/lib/public-copy";
import {
  getSeoLandingPageBySlug,
  ensureResponsiveStyles,
  type SeoLandingPage,
  type LPSection,
  type LPSplitSections,
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
  type LPRoomSliderSection,
  type LPDatePickerSection,
} from "@/admin/modules/seo/landing-page.functions";
import { canonicalHeadTags, canonicalUrlForPath, isUnoptimizedSharePng, shareOgImageTags } from "@/public/lib/public-seo";
import {
  APPROVED_LP,
  applyApprovedHomepageSeo,
  patchUnnesDistance,
  stripHotWaterFromPublicJson,
  stripPublicHotWaterClaim,
} from "@/public/content/approved-seo";
import { UnnesLanding } from "@/public/components/unnes-landing";
import { rewritePublicHref } from "@/public/lib/public-href";
import { buildStorageImageUrl, heroPreloadLinks } from "@/lib/storage-image";
import { POMAH_NAP_LINE } from "@/public/lib/site-identity";
import {
  allLandingSections,
  blockHeadingTag,
  buildLandingHeadExtras,
  demoteContentH1,
  firstHeroImageUrl,
  landingDocumentOutline,
  landingNeedsGoogleReviews,
  publicLandingSections,
} from "@/public/lib/landing-page-seo";
import { BrandLogo, PomahFooter } from "@/public/components/public-shell";
import { mergeHomepageConfig } from "@/admin/modules/homepage/homepage.config";
// NOTE: Home-page duplication via landing page (PomahHomeView) sementara
// dinonaktifkan — komponen sumber sudah tidak diekspor lagi.

/* ─── Shared booking-date state (date picker → room slider) ───────── */
type BookingDates = {
  checkIn: string; checkOut: string; today: string;
  setCheckIn: (v: string) => void; setCheckOut: (v: string) => void;
  checkInOpen: boolean; setCheckInOpen: (v: boolean) => void;
  checkOutOpen: boolean; setCheckOutOpen: (v: boolean) => void;
  handleCheckInChange: (v: string) => void;
};
const BookingCtx = createContext<BookingDates | null>(null);
const isoAddDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type LpRoomCard = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  base_rate: number | string;
  capacity?: number | null;
  size_sqm?: number | null;
  hero_image_url?: string | null;
};

type LpRenderValue = {
  rooms: LpRoomCard[];
  reviews: GoogleReviewsResult | null;
  h1SectionId: string | null;
  eagerSectionId: string | null;
  demoteHeadings: boolean;
  demoteInlineHeadings: boolean;
};

const LpRenderCtx = createContext<LpRenderValue>({
  rooms: [],
  reviews: null,
  h1SectionId: null,
  eagerSectionId: null,
  demoteHeadings: false,
  demoteInlineHeadings: false,
});

function useBlockHeading(sectionId: string): "h1" | "h2" {
  const ctx = useContext(LpRenderCtx);
  return blockHeadingTag(sectionId, ctx.h1SectionId, ctx.demoteHeadings);
}

function useEagerMedia(sectionId: string): boolean {
  const ctx = useContext(LpRenderCtx);
  return !ctx.demoteHeadings && ctx.eagerSectionId === sectionId;
}

function LpSizedImage({
  url,
  alt,
  eager,
  width,
  height,
  className,
}: {
  url: string;
  alt: string;
  eager: boolean;
  width: number;
  height: number;
  className: string;
}) {
  return (
    <img
      src={buildStorageImageUrl(url, { width, height, quality: 60 })}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "low"}
      decoding="async"
      className={className}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/lp/$slug")({
  head: ({ loaderData }: any) => {
    const p = loaderData?.page as SeoLandingPage | undefined;
    if (!p) return {};
    const approved = p.slug === APPROVED_LP.slug;
    const title = approved ? APPROVED_LP.title : stripPublicHotWaterClaim(p.meta_title || p.title);
    const description = approved ? APPROVED_LP.meta : stripPublicHotWaterClaim(p.meta_description || "");
    const canonical = canonicalHeadTags(`/lp/${p.slug || ""}`);
    const property = loaderData?.property as { homepage_config?: unknown; whatsapp_number?: string | null; email?: string | null } | undefined;
    const heroImage = approved
      ? mergeHomepageConfig(property?.homepage_config).hero.slides?.[0]?.imageUrl
      : firstHeroImageUrl(publicLandingSections(p.sections)) ?? "";
    const extras = buildLandingHeadExtras({
      approved,
      pageUrl: canonicalUrlForPath(`/lp/${p.slug || ""}`),
      name: title,
      description,
      sections: p.sections,
      customHead: p.custom_head,
      customRobots: p.custom_robots,
      noindex: p.noindex,
      jsonLdEnabled: p.json_ld_enabled,
      customJsonLd: p.custom_json_ld,
      property,
    });
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...canonical.meta,
        ...(isUnoptimizedSharePng(p.og_image_url)
          ? shareOgImageTags()
          : p.og_image_url
            ? [{ property: "og:image", content: p.og_image_url }]
            : []),
        ...extras.meta,
      ],
      links: [...canonical.links, ...heroPreloadLinks(heroImage), ...extras.links],
      scripts: extras.scripts,
      styles: extras.styles,
    };
  },

  loader: async ({ params, location }: any) => {
    const builderPreview = new URLSearchParams(location?.searchStr ?? "").get("builder") === "1";
    const [result, siteData] = await Promise.all([
      getSeoLandingPageBySlug({ data: { slug: params.slug } }) as Promise<{
        page: SeoLandingPage | null;
      }>,
      getPublicSiteData(),
    ]);
    if (!result.page) throw notFound();
    const patched = patchUnnesDistance(result.page) as SeoLandingPage;
    if (patched.homepage_config) {
      patched.homepage_config = applyApprovedHomepageSeo(patched.homepage_config);
    }
    const cleaned = stripHotWaterFromPublicJson(patched);
    const page =
      cleaned.slug === APPROVED_LP.slug
        ? {
            ...cleaned,
            title: APPROVED_LP.title,
            meta_title: APPROVED_LP.title,
            meta_description: APPROVED_LP.meta,
            hero_headline: APPROVED_LP.h1,
            hero_subheadline: APPROVED_LP.cardIntro,
            target_keyword: null,
          }
        : cleaned;
    const site = siteData as { property?: unknown; roomTypes?: unknown[] } | null;
    const reviews = landingNeedsGoogleReviews(allLandingSections(page.sections))
      ? await getGoogleReviews().catch(
          (): GoogleReviewsResult => ({ rating: null, total: null, reviews: [], status: "ERROR" }),
        )
      : null;
    return {
      page,
      property: site?.property,
      roomTypes: site?.roomTypes ?? [],
      reviews,
      builderPreview,
    };
  },

  component: LandingPage,
});

type LandingProperty = {
  name?: string | null;
  logo_url?: string | null;
  homepage_config?: unknown;
  whatsapp_number?: string | null;
  email?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  facebook_url?: string | null;
  youtube_url?: string | null;
};

/**
 * One indexed section tree.
 *
 * Responsive styles (font, spacing, visibility) already live on each section
 * and apply through a media query, so the public HTML does not print a second
 * copy. When the editor saved a different mobile tree, a narrow viewport
 * replaces the desktop tree after hydration — it does not append it.
 *
 * The admin iframe (`?builder=1`) still receives both trees so the desktop
 * and mobile preview widths keep working. The mobile copy's headings are
 * demoted and the copy is aria-hidden / data-nosnippet.
 */
function BuilderSections({
  page,
  property,
  rooms,
  reviews,
  builderPreview,
}: {
  page: SeoLandingPage;
  property?: LandingProperty;
  rooms: LpRoomCard[];
  reviews: GoogleReviewsResult | null;
  builderPreview: boolean;
}) {
  const sectionsData = page.sections;
  const isSplit = Boolean(sectionsData && !Array.isArray(sectionsData) && (sectionsData as LPSplitSections).split);
  const desktopSections: LPSection[] = isSplit
    ? ((sectionsData as LPSplitSections).desktop ?? [])
    : Array.isArray(sectionsData)
      ? sectionsData
      : [];
  const mobileSections: LPSection[] = isSplit ? ((sectionsData as LPSplitSections).mobile ?? []) : desktopSections;
  const canonicalSections = publicLandingSections<LPSection>(sectionsData);
  const [liveSections, setLiveSections] = useState(canonicalSections);

  useEffect(() => {
    if (builderPreview || !isSplit) {
      setLiveSections(canonicalSections);
      return;
    }
    const desktop = desktopSections.length > 0 ? desktopSections : mobileSections;
    const mobile = mobileSections.length > 0 ? mobileSections : desktop;
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setLiveSections(query.matches ? mobile : desktop);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [builderPreview, isSplit, page.id]);

  const nav = {
    ctaUrl: page.hero_cta_url,
    ctaText: page.hero_cta_text,
    logoUrl: property?.logo_url,
    brand: property?.name || "Pomah Guesthouse",
  };

  if (builderPreview && isSplit) {
    return (
      <>
        <div className="hidden md:flex md:flex-col">
          <LandingSectionTree sections={desktopSections} demote={false} page={page} nav={nav} rooms={rooms} reviews={reviews} />
        </div>
        <div className="flex flex-col md:hidden" aria-hidden="true" data-nosnippet="">
          <LandingSectionTree sections={mobileSections} demote page={page} nav={nav} rooms={rooms} reviews={reviews} />
        </div>
      </>
    );
  }

  return (
    <LandingSectionTree sections={liveSections} demote={false} page={page} nav={nav} rooms={rooms} reviews={reviews} />
  );
}

function LandingSectionTree({
  sections,
  demote,
  page,
  nav,
  rooms,
  reviews,
}: {
  sections: LPSection[];
  demote: boolean;
  page: SeoLandingPage;
  nav: { ctaUrl: string; ctaText: string; logoUrl?: string | null; brand: string };
  rooms: LpRoomCard[];
  reviews: GoogleReviewsResult | null;
}) {
  const outline = landingDocumentOutline(sections, page);
  const hasHeader = sections.some((section) => section.type === "header");
  return (
    <LpRenderCtx.Provider
      value={{
        rooms,
        reviews,
        h1SectionId: demote ? null : outline.h1SectionId,
        eagerSectionId: demote ? null : outline.eagerSectionId,
        demoteHeadings: demote,
        demoteInlineHeadings: demote || Boolean(outline.h1SectionId || outline.fallbackH1),
      }}
    >
      {!hasHeader && (
        <LPNav ctaUrl={nav.ctaUrl} ctaText={nav.ctaText} logoUrl={nav.logoUrl} brand={nav.brand} />
      )}
      {!demote && outline.fallbackH1 ? (
        <div className="mx-auto max-w-3xl px-6 pt-16 text-center">
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight text-stone-900 sm:text-5xl">
            {outline.fallbackH1}
          </h1>
        </div>
      ) : null}
      {sections.map((section) => (
        <SectionWrapper key={section.id} section={section}>
          <LPSectionRenderer section={section} />
        </SectionWrapper>
      ))}
    </LpRenderCtx.Provider>
  );
}

/* ─── Page root ─────────────────────────────────────────────────── */
function LandingPage() {
  const { page, property, roomTypes, reviews, builderPreview } = Route.useLoaderData() as {
    page: SeoLandingPage;
    property?: LandingProperty;
    roomTypes?: LpRoomCard[];
    reviews?: GoogleReviewsResult | null;
    builderPreview?: boolean;
  };
  const whatsappNumber = String(property?.whatsapp_number || "6285190986169").replace(/\D/g, "");
  // Halaman hasil duplikasi Home sementara di-skip; fallback ke render section
  // standar di bawah agar build tidak gagal.
  // if (page.homepage_config && typeof page.homepage_config === "object") { ... }

  const hasSections = publicLandingSections(page.sections).length > 0;

  // Shared booking dates (date picker → room slider).
  const [today, setToday] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);

  const handleCheckInChange = (val: string) => {
    setCheckIn(val);
    setCheckInOpen(false);
    if (!checkOut || checkOut <= val) {
      setCheckOut(isoAddDays(val, 1));
    }
    setTimeout(() => {
      setCheckOutOpen(true);
    }, 150);
  };

  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, []);

  const homeCfg = mergeHomepageConfig(property?.homepage_config);
  const approved = page.slug === APPROVED_LP.slug;

  return (
    <BookingCtx.Provider value={{ checkIn, checkOut, today, setCheckIn, setCheckOut, checkInOpen, setCheckInOpen, checkOutOpen, setCheckOutOpen, handleCheckInChange }}>
    <div className="relative min-h-screen bg-[#f6f1e8] text-stone-800">
      {approved ? (
        <>
          <LPNav
            overlay
            ctaUrl="/book"
            ctaText="Pesan kamar"
            logoUrl={property?.logo_url}
            brand={property?.name || "Pomah Guesthouse"}
            logoSize={homeCfg.header.logoSize}
            links={homeCfg.header.links.map((link) => ({ label: link.label, url: link.href }))}
          />
          <UnnesLanding
            rooms={roomTypes}
            property={property}
            hero={homeCfg.hero}
            ctaHref="/book"
            ctaText="Pesan kamar"
          />
        </>
      ) : hasSections ? (
        <BuilderSections
          key={page.id}
          page={page}
          property={property}
          rooms={(roomTypes ?? []) as LpRoomCard[]}
          reviews={reviews ?? null}
          builderPreview={builderPreview === true}
        />
      ) : (
        /* ── Legacy fallback for pages without sections ── */
        <>
          <section className="relative overflow-hidden bg-gradient-to-br from-amber-800 via-amber-700 to-amber-900 px-6 py-28 text-center text-white">
            <div className="mx-auto max-w-3xl">
              {page.target_keyword && (
                <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-amber-200">
                  {page.target_keyword}
                </p>
              )}
              <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                {page.hero_headline || page.title}
              </h1>
              {page.hero_subheadline && (
                <p className="mx-auto mt-6 max-w-xl text-lg text-amber-100">{page.hero_subheadline}</p>
              )}
              <a href={rewritePublicHref(page.hero_cta_url)}
                className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-amber-800 shadow-lg transition hover:bg-amber-50">
                {page.hero_cta_text}
              </a>
            </div>
          </section>

          {page.body_content && (
            <section className="mx-auto max-w-3xl px-6 py-16">
              <div className="prose prose-stone prose-headings:font-serif prose-a:text-amber-800 max-w-none"
                dangerouslySetInnerHTML={{ __html: demoteContentH1(stripPublicHotWaterClaim(page.body_content)).replace(/href=(["'])\/rooms\/?\1/g, 'href=$1/#rooms$1') }} />
            </section>
          )}

          <section className="border-t border-stone-200 bg-white px-6 py-14 text-center">
            <p className="font-serif text-2xl font-bold text-amber-700">Siap Menginap?</p>
            <p className="mt-2 text-sm text-stone-500">{POMAH_NAP_LINE}</p>
            <a href={rewritePublicHref(page.hero_cta_url)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-700 px-8 py-3 text-sm font-bold text-white shadow transition hover:bg-amber-800">
              {page.hero_cta_text}
            </a>
          </section>
        </>
      )}

      <PomahFooter name={property?.name || "Pomah Guesthouse"} property={property} rooms={roomTypes} />

      {/* WhatsApp float */}
      <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer"
        aria-label="Hubungi via WhatsApp"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600">
        <MessageCircle className="h-7 w-7" />
      </a>
    </div>
    </BookingCtx.Provider>
  );
}


/* ─── Responsive Section Wrapper ─── */
function SectionWrapper({ section, children }: { section: LPSection; children: React.ReactNode }) {
  const isBuilder = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("builder") === "1";
  const s = ensureResponsiveStyles(section);
  const styles = s.styles;

  const desktop = styles.desktop || {};
  const mobile = styles.mobile || {};

  const css = `
    #sec-${s.id} {
      ${desktop.fontSize ? `font-size: ${desktop.fontSize} !important;` : ''}
      ${desktop.textSize ? `line-height: ${desktop.textSize} !important;` : ''}
      ${desktop.fontWeight ? `font-weight: ${desktop.fontWeight} !important;` : ''}
      ${desktop.alignment ? `text-align: ${desktop.alignment} !important;` : ''}
      ${desktop.width ? `width: ${desktop.width} !important;` : ''}
      ${desktop.height ? `height: ${desktop.height} !important;` : ''}
      ${desktop.padding ? `padding: ${desktop.padding} !important;` : ''}
      ${desktop.margin ? `margin: ${desktop.margin} !important;` : ''}
      ${desktop.borderRadius ? `border-radius: ${desktop.borderRadius} !important;` : ''}
      ${desktop.bgColor ? `background-color: ${desktop.bgColor} !important;` : ''}
      ${desktop.textColor ? `color: ${desktop.textColor} !important;` : ''}
      ${desktop.visibility === 'hidden' || desktop.display === 'none' 
        ? (isBuilder 
            ? 'opacity: 0.4 !important; outline: 2px dashed #0d9488 !important; outline-offset: -2px !important;' 
            : 'display: none !important;') 
        : ''}
    }

    @media (max-width: 767px) {
      #sec-${s.id} {
        ${mobile.fontSize ? `font-size: ${mobile.fontSize} !important;` : (desktop.fontSize ? `font-size: ${desktop.fontSize} !important;` : '')}
        ${mobile.textSize ? `line-height: ${mobile.textSize} !important;` : (desktop.textSize ? `line-height: ${desktop.textSize} !important;` : '')}
        ${mobile.fontWeight ? `font-weight: ${mobile.fontWeight} !important;` : (desktop.fontWeight ? `font-weight: ${desktop.fontWeight} !important;` : '')}
        ${mobile.alignment ? `text-align: ${mobile.alignment} !important;` : (desktop.alignment ? `text-align: ${desktop.alignment} !important;` : '')}
        ${mobile.width ? `width: ${mobile.width} !important;` : (desktop.width ? `width: ${desktop.width} !important;` : '')}
        ${mobile.height ? `height: ${mobile.height} !important;` : (desktop.height ? `height: ${desktop.height} !important;` : '')}
        ${mobile.padding ? `padding: ${mobile.padding} !important;` : (desktop.padding ? `padding: ${desktop.padding} !important;` : '')}
        ${mobile.margin ? `margin: ${mobile.margin} !important;` : (desktop.margin ? `margin: ${desktop.margin} !important;` : '')}
        ${mobile.borderRadius ? `border-radius: ${mobile.borderRadius} !important;` : (desktop.borderRadius ? `border-radius: ${desktop.borderRadius} !important;` : '')}
        ${mobile.bgColor ? `background-color: ${mobile.bgColor} !important;` : (desktop.bgColor ? `background-color: ${desktop.bgColor} !important;` : '')}
        ${mobile.textColor ? `color: ${mobile.textColor} !important;` : (desktop.textColor ? `color: ${desktop.textColor} !important;` : '')}
        ${mobile.visibility === 'hidden' || mobile.display === 'none' 
          ? (isBuilder 
              ? 'display: block !important; opacity: 0.4 !important; outline: 2px dashed #0d9488 !important; outline-offset: -2px !important;' 
              : 'display: none !important;') 
          : (mobile.display === 'block' ? 'display: block !important;' : '')}
        ${mobile.fullWidth ? 'width: 100% !important; max-width: 100% !important; margin-left: 0 !important; margin-right: 0 !important; border-radius: 0 !important;' : ''}
        ${mobile.order !== undefined ? `order: ${mobile.order} !important;` : ''}
      }
    }
  `;

  return (
    <div id={`sec-${s.id}`} className="transition-all duration-200">
      <style>{css}</style>
      {children}
    </div>
  );
}

/* ─── Section dispatcher ────────────────────────────────────────── */
function LPSectionRenderer({ section }: { section: LPSection }) {
  switch (section.type) {
    case "header":       return <HeaderSection       s={section} />;
    case "hero":         return <HeroSection         s={section} />;
    case "slider":       return <SliderSection       s={section} />;
    case "room_slider":  return <RoomSliderSection    s={section} />;
    case "datepicker":   return <DatePickerSection    s={section} />;
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
        <a href="/" className="flex items-center gap-2">
          {s.logo_url ? (
            <img src={s.logo_url} alt={s.brand || "Logo"} className="h-9 w-auto object-contain" />
          ) : (
            <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">{s.brand || "Pomah"}</span>
          )}
        </a>
        <div className="hidden items-center gap-6 md:flex">
          {links.map((l, i) => (
            <a key={i} href={rewritePublicHref(l.url)} className="text-sm text-stone-500 transition hover:text-stone-900">{l.label}</a>
          ))}
          {s.cta_text && (
            <a href={rewritePublicHref(s.cta_url ?? "/book")}
              className="rounded-full bg-amber-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-amber-800">
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
            <a key={i} href={rewritePublicHref(l.url)} className="block text-sm text-stone-600" onClick={() => setOpen(false)}>{l.label}</a>
          ))}
          {s.cta_text && (
            <a href={rewritePublicHref(s.cta_url ?? "/book")} className="block rounded-full bg-amber-700 py-2 text-center text-sm font-semibold text-white">
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
  const HeadingTag = useBlockHeading(s.id);
  const eagerSlide = useEagerMedia(s.id);
  const slides = s.slides.length
    ? s.slides
    : [{ imageUrl: "", videoUrl: "", heading: "Selamat Datang", subheading: "" }];
  const [i, setI] = useState(0);
  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || s.autoplayMs <= 0) return;
    const t = setInterval(() => {
      setHasChanged(true);
      setI((v) => (v + 1) % slides.length);
    }, s.autoplayMs);
    return () => clearInterval(t);
  }, [slides.length, s.autoplayMs]);

  const active = slides[i % slides.length];
  const go = (d: number) => {
    setHasChanged(true);
    setI((v) => (v + d + slides.length) % slides.length);
  };
  const enterClass = hasChanged ? (HERO_ANIM[s.transition] ?? "") : "";

  return (
    <header className="relative w-full overflow-hidden" style={{ height: s.height }}>
      <div key={i} className={`absolute inset-0${enterClass ? ` ${enterClass}` : ""}`}>
        {active.videoUrl ? (
          <video src={active.videoUrl} autoPlay muted loop playsInline
            className="absolute inset-0 h-full w-full object-cover" />
        ) : active.imageUrl ? (
          <LpSizedImage
            url={active.imageUrl}
            alt={active.heading || "Pomah Guesthouse"}
            eager={eagerSlide && i === 0}
            width={1200}
            height={675}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-800 via-amber-700 to-amber-900" />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          {((active.heading ?? "").trim() || slides.find((slide) => (slide.heading ?? "").trim())?.heading) && (
          <HeadingTag
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
            {(active.heading ?? "").trim() || slides.find((slide) => (slide.heading ?? "").trim())?.heading}
          </HeadingTag>
          )}
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
              <button key={d} onClick={() => { setHasChanged(true); setI(d); }} aria-label={`Slide ${d + 1}`}
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
                        "bg-amber-700 text-white hover:bg-amber-800";
  const outlineCls =
    color === "dark"  ? "border border-stone-800 text-stone-800 hover:bg-stone-800 hover:text-white" :
    color === "light" ? "border border-white text-white hover:bg-white hover:text-stone-800" :
                        "border border-amber-700 text-amber-700 hover:bg-amber-700 hover:text-white";
  return (
    <section className="px-6 py-10">
      <div className={`mx-auto flex max-w-6xl ${justify}`}>
        <a href={rewritePublicHref(s.url)}
          className={`inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold shadow-sm transition ${outline ? outlineCls : solidCls}`}>
          {s.text}
        </a>
      </div>
    </section>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────── */
function HeroSection({ s }: { s: LPHeroSection }) {
  const HeadingTag = useBlockHeading(s.id);
  const eager = useEagerMedia(s.id);
  const overlay = Math.min(80, Math.max(0, s.overlay ?? 40));
  return (
    <section className="relative overflow-hidden py-28 text-center text-white"
      style={{ minHeight: 480 }}>
      {/* Background */}
      {s.image_url ? (
        <LpSizedImage
          url={s.image_url}
          alt={s.headline}
          eager={eager}
          width={1200}
          height={675}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-amber-800 via-amber-700 to-amber-900" />
      )}
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${overlay / 100})` }} />

      {/* Content */}
      <div className="relative mx-auto max-w-3xl px-6">
        {s.headline?.trim() ? (
        <HeadingTag className="font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl drop-shadow">
          {s.headline}
        </HeadingTag>
        ) : null}
        {s.subheadline && (
          <p className="mx-auto mt-6 max-w-xl text-lg text-white/90">{s.subheadline}</p>
        )}
        {s.cta_text && (
          <a href={rewritePublicHref(s.cta_url ?? "/book")}
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-amber-800 shadow-lg transition hover:bg-amber-50">
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
  const html = useContext(LpRenderCtx).demoteInlineHeadings ? demoteContentH1(s.content) : s.content;
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      {s.title && (
        <div className={`mb-8 flex flex-col ${center ? "items-center" : "items-start"}`}>
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
        </div>
      )}
      <div className={`prose prose-stone prose-headings:font-serif prose-a:text-amber-800 max-w-none ${center ? "text-center" : ""}`}
        dangerouslySetInnerHTML={{ __html: html }} />
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
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
        </div>
      )}
      <div className={`grid grid-cols-1 gap-5 ${gridCls}`}>
        {(s.items ?? []).map((item, i) => (
          <div key={i} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 font-serif font-bold">
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
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 ${gridCls}`}>
        {images.map((url, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-stone-200 bg-amber-50 shadow-sm aspect-[4/3]">
            <LpSizedImage
              url={url}
              alt={`${s.title ?? "Foto"} ${i + 1}`}
              eager={false}
              width={960}
              height={720}
              className="h-full w-full object-cover transition hover:scale-105"
            />
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
          <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{s.title}</h2>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
        </div>
      )}
      <div className="space-y-2">
        {(s.items ?? []).map((item, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <button type="button" onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-stone-50">
              <span className="font-medium text-stone-800">{item.question}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-amber-600 transition-transform ${open === i ? "rotate-180" : ""}`} />
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
                          "bg-amber-700 text-white";
  const btnCls =
    s.style === "dark"  ? "bg-white text-stone-900 hover:bg-stone-100" :
    s.style === "light" ? "bg-amber-700 text-white hover:bg-amber-800" :
                          "bg-white text-amber-800 hover:bg-amber-50";
  return (
    <section className={`px-6 py-16 text-center ${bgCls}`}>
      <div className="mx-auto max-w-2xl">
        <h2 className="font-serif text-3xl font-bold">{s.headline}</h2>
        {s.subheadline && <p className="mt-3 text-base opacity-80">{s.subheadline}</p>}
        <a href={rewritePublicHref(s.cta_url)}
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
  const seeded = useContext(LpRenderCtx).reviews;

  const reviewsFn = useServerFn(getGoogleReviews);
  const { data: gr } = useQuery({
    queryKey: ["lp-google-reviews"],
    queryFn: () => reviewsFn(),
    enabled: useGoogle,
    initialData: seeded ?? undefined,
    staleTime: 10 * 60_000,
  });

  // Source: live Google reviews, with a graceful fallback to manual items.
  const googleItems = (gr?.reviews ?? []).map((rv: GoogleReview) => ({ name: rv.author, text: rv.text, isGoogle: true }));
  const items = useGoogle
    ? (googleItems.length > 0 ? googleItems : (s.items ?? []).map((i) => ({ ...i, isGoogle: false })))
    : (s.items ?? []).map((i) => ({ ...i, isGoogle: false }));

  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  if (items.length === 0) return null;
  return (
    <section className="bg-stone-50 px-6 py-16">
      <div className="mx-auto max-w-3xl">
        {s.title && (
          <div className="mb-10 flex flex-col items-center text-center">
            <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{s.title}</h2>
            <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
          </div>
        )}
        {items.map((item, d) => (
          <div key={`${item.name}-${d}`} className={d === i % items.length ? "block" : "hidden"}>
            <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
              <Quote className="mx-auto h-7 w-7 text-amber-600/40" />
              <p className="mt-4 text-base leading-relaxed text-stone-600">&ldquo;{item.text}&rdquo;</p>
              {item.name && <p className="mt-5 text-sm font-semibold text-stone-700">— {item.name}</p>}
            </div>
            {item.isGoogle && (
              <div className="mt-2 flex items-center justify-end gap-1.5 pr-2 text-xs text-stone-500">
                <span className="font-bold text-stone-700">G</span>
                <span>Google</span>
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3, 4].map((star) => (
                    <Star key={star} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {items.length > 1 && (
          <div className="mt-5 flex justify-center gap-2">
            {items.map((_: (typeof items)[number], d: number) => (
              <button key={d} onClick={() => setI(d)} aria-label={`Testimoni ${d + 1}`}
                className={`h-2 rounded-full transition-all ${d === i % items.length ? "w-6 bg-amber-700" : "w-2 bg-stone-300"}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Date Picker — availability widget (same flow as homepage) ───── */
function DatePickerSection({ s }: { s: LPDatePickerSection }) {
  const ctx = useContext(BookingCtx);
  const [localIn, setLocalIn] = useState("");
  const [localOut, setLocalOut] = useState("");
  const [localInOpen, setLocalInOpen] = useState(false);
  const [localOutOpen, setLocalOutOpen] = useState(false);

  const today = ctx?.today ?? "";
  const checkIn = ctx?.checkIn ?? localIn;
  const checkOut = ctx?.checkOut ?? localOut;
  const checkInOpen = ctx?.checkInOpen ?? localInOpen;
  const checkOutOpen = ctx?.checkOutOpen ?? localOutOpen;
  const setCheckInOpen = ctx?.setCheckInOpen ?? setLocalInOpen;
  const setCheckOutOpen = ctx?.setCheckOutOpen ?? setLocalOutOpen;

  const handleCheckInChange = ctx?.handleCheckInChange ?? ((val) => {
    const setCheckIn = ctx?.setCheckIn ?? setLocalIn;
    const setCheckOut = ctx?.setCheckOut ?? setLocalOut;
    setCheckIn(val);
    setCheckInOpen(false);
    if (!checkOut || checkOut <= val) {
      setCheckOut(isoAddDays(val, 1));
    }
    setTimeout(() => {
      setCheckOutOpen(true);
    }, 150);
  });

  const setCheckOut = ctx?.setCheckOut ?? setLocalOut;

  const onSubmit = () => {
    const el = document.getElementById("lp-room-slider");
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    // No room slider on this page → go straight to booking.
    const qs = checkIn && checkOut ? `?checkIn=${checkIn}&checkOut=${checkOut}` : "";
    window.location.href = `/book${qs}`;
  };

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xl">
        {s.heading && <p className="mb-3 text-center font-serif text-lg font-bold text-amber-700">{s.heading}</p>}
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-stone-500">Check-In</label>
            <Suspense fallback={<div className="h-10 w-full rounded-md border border-stone-200 bg-white" />}>
            <DatePickerID
              value={checkIn}
              onChange={handleCheckInChange}
              min={today}
              open={checkInOpen}
              onOpenChange={setCheckInOpen}
              placeholder="Pilih tanggal"
              className="h-10"
            />
            </Suspense>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-stone-500">Check-Out</label>
            <Suspense fallback={<div className="h-10 w-full rounded-md border border-stone-200 bg-white" />}>
            <DatePickerID
              value={checkOut}
              onChange={setCheckOut}
              min={checkIn ? isoAddDays(checkIn, 1) : today}
              open={checkOutOpen}
              onOpenChange={setCheckOutOpen}
              placeholder="Pilih tanggal"
              className="h-10"
            />
            </Suspense>
          </div>
          <button type="button" onClick={onSubmit}
            className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-8 text-sm font-semibold text-white transition hover:bg-amber-800">
            {s.buttonLabel || "Cek Ketersediaan"}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Slider Kamar — room carousel from the booking system ─────────── */
type LPRoomType = {
  id: string; name: string; slug: string;
  description?: string | null; base_rate: number | string;
  capacity?: number | null; size_sqm?: number | null; hero_image_url?: string | null;
};

function RoomSliderSection({ s }: { s: LPRoomSliderSection }) {
  const ctx = useContext(BookingCtx);
  const today = ctx?.today ?? "";
  const checkIn = ctx?.checkIn ?? "";
  const checkOut = ctx?.checkOut ?? "";
  const rooms = useContext(LpRenderCtx).rooms;

  // Default to today → tomorrow so cards always reflect availability.
  const usingFilter = !!checkIn && !!checkOut && checkIn < checkOut;
  const effIn = usingFilter ? checkIn : today;
  const effOut = usingFilter ? checkOut : today ? isoAddDays(today, 1) : "";

  const availFn = useServerFn(checkRoomTypeAvailability);
  const { data: availData } = useQuery({
    queryKey: ["lp-availability", effIn, effOut],
    staleTime: 0,
    queryFn: () => availFn({ data: { checkIn: effIn, checkOut: effOut } }),
    enabled: !!effIn && !!effOut && effIn < effOut,
  });
  const availability = availData?.availability ?? null;

  const displayRooms = useMemo(() => {
    const resolvedRates = availData?.rates ?? null;
    if (!resolvedRates) return rooms;
    return rooms.map((rt: any) => {
      const rateInfo = resolvedRates[rt.id];
      if (rateInfo) {
        return {
          ...rt,
          base_rate: rateInfo.base_rate,
        };
      }
      return rt;
    });
  }, [rooms, availData?.rates]);

  const per = Math.max(1, Math.min(s.cardsPerView ?? 3, 4));
  const [cardsPerView, setCardsPerView] = useState(per);
  useEffect(() => {
    const update = () => setCardsPerView(window.innerWidth < 640 ? 1 : per);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [per]);

  const maxIndex = Math.max(0, displayRooms.length - cardsPerView);
  const [i, setI] = useState(0);
  useEffect(() => { setI((v) => Math.min(v, maxIndex)); }, [maxIndex]);

  useEffect(() => {
    if (!(s.autoplay ?? true) || displayRooms.length <= cardsPerView || (s.slideMs ?? 4000) <= 0) return;
    const t = setInterval(() => setI((v) => (v >= maxIndex ? 0 : v + 1)), s.slideMs ?? 4000);
    return () => clearInterval(t);
  }, [s.autoplay, s.slideMs, displayRooms.length, cardsPerView, maxIndex]);

  return (
    <section id="lp-room-slider" className="scroll-mt-4 bg-[#f3ece0] py-16">
      <div className="mx-auto max-w-6xl px-6">
        {(s.title || s.subheading) && (
          <div className="mb-2 text-center">
            {s.title && <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{publicCopy(s.title)}</h2>}
            {s.subheading && <p className="mx-auto mt-3 max-w-md text-sm text-stone-500">{s.subheading}</p>}
          </div>
        )}
        {(usingFilter || today) && (
          <p className="mb-2 text-center text-sm font-medium text-stone-600">
            {usingFilter ? `Ketersediaan: ${checkIn} – ${checkOut}` : "Ketersediaan kamar hari ini"}
          </p>
        )}

        {displayRooms.length === 0 ? (
          <p className="mt-10 text-center text-sm text-stone-400">Belum ada kamar tersedia.</p>
        ) : (
          <div className="relative mt-8">
            <div className="overflow-hidden">
              <div className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${i * (100 / cardsPerView)}%)` }}>
                {displayRooms.map((rt) => (
                  <div key={rt.id} className="shrink-0 px-3" style={{ width: `${100 / cardsPerView}%` }}>
                    <article className="h-full overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl">
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-amber-50">
                        {rt.hero_image_url
                          ? <img src={buildStorageImageUrl(rt.hero_image_url, { width: 640, quality: 60 })} width={640} height={480} alt={rt.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                          : <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest text-amber-700/60">Foto Kamar</div>}
                      </div>
                      <div className="p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-serif text-xl font-semibold text-stone-900">{rt.name}</h3>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
                              {[rt.capacity && `${rt.capacity} TAMU`, rt.size_sqm && `${rt.size_sqm} M²`].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] text-stone-400">
                              {usingFilter ? "Harga" : "Harga Hari Ini"}
                            </p>
                            <p className="text-lg font-bold text-amber-700">Rp {Number(rt.base_rate).toLocaleString("id-ID")}</p>
                          </div>
                        </div>
                        {rt.description && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-500">{rt.description}</p>}
                        {availability && availability[rt.id] === false ? (
                          <span className="mt-5 block cursor-not-allowed rounded-lg bg-stone-300 py-2.5 text-center text-sm font-semibold text-stone-500">Tidak Tersedia</span>
                        ) : (
                          <Link to="/rooms/$slug" params={{ slug: rt.slug }}
                            search={{ checkIn: checkIn || undefined, checkOut: checkOut || undefined }}
                            className="mt-5 block rounded-lg border border-amber-700 bg-white py-2.5 text-center text-sm font-semibold text-amber-700 transition hover:bg-amber-50">
                            Pesan Kamar
                          </Link>
                        )}
                      </div>
                    </article>
                  </div>
                ))}
              </div>
            </div>
            {maxIndex > 0 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button onClick={() => setI((v) => Math.max(0, v - 1))} aria-label="Sebelumnya"
                  className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex gap-1.5">
                  {Array.from({ length: maxIndex + 1 }).map((_, d) => (
                    <button key={d} onClick={() => setI(d)} aria-label={`Halaman ${d + 1}`}
                      className={`h-2 rounded-full transition-all ${d === i ? "w-6 bg-amber-700" : "w-2 bg-stone-300"}`} />
                  ))}
                </div>
                <button onClick={() => setI((v) => Math.min(maxIndex, v + 1))} aria-label="Berikutnya"
                  className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Nav ───────────────────────────────────────────────────────── */
function LPNav({
  ctaUrl,
  ctaText,
  overlay = false,
  logoUrl,
  brand = "Pomah Guesthouse",
  logoSize = 36,
  links,
}: {
  ctaUrl: string;
  ctaText: string;
  /** Floats over the hero the same way as the homepage header. */
  overlay?: boolean;
  logoUrl?: string | null;
  brand?: string;
  logoSize?: number;
  links?: Array<{ label: string; url: string }>;
}) {
  const ctaHref = rewritePublicHref(ctaUrl);
  const [open, setOpen] = useState(false);
  const items = (links?.length
    ? links
    : [
        { label: "Beranda", url: "/" },
        { label: "Kamar", url: "/#rooms" },
      ]
  ).map((item) => ({ ...item, label: publicCopy(item.label) }));
  const linkClass = overlay
    ? "text-sm font-medium text-white transition hover:text-white/70"
    : "text-sm font-medium text-stone-700 transition hover:text-amber-700";
  return (
    <nav
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-50"
          : "sticky top-0 z-40 border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur-sm"
      }
      style={
        overlay
          ? { background: "transparent", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }
          : undefined
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <Link to="/" className="flex min-w-0 items-center" title={brand}>
          {logoUrl ? (
            <BrandLogo
              src={logoUrl}
              alt={brand}
              height={overlay ? logoSize : Math.min(logoSize, 40)}
              className="w-auto max-w-[150px] object-contain sm:max-w-[220px]"
            />
          ) : (
            <span className="flex items-baseline gap-1.5">
              <span className={`font-serif text-xl font-bold sm:text-2xl ${overlay ? "text-white" : "text-stone-900"}`}>
                Pomah
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${overlay ? "text-white/70" : "text-stone-400"}`}>
                guesthouse
              </span>
            </span>
          )}
        </Link>
        <div className={`hidden items-center gap-4 md:flex lg:gap-7 ${overlay ? "text-white" : "text-stone-700"}`}>
          {items.map((item) => (
            <a key={`${item.label}-${item.url}`} href={rewritePublicHref(item.url)} className={linkClass}>
              {item.label}
            </a>
          ))}
          {overlay ? null : (
            <a
              href={ctaHref}
              className="rounded-full bg-amber-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              {ctaText || "Pesan Sekarang"}
            </a>
          )}
        </div>
        <button
          className={`md:hidden rounded-full p-2 ${overlay ? "bg-black/35 text-white" : "text-stone-700"}`}
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="mx-3 mb-3 space-y-3 rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-lg md:hidden">
          {items.map((item) => (
            <a
              key={`${item.label}-${item.url}`}
              href={rewritePublicHref(item.url)}
              className="block text-sm text-stone-600"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <a href={ctaHref} className="block rounded-full bg-amber-700 py-2 text-center text-sm font-semibold text-white">
            {ctaText || "Pesan Sekarang"}
          </a>
        </div>
      )}
    </nav>
  );
}

