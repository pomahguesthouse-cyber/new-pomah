import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, MapPin, Phone, Mail, Instagram, Menu, X, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type HomepageConfig } from "@/admin/modules/homepage/homepage.config";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { buildStorageImageUrl, buildStorageImageSrcSet } from "@/lib/storage-image";

// Lebar responsif untuk hero image — disesuaikan dengan breakpoint umum.
const HERO_WIDTHS = [640, 960, 1280, 1600, 1920];
const HERO_SIZES = "100vw";

/* ------------------------------------------------------------------ */
/* Public Nav                                                           */
/* ------------------------------------------------------------------ */
export function PublicNav({
  property,
  showBackHome = false,
  transparent = false,
}: {
  property?: {
    name?: string | null;
    logo_url?: string | null;
  } | null;
  showBackHome?: boolean;
  transparent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fullName = property?.name || "Pomah Guesthouse";
  const parts = fullName.split(" ");
  const firstWord = parts[0];
  const restWords = parts.slice(1).join(" ");
  return (
    <nav className={`z-50 transition-all duration-300 ${
      transparent 
        ? "absolute top-0 left-0 right-0 border-b border-white/10 bg-transparent" 
        : "sticky top-0 border-b border-stone-200 bg-white/95 backdrop-blur-sm shadow-sm"
    }`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link to="/" className="flex items-center">
          {property?.logo_url ? (
            <img
              src={property.logo_url}
              alt={fullName}
              className="h-8 max-w-[180px] object-contain"
            />
          ) : (
            <div className="flex items-center gap-2">
              <div className={`flex items-center justify-center rounded-md p-1.5 ${transparent ? "bg-white/10 text-white" : "bg-[#1A3620] text-white"}`}>
                <Home className="w-5 h-5" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className={`font-serif text-xl font-semibold tracking-tight ${transparent ? "text-white" : "text-stone-900"}`}>
                  {firstWord}
                </span>
                {restWords && (
                  <span className={`font-serif text-xl font-light ${transparent ? "text-amber-300 animate-pulse" : "text-amber-700"}`}>{restWords}</span>
                )}
              </div>
            </div>
          )}
        </Link>
 
        {/* Desktop menu */}
        <div className="hidden items-center gap-8 md:flex">
          <Link
            to="/"
            className={`text-sm transition-colors font-medium ${transparent ? "text-stone-200 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
          >
            Beranda
          </Link>
          <Link
            to="/rooms"
            className={`text-sm transition-colors font-medium ${transparent ? "text-stone-200 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
          >
            Kamar
          </Link>
          <Link
            to="/explore"
            className={`text-sm transition-colors font-medium ${transparent ? "text-stone-200 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
          >
            Jelajahi Semarang
          </Link>
          <Link
            to="/book"
            search={{}}
            className={`text-sm transition-colors font-medium ${transparent ? "text-stone-200 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
          >
            Fasilitas
          </Link>
          <Link
            to="/book"
            search={{}}
            className={`text-sm transition-colors font-medium ${transparent ? "text-stone-200 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
          >
            Lokasi
          </Link>
          {showBackHome ? (
            <Button asChild size="sm" variant="outline" className={`border-stone-300 hover:bg-stone-100 ${transparent ? "bg-white/10 text-white border-white/20 hover:bg-white/20 hover:text-white" : ""}`}>
              <Link to="/">
                Kembali
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" className="bg-amber-700 hover:bg-amber-800">
              <Link to="/book" search={{}}>
                Pesan Sekarang
              </Link>
            </Button>
          )}
        </div>
 
        {/* Mobile menu toggle */}
        <button
          className={`md:hidden ${transparent ? "text-white" : "text-stone-700"}`}
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
 
      {/* Mobile dropdown */}
      {open && (
        <div className={`border-t md:hidden ${transparent ? "border-white/10 bg-stone-950/95 backdrop-blur-md" : "border-stone-100 bg-white"}`}>
          <div className="flex flex-col gap-1 px-6 py-4">
            {[
              { to: "/", label: "Beranda" },
              { to: "/rooms", label: "Kamar" },
              { to: "/explore", label: "Jelajahi Semarang" },
              { to: "/book", label: "Fasilitas" },
              { to: "/book", label: "Lokasi" },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`py-2 text-sm ${transparent ? "text-stone-300 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
              >
                {item.label}
              </Link>
            ))}
            {showBackHome ? (
              <Button asChild size="sm" variant="outline" className={`mt-2 border-stone-300 hover:bg-stone-100 ${transparent ? "bg-white/10 text-white border-white/20 hover:bg-white/20" : ""}`}>
                <Link to="/" onClick={() => setOpen(false)}>
                  Kembali
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm" className="mt-2 bg-amber-700 hover:bg-amber-800">
                <Link to="/book" search={{}} onClick={() => setOpen(false)}>
                  Pesan Sekarang
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Public Footer                                                        */
/* ------------------------------------------------------------------ */
export function PublicFooter({
  property,
}: {
  property?: {
    name?: string;
    address?: string | null;
    city?: string | null;
    whatsapp_number?: string | null;
    email?: string | null;
  } | null;
}) {
  const fullName = property?.name || "Pomah Guesthouse";
  const parts = fullName.split(" ");
  const firstWord = parts[0];
  const restWords = parts.slice(1).join(" ");

  return (
    <footer className="border-t border-teal-800/30 bg-teal-950 text-teal-100/90">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-2xl font-semibold text-white">{firstWord}</span>
              {restWords && (
                <span className="font-serif text-2xl font-light text-amber-400">{restWords}</span>
              )}
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-teal-200/80">
              Guesthouse butik dengan pengalaman menginap yang personal. Setiap tamu adalah tamu
              istimewa.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <a
                href="#"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-teal-800 text-teal-200/80 transition hover:border-amber-400 hover:text-amber-400"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href={
                  property?.whatsapp_number
                    ? `https://wa.me/${property.whatsapp_number.replace(/\D/g, "")}`
                    : "#"
                }
                className="flex h-8 w-8 items-center justify-center rounded-full border border-teal-800 text-teal-200/80 transition hover:border-amber-400 hover:text-amber-400"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-teal-400/85">
              Navigasi
            </p>
            <ul className="space-y-2 text-sm">
              {[
                { to: "/", label: "Beranda" },
                { to: "/rooms", label: "Kamar" },
                { to: "/explore", label: "Jelajahi Semarang" },
                { to: "/book", label: "Reservasi" },
              ].map((l) => (
                <li key={l.label}>
                  <Link to={l.to} className="text-teal-200/80 transition hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-teal-400/85">
              Kontak
            </p>
            <ul className="space-y-3 text-sm">
              {property?.address && (
                <li className="flex items-start gap-2 text-teal-200/80">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    {property.address}
                    {property.city ? `, ${property.city}` : ""}
                  </span>
                </li>
              )}
              {property?.whatsapp_number && (
                <li className="flex items-center gap-2 text-teal-200/80">
                  <Phone className="h-4 w-4 shrink-0 text-amber-500" />
                  <a
                    href={`https://wa.me/${property.whatsapp_number.replace(/\D/g, "")}`}
                    className="hover:text-white"
                  >
                    {property.whatsapp_number}
                  </a>
                </li>
              )}
              {property?.email && (
                <li className="flex items-center gap-2 text-teal-200/80">
                  <Mail className="h-4 w-4 shrink-0 text-amber-500" />
                  <a href={`mailto:${property.email}`} className="hover:text-white">
                    {property.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-teal-900/30 pt-8 md:flex-row">
          <p className="text-xs text-teal-400/60">
            © {new Date().getFullYear()} {fullName}. Semua hak dilindungi.
          </p>
          <Link
            to="/login"
            className="font-mono text-[10px] uppercase tracking-widest text-teal-400/40 hover:text-teal-300/60"
          >
            Staff Login
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Extracted Page Builder Components                                   */
/* ------------------------------------------------------------------ */

export type Pb = { isBuilder: boolean; sel: string | null; onSelect: (key: string) => void };

/** Wraps a homepage section so it is click-to-select inside the builder.
 *  `layout` (optional) applies admin-edited paddingTop / paddingBottom /
 *  textAlign overrides — honoured in both builder and production. */
export function PbZone({
  id,
  label,
  pb,
  children,
  layout,
}: {
  id: string;
  label: string;
  pb: Pb;
  children: React.ReactNode;
  layout?: {
    textAlign?: "left" | "center" | "right";
    paddingTop?: number;
    paddingBottom?: number;
    backgroundColor?: string;
  };
}) {
  // NOTE: backgroundColor is intentionally NOT applied here on the wrapper —
  // sections render their own background, and applying it on the wrapper too
  // produced a visible double-paint when the user changed colours. The
  // section render reads `cfg.sectionLayouts?.<id>?.backgroundColor` itself
  // so the new colour wins as a single source of truth.
  const style: React.CSSProperties | undefined = layout
    ? {
        ...(typeof layout.paddingTop === "number" ? { paddingTop: `${layout.paddingTop}px` } : {}),
        ...(typeof layout.paddingBottom === "number"
          ? { paddingBottom: `${layout.paddingBottom}px` }
          : {}),
        ...(layout.textAlign ? { textAlign: layout.textAlign } : {}),
      }
    : undefined;
  if (!pb.isBuilder) {
    if (!style) return <>{children}</>;
    return <div style={style}>{children}</div>;
  }
  const active = pb.sel === id;
  return (
    <div
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pb.onSelect(id);
      }}
      style={style}
      className={`relative ${
        active
          ? "outline outline-2 -outline-offset-2 outline-orange-500"
          : "hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-orange-300"
      }`}
    >
      {active && (
        <span className="pointer-events-none absolute right-0 top-0 z-[60] rounded-bl bg-orange-500 px-2 py-0.5 text-[10px] font-medium text-white">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

export function PomahNav({
  name,
  logo,
  header,
  pb,
}: {
  name: string;
  logo: string | null;
  header: HomepageConfig["header"];
  pb: Pb;
}) {
  // Visual preset drives layout (overlay vs in-flow) and colour scheme.
  const style = header.style ?? "pill";
  const overlay = style === "pill" || style === "transparent"; // floats over hero
  const darkText = style === "pill" || style === "minimal"; // dark text on light bg

  // Scroll behaviour: "scroll" leaves the header in flow; the others pin
  // it with `position: fixed` (reliable regardless of ancestor overflow).
  const mode = header.scrollBehavior;
  const pinned = mode !== "scroll";
  const headerHeight = Math.max(header.logoSize, 36) + 32;

  const [hidden, setHidden] = useState(false);
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    if (mode !== "disappear" && mode !== "fade") {
      setHidden(false);
      setFaded(false);
      return;
    }
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (mode === "disappear") setHidden(y > 120 && y > last);
      if (mode === "fade") setFaded(y > 120);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [mode]);

  let positionClass: string;
  if (overlay) {
    positionClass = "absolute inset-x-0 top-0";
  } else if (pinned) {
    positionClass = "fixed inset-x-0 top-0";
  } else {
    positionClass = "relative";
  }
  const needsSpacer = !overlay && pinned;
  const navBg = style === "solid" ? header.bgColor : "transparent";
  const selected = pb.isBuilder && pb.sel === "header";

  const logoEl = (
    <Link to="/" className="flex items-baseline gap-1.5" title={name} key="logo">
      {logo ? (
        <img
          src={logo}
          alt={name}
          style={{ height: header.logoSize }}
          className="w-auto max-w-[240px] object-contain"
        />
      ) : (
        <>
          <span className={`font-serif text-2xl font-bold ${darkText ? "text-stone-900" : "text-white"}`}>
            Pomah
          </span>
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
              darkText ? "text-stone-400" : "text-white/70"
            }`}
          >
            guesthouse
          </span>
        </>
      )}
    </Link>
  );

  const linksEl = (
    <div
      className={`hidden items-center gap-7 text-sm font-medium md:flex ${
        darkText ? "text-stone-700" : "text-white"
      }`}
      key="links"
    >
      {header.links.map((n) => (
        <a
          key={n.label}
          href={n.href}
          className={`transition ${darkText ? "hover:text-amber-700" : "hover:text-white/70"}`}
        >
          {n.label}
        </a>
      ))}
    </div>
  );

  const actionsEl = (
    <div className="flex items-center gap-3" key="actions">
      <button className={`md:hidden ${darkText ? "text-stone-700" : "text-white"}`} aria-label="Menu">
        <Menu className="h-5 w-5" />
      </button>
    </div>
  );

  const slots =
    header.logoPosition === "center"
      ? [linksEl, logoEl, actionsEl]
      : header.logoPosition === "right"
        ? [linksEl, actionsEl, logoEl]
        : [logoEl, linksEl, actionsEl];

  return (
    <>
      <nav
        onClickCapture={
          pb.isBuilder
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                pb.onSelect("header");
              }
            : undefined
        }
        className={`z-50 transition-all duration-300 ${positionClass} ${
          style === "minimal" ? "border-b border-stone-200 bg-white" : ""
        } ${header.dropShadow && (style === "solid" || style === "minimal") ? "shadow-md" : ""} ${
          selected ? "outline outline-2 -outline-offset-2 outline-orange-500" : ""
        }`}
        style={{
          background: navBg,
          transform: hidden ? "translateY(-110%)" : undefined,
          opacity: faded ? 0 : undefined,
          ...(header.blur
            ? {
                backdropFilter: `blur(${header.blurAmount}px)`,
                WebkitBackdropFilter: `blur(${header.blurAmount}px)`,
              }
            : {}),
        }}
      >
        {selected && (
          <span className="pointer-events-none absolute right-0 top-0 z-[60] rounded-bl bg-orange-500 px-2 py-0.5 text-[10px] font-medium text-white">
            Header
          </span>
        )}
        <div
          className={
            style === "pill"
              ? "mx-auto mt-4 flex max-w-6xl items-center justify-between gap-4 rounded-full border border-stone-100 bg-white/95 px-6 py-3 text-stone-800 shadow-lg backdrop-blur"
              : "mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4"
          }
        >
          {slots}
        </div>
        <span className="sr-only">{name}</span>
      </nav>
      {needsSpacer && <div style={{ height: headerHeight }} aria-hidden />}
    </>
  );
}

export function PomahFooter({ name }: { name: string }) {
  return (
    <footer className="bg-teal-900 text-teal-100">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-3">
        <div>
          <p className="font-serif text-xl font-bold uppercase tracking-wide text-white">{name}</p>
          <p className="mt-3 max-w-xs text-sm text-teal-200/80">
            Experience comfort and hospitality at {name}.
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal-300">
            Quick Links
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link to="/" className="transition hover:text-white">
                Home
              </Link>
            </li>
            <li>
              <Link to="/rooms" className="transition hover:text-white">
                Rooms
              </Link>
            </li>
            <li>
              <a href="#facilities" className="transition hover:text-white">
                Amenities
              </a>
            </li>
            <li>
              <a href="#lokasi" className="transition hover:text-white">
                Lokasi
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal-300">
            Follow Us
          </p>
          <a
            href="#"
            aria-label="Instagram"
            className="mt-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-teal-700 text-teal-200 transition hover:border-white hover:text-white"
          >
            <Instagram className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div className="border-t border-teal-800/60 py-5 text-center text-xs text-teal-300/70">
        © {new Date().getFullYear()} {name}. Semua hak dilindungi.
      </div>
    </footer>
  );
}

const HERO_ANIM: Record<string, string> = {
  fade: "animate-in fade-in duration-700",
  slide: "animate-in slide-in-from-right-full duration-500 ease-out",
  zoom: "animate-in zoom-in-95 duration-700",
  none: "",
};

export function HeroSlider({
  hero,
  fallbackTitle,
  accent,
  rating,
  actions,
}: {
  hero: HomepageConfig["hero"];
  fallbackTitle: string;
  /** Optional gold script accent rendered just under the heading (home only). */
  accent?: string;
  /** Optional Google-rating badge shown under the subheading (home only). */
  rating?: { score: number; total: number };
  /** Optional CTA buttons rendered under the badge (home only). */
  actions?: React.ReactNode;
}) {
  const slides = hero.slides.length
    ? hero.slides
    : [{ imageUrl: "", videoUrl: "", heading: fallbackTitle, subheading: "" }];
  const [i, setI] = useState(0);

  useEffect(() => {
    if (slides.length < 2 || hero.autoplayMs <= 0) return;
    const t = setInterval(() => setI((v) => (v + 1) % slides.length), hero.autoplayMs);
    return () => clearInterval(t);
  }, [slides.length, hero.autoplayMs]);

  const active = slides[i % slides.length];
  const go = (d: number) => setI((v) => (v + d + slides.length) % slides.length);

  return (
    <header
      className="relative w-full overflow-hidden"
      style={{ height: hero.height, zIndex: hero.layer }}
    >
      <div key={i} className={`absolute inset-0 ${HERO_ANIM[hero.transition] ?? ""}`}>
        {active.videoUrl ? (
          <video
            src={active.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : active.imageUrl ? (
          <img
            src={buildStorageImageUrl(active.imageUrl, { width: 1600, quality: 75 })}
            srcSet={buildStorageImageSrcSet(active.imageUrl, HERO_WIDTHS, { quality: 75 })}
            sizes={HERO_SIZES}
            alt={active.heading}
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-800 via-amber-700 to-amber-900" />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div
          className={`relative mx-auto flex h-full max-w-6xl flex-col justify-center px-6 ${
            hero.textAlign === "left"
              ? "items-start text-left"
              : hero.textAlign === "right"
                ? "items-end text-right"
                : "items-center text-center"
          }`}
        >
          <h1
            className={`hero-heading max-w-3xl tracking-tight drop-shadow ${
              hero.fontFamily === "mono"
                ? "font-mono"
                : hero.fontFamily === "sans"
                  ? "font-sans"
                  : "font-serif"
            }`}
            style={
              {
                "--fs-mob": `${hero.fontSizeMobile ?? 32}px`,
                "--fs-desk": `${hero.fontSize}px`,
                fontSize: "var(--fs-mob)",
                lineHeight: 1.1,
                fontStyle: hero.fontStyle === "italic" ? "italic" : "normal",
                fontWeight: hero.fontStyle === "bold" ? 700 : 400,
                color: hero.color || "#ffffff",
              } as React.CSSProperties
            }
          >
            <style>{`
              @media (min-width: 768px) {
                .hero-heading {
                  font-size: var(--fs-desk) !important;
                }
              }
            `}</style>
            {active.heading}
          </h1>
          {accent && (
            <p className="mt-1 font-serif text-3xl italic text-amber-300 drop-shadow md:text-4xl">
              {accent}
            </p>
          )}
          {active.subheading && (
            <>
              <span className="my-4 h-px w-40 bg-white/70" />
              <p className="text-base text-white/90 md:text-lg">{active.subheading}</p>
            </>
          )}
          {rating && (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-1.5 text-sm font-medium text-stone-800 shadow">
              <span className="font-bold">G</span>
              <span>Google Rating {rating.score.toFixed(1)}</span>
              <span className="flex gap-0.5">
                {[0, 1, 2, 3, 4].map((s) => (
                  <Star key={s} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
              </span>
              <span className="text-stone-500">{rating.total} ulasan</span>
            </div>
          )}
          {actions && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>
          )}
        </div>
      </div>
      {slides.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            aria-label="Sebelumnya"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white hover:bg-white/40"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Berikutnya"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white hover:bg-white/40"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((s, d) => (
              <button
                key={d}
                onClick={() => setI(d)}
                aria-label={`Slide ${d + 1}`}
                className={`h-2 rounded-full transition-all ${
                  d === i % slides.length ? "w-6 bg-white" : "w-2 bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </header>
  );
}

