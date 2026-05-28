import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
} from "lucide-react";
import {
  getPublicSiteData,
  checkRoomTypeAvailability,
} from "@/public/functions/public.functions";
import { getGoogleReviews, type GoogleReview } from "@/public/functions/google-reviews.functions";
import { mergeHomepageConfig, type HomepageConfig } from "@/admin/modules/homepage/homepage.config";
import { mergeExploreConfig } from "@/admin/modules/explore/explore.config";
import { PomahNav, PomahFooter, HeroSlider, PbZone } from "@/public/components/public-shell";
import { DatePickerID } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  loader: async () => getPublicSiteData(),
  staleTime: 5 * 60 * 1000,

  head: ({ loaderData }: any) => {
    const cfg = mergeHomepageConfig(
      (loaderData?.property as { homepage_config?: unknown } | undefined)?.homepage_config,
    );
    const seo = cfg.seo;
    const title = seo.metaTitle || "Pomah Guesthouse Semarang | Hotel Murah & Nyaman di Semarang";
    const desc =
      seo.metaDescription ||
      "Pomah Guesthouse — penginapan murah dan nyaman di Kota Semarang. Kamar bersih, pelayanan ramah, lokasi strategis.";
    const heroImage = cfg.hero.slides?.[0]?.imageUrl;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(seo.ogImageUrl ? [{ property: "og:image", content: seo.ogImageUrl }] : []),
      ],
      links: heroImage
        ? [{ rel: "preload", as: "image", href: heroImage, fetchpriority: "high" }]
        : [],
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

