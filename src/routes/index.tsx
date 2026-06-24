// LOCKED: Halaman utama "/" WAJIB merender landing Pomah Guesthouse.
// JANGAN mengganti file ini dengan landing lain (mis. Baboo / template generik)
// kecuali diminta eksplisit oleh pemilik. Lihat mem://constraints/homepage-pomah-lock.
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { buildStorageImageUrl, buildStorageImageSrcSet } from "@/lib/storage-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Wifi,
  Building2,
  Car,
  Coffee,
  MapPin,
  Clock,
  Star,
  CalendarDays,
  MessageCircle,
  Menu,
  Quote,
  Instagram,
  ChevronLeft,
  ChevronRight,
  Users,
  BedDouble,
  Headphones,
  ChevronDown,
  Search,
  Plus,
  Minus,
  X,
  Trash2,
  Tv,
  Wind,
  Bath,
  Utensils,
  CheckCircle2,
} from "lucide-react";
import {
  getPublicSiteData,
  checkRoomTypeAvailability,
  submitCartBooking,
  getMediaAssetByName,
} from "@/public/functions/public.functions";
import { getGoogleReviews, type GoogleReview } from "@/public/functions/google-reviews.functions";
import {
  mergeHomepageConfig,
  type HomepageConfig,
  type HomeSectionKey,
} from "@/admin/modules/homepage/homepage.config";
import { mergeExploreConfig } from "@/admin/modules/explore/explore.config";
import { listActivePublicEvents } from "@/admin/modules/seo/schedules.functions";
import { getPublicExploreItems } from "@/public/functions/public.functions";
import type { RoomRow } from "@/routes/rooms.$slug";
import { DEFAULT_HOTEL_POLICY } from "@/public/lib/hotel-policy";
// Lazy-load BookingDialog — komponen ini hanya dibutuhkan saat user
// membuka dialog booking, sehingga tidak perlu masuk initial bundle.
const BookingDialog = lazy(() =>
  import("@/routes/rooms.$slug").then((m) => ({ default: m.BookingDialog })),
);
import { PomahNav, PomahFooter, HeroSlider, PbZone } from "@/public/components/public-shell";
import { DateRangePickerID } from "@/components/ui/date-range-picker";

export const Route = createFileRoute("/")({
  loader: async () => getPublicSiteData(),
  // Data property + room types jarang berubah; cache 1 jam mengurangi
  // beban server dan mempercepat navigasi balik ke home.
  staleTime: 60 * 60 * 1000,


  head: ({ loaderData }: any) => {
    const cfg = mergeHomepageConfig(
      (loaderData?.property as { homepage_config?: unknown } | undefined)?.homepage_config,
    );
    const seo = cfg.seo;
    const title = seo.metaTitle || "Pomah Guesthouse Semarang | Hotel Murah & Nyaman di Semarang";
    const desc =
      seo.metaDescription ||
      "Pomah Guesthouse — penginapan murah dan nyaman di Kota Semarang. Kamar bersih, pelayanan ramah, lokasi strategis.";
    const heroImageRaw = cfg.hero.slides?.[0]?.imageUrl;
    const heroImage = heroImageRaw
      ? buildStorageImageUrl(heroImageRaw, { width: 1600, quality: 75 })
      : "";
    const heroImageSrcSet = heroImageRaw
      ? buildStorageImageSrcSet(heroImageRaw, [640, 960, 1280, 1600, 1920], { quality: 75 })
      : undefined;
    const domain = loaderData?.property?.public_domain || "pomahliving.com";
    const canonicalUrl = `https://${domain.replace(/^https?:\/\//, "")}/`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(seo.ogImageUrl ? [{ property: "og:image", content: seo.ogImageUrl }] : []),
      ],
      links: [
        { rel: "canonical", href: canonicalUrl },
        ...(heroImage
          ? [
              {
                rel: "preload",
                as: "image",
                href: heroImage,
                imagesrcset: heroImageSrcSet,
                imagesizes: "100vw",
                fetchpriority: "high" as const,
              },
            ]
          : []),
      ],
    };
  },
  component: PomahHome,
});


/* ------------------------------------------------------------------ */
/* Static content (no DB source)                                       */
/* ------------------------------------------------------------------ */

const FACILITIES = [
  { icon: Wifi, title: "Free Wifi", desc: "Wifi di Ruang Publik" },
  { icon: Building2, title: "Balkon", desc: "Balkon" },
  { icon: Car, title: "Free Parking", desc: "Parkir Gratis" },
  { icon: Coffee, title: "Mini Cafe", desc: "Mini Cafe" },
];

/** Trust badges shown as an icon row just under the hero / date picker. */
const FEATURE_BADGES = [
  { icon: Star, title: "Rating Google", desc: "76 ulasan" },
  { icon: BedDouble, title: "Kamar Bersih", desc: "Nyaman & terawat" },
  { icon: Users, title: "Cocok untuk", desc: "Keluarga" },
  { icon: MapPin, title: "Lokasi Strategis", desc: "Dekat kampus & kota" },
  { icon: Headphones, title: "Pelayanan Ramah", desc: "Siap membantu" },
];

const REVIEWS = [
  "Kmr nya bersih, rapih dekat dgn Unnes.... pelayanan ramah sekali",
  "Tempatnya nyaman, cocok untuk keluarga. Parkir luas dan aman.",
  "Penginapan murah tapi kualitas oke, staff sangat membantu.",
];

const ID_DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const ID_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
/** Add `n` days to a `YYYY-MM-DD` string. */
function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
/** "2026-05-18" → "18/05/2026" */
function fmtDateID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
/** "2026-05-18" → "18/05/2026" (Full Date disamakan formatnya) */
function fmtFullDateID(iso: string): string {
  return fmtDateID(iso);
}
/** "2026-05-31" → "31-Mei-2026" — dash-separated, Indonesian month names. */
function fmtDateDashedID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()}-${ID_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
/** "2026-05-31" → "31 Mei 2026" — space-separated, for headline display. */
function fmtDateSpacedID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "2026-05-31" → "Minggu" — day-of-week in Bahasa Indonesia. */
function fmtDayNameID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return ID_DAYS[d.getDay()];
}
/** "2026-05-31" → "31 Mei" — day + month, no year. */
function fmtDayMonthID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${ID_MONTHS[d.getMonth()]}`;
}
/** "2026-05-31" → "2026" — year only. */
function fmtYearID(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return String(d.getFullYear());
}
/**
 * Parse a free-text Indonesian date ("05 Mei 2026", "10-12 September 2026")
 * into a sortable epoch (ms). Uses the START day of any range. Returns 0 when
 * the month/year can't be found, so unparseable items sort last.
 */
function parseIdDate(s: string): number {
  if (!s) return 0;
  const lower = s.toLowerCase();
  const monthIdx = ID_MONTHS.findIndex((m) => lower.includes(m.toLowerCase()));
  const yearMatch = lower.match(/\d{4}/);
  if (monthIdx < 0 || !yearMatch) return 0;
  const dayMatch = lower.match(/\b\d{1,2}\b/);
  const day = dayMatch ? parseInt(dayMatch[0], 10) : 1;
  return new Date(parseInt(yearMatch[0], 10), monthIdx, day).getTime();
}

/** Whole nights between two `YYYY-MM-DD` strings. */
function nightsBetween(a: string, b: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function PomahHome() {
  const loaderData = Route.useLoaderData();
  return <PomahHomeView initialData={loaderData} />;
}

/**
 * Komponen utama yang merender seluruh tampilan Home.
 * Dapat dipakai ulang oleh `/lp/$slug` ketika halaman LP merupakan
 * hasil duplikasi Home (kolom `homepage_config` terisi) — diberikan
 * `configOverride` agar konfigurasinya dipakai sebagai pengganti
 * konfigurasi homepage properti.
 */
export function PomahHomeView({
  initialData,
  configOverride,
}: {
  initialData?: unknown;
  configOverride?: HomepageConfig;
}) {
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fetchData(),
    initialData: initialData as never,
    staleTime: 60 * 60 * 1000,
  });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

  // Total normal capacity = sum of (capacity + extrabed_capacity) × total_physical_rooms per room type
  const totalNormalCapacity = (rooms as RoomType[]).reduce((sum: number, rt: RoomType) => {
    const cap = Number(rt.capacity ?? 0);
    const ebCap = Number(rt.extrabed_capacity ?? 0);
    const physRooms = Number(rt.total_physical_rooms ?? 0);
    return sum + (cap + ebCap) * physRooms;
  }, 0);

  const reviewsFn = useServerFn(getGoogleReviews);
  const { data: gr } = useQuery({
    queryKey: ["google-reviews"],
    queryFn: () => reviewsFn(),
    staleTime: 10 * 60 * 1000,
  });

  const gRating = gr?.rating ?? 4.8;
  const gTotal = gr?.total ?? 76;
  const gReviews = gr?.reviews ?? [];

  // Diagnostic: log why the Google reviews widget falls back to static.
  useEffect(() => {
    if (gr && gr.status !== "OK") {
      console.warn(`[Google Reviews] tidak tampil — status: ${gr.status}`);
    }
  }, [gr]);

  const propertyName = property?.name ?? "Pomah Guesthouse";
  const wa = property?.whatsapp_number?.replace(/\D/g, "") ?? "";
  const address = property?.address ?? "Pomah Guesthouse Semarang";
  const logoUrl = (property as { logo_url?: string | null } | null | undefined)?.logo_url ?? null;
  const cfg = configOverride ?? mergeHomepageConfig(
    (property as { homepage_config?: unknown } | null | undefined)?.homepage_config,
  );

  // News & Event slider — sourced ENTIRELY from explore_items (where the
  // Content Manager Agent writes its discoveries). Only is_published=true
  // rows appear here; drafts stay invisible until admin approves them.
  // Manual exploreCfg.events / exploreCfg.news arrays + the AI scheduler's
  // active_public_events view are no longer used as homepage sources —
  // single source of truth.
  void mergeExploreConfig; // keep import side-effect free for other usages
  void listActivePublicEvents;

  const { data: cityGuideItems } = useQuery({
    queryKey: ["public-explore-items"],
    queryFn: () => getPublicExploreItems(),
    staleTime: 5 * 60 * 1000,
  });

  const newsEvents = (cityGuideItems ?? [])
    .map((it: any) => {
      const ts = it.date_text ? parseIdDate(it.date_text) : Date.now();
      const categoryLabel = it.badge
        ? it.badge
        : it.category === "event"
        ? "Event"
        : it.category === "destinasi"
        ? "Destinasi"
        : it.category === "kuliner"
        ? "Kuliner"
        : "Tips";
      return {
        date: it.date_text || it.location_text || "",
        category: categoryLabel,
        title: it.title,
        excerpt: it.description ?? "",
        image: it.image_url || "",
        ts,
      };
    })
    .sort((a: any, b: any) => b.ts - a.ts)
    .slice(0, 12);

  // Advanced SEO — inject custom head markup + JSON-LD for the home page.
  useEffect(() => {
    const seo = cfg.seo;
    const added: Node[] = [];
    if (seo.customHead) {
      const tpl = document.createElement("template");
      tpl.innerHTML = seo.customHead;
      tpl.content.childNodes.forEach((node) => {
        if (node.nodeName === "SCRIPT") {
          const orig = node as HTMLScriptElement;
          const sc = document.createElement("script");
          Array.from(orig.attributes).forEach((a) => sc.setAttribute(a.name, a.value));
          sc.textContent = orig.textContent;
          document.head.appendChild(sc); added.push(sc);
        } else {
          const clone = node.cloneNode(true);
          document.head.appendChild(clone); added.push(clone);
        }
      });
    }
    if (seo.jsonLdEnabled && seo.customJsonLd?.trim()) {
      const sc = document.createElement("script");
      sc.type = "application/ld+json";
      sc.textContent = seo.customJsonLd;
      document.head.appendChild(sc); added.push(sc);
    }
    return () => added.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
  }, [cfg.seo.customHead, cfg.seo.customJsonLd, cfg.seo.jsonLdEnabled]);

  // Page Builder integration: when loaded inside the builder iframe
  // (`?builder=1`), sections become click-to-select and report back.
  const [isBuilder, setIsBuilder] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const builder = new URLSearchParams(window.location.search).get("builder") === "1";
    setIsBuilder(builder);
    if (!builder) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.source === "pb-host") setSel(e.data.section ?? null);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const pbSelect = (key: string) => {
    setSel(key);
    window.parent?.postMessage({ source: "pb", section: key }, "*");
  };
  const pb = { isBuilder, sel, onSelect: pbSelect };

  // Booking date-picker state — driven by DateRangePickerID which
  // sets both ends in one update.
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  const [guests, setGuests] = useState(1);
  // Cart of rooms picked from the carousel; keyed by room type id.
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const cartEntries = Object.values(cart);
  const cartOpen = cartEntries.length > 0;
  // Booking dialog only opens after the user confirms on the side panel.
  const [dialogOpen, setDialogOpen] = useState(false);

  const addToCart = (rt: RoomType) => {
    if (cart[rt.id]) return;
    setCart((c) => ({
      ...c,
      [rt.id]: {
        room: {
          id: rt.id,
          name: rt.name,
          slug: rt.slug,
          description: rt.description ?? null,
          base_rate: rt.base_rate,
          capacity: rt.capacity ?? null,
          bed_type: null,
          floor_info: null,
          size_sqm: rt.size_sqm ?? null,
          amenities: null,
          hero_image_url: rt.hero_image_url ?? null,
          images: null,
          extrabed_rate: rt.extrabed_rate ?? null,
          extrabed_capacity: rt.extrabed_capacity ?? null,
          total_physical_rooms: rt.total_physical_rooms ?? null,
        },
        rooms: 1,
        extrabed: 0,
      },
    }));
  };
  const setCartRooms = (id: string, n: number) =>
    setCart((c) => {
      if (!c[id]) return c;
      if (n <= 0) {
        // Remove the entry.
        const { [id]: _drop, ...rest } = c;
        return rest;
      }
      // Clamp extrabed to new max (rooms × extrabed_capacity per room)
      const perRoomCap = Math.max(0, Number(c[id].room.extrabed_capacity ?? 0));
      const newMaxExtrabed = perRoomCap * n;
      const clampedExtrabed = Math.min(c[id].extrabed, newMaxExtrabed);
      return { ...c, [id]: { ...c[id], rooms: n, extrabed: clampedExtrabed } };
    });
  const setCartExtrabed = (id: string, n: number) =>
    setCart((c) =>
      c[id] ? { ...c, [id]: { ...c[id], extrabed: Math.max(0, n) } } : c,
    );
  const removeFromCart = (id: string) =>
    setCart((c) => {
      const { [id]: _drop, ...rest } = c;
      return rest;
    });

  // Detect when the sticky date picker pins to the top — used to stretch
  // the bar full-width and reveal the logo on the left. Uses a sentinel placed
  // above the sticky wrapper: when it scrolls out of view (top < 0), pinned.
  const [stuck, setStuck] = useState(false);
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stuckSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    obs.observe(el);
    // Initial check (in case the page loads already scrolled).
    setStuck(el.getBoundingClientRect().top < 0);
    return () => obs.disconnect();
  }, []);
  const [today, setToday] = useState("");
  useEffect(() => {
    const d = new Date();
    setToday(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`,
    );
  }, []);

  // Room availability — uses the picked dates, or today → tomorrow by
  // default so the cards always reflect today's availability.
  const usingDateFilter = !!checkIn && !!checkOut && checkIn < checkOut;
  const effCheckIn = usingDateFilter ? checkIn : today;
  const effCheckOut = usingDateFilter ? checkOut : today ? isoAddDays(today, 1) : "";

  const availFn = useServerFn(checkRoomTypeAvailability);
  const { data: availData } = useQuery({
    queryKey: ["availability", effCheckIn, effCheckOut],
    queryFn: () => availFn({ data: { checkIn: effCheckIn, checkOut: effCheckOut } }),
    enabled: !!effCheckIn && !!effCheckOut && effCheckIn < effCheckOut,
    staleTime: 60 * 1000,
  });
  const availability = availData?.availability ?? null;
  const availableRooms = availData?.availableRooms ?? null;

  const resolvedRates = availData?.rates ?? null;
  const displayRooms = useMemo(() => {
    if (!resolvedRates) return rooms;
    return rooms.map((rt: any) => {
      const rateInfo = resolvedRates[rt.id];
      if (rateInfo) {
        return {
          ...rt,
          base_rate: rateInfo.base_rate,
          extrabed_rate: rateInfo.extrabed_rate,
        };
      }
      return rt;
    });
  }, [rooms, resolvedRates]);

  useEffect(() => {
    if (!resolvedRates) return;
    setCart((currentCart) => {
      let changed = false;
      const newCart = { ...currentCart };
      for (const id of Object.keys(newCart)) {
        const rateInfo = resolvedRates[id];
        if (rateInfo) {
          const room = newCart[id].room;
          if (room.base_rate !== rateInfo.base_rate || room.extrabed_rate !== rateInfo.extrabed_rate) {
            newCart[id] = {
              ...newCart[id],
              room: {
                ...room,
                base_rate: rateInfo.base_rate,
                extrabed_rate: rateInfo.extrabed_rate,
              },
            };
            changed = true;
          }
        }
      }
      return changed ? newCart : currentCart;
    });
  }, [resolvedRates]);

  return (
    <div className="relative min-h-screen bg-[#f6f1e8] text-stone-800">
      <PomahNav name={propertyName} logo={logoUrl} header={cfg.header} pb={pb} />

      <PbZone id="hero" label="Hero Slider" pb={pb} layout={cfg.sectionLayouts?.hero}>
        <HeroSlider
          hero={cfg.hero}
          fallbackTitle={`Selamat Datang Di ${propertyName}`}
          accent={cfg.hero.accent}
          rating={{ score: gRating, total: gTotal }}
          actions={
            <>
              <Link
                to="/book"
                search={{}}
                className="inline-flex items-center gap-2 rounded-full bg-amber-700 px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-800"
              >
                <CalendarDays className="h-4 w-4" />
                Pesan kamar sekarang
              </Link>
              {wa && (
                <a
                  href={`https://wa.me/${wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-stone-800 shadow-lg transition hover:bg-amber-50"
                >
                  <MessageCircle className="h-4 w-4 text-green-600" />
                  Chat WhatsApp
                </a>
              )}
            </>
          }
        />
      </PbZone>

      {/* ── DATE PICKER WIDGET ── */}
      {cfg.datePicker.enabled && (
        <PbZone id="datepicker" label="Date Picker" pb={pb} layout={cfg.sectionLayouts?.datepicker}>
          {/* Sentinel — when this leaves the viewport from the top, the picker
              below has pinned. Observed by the stuck IntersectionObserver. */}
          <div ref={stuckSentinelRef} aria-hidden className="hidden h-px md:-mt-12 md:block" />
          <div
            className={`fixed inset-x-0 bottom-0 px-0 pb-0 transition-all duration-500 ease-out md:sticky md:bottom-auto md:left-auto md:right-auto md:top-0 md:mx-auto md:-mt-12 md:pb-0 ${
              stuck ? "md:max-w-full md:px-10" : "md:max-w-4xl md:px-6"
            }`}
            style={{ zIndex: 60 }}
          >
            <div
              className={`border border-stone-200 bg-white px-3 py-2 shadow-xl md:px-8 md:py-4 ${
                stuck
                  ? "md:rounded-b-2xl md:flex md:items-center md:gap-4"
                  : "rounded-t-2xl md:rounded-2xl md:rounded-b-2xl"
              }`}
            >
              {stuck && (
                <Link
                  to="/"
                  aria-label={propertyName}
                  className="hidden shrink-0 items-center gap-2 border-r border-stone-200 pr-4 transition-opacity duration-500 md:flex"
                >
                  {cfg.datePicker.logoUrl || logoUrl ? (
                    <img
                      src={cfg.datePicker.logoUrl || logoUrl || undefined}
                      alt={propertyName}
                      className="h-16 w-auto object-contain"
                    />
                  ) : (
                    <>
                      <span className="font-serif text-3xl font-bold text-stone-900">Pomah</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-stone-400">
                        guesthouse
                      </span>
                    </>
                  )}
                </Link>
              )}
              <div className={stuck ? "md:min-w-0 md:flex-1" : ""}>
              {cfg.datePicker.heading && (
                <p
                  className={`mb-3 hidden text-center md:block ${
                    cfg.datePicker.fontFamily === "mono"
                      ? "font-mono"
                      : cfg.datePicker.fontFamily === "sans"
                        ? "font-sans"
                        : cfg.datePicker.fontFamily === "brother-signature"
                          ? "font-brother-signature"
                          : "font-serif"
                  }`}
                  style={{
                    fontSize: cfg.datePicker.fontSize,
                    fontStyle: cfg.datePicker.fontStyle === "italic" ? "italic" : "normal",
                    fontWeight: cfg.datePicker.fontStyle === "bold" ? 700 : 400,
                    color: cfg.datePicker.color || "#7c4a21",
                  }}
                >
                  {cfg.datePicker.heading}
                </p>
              )}
              <div className="flex flex-row items-end gap-1.5 md:gap-3">
                <Field label="Tanggal Menginap" className="flex-1 min-w-0">
                  <DateRangePickerID
                    className="bg-[#5f6d61] text-white hover:bg-[#5f6d61]/90 border-none"
                    checkIn={checkIn || null}
                    checkOut={checkOut || null}
                    min={today}
                    onChange={({ checkIn: ci, checkOut: co }) => {
                      setCheckIn(ci);
                      setCheckOut(co);
                    }}
                  />
                </Field>
                <Field label="Tamu" className="flex-none w-[72px] md:flex-1 md:w-auto">
                  <div className="relative">
                    <Users className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 md:left-3" />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={30}
                      value={guests === 0 ? "" : guests}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "") {
                          setGuests(0);
                        } else {
                          const parsed = parseInt(val, 10);
                          if (!isNaN(parsed)) {
                            setGuests(Math.min(30, parsed));
                          }
                        }
                      }}
                      onBlur={() => {
                        if (guests < 1) {
                          setGuests(1);
                        }
                      }}
                      className="h-11 w-full rounded-md border border-stone-200 bg-background pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-amber-500 md:h-10 md:pl-9 md:pr-4 md:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("our-room")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  aria-label={cfg.datePicker.buttonLabel}
                  className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white transition hover:bg-amber-800 md:h-10 md:px-8"
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden md:inline">{cfg.datePicker.buttonLabel}</span>
                </button>
              </div>
              </div>
            </div>
          </div>
        </PbZone>
      )}

      {cfg.sectionOrder.map((key) => (
        <Fragment key={key}>{renderHomeSection(key)}</Fragment>
      ))}

      <PomahFooter name={propertyName} property={property} />

      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hubungi via WhatsApp"
          // z-[70] so it floats ABOVE the bottom-pinned date picker (z-60).
          // On mobile the picker hugs bottom-0 — lift the button above it
          // with bottom-24, then restore bottom-5 on md+ where the picker
          // sits at the top.
          className="fixed bottom-24 right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600 md:bottom-5 md:right-5"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}

      {dialogOpen && cartEntries.length === 1 && effCheckIn && effCheckOut && (
        <Suspense fallback={null}>
          <BookingDialog
            open={true}
            onClose={() => setDialogOpen(false)}
            room={cartEntries[0].room}
            checkIn={effCheckIn}
            checkOut={effCheckOut}
            onCheckInChange={(v) => setCheckIn(v)}
            onCheckOutChange={(v) => setCheckOut(v)}
            rooms={cartEntries[0].rooms}
            extrabed={cartEntries[0].extrabed}
            maxRooms={Math.max(
              1,
              Number(cartEntries[0].room.total_physical_rooms ?? 0) || 10,
            )}
            guests={guests}
            hotelPolicy={
              (property as { hotel_policy?: string | null } | null | undefined)?.hotel_policy ??
              DEFAULT_HOTEL_POLICY
            }
          />
        </Suspense>
      )}
      {dialogOpen && cartEntries.length > 1 && effCheckIn && effCheckOut && (
        <CartBookingDialog
          open={true}
          onClose={() => setDialogOpen(false)}
          cart={cartEntries}
          checkIn={effCheckIn}
          checkOut={effCheckOut}
          guests={guests}
        />
      )}
    </div>
  );

  /* ── Reorderable content sections (order controlled by cfg.sectionOrder) ── */
  function renderHomeSection(key: HomeSectionKey): React.ReactNode {
    switch (key) {
      case "badges": {
        const b = cfg.badges;
        return (
          <PbZone id="badges" label="Ikon Fitur" pb={pb} layout={cfg.sectionLayouts?.badges}>
            <section className="mx-auto max-w-5xl px-6 pt-16 pb-8">
              {b.heading && (
                <div className="mb-10">
                  <SectionHeading
                    fontFamily={b.fontFamily}
                    fontSize={b.fontSize}
                    fontStyle={b.fontStyle}
                    color={b.color}
                    uppercase={cfg.sectionLayouts?.badges?.uppercase}
                  >
                    {b.heading}
                  </SectionHeading>
                </div>
              )}
              <div
                className="grid gap-2 md:gap-6"
                style={{ gridTemplateColumns: `repeat(${b.items?.length || 1}, 1fr)` }}
              >
                {b.items?.map((item, idx) => {
                  const IconComp = (() => {
                    switch (item.iconName) {
                      case "Star": return Star;
                      case "BedDouble": return BedDouble;
                      case "Users": return Users;
                      case "MapPin": return MapPin;
                      case "Headphones": return Headphones;
                      case "Wifi": return Wifi;
                      case "Coffee": return Coffee;
                      case "Car": return Car;
                      default: return Star;
                    }
                  })();
                  const isCustom = item.iconName === "custom";

                  return (
                    <div key={idx} className="flex flex-col items-center text-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-700 text-white shadow-sm md:h-12 md:w-12 overflow-hidden">
                        {isCustom && item.iconUrl ? (
                          <img src={item.iconUrl} className="h-full w-full object-cover" alt="" />
                        ) : (
                          <IconComp className="h-4 w-4 md:h-5 md:w-5" />
                        )}
                      </span>
                      <p className="mt-2 text-xs font-semibold text-stone-800 md:text-sm">{item.title}</p>
                      <p className="text-[10px] text-stone-400 md:text-xs">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </PbZone>
        );
      }
      case "story":
        return (
          <PbZone id="story" label="Your Perfect Stay" pb={pb} layout={cfg.sectionLayouts?.story}>
            <section className="mx-auto max-w-4xl px-6 py-20 text-center">
              <SectionHeading
                fontFamily={cfg.story.fontFamily}
                fontSize={cfg.story.fontSize}
                fontStyle={cfg.story.fontStyle}
                color={cfg.story.color}
                uppercase={cfg.sectionLayouts?.story?.uppercase}
              >
                {cfg.story.heading}
              </SectionHeading>
              <div className="mt-8 space-y-5 text-base leading-relaxed text-stone-500">
                {cfg.story.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          </PbZone>
        );
      case "reviews":
        return (
          <PbZone id="reviews" label="Google Rating" pb={pb} layout={cfg.sectionLayouts?.reviews}>
            <section className="mx-auto max-w-4xl px-6 py-16">
              {cfg.reviews.heading && (
                <div className="mb-10">
                  <SectionHeading
                    fontFamily={cfg.reviews.fontFamily}
                    fontSize={cfg.reviews.fontSize}
                    fontStyle={cfg.reviews.fontStyle}
                    color={cfg.reviews.color}
                    uppercase={cfg.sectionLayouts?.reviews?.uppercase}
                  >
                    {cfg.reviews.heading}
                  </SectionHeading>
                </div>
              )}
              <div className="flex flex-col items-center">
                <p className="flex items-center gap-2 text-sm font-medium text-stone-600">
                  <span className="text-base font-bold">G</span> Google Rating
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Star
                        key={i}
                        className={`h-5 w-5 ${
                          i < Math.round(gRating)
                            ? "fill-amber-400 text-amber-400"
                            : "fill-stone-200 text-stone-200"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-2xl font-bold text-stone-800">{gRating.toFixed(1)}</span>
                </div>
                <p className="mt-1 text-xs text-stone-400">Berdasarkan {gTotal} ulasan Google</p>
              </div>
              <ReviewSlider
                items={
                  gReviews.length > 0
                    ? gReviews.map((rv: GoogleReview) => ({ text: rv.text, author: rv.author, isGoogle: true }))
                    : REVIEWS.map((r) => ({ text: r, author: null, isGoogle: false }))
                }
              />
            </section>
          </PbZone>
        );
      case "rooms":
        return (
          <PbZone id="carousel" label="Our Room" pb={pb} layout={cfg.sectionLayouts?.carousel}>
            <section
              id="our-room"
              className="relative scroll-mt-20 py-20 bg-cover bg-center bg-no-repeat"
              style={{
                zIndex: cfg.roomCarousel.layer,
                // Newest wins: the per-section override from the Page Builder
                // takes precedence over the legacy roomCarousel.bgColor field,
                // which falls back to the historic default. Avoids the
                // "double background" effect when both were set.
                backgroundColor:
                  cfg.sectionLayouts?.carousel?.backgroundColor ||
                  cfg.roomCarousel.bgColor ||
                  "#f3ece0",
                backgroundImage: cfg.roomCarousel.bgImageUrl ? `url(${cfg.roomCarousel.bgImageUrl})` : undefined,
              }}
            >
              <div className="mx-auto max-w-7xl px-6">
                <div className="text-center">
                  {(() => {
                    // Adapt the configurable heading when the user has picked
                    // a date range — swap "Hari Ini" → "Tanggal Pilihan Tamu"
                    // so the heading stays consistent with the date below.
                    const baseHeading = cfg.roomCarousel.heading || "Ketersediaan Kamar";
                    const headingText = usingDateFilter
                      ? baseHeading.replace(/hari ini/i, "Tanggal Pilihan Tamu")
                      : baseHeading;
                    return (
                      <div className="flex flex-col items-center justify-center gap-x-3 md:flex-row md:flex-wrap">
                        <SectionHeading
                          normalCase
                          noUnderline
                          uppercase={cfg.sectionLayouts?.carousel?.uppercase}
                          fontFamily={cfg.roomCarousel.fontFamily}
                          fontSize={cfg.roomCarousel.fontSize}
                          fontStyle={cfg.roomCarousel.fontStyle}
                          color={cfg.roomCarousel.color}
                        >
                          {headingText}
                        </SectionHeading>
                        {usingDateFilter && checkIn && checkOut ? (
                          <DateStack
                            fromIso={checkIn}
                            toIso={checkOut}
                            nights={nightsBetween(checkIn, checkOut)}
                          />
                        ) : today ? (
                          <DateStack fromIso={today} />
                        ) : null}
                      </div>
                    );
                  })()}
                  {cfg.roomCarousel.subheading && (
                    <p className="mx-auto mt-3 max-w-md text-sm text-stone-500">
                      {cfg.roomCarousel.subheading}
                    </p>
                  )}
                  {guests > totalNormalCapacity && totalNormalCapacity > 0 && wa && (
                    <div className="mx-auto mt-4 flex max-w-xl items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                      <MessageCircle className="h-5 w-5 shrink-0 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-amber-800">
                          Jumlah tamu melebihi kapasitas normal ({totalNormalCapacity} tamu)
                        </p>
                        <p className="mt-0.5 text-xs text-amber-700">
                          Silakan hubungi admin untuk pemesanan rombongan.
                        </p>
                      </div>
                      <a
                        href={`https://wa.me/${wa}?text=${encodeURIComponent(
                          `Halo, saya ingin memesan untuk ${guests} tamu (${fmtDateID(checkIn || today)} – ${fmtDateID(checkOut || (today ? isoAddDays(today, 1) : ""))}). Mohon bantuannya.`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-green-700"
                      >
                        Chat Admin
                      </a>
                    </div>
                  )}
                </div>
                <div
                  className={
                    cartOpen
                      ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
                      : ""
                  }
                >
                  <div className="min-w-0">
                    <RoomCarousel
                      rooms={displayRooms}
                      rc={cfg.roomCarousel}
                      availability={availability}
                      availableRooms={availableRooms}
                      checkIn={checkIn}
                      checkOut={checkOut}
                      guests={guests}
                      cart={cart}
                      cartOpen={cartOpen}
                      onAddRoom={addToCart}
                      onChangeRooms={setCartRooms}
                      onChangeExtrabed={setCartExtrabed}
                    />
                  </div>
                  {cartOpen && effCheckIn && effCheckOut && (
                    <div className="lg:pt-2">
                      <BookingSidePanel
                        cart={cartEntries}
                        checkIn={effCheckIn}
                        checkOut={effCheckOut}
                        guests={guests}
                        availableRooms={availableRooms}
                        onRemove={removeFromCart}
                        onClose={() => {
                          setCart({});
                          setDialogOpen(false);
                        }}
                        onConfirm={() => setDialogOpen(true)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          </PbZone>
        );
      case "facilities": {
        const fac = cfg.facilities;
        return (
          <PbZone id="facilities" label="Fasilitas" pb={pb} layout={cfg.sectionLayouts?.facilities}>
            <section id="facilities" className="mx-auto max-w-6xl px-6 py-20">
              <div className="text-center">
                <SectionHeading
                  fontFamily={fac.fontFamily}
                  fontSize={fac.fontSize}
                  fontStyle={fac.fontStyle}
                  color={fac.color}
                  uppercase={cfg.sectionLayouts?.facilities?.uppercase}
                >
                  {fac.heading}
                </SectionHeading>
                {fac.subheading && (
                  <p className="mx-auto mt-4 max-w-lg text-sm text-stone-500">
                    {fac.subheading}
                  </p>
                )}
              </div>
              <div className="mt-12 grid grid-cols-2 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {FACILITIES.map((f) => (
                  <div
                    key={f.title}
                    className="rounded-2xl border border-stone-200 bg-white p-4 text-center shadow-sm"
                  >
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                      <f.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 font-serif text-lg font-semibold text-stone-900">{f.title}</h3>
                    <p className="mt-1 text-sm text-stone-500">{f.desc}</p>
                  </div>
                ))}
              </div>
            </section>
          </PbZone>
        );
      }
      case "lokasi": {
        const lok = cfg.lokasi;
        return (
          <PbZone id="lokasi" label="Lokasi Kami" pb={pb} layout={cfg.sectionLayouts?.lokasi}>
            <section id="lokasi" className="bg-[#f3ece0] py-20">
              <div className="mx-auto max-w-6xl px-6">
                <div className="text-center">
                  <SectionHeading
                    fontFamily={lok.fontFamily}
                    fontSize={lok.fontSize}
                    fontStyle={lok.fontStyle}
                    color={lok.color}
                    uppercase={cfg.sectionLayouts?.lokasi?.uppercase}
                  >
                    {lok.heading}
                  </SectionHeading>
                  {lok.subheading && (
                    <p className="mt-3 text-sm text-stone-500">{lok.subheading}</p>
                  )}
                </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
                <iframe
                  title="Lokasi Pomah Guesthouse"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
                  className="h-80 w-full"
                  loading="lazy"
                />
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="flex items-center gap-2 font-serif text-lg font-semibold text-amber-700">
                  <MapPin className="h-5 w-5" />
                  {cfg.lokasi.nearbyTitle}
                </p>
                <div className="mt-3 space-y-2">
                  {cfg.lokasi.nearby.map((n, idx) => (
                    <div
                      key={`${n.name}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="h-6 w-6 shrink-0 rounded-full border-2 border-amber-600" />
                        <div>
                          <p className="text-sm font-semibold text-stone-800">{n.name}</p>
                          <p className="text-xs text-stone-400">{n.type}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="flex items-center gap-1 text-sm font-medium text-amber-700">
                          <MapPin className="h-3.5 w-3.5" />
                          {n.distance}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-stone-400">
                          <Clock className="h-3 w-3" />
                          {n.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
          </PbZone>
        );
      }
      case "news": {
        const n = cfg.news;
        return newsEvents.length > 0 ? (
          <PbZone id="news" label="Berita" pb={pb} layout={cfg.sectionLayouts?.news}>
            <section id="news-event" className="mx-auto max-w-6xl px-6 py-20">
              <div className="text-center">
                <SectionHeading
                  fontFamily={n.fontFamily}
                  fontSize={n.fontSize}
                  fontStyle={n.fontStyle}
                  color={n.color}
                  uppercase={cfg.sectionLayouts?.news?.uppercase}
                >
                  {n.heading}
                </SectionHeading>
                {n.subheading && (
                  <p className="mx-auto mt-4 max-w-lg text-sm text-stone-500">
                    {n.subheading}
                  </p>
                )}
              </div>
              <NewsEventSlider items={newsEvents} />
              <div className="mt-10 text-center">
                <Link
                  to="/explore"
                  className="inline-flex items-center gap-2 rounded-full bg-amber-700 px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800"
                >
                  Lihat Selengkapnya di City Guide
                </Link>
              </div>
            </section>
          </PbZone>
        ) : null;
      }
      case "cta":
        return (
          <PbZone id="cta" label="CTA Banner" pb={pb} layout={cfg.sectionLayouts?.cta}>
            <section className="mx-auto max-w-6xl px-6 pb-20">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-900 to-amber-700 px-8 py-12 text-center shadow-lg">
                <h2
                  className={`tracking-tight ${
                    cfg.cta.fontFamily === "mono"
                      ? "font-mono"
                      : cfg.cta.fontFamily === "sans"
                        ? "font-sans"
                        : cfg.cta.fontFamily === "brother-signature"
                          ? "font-brother-signature"
                          : "font-serif"
                  }`}
                  style={{
                    fontSize: cfg.cta.fontSize ? `${cfg.cta.fontSize}px` : undefined,
                    fontStyle: cfg.cta.fontStyle === "italic" ? "italic" : "normal",
                    fontWeight: cfg.cta.fontStyle === "bold" ? 700 : 400,
                    color: cfg.cta.color || "#ffffff",
                  }}
                >
                  {cfg.cta.heading || `Siap menginap di ${propertyName}?`}
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-amber-100">
                  Booking mudah dan cepat. Tim kami siap menyambut Anda.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    to="/book"
                    search={{}}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-50"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Pesan kamar sekarang
                  </Link>
                  {wa && (
                    <a
                      href={`https://wa.me/${wa}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/40 px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Chat WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </section>
          </PbZone>
        );
      default:
        return null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hero slider                                                          */
/* ------------------------------------------------------------------ */

/** Per-slide enter animation, keyed by the configured transition. */

/* ------------------------------------------------------------------ */
/* Room carousel                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Review slider                                                        */
/* ------------------------------------------------------------------ */

type ReviewSliderItem = { text: string; author: string | null; isGoogle?: boolean };

function ReviewSlider({ items }: { items: ReviewSliderItem[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items.length]);

  if (items.length === 0) return null;
  const idx = i % items.length;
  const cur = items[idx];

  return (
    <div className="mx-auto mt-6 max-w-xl">
      <div
        key={idx}
        className="animate-in fade-in rounded-2xl border border-stone-200 bg-white p-7 text-center shadow-sm duration-500"
      >
        <Quote className="mx-auto h-6 w-6 text-amber-600/40" />
        <p className="mt-3 text-sm leading-relaxed text-stone-600">&ldquo;{cur.text}&rdquo;</p>
        {cur.author && <p className="mt-4 text-xs font-semibold text-stone-700">— {cur.author}</p>}
      </div>
      {cur.isGoogle && (
        <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-stone-500 pr-2">
          <span className="font-bold text-stone-700">G</span>
          <span>Google</span>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((star) => (
              <Star key={star} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            ))}
          </div>
        </div>
      )}
      {items.length > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setI((v) => (v - 1 + items.length) % items.length)}
            aria-label="Sebelumnya"
            className="rounded-full border border-stone-300 bg-white p-1.5 text-amber-700 hover:bg-amber-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex gap-1.5">
            {items.map((_, d) => (
              <button
                key={d}
                onClick={() => setI(d)}
                aria-label={`Ulasan ${d + 1}`}
                className={`h-2 rounded-full transition-all ${
                  d === idx ? "w-6 bg-amber-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => setI((v) => (v + 1) % items.length)}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-1.5 text-amber-700 hover:bg-amber-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* News & Event slider                                                  */
/* ------------------------------------------------------------------ */

type NewsEventItem = {
  date: string;
  category: string;
  title: string;
  excerpt: string;
  image: string;
};

function getDisplayImageUrl(url: string | undefined | null) {
  if (!url) return "";
  if (url.includes("maps.googleapis.com/maps/api/place/photo")) {
    try {
      const parsedUrl = new URL(url);
      const photoReference = parsedUrl.searchParams.get("photo_reference");
      if (photoReference) {
        return `/api/place-photo?photo_reference=${encodeURIComponent(photoReference)}`;
      }
    } catch (e) {
      // ignore
    }
  }
  return url;
}

const handleImageError = (
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  fallbackType: "dest" | "culinary" | "event" | "news"
) => {
  const target = e.currentTarget;
  target.onerror = null;
  if (fallbackType === "culinary") {
    target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=400";
  } else if (fallbackType === "event") {
    target.src = "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=400";
  } else {
    target.src = "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600";
  }
};

function NewsEventSlider({ items }: { items: NewsEventItem[] }) {
  const [cardsPerView, setCardsPerView] = useState(3);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setCardsPerView(w < 640 ? 1 : w < 1024 ? 2 : 3);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const maxIndex = Math.max(0, items.length - cardsPerView);
  const isLoopable = items.length > cardsPerView;

  // Clone the edges so the track can wrap seamlessly in both directions.
  const extended = isLoopable
    ? [...items.slice(-cardsPerView), ...items, ...items.slice(0, cardsPerView)]
    : items;

  const [i, setI] = useState(isLoopable ? cardsPerView : 0);
  const [isTransitioning, setIsTransitioning] = useState(true);

  // Keep the index valid when cardsPerView changes on resize.
  useEffect(() => {
    setI(isLoopable ? cardsPerView : 0);
  }, [cardsPerView, isLoopable]);

  // Autoplay.
  useEffect(() => {
    if (!isLoopable) return;
    const t = setInterval(() => {
      setIsTransitioning(true);
      setI((v) => v + 1);
    }, 5000);
    return () => clearInterval(t);
  }, [isLoopable]);

  const handlePrev = () => {
    if (isLoopable) {
      setIsTransitioning(true);
      setI((v) => v - 1);
    } else {
      setI((v) => Math.max(0, v - 1));
    }
  };
  const handleNext = () => {
    if (isLoopable) {
      setIsTransitioning(true);
      setI((v) => v + 1);
    } else {
      setI((v) => Math.min(maxIndex, v + 1));
    }
  };

  // After landing on a cloned edge, snap (without animation) to the real slide.
  const handleTransitionEnd = () => {
    if (!isLoopable) return;
    if (i <= 0) {
      setIsTransitioning(false);
      setI(items.length);
    } else if (i >= items.length + cardsPerView) {
      setIsTransitioning(false);
      setI(cardsPerView);
    }
  };

  // Touch swipe.
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50) {
      if (dx > 0) handleNext();
      else handlePrev();
    }
    touchStartX.current = null;
  };

  if (items.length === 0) return null;

  const activeDot = isLoopable
    ? (((i - cardsPerView) % items.length) + items.length) % items.length
    : i;
  const totalDots = isLoopable ? items.length : maxIndex + 1;

  return (
    <div className="relative mt-12">
      <div className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div
          className="flex"
          style={{
            transform: `translateX(-${i * (100 / cardsPerView)}%)`,
            transition: isTransitioning ? "transform 500ms ease-out" : "none",
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          {extended.map((n, idx) => (
            <div
              key={`${n.title}-${n.date}-${idx}`}
              className="shrink-0 px-3"
              style={{ width: `${100 / cardsPerView}%` }}
            >
              <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl">
                {n.image && (
                  <div className="aspect-[16/9] w-full overflow-hidden bg-stone-100">
                    <img
                      src={getDisplayImageUrl(n.image)}
                      alt={n.title}
                      loading="lazy"
                      onError={(e) => handleImageError(e, n.category.toLowerCase().includes("event") ? "event" : "news")}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-stone-400">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {n.date}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      {n.category}
                    </span>
                  </div>
                  <h3 className="mt-4 font-serif text-lg font-semibold text-stone-900">{n.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-stone-500">{n.excerpt}</p>
                </div>
              </article>
            </div>
          ))}
        </div>
      </div>

      {totalDots > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={handlePrev}
            aria-label="Sebelumnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex gap-1.5">
            {Array.from({ length: totalDots }).map((_, d) => (
              <button
                key={d}
                onClick={() => {
                  setIsTransitioning(true);
                  setI(isLoopable ? d + cardsPerView : d);
                }}
                aria-label={`Halaman ${d + 1}`}
                className={`h-2 rounded-full transition-all ${
                  d === activeDot ? "w-6 bg-amber-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

type RoomType = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  base_rate: number | string;
  capacity?: number | null;
  size_sqm?: number | null;
  hero_image_url?: string | null;
  extrabed_rate?: number | string | null;
  extrabed_capacity?: number | null;
  total_physical_rooms?: number | null;
  amenities?: string[] | null;
};

/** One picked room in the homepage booking cart. */
type CartItem = { room: RoomRow; rooms: number; extrabed: number };

/* ------------------------------------------------------------------ */
/* Per-card jumlah kamar + extrabed steppers (replaces the CTA button   */
/* on a room card once it is added to the booking)                      */
/* ------------------------------------------------------------------ */

function RoomCardSteppers({
  rooms,
  extrabed,
  maxRooms,
  maxExtrabed,
  extrabedRate,
  onChangeRooms,
  onChangeExtrabed,
  onRemove,
  compact,
}: {
  rooms: number;
  extrabed: number;
  maxRooms: number;
  maxExtrabed: number;
  extrabedRate: number;
  onChangeRooms: (v: number) => void;
  onChangeExtrabed: (v: number) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const dec = (v: number, min = 0) => Math.max(min, v - 1);
  const incRooms = (v: number) => Math.min(maxRooms, v + 1);
  const incExtrabed = (v: number) => Math.min(maxExtrabed, v + 1);
  const btnSize = compact ? "h-6 w-6" : "h-8 w-8";
  const iconSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <div className={compact ? "mt-3 space-y-1.5" : "mt-5 space-y-2"}>
      <div className={`flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}>
        <div className="min-w-0">
          <p className={`font-semibold text-stone-900 ${compact ? "text-xs" : "text-sm"}`}>Jumlah Kamar</p>
          <p className={compact ? "text-[9px] text-stone-400" : "text-[10px] text-stone-400"}>Maksimal {maxRooms}</p>
        </div>
        <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
          <button
            type="button"
            onClick={() =>
              rooms <= 1 ? onRemove() : onChangeRooms(dec(rooms, 1))
            }
            className={`flex ${btnSize} items-center justify-center rounded-md border border-red-200 text-red-600 transition hover:bg-red-50`}
            aria-label={rooms <= 1 ? "Hapus" : "Kurangi"}
          >
            {rooms <= 1 ? <Trash2 className={iconSize} /> : <Minus className={iconSize} />}
          </button>
          <span className={`w-5 text-center font-bold text-stone-900 tabular-nums ${compact ? "text-xs" : "text-sm"}`}>{rooms}</span>
          <button
            type="button"
            onClick={() => onChangeRooms(incRooms(rooms))}
            disabled={rooms >= maxRooms}
            className={`flex ${btnSize} items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:bg-stone-100 disabled:opacity-40`}
            aria-label="Tambah"
          >
            <Plus className={iconSize} />
          </button>
        </div>
      </div>

      {maxExtrabed > 0 && (
        <div className={`flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}>
          <div className="min-w-0">
            <p className={`font-semibold text-stone-900 ${compact ? "text-xs" : "text-sm"}`}>
              Extrabed <span className={`font-normal text-stone-400 ${compact ? "text-[8px]" : "text-[10px]"}`}>(Maks {maxExtrabed})</span>
            </p>
            {extrabedRate > 0 && (
              <p className={compact ? "text-[9px] text-stone-400" : "text-[10px] text-stone-400"}>
                +{formatIDR(extrabedRate, "text-inherit", "font-sans font-semibold tabular-nums")}
              </p>
            )}
          </div>
          <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
            <button
              type="button"
              onClick={() => onChangeExtrabed(dec(extrabed))}
              disabled={extrabed <= 0}
              className={`flex ${btnSize} items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:bg-stone-100 disabled:opacity-40`}
              aria-label="Kurangi"
            >
              <Minus className={iconSize} />
            </button>
            <span className={`w-5 text-center font-bold text-stone-900 tabular-nums ${compact ? "text-xs" : "text-sm"}`}>{extrabed}</span>
            <button
              type="button"
              onClick={() => onChangeExtrabed(incExtrabed(extrabed))}
              disabled={extrabed >= maxExtrabed}
              className={`flex ${btnSize} items-center justify-center rounded-md border border-stone-300 text-stone-700 transition hover:bg-stone-100 disabled:opacity-40`}
              aria-label="Tambah"
            >
              <Plus className={iconSize} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cart booking dialog — contact form + submit for a multi-room cart    */
/* ------------------------------------------------------------------ */

function CartBookingDialog({
  open,
  onClose,
  cart,
  checkIn,
  checkOut,
  guests,
}: {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  checkIn: string;
  checkOut: string;
  guests: number;
}) {
  const navigate = useNavigate();
  const submitFn = useServerFn(submitCartBooking);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<"transfer" | "onsite">("transfer");
  const [pending, setPending] = useState(false);

  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() -
        new Date(`${checkIn}T00:00:00`).getTime()) /
        86400000,
    ),
  );
  const idr = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
  const grandTotal = cart.reduce((sum, item) => {
    const rate = Number(item.room.base_rate ?? 0);
    const erate = Number(item.room.extrabed_rate ?? 0);
    return sum + rate * nights * item.rooms + erate * nights * item.extrabed;
  }, 0);

  const onSubmit = async () => {
    if (!fullName.trim() || !phone.trim()) {
      toast.error("Lengkapi nama dan nomor WhatsApp");
      return;
    }
    setPending(true);
    try {
      const res = await submitFn({
        data: {
          fullName: fullName.trim(),
          email: email.trim() || `${phone.replace(/\D/g, "")}@guest.local`,
          phone: phone.trim(),
          cart: cart.map((item) => ({
            roomTypeId: item.room.id,
            quantity: item.rooms,
            extraBeds: item.extrabed,
          })),
          checkIn,
          checkOut,
          adults: guests,
          children: 0,
          paymentMethod: payment,
          specialRequests: "",
        },
      });
      toast.success("Pemesanan berhasil dibuat");
      navigate({
        to: "/book/confirmation/$id",
        params: { id: res.reference_code ?? res.id },
        search: {},
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Lengkapi Data Pemesan</DialogTitle>
          <DialogDescription>
            {cart.length} tipe kamar dipilih · {fmtDateID(checkIn)} → {fmtDateID(checkOut)}
          </DialogDescription>
        </DialogHeader>

        {/* Cart recap */}
        <div className="space-y-2 rounded-lg bg-stone-50 p-3 text-sm">
          {cart.map((item) => {
            const rate = Number(item.room.base_rate ?? 0);
            const erate = Number(item.room.extrabed_rate ?? 0);
            const sub = rate * nights * item.rooms + erate * nights * item.extrabed;
            return (
              <div key={item.room.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-stone-700">
                  {item.rooms}× {item.room.name}
                  {item.extrabed > 0 ? ` (+${item.extrabed} extrabed)` : ""}
                </span>
                <span className="shrink-0 font-medium text-stone-900">
                  {formatIDR(sub, "text-sm", "font-sans font-semibold tabular-nums")}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t border-stone-200 pt-2">
            <span className="font-semibold">Total</span>
            <span className="font-serif text-lg font-bold text-amber-700">
              {formatIDR(grandTotal, "text-lg", "font-sans font-bold text-amber-700 tabular-nums")}
            </span>
          </div>
        </div>

        {/* Contact form */}
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-xs font-medium">
              Nama Lengkap <span className="text-red-500">*</span>
            </Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Budi" />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium">
              Nomor WhatsApp <span className="text-red-500">*</span>
            </Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 812 3456 7890" />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium">Email (opsional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-medium">Metode Pembayaran</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["transfer", "onsite"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPayment(p)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs font-medium transition",
                    payment === p
                      ? "border-amber-500 bg-amber-50 text-amber-800"
                      : "border-input bg-background hover:bg-muted",
                  )}
                >
                  {p === "transfer" ? "Transfer Bank" : "Bayar di Tempat"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-700 py-3 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
        >
          {pending ? (
            "Memproses…"
          ) : (
            <span className="inline-flex items-center gap-1">
              Konfirmasi Pemesanan · {formatIDR(grandTotal, "text-sm text-white", "font-sans font-bold text-white tabular-nums")}
            </span>
          )}
        </button>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Inline booking summary panel                                         */
/* ------------------------------------------------------------------ */

function BookingSidePanel({
  cart,
  checkIn,
  checkOut,
  guests,
  availableRooms,
  onRemove,
  onClose,
  onConfirm,
}: {
  cart: CartItem[];
  checkIn: string;
  checkOut: string;
  guests: number;
  availableRooms?: Record<string, number> | null;
  onRemove: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() -
        new Date(`${checkIn}T00:00:00`).getTime()) /
        86400000,
    ),
  );
  const idr = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

  const hasConflicts = cart.some((item) => {
    const currentAvail = availableRooms !== undefined && availableRooms !== null
      ? availableRooms[item.room.id] ?? 0
      : null;
    return currentAvail !== null && currentAvail < item.rooms;
  });

  let grandTotal = 0;
  let totalCapacity = 0;
  let totalRooms = 0;
  for (const item of cart) {
    const currentAvail = availableRooms !== undefined && availableRooms !== null
      ? availableRooms[item.room.id] ?? 0
      : null;
    const isSoldOut = currentAvail === 0;

    if (!isSoldOut) {
      const rate = Number(item.room.base_rate ?? 0);
      const erate = Number(item.room.extrabed_rate ?? 0);
      grandTotal += rate * nights * item.rooms + erate * nights * item.extrabed;
      totalCapacity += (Number(item.room.capacity ?? 0) || 0) * item.rooms + item.extrabed;
      totalRooms += item.rooms;
    }
  }
  const capacityShort = totalCapacity > 0 && totalCapacity < guests;

  return (
    <div className="sticky top-28 rounded-3xl border border-stone-200 bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-2">
        <h3 className="font-serif text-xl font-bold text-stone-900">Ringkasan Booking</h3>
        <button
          onClick={onClose}
          aria-label="Tutup"
          className="rounded-full p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {hasConflicts && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-semibold">⚠️ Kamar Terpesan / Berkurang</p>
          <p className="mt-1 leading-relaxed">
            Beberapa kamar pilihan Anda baru saja terbooking via chatbot/tamu lain. Silakan sesuaikan atau hapus kamar tersebut.
          </p>
        </div>
      )}

      {/* Cart items */}
      <div className="mb-4 max-h-[44vh] space-y-3 overflow-y-auto pr-1">
        {cart.map((item) => {
          const rate = Number(item.room.base_rate ?? 0);
          const erate = Number(item.room.extrabed_rate ?? 0);
          const currentAvail = availableRooms !== undefined && availableRooms !== null
            ? availableRooms[item.room.id] ?? 0
            : null;
          const isSoldOut = currentAvail === 0;
          const isReduced = currentAvail !== null && currentAvail > 0 && currentAvail < item.rooms;
          const sub = rate * nights * item.rooms + erate * nights * item.extrabed;

          return (
            <div
              key={item.room.id}
              className={cn(
                "rounded-2xl border p-3 transition",
                isSoldOut
                  ? "border-red-200 bg-red-50/40"
                  : isReduced
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-stone-100 bg-stone-50/60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate font-semibold",
                      isSoldOut ? "text-stone-400 line-through decoration-red-400 decoration-2" : "text-stone-900",
                    )}
                  >
                    {item.room.name}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      isSoldOut ? "text-stone-400 line-through" : "text-stone-500",
                    )}
                  >
                    {item.rooms}× Kamar
                    {item.extrabed > 0 ? ` · ${item.extrabed}× Extrabed` : ""}
                  </p>
                  {isSoldOut && (
                    <span className="mt-1.5 inline-block rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">
                      Habis Terpesan (Chatbot/Tamu Lain)
                    </span>
                  )}
                  {isReduced && (
                    <span className="mt-1.5 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                      Sisa {currentAvail} Kamar (Tersedia Berkurang)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.room.id)}
                  aria-label="Hapus"
                  className="rounded-md p-1 text-stone-400 transition hover:bg-white hover:text-red-600 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p
                className={cn(
                  "mt-1 text-right text-sm font-medium",
                  isSoldOut ? "text-stone-400 line-through" : "text-stone-700",
                )}
              >
                {formatIDR(sub, "text-sm", "font-sans font-semibold tabular-nums")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Stay info + capacity */}
      <div className="mb-4 space-y-2 border-y border-stone-100 py-4 text-sm">
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-stone-500">
            <CalendarDays className="h-3.5 w-3.5" /> Check-in
          </span>
          <span className="font-medium text-stone-800">{fmtDateID(checkIn)}</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-stone-500">
            <CalendarDays className="h-3.5 w-3.5" /> Check-out
          </span>
          <span className="font-medium text-stone-800">{fmtDateID(checkOut)}</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-stone-500">
            <Clock className="h-3.5 w-3.5" /> Malam
          </span>
          <span className="font-medium text-stone-800">{nights}</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-stone-500">
            <Users className="h-3.5 w-3.5" /> Tamu
          </span>
          <span className="font-medium text-stone-800">{guests}</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-stone-500">
            <Users className="h-3.5 w-3.5" /> Kapasitas dipilih
          </span>
          <span
            className={`font-semibold ${
              capacityShort ? "text-red-600" : "text-amber-700"
            }`}
          >
            {totalCapacity} tamu
          </span>
        </div>
      </div>

      {/* Total */}
      <div className="mb-3 flex items-end justify-between">
        <span className="text-stone-600">Total ({totalRooms} kamar)</span>
        <span className="font-serif text-2xl font-bold text-amber-700">
          {formatIDR(grandTotal, "text-2xl", "font-sans font-bold text-amber-700 tabular-nums")}
        </span>
      </div>

      {capacityShort && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          Kapasitas masih kurang. Tambahkan kamar lain agar muat {guests} tamu.
        </p>
      )}

      <button
        onClick={onConfirm}
        disabled={hasConflicts}
        className="w-full rounded-xl bg-amber-700 py-3 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {hasConflicts ? "Sesuaikan Pilihan Kamar" : "Lanjutkan Pemesanan"}
      </button>
      <p className="mt-3 text-center text-[11px] text-stone-400">
        Isi data tamu di langkah berikutnya.
      </p>
    </div>
  );
}

const formatIDR = (
  n: number,
  sizeClass = "text-inherit",
  numberClass = "font-sans font-bold tabular-nums"
) => {
  return (
    <span className={`${sizeClass} inline-flex items-baseline font-sans`}>
      <span className="text-[0.75em] font-normal text-stone-500 mr-0.5 tracking-normal">Rp</span>
      <span className={numberClass}>{n.toLocaleString("id-ID")}</span>
    </span>
  );
};

const getAmenityIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("wifi") || n.includes("internet")) return <Wifi className="h-3.5 w-3.5" />;
  if (n.includes("ac") || n.includes("air cond") || n.includes("pendingin")) return <Wind className="h-3.5 w-3.5" />;
  if (n.includes("tv") || n.includes("televisi")) return <Tv className="h-3.5 w-3.5" />;
  if (n.includes("shower") || n.includes("kamar mandi") || n.includes("air panas") || n.includes("toilet") || n.includes("bathtub")) return <Bath className="h-3.5 w-3.5" />;
  if (n.includes("kopi") || n.includes("teh") || n.includes("kettle") || n.includes("coffee") || n.includes("minum") || n.includes("water")) return <Coffee className="h-3.5 w-3.5" />;
  if (n.includes("sarapan") || n.includes("breakfast") || n.includes("makan")) return <Utensils className="h-3.5 w-3.5" />;
  return <CheckCircle2 className="h-3.5 w-3.5" />;
};

function RoomCarousel({
  rooms,
  rc,
  availability,
  availableRooms,
  checkIn,
  checkOut,
  guests = 1,
  cart,
  cartOpen,
  onAddRoom,
  onChangeRooms,
  onChangeExtrabed,
}: {
  rooms: RoomType[];
  rc: HomepageConfig["roomCarousel"];
  availability: Record<string, boolean> | null;
  availableRooms?: Record<string, number> | null;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  cart?: Record<string, CartItem>;
  cartOpen?: boolean;
  onAddRoom?: (room: RoomType) => void;
  onChangeRooms?: (id: string, n: number) => void;
  onChangeExtrabed?: (id: string, n: number) => void;
}) {
  const usingDateFilter = !!checkIn && !!checkOut && checkIn < checkOut;
  const [cardsPerView, setCardsPerView] = useState(Math.max(1, Math.min(rc.cardsPerView, 4)));
  // Adjust cards per view for mobile screens (show 1 card on small widths)
  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      if (width < 640) { // Tailwind 'sm' breakpoint approx 640px
        setCardsPerView(1);
      } else {
        setCardsPerView(Math.max(1, Math.min(rc.cardsPerView, 4)));
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [rc.cardsPerView]);

  const maxIndex = Math.max(0, rooms.length - cardsPerView);
  const isLoopable = rooms.length > cardsPerView;

  // Clone slides for infinite loop
  const extendedRooms = isLoopable
    ? [
        ...rooms.slice(-cardsPerView),
        ...rooms,
        ...rooms.slice(0, cardsPerView),
      ]
    : rooms;

  const [i, setI] = useState(isLoopable ? cardsPerView : 0);
  const [isTransitioning, setIsTransitioning] = useState(true);

  // Sync index when cardsPerView changes on window resize
  useEffect(() => {
    if (isLoopable) {
      setI(cardsPerView);
    } else {
      setI(0);
    }
  }, [cardsPerView, isLoopable]);

  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const [touchEndY, setTouchEndY] = useState<number | null>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchEndY(null);
    setTouchStartX(e.targetTouches[0].clientX);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
    setTouchEndY(e.targetTouches[0].clientY);
  };

  const handlePrev = () => {
    if (isLoopable) {
      setIsTransitioning(true);
      setI((v) => v - 1);
    } else {
      setI((v) => Math.max(0, v - 1));
    }
  };

  const handleNext = () => {
    if (isLoopable) {
      setIsTransitioning(true);
      setI((v) => v + 1);
    } else {
      setI((v) => Math.min(rooms.length - cardsPerView, v + 1));
    }
  };

  const onTouchEnd = () => {
    if (!touchStartX || !touchEndX || !touchStartY || !touchEndY) return;
    const distanceX = touchStartX - touchEndX;
    const distanceY = touchStartY - touchEndY;
    if (Math.abs(distanceX) > Math.abs(distanceY) && Math.abs(distanceX) > minSwipeDistance) {
      if (distanceX > 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
  };

  const handleTransitionEnd = () => {
    if (!isLoopable) return;
    if (i <= 0) {
      setIsTransitioning(false);
      setI(rooms.length);
    } else if (i >= rooms.length + cardsPerView) {
      setIsTransitioning(false);
      setI(cardsPerView);
    }
  };

  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!rc.autoplay || !isLoopable || rc.slideMs <= 0 || hovered) return;
    const t = setInterval(() => {
      setIsTransitioning(true);
      setI((v) => v + 1);
    }, rc.slideMs);
    return () => clearInterval(t);
  }, [rc.autoplay, rc.slideMs, isLoopable, hovered]);

  if (rooms.length === 0) {
    return <p className="mt-12 text-center text-sm text-stone-400">Belum ada kamar tersedia.</p>;
  }

  const activeDot = isLoopable
    ? ((i - cardsPerView) % rooms.length + rooms.length) % rooms.length
    : i;

  const totalDots = isLoopable ? rooms.length : maxIndex + 1;

  return (
    <div
      className="relative mt-12"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left arrow */}
      {totalDots > 1 && (
        <button
          onClick={handlePrev}
          aria-label="Sebelumnya"
          className="absolute -left-4 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-stone-200 bg-white/90 p-2.5 text-amber-700 shadow-lg backdrop-blur transition hover:bg-amber-50 hover:shadow-xl md:flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {/* Right arrow */}
      {totalDots > 1 && (
        <button
          onClick={handleNext}
          aria-label="Berikutnya"
          className="absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-stone-200 bg-white/90 p-2.5 text-amber-700 shadow-lg backdrop-blur transition hover:bg-amber-50 hover:shadow-xl md:flex items-center justify-center"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      <div
        className="overflow-hidden py-4 -my-4"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex"
          style={{
            transform: `translateX(-${i * (100 / cardsPerView)}%)`,
            transition: isTransitioning ? 'transform 500ms ease-out' : 'none'
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          {extendedRooms.map((rt, idx) => (
            <div key={`${rt.id}-${idx}`} className="shrink-0 px-3" style={{ width: `${100 / cardsPerView}%` }}>
              <article className="h-full overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-amber-50">
                  {availableRooms !== undefined && availableRooms !== null && (
                    <div className="absolute left-3 top-3 z-10">
                      {(() => {
                        const count = availableRooms[rt.id] ?? 0;
                        if (count === 0) {
                          return (
                            <span className="rounded-full bg-red-600/90 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
                              Habis Terpesan
                            </span>
                          );
                        }
                        if (count <= 2) {
                          return (
                            <span className="rounded-full bg-amber-600/95 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
                              Sisa {count} Kamar!
                            </span>
                          );
                        }
                        return (
                          <span className="rounded-full bg-stone-900/80 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
                            {count} Kamar Tersedia
                          </span>
                        );
                      })()}
                    </div>
                  )}
                  {(() => {
                    // Resolve best available cover: hero → first images[] → null.
                    const cover =
                      rt.hero_image_url ||
                      ((rt as any).images && Array.isArray((rt as any).images) && (rt as any).images[0]) ||
                      null;
                    return cover ? (
                      <img
                        src={cover}
                        alt={rt.name}
                        className="absolute inset-0 h-full w-full object-cover"
                        onError={(e) => {
                          // Image URL broken / 404 / forbidden — hide and show fallback
                          const img = e.currentTarget as HTMLImageElement;
                          img.style.display = "none";
                          img.parentElement?.querySelector(".room-img-fallback")?.classList.remove("hidden");
                        }}
                      />
                    ) : null;
                  })()}
                  <div
                    className={cn(
                      "room-img-fallback absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-50 to-stone-100 text-amber-700/70",
                      (rt.hero_image_url ||
                        ((rt as any).images && (rt as any).images[0])) &&
                        "hidden",
                    )}
                  >
                    <BedDouble className="h-8 w-8 opacity-60" />
                    <span className="px-3 text-center font-mono text-[10px] uppercase tracking-widest">
                      {rt.name || "Foto Kamar"}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-widest opacity-60">
                      Belum ada foto
                    </span>
                  </div>
                  {(rt as any).floor_info && (
                    <div className={`absolute left-2.5 ${cartOpen ? "bottom-2" : "bottom-3"} inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-stone-800 shadow-sm backdrop-blur-sm`}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Lantai</span>
                      {String((rt as any).floor_info).replace(/^lantai\s*/i, "").trim() || (rt as any).floor_info}
                    </div>
                  )}
                </div>
                <div className={cartOpen ? "p-3" : "p-6"}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className={`font-serif font-semibold text-stone-900 ${cartOpen ? "text-base" : "text-xl"}`}>{rt.name}</h3>
                      <p className={`mt-1 font-mono uppercase tracking-wider text-stone-400 ${cartOpen ? "text-[9px]" : "text-[11px]"}`}>
                        {[
                          rt.capacity && `${rt.capacity} TAMU`,
                          rt.size_sqm && `${rt.size_sqm} M²`,
                          (rt as any).bed_type,
                        ]
                           .filter(Boolean)
                           .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cartOpen ? "text-[9px] text-stone-400" : "text-[10px] text-stone-400"}>
                        {usingDateFilter ? "Harga" : "Harga Hari Ini"}
                      </p>
                      <p className="text-amber-700">
                        {formatIDR(Number(rt.base_rate), cartOpen ? "text-sm" : "text-lg", "font-sans font-bold tabular-nums")}
                      </p>
                    </div>
                  </div>
                  {rt.description && (
                    <p className={`line-clamp-2 leading-relaxed text-stone-500 ${cartOpen ? "mt-2 text-xs" : "mt-3 text-sm"}`}>
                      {rt.description}
                    </p>
                  )}
                  {rt.amenities && rt.amenities.length > 0 && (
                    <div className={`flex flex-wrap gap-x-2.5 gap-y-1 border-t border-stone-100 pt-2.5 text-stone-600 ${cartOpen ? "mt-1.5" : "mt-3.5"}`}>
                      {rt.amenities.map((amenity: string) => {
                        const icon = getAmenityIcon(amenity);
                        return (
                          <div key={amenity} className={`flex items-center gap-1 text-stone-600 ${cartOpen ? "text-[10px]" : "text-[11px]"}`}>
                            <span className="text-amber-700">{icon}</span>
                            <span>{amenity}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(() => {
                    const item = cart?.[rt.id];
                    if (availability && availability[rt.id] === false && !item) {
                      return (
                        <span className={`block cursor-not-allowed rounded-lg bg-stone-300 text-center font-semibold text-stone-500 ${cartOpen ? "mt-3 py-1.5 text-xs" : "mt-5 py-2.5 text-sm"}`}>
                          Tidak Tersedia
                        </span>
                      );
                    }
                    if (item) {
                      const perRoomExtrabedCap = Math.max(0, Number(rt.extrabed_capacity ?? 0));
                      const totalMaxExtrabed = perRoomExtrabedCap * item.rooms;
                      return (
                        <RoomCardSteppers
                          rooms={item.rooms}
                          extrabed={Math.min(item.extrabed, totalMaxExtrabed)}
                          maxRooms={Math.max(1, Number(rt.total_physical_rooms ?? 0) || 1)}
                          maxExtrabed={totalMaxExtrabed}
                          extrabedRate={Number(rt.extrabed_rate ?? 0)}
                          onChangeRooms={(v) => onChangeRooms?.(rt.id, v)}
                          onChangeExtrabed={(v) => onChangeExtrabed?.(rt.id, v)}
                          onRemove={() => onChangeRooms?.(rt.id, 0)}
                          compact={cartOpen}
                        />
                      );
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => onAddRoom?.(rt)}
                        className={`block w-full cursor-pointer rounded-lg border border-amber-700 bg-white text-center font-semibold text-amber-700 transition hover:bg-amber-50 ${cartOpen ? "mt-3 py-1.5 text-xs" : "mt-5 py-2.5 text-sm"}`}
                      >
                        Tambahkan kamar
                      </button>
                    );
                  })()}
                </div>
              </article>
            </div>
          ))}
        </div>
      </div>

      {totalDots > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          {/* Mobile-only prev arrow */}
          <button
            onClick={handlePrev}
            aria-label="Sebelumnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50 md:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex gap-1.5">
            {Array.from({ length: totalDots }).map((_, d) => (
              <button
                key={d}
                onClick={() => {
                  setIsTransitioning(true);
                  if (isLoopable) {
                    setI(d + cardsPerView);
                  } else {
                    setI(d);
                  }
                }}
                aria-label={`Halaman ${d + 1}`}
                className={`h-2 rounded-full transition-all ${
                  d === activeDot ? "w-6 bg-amber-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          {/* Mobile-only next arrow */}
          <button
            onClick={handleNext}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-amber-700 hover:bg-amber-50 md:hidden"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

/** Convert a `#rrggbb` hex color to an `rgba()` string with the given alpha. */

/** Page Builder integration props passed down to selectable sections. */



/**
 * Stacked date display next to the room-carousel heading.
 *
 * Layout (single date):
 *      ┌────────┐
 *      │ Minggu │  ← coloured day badge (weekend = amber, weekday = sky)
 *      └────────┘
 *      31 Mei 2026
 *
 * Layout (range with N nights):
 *      ┌────────┐         ┌────────┐
 *      │ Minggu │   │     │ Senin  │   │   ┌───┐
 *      └────────┘   │     └────────┘   │   │ 1 │ Malam
 *      31 Mei 2026  │     1 Juni 2026  │   └───┘
 */
/**
 * Single date column in the carousel header. Layout:
 *
 *      Minggu                ← day name top-LEFT, same colour as date
 *      31 Mei                ← big bold day + month (pink check-in / dark check-out)
 *              2026          ← year bottom-RIGHT, small grey
 *
 * `accent="pink"` highlights the check-in / today date.
 */
function DayDateBlock({ iso, accent }: { iso: string; accent?: "pink" | "dark" }) {
  const colour = accent === "pink" ? "text-pink-600" : "text-stone-900";
  return (
    <span className="inline-flex flex-col leading-none">
      <span className={`self-start text-xs font-semibold md:text-sm ${colour}`}>
        {fmtDayNameID(iso)}
      </span>
      <span className={`mt-0.5 whitespace-nowrap text-lg font-bold md:text-xl ${colour}`}>
        {fmtDayMonthID(iso)}
      </span>
      <span className="-mt-0.5 self-end text-[9px] font-medium text-stone-400 md:text-[10px]">
        {fmtYearID(iso)}
      </span>
    </span>
  );
}

/**
 * Date stack wrapped by a one-shot red-circle SVG annotation
 * (red-circle-animation.svg from the media library, with /public fallback).
 * IntersectionObserver fires the animation exactly once per page load.
 */
function DateStack({
  fromIso,
  toIso,
  nights,
}: {
  fromIso: string;
  toIso?: string | null;
  nights?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [show, setShow] = useState(false);
  const playedRef = useRef(false);

  const getAssetFn = useServerFn(getMediaAssetByName);
  const { data: assetData } = useQuery({
    queryKey: ["media-asset", "icon", "red-circle-animation.svg"],
    queryFn: () =>
      getAssetFn({ data: { name: "red-circle-animation.svg", folder: "icon" } }),
    staleTime: 10 * 60 * 1000,
  });
  const svgUrl = assetData?.url || "/red-circle-animation.svg";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !playedRef.current) {
            playedRef.current = true;
            setShow(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const isRange = !!(toIso && toIso !== fromIso);

  return (
    <span ref={ref} className="relative inline-flex items-center gap-2.5 px-5 py-3">
      <DayDateBlock iso={fromIso} accent="pink" />
      {isRange && (
        <>
          <span aria-hidden="true" className="h-10 w-px bg-stone-300" />
          <DayDateBlock iso={toIso!} accent="dark" />
          {typeof nights === "number" && nights > 0 && (
            <>
              <span aria-hidden="true" className="h-10 w-px bg-stone-300" />
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-stone-800 md:text-xl">{nights}</span>
                <span className="text-[9px] font-medium text-stone-400 md:text-[10px]">Malam</span>
              </span>
            </>
          )}
        </>
      )}
      {show && (
        <img
          // Hash suffix forces a fresh decode so SMIL replays per mount.
          src={`${svgUrl}#play-${playedRef.current ? 1 : 0}`}
          alt=""
          aria-hidden="true"
          // SVG has preserveAspectRatio="none", so it stretches to fill the
          // wrapper box exactly — guarantees the lasso encloses every label.
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
        />
      )}
    </span>
  );
}

function SectionHeading({
  children,
  noUnderline,
  normalCase, // legacy prop, retained for back-compat (no-op now)
  uppercase,  // explicit opt-in to CAPS styling
  fontFamily,
  fontSize,
  fontStyle,
  color,
}: {
  children: React.ReactNode;
  noUnderline?: boolean;
  normalCase?: boolean;
  uppercase?: boolean;
  fontFamily?: "sans" | "serif" | "mono" | "brother-signature";
  fontSize?: number;
  fontStyle?: "normal" | "bold" | "italic";
  color?: string;
}) {
  void normalCase; // suppress unused-var warning; semantics now default-on
  const fontClass =
    fontFamily === "mono"
      ? "font-mono"
      : fontFamily === "sans"
        ? "font-sans"
        : fontFamily === "brother-signature"
          ? "font-brother-signature"
          : "font-serif";

  return (
    <div className="flex flex-col items-center">
      <h2
        className={`tracking-tight ${color ? "" : "text-stone-800"} ${fontClass} ${
          uppercase ? "uppercase" : ""
        } ${fontSize ? "" : "text-3xl font-bold md:text-4xl"}`}
        style={{
          ...(color ? { color } : {}),
          ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
          ...(fontStyle
            ? {
                fontStyle: fontStyle === "italic" ? "italic" : "normal",
                fontWeight: fontStyle === "bold" ? 700 : 400,
              }
            : {}),
        }}
      >
        {children}
      </h2>
      {!noUnderline && <span className="mt-3 h-1 w-16 rounded-full" style={{ backgroundColor: color || "#d97706" }} />}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 flex-1", className)}>
      <label className="mb-1 hidden font-mono text-[10px] uppercase tracking-widest text-stone-400 md:block">
        {label}
      </label>
      {children}
    </div>
  );
}