const NEARBY = [
  { name: "Unnes Sekaran", type: "Universitas", distance: "8 km", time: "~13 menit" },
  { name: "Unwahas Menoreh", type: "Universitas", distance: "1.3 km", time: "~5 menit" },
  { name: "Jatidiri GOR", type: "Olahraga", distance: "3.7 km", time: "~10 menit" },
  { name: "Pintu Tol Jatingaleh", type: "Pintu Tol", distance: "5 km", time: "~12 menit" },
  { name: "Undip Tembalang", type: "Universitas", distance: "8 km", time: "~20 menit" },
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
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fetchData(),
    initialData: loaderData,
    staleTime: 5 * 60 * 1000,
  });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

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
  const cfg = mergeHomepageConfig(
    (property as { homepage_config?: unknown } | null | undefined)?.homepage_config,
  );

  // News & Event — sourced from the same City Guide data as /explore.
  const exploreCfg = mergeExploreConfig(
    (property as { explore_config?: unknown } | null | undefined)?.explore_config,
  );
  const newsEvents = [
    ...exploreCfg.events.map((e) => ({
      date: e.date,
      category: e.label || "Event",
      title: e.title,
      excerpt: e.desc,
      image: e.image,
      ts: parseIdDate(e.date),
    })),
    ...exploreCfg.news.map((n) => ({
      date: n.date,
      category: n.label || "Berita",
      title: n.title,
      excerpt: n.desc,
      image: n.image,
      ts: parseIdDate(n.date),
    })),
  ]
    .sort((a, b) => b.ts - a.ts) // newest first
    .slice(0, 5);

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

  // Booking date-picker state.
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [tempCheckIn, setTempCheckIn] = useState("");
  const [tempCheckOut, setTempCheckOut] = useState("");
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

  return (
    <div className="relative min-h-screen bg-[#f6f1e8] text-stone-800">
      <PomahNav name={propertyName} logo={logoUrl} header={cfg.header} pb={pb} />

      <PbZone id="hero" label="Hero Slider" pb={pb}>
        <HeroSlider hero={cfg.hero} fallbackTitle={`Selamat Datang Di ${propertyName}`} />
      </PbZone>

      {/* ── DATE PICKER WIDGET ── */}
      {cfg.datePicker.enabled && (
        <PbZone id="datepicker" label="Date Picker" pb={pb}>
          <div
            className="relative mx-auto -mt-12 max-w-4xl px-6"
            style={{ zIndex: cfg.datePicker.layer }}
          >
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xl">
              {cfg.datePicker.heading && (
                <p
                  className={`mb-3 text-center text-teal-700 ${
                    cfg.datePicker.fontFamily === "mono"
                      ? "font-mono"
                      : cfg.datePicker.fontFamily === "sans"
                        ? "font-sans"
                        : "font-serif"
                  }`}
                  style={{
                    fontSize: cfg.datePicker.fontSize,
                    fontStyle: cfg.datePicker.fontStyle === "italic" ? "italic" : "normal",
                    fontWeight: cfg.datePicker.fontStyle === "bold" ? 700 : 400,
                  }}
                >
                  {cfg.datePicker.heading}
                </p>
              )}
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <Field label="Check-In">
                  <DatePickerID
                    value={checkIn}
                    onChange={setCheckIn}
                    placeholder="Pilih tanggal"
                    className="h-10"
                  />
                </Field>
                <Field label="Check-Out">
                  <DatePickerID
                    value={checkOut}
                    onChange={setCheckOut}
                    min={checkIn || undefined}
                    placeholder="Pilih tanggal"
                    className="h-10"
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("our-room")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-teal-700 px-8 text-sm font-semibold text-white transition hover:bg-teal-800"
                >
                  {cfg.datePicker.buttonLabel}
                </button>
              </div>
            </div>
          </div>
        </PbZone>
      )}

      {/* ── YOUR PERFECT STAY ── */}
      <PbZone id="story" label="Your Perfect Stay" pb={pb}>
        <section className="mx-auto max-w-4xl px-6 py-20 text-center">
          <SectionHeading
            fontFamily={cfg.story.fontFamily}
            fontSize={cfg.story.fontSize}
            fontStyle={cfg.story.fontStyle}
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

      {/* ── GOOGLE RATING ── */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
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

      {/* ── OUR ROOM (CAROUSEL) ── */}
      <PbZone id="carousel" label="Our Room" pb={pb}>
        <section
          id="our-room"
          className="relative scroll-mt-20 py-20 bg-cover bg-center bg-no-repeat"
          style={{
            zIndex: cfg.roomCarousel.layer,
            backgroundColor: cfg.roomCarousel.bgColor || "#f3ece0",
            backgroundImage: cfg.roomCarousel.bgImageUrl ? `url(${cfg.roomCarousel.bgImageUrl})` : undefined,
          }}
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center">
              <SectionHeading
                normalCase
                noUnderline
                fontFamily={cfg.roomCarousel.fontFamily}
                fontSize={cfg.roomCarousel.fontSize}
                fontStyle={cfg.roomCarousel.fontStyle}
              >
                {cfg.roomCarousel.heading}
              </SectionHeading>
              {cfg.roomCarousel.subheading && (
                <p className="mx-auto mt-4 max-w-md text-sm text-stone-500">
                  {cfg.roomCarousel.subheading}
                </p>
              )}
              {(usingDateFilter || today) && (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="mt-3 text-sm md:text-base text-stone-600 font-medium">
                    {usingDateFilter
                      ? `Ketersediaan kamar untuk: ${fmtDateID(checkIn)} – ${fmtDateID(
                          checkOut,
                        )} (${nightsBetween(checkIn, checkOut)} Malam)`
                      : `Ketersediaan kamar hari ini, ${fmtFullDateID(today)}`}
                  </p>
                  <Dialog
                    onOpenChange={(open) => {
                      if (open) {
                        setTempCheckIn(checkIn || today);
                        setTempCheckOut(
                          checkOut ||
                            (checkIn
                              ? isoAddDays(checkIn, 1)
                              : today
                                ? isoAddDays(today, 1)
                                : ""),
                        );
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="cursor-pointer rounded-full bg-orange-500 px-6 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600 mt-2"
                      >
                        Ganti
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[340px] rounded-2xl bg-white p-6 shadow-xl border border-stone-200">
                      <DialogHeader className="text-left">
                        <DialogTitle className="font-serif text-lg text-stone-900">Ganti Tanggal</DialogTitle>
                      </DialogHeader>
                      <div className="mt-4 space-y-4">
                        <Field label="Check-In">
                          <DatePickerID
                            value={tempCheckIn}
                            onChange={(val) => {
                              setTempCheckIn(val);
                              if (tempCheckOut && val >= tempCheckOut) {
                                setTempCheckOut(isoAddDays(val, 1));
                              }
                            }}
                            placeholder="Pilih tanggal"
                            className="h-10 text-sm"
                          />
                        </Field>
                        <Field label="Check-Out">
                          <DatePickerID
                            value={tempCheckOut}
                            onChange={setTempCheckOut}
                            min={tempCheckIn || today || undefined}
                            placeholder="Pilih tanggal"
                            className="h-10 text-sm"
                          />
                        </Field>
                        <DialogClose asChild>
                          <button
                            type="button"
                            onClick={() => {
                              setCheckIn(tempCheckIn);
                              setCheckOut(tempCheckOut);
                            }}
                            className="cursor-pointer w-full rounded-lg bg-teal-700 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-teal-800"
                          >
                            Terapkan
                          </button>
                        </DialogClose>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>
            <RoomCarousel
              rooms={rooms}
              rc={cfg.roomCarousel}
              availability={availability}
              checkIn={checkIn}
              checkOut={checkOut}
            />
          </div>
        </section>
      </PbZone>

      {/* ── FACILITIES ── */}
      <section id="facilities" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <SectionHeading>Facilities</SectionHeading>
          <p className="mx-auto mt-4 max-w-lg text-sm text-stone-500">
            Nikmati fasilitas yang dirancang untuk membuat menginap Anda nyaman dan berkesan.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {FACILITIES.map((f) => (
            <div
              key={f.title}
                className="rounded-2xl border border-stone-200 bg-white p-4 text-center shadow-sm"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-serif text-lg font-semibold text-stone-900">{f.title}</h3>
              <p className="mt-1 text-sm text-stone-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── LOKASI KAMI ── */}
      <section id="lokasi" className="bg-[#f3ece0] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="font-serif text-3xl font-bold tracking-tight text-teal-700 md:text-4xl">
              Lokasi Kami
            </h2>
            <p className="mt-3 text-sm text-stone-500">
              Temukan kami di lokasi strategis yang mudah diakses
            </p>
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
              <p className="flex items-center gap-2 font-serif text-lg font-semibold text-teal-700">
                <MapPin className="h-5 w-5" />
                Lokasi Terdekat (Radius 5km)
              </p>
              <div className="mt-3 space-y-2">
                {NEARBY.map((n) => (
                  <div
                    key={n.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-6 w-6 shrink-0 rounded-full border-2 border-teal-600" />
                      <div>
                        <p className="text-sm font-semibold text-stone-800">{n.name}</p>
                        <p className="text-xs text-stone-400">{n.type}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="flex items-center gap-1 text-sm font-medium text-teal-700">
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

      {/* ── NEWS & EVENT (from City Guide) ── */}
      {newsEvents.length > 0 && (
        <section id="news-event" className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <SectionHeading>News &amp; Event</SectionHeading>
            <p className="mx-auto mt-4 max-w-lg text-sm text-stone-500">
              Kabar terbaru, promo, dan acara seputar Semarang dari City Guide kami.
            </p>
          </div>
          <NewsEventSlider items={newsEvents} />
          <div className="mt-10 text-center">
            <Link
              to="/explore"
              className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-7 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
            >
              Lihat Selengkapnya di City Guide
            </Link>
          </div>
        </section>
      )}

      <PomahFooter name={propertyName} />

      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hubungi via WhatsApp"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}
    </div>
  );
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

function ReviewSlider({ items }: { items: { text: string; author: string | null; isGoogle?: boolean }[] }) {
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
        <Quote className="mx-auto h-6 w-6 text-teal-600/40" />
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
            className="rounded-full border border-stone-300 bg-white p-1.5 text-teal-700 hover:bg-teal-50"
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
                  d === idx ? "w-6 bg-teal-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => setI((v) => (v + 1) % items.length)}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-1.5 text-teal-700 hover:bg-teal-50"
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
                      src={n.image}
                      alt={n.title}
                      loading="lazy"
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
                    <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
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
            className="rounded-full border border-stone-300 bg-white p-2 text-teal-700 hover:bg-teal-50"
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
                  d === activeDot ? "w-6 bg-teal-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-teal-700 hover:bg-teal-50"
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
};

function RoomCarousel({
  rooms,
  rc,
  availability,
  checkIn,
  checkOut,
}: {
  rooms: RoomType[];
  rc: HomepageConfig["roomCarousel"];
  availability: Record<string, boolean> | null;
  checkIn?: string;
  checkOut?: string;
}) {
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

  useEffect(() => {
    if (!rc.autoplay || !isLoopable || rc.slideMs <= 0) return;
    const t = setInterval(() => {
      setIsTransitioning(true);
      setI((v) => v + 1);
    }, rc.slideMs);
    return () => clearInterval(t);
  }, [rc.autoplay, rc.slideMs, isLoopable]);

  if (rooms.length === 0) {
    return <p className="mt-12 text-center text-sm text-stone-400">Belum ada kamar tersedia.</p>;
  }

  const activeDot = isLoopable
    ? ((i - cardsPerView) % rooms.length + rooms.length) % rooms.length
    : i;

  const totalDots = isLoopable ? rooms.length : maxIndex + 1;

  return (
    <div className="relative mt-12">
      <div
        className="overflow-hidden"
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
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-teal-50">
                  {rt.hero_image_url ? (
                    <img
                      src={rt.hero_image_url}
                      alt={rt.name}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest text-teal-600/50">
                      Foto Kamar
                    </div>
                  )}
                </div>
                <div className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-xl font-semibold text-stone-900">{rt.name}</h3>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
                        {[rt.capacity && `${rt.capacity} TAMU`, rt.size_sqm && `${rt.size_sqm} M²`]
                           .filter(Boolean)
                           .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-stone-400">Harga hari ini</p>
                      <p className="text-lg font-bold text-teal-700">
                        Rp {Number(rt.base_rate).toLocaleString("id-ID")}
                      </p>
                    </div>
                  </div>
                  {rt.description && (
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-500">
                      {rt.description}
                    </p>
                  )}
                  {availability && availability[rt.id] === false ? (
                    <span className="mt-5 block cursor-not-allowed rounded-lg bg-stone-300 py-2.5 text-center text-sm font-semibold text-stone-500">
                      Tidak Tersedia
                    </span>
                  ) : (
                    <Link
                      to="/rooms/$slug"
                      params={{ slug: rt.slug }}
                      search={{
                        checkIn: checkIn || undefined,
                        checkOut: checkOut || undefined,
                      }}
                      className="mt-5 block cursor-pointer rounded-lg bg-teal-700 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-teal-800"
                    >
                      Pesan Kamar
                    </Link>
                  )}
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
            className="rounded-full border border-stone-300 bg-white p-2 text-teal-700 hover:bg-teal-50"
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
                  d === activeDot ? "w-6 bg-teal-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            aria-label="Berikutnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-teal-700 hover:bg-teal-50"
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



function SectionHeading({
  children,
  noUnderline,
  normalCase,
  fontFamily,
  fontSize,
  fontStyle,
}: {
  children: React.ReactNode;
  noUnderline?: boolean;
  normalCase?: boolean;
  fontFamily?: "sans" | "serif" | "mono";
  fontSize?: number;
  fontStyle?: "normal" | "bold" | "italic";
}) {
  const fontClass =
    fontFamily === "mono"
      ? "font-mono"
      : fontFamily === "sans"
        ? "font-sans"
        : "font-serif";

  return (
    <div className="flex flex-col items-center">
      <h2
        className={`tracking-tight text-stone-800 ${fontClass} ${
          normalCase ? "" : "uppercase"
        } ${fontSize ? "" : "text-3xl font-bold md:text-4xl"}`}
        style={{
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
      {!noUnderline && <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex-1">
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-stone-400">
        {label}
      </label>
      {children}
    </div>
  );
}
