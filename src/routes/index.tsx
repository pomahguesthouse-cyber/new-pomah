import { useEffect, useState } from "react";
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
  MessageCircle,
  Menu,
  Quote,
  Instagram,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getPublicSiteData,
  getGoogleReviews,
  checkRoomTypeAvailability,
} from "@/public/functions/public.functions";
import { mergeHomepageConfig, type HomepageConfig } from "@/admin/modules/homepage/homepage.config";
import { DatePickerID } from "@/components/ui/date-picker";
import { Webchat } from "@/public/components/webchat";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pomah Guesthouse Semarang | Hotel Murah & Nyaman di Semarang" },
      {
        name: "description",
        content:
          "Pomah Guesthouse — penginapan murah dan nyaman di Kota Semarang. Kamar bersih, pelayanan ramah, lokasi strategis.",
      },
      { property: "og:title", content: "Pomah Guesthouse Semarang" },
      { property: "og:description", content: "Penginapan murah & nyaman di Kota Semarang." },
    ],
  }),
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
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

  const reviewsFn = useServerFn(getGoogleReviews);
  const { data: gr } = useQuery({ queryKey: ["google-reviews"], queryFn: () => reviewsFn() });
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
          <SectionHeading>{cfg.story.heading}</SectionHeading>
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
              ? gReviews.map((rv) => ({ text: rv.text, author: rv.author }))
              : REVIEWS.map((r) => ({ text: r, author: null }))
          }
        />
      </section>

      {/* ── OUR ROOM (CAROUSEL) ── */}
      <PbZone id="carousel" label="Our Room" pb={pb}>
        <section
          id="our-room"
          className="relative scroll-mt-20 bg-[#f3ece0] py-20"
          style={{ zIndex: cfg.roomCarousel.layer }}
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center">
              <SectionHeading>{cfg.roomCarousel.heading}</SectionHeading>
              {cfg.roomCarousel.subheading && (
                <p className="mx-auto mt-4 max-w-md text-sm text-stone-500">
                  {cfg.roomCarousel.subheading}
                </p>
              )}
              {(usingDateFilter || today) && (
                <p className="mt-2 text-xs font-semibold text-teal-700">
                  {usingDateFilter
                    ? `Ketersediaan kamar untuk: ${fmtDateID(checkIn)} – ${fmtDateID(
                        checkOut,
                      )} (${nightsBetween(checkIn, checkOut)} Malam)`
                    : `Ketersediaan kamar hari ini, ${fmtFullDateID(today)}`}
                </p>
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
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FACILITIES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm"
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

      <PomahFooter name={propertyName} />

      {wa && (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Hubungi via WhatsApp"
          className="fixed bottom-5 right-24 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition hover:bg-green-600"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}

      <Webchat rooms={rooms} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero slider                                                          */
/* ------------------------------------------------------------------ */

/** Per-slide enter animation, keyed by the configured transition. */
const HERO_ANIM: Record<string, string> = {
  fade: "animate-in fade-in duration-700",
  slide: "animate-in slide-in-from-right-full duration-500 ease-out",
  zoom: "animate-in zoom-in-95 duration-700",
  none: "",
};

function HeroSlider({
  hero,
  fallbackTitle,
}: {
  hero: HomepageConfig["hero"];
  fallbackTitle: string;
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
            src={active.imageUrl}
            alt={active.heading}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-teal-800 via-teal-700 to-teal-900" />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          <h1
            className={`max-w-3xl tracking-tight text-white drop-shadow ${
              hero.fontFamily === "mono"
                ? "font-mono"
                : hero.fontFamily === "sans"
                  ? "font-sans"
                  : "font-serif"
            }`}
            style={{
              fontSize: hero.fontSize,
              lineHeight: 1.1,
              fontStyle: hero.fontStyle === "italic" ? "italic" : "normal",
              fontWeight: hero.fontStyle === "bold" ? 700 : 400,
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

/* ------------------------------------------------------------------ */
/* Room carousel                                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Review slider                                                        */
/* ------------------------------------------------------------------ */

function ReviewSlider({ items }: { items: { text: string; author: string | null }[] }) {
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
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!rc.autoplay || maxIndex < 1 || rc.slideMs <= 0) return;
    const t = setInterval(() => setI((v) => (v >= maxIndex ? 0 : v + 1)), rc.slideMs);
    return () => clearInterval(t);
  }, [rc.autoplay, rc.slideMs, maxIndex]);

  if (rooms.length === 0) {
    return <p className="mt-12 text-center text-sm text-stone-400">Belum ada kamar tersedia.</p>;
  }

  const index = Math.min(i, maxIndex);

  return (
    <div className="relative mt-12">
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * (100 / cardsPerView)}%)` }}
        >
          {rooms.map((rt) => (
            <div key={rt.id} className="shrink-0 px-3" style={{ width: `${100 / cardsPerView}%` }}>
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
                        {[rt.capacity && `${rt.capacity} Tamu`, rt.size_sqm && `${rt.size_sqm} m²`]
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
                      className="mt-5 block rounded-lg bg-teal-700 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-teal-800"
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

      {maxIndex > 0 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => setI((v) => Math.max(0, v - 1))}
            aria-label="Sebelumnya"
            className="rounded-full border border-stone-300 bg-white p-2 text-teal-700 hover:bg-teal-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex gap-1.5">
            {Array.from({ length: maxIndex + 1 }).map((_, d) => (
              <button
                key={d}
                onClick={() => setI(d)}
                aria-label={`Halaman ${d + 1}`}
                className={`h-2 rounded-full transition-all ${
                  d === index ? "w-6 bg-teal-700" : "w-2 bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => setI((v) => Math.min(maxIndex, v + 1))}
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
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Page Builder integration props passed down to selectable sections. */
type Pb = { isBuilder: boolean; sel: string | null; onSelect: (key: string) => void };

/** Wraps a homepage section so it is click-to-select inside the builder. */
function PbZone({
  id,
  label,
  pb,
  children,
}: {
  id: string;
  label: string;
  pb: Pb;
  children: React.ReactNode;
}) {
  if (!pb.isBuilder) return <>{children}</>;
  const active = pb.sel === id;
  return (
    <div
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pb.onSelect(id);
      }}
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
  const background = header.transparent
    ? hexToRgba(header.bgColor, Math.max(0, Math.min(header.opacity, 100)) / 100)
    : header.bgColor;

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
  if (pinned) {
    positionClass = "fixed inset-x-0 top-0";
  } else if (header.transparent) {
    positionClass = "absolute inset-x-0 top-0";
  } else {
    positionClass = "relative";
  }
  const needsSpacer = pinned && !header.transparent;
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
          <span className="font-serif text-2xl font-bold">Pomah</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
            guesthouse
          </span>
        </>
      )}
    </Link>
  );

  const linksEl = (
    <div className="hidden items-center gap-7 text-sm font-medium md:flex" key="links">
      {header.links.map((n) => (
        <a key={n.label} href={n.href} className="transition hover:text-white/70">
          {n.label}
        </a>
      ))}
    </div>
  );

  const actionsEl = (
    <div className="flex items-center gap-3" key="actions">
      <Link
        to="/book"
        search={{}}
        className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold transition hover:bg-white/90"
        style={{ color: header.bgColor }}
      >
        {header.bookLabel}
      </Link>
      <button className="text-white md:hidden" aria-label="Menu">
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
        className={`z-40 text-white transition-all duration-300 ${positionClass} ${
          header.dropShadow ? "shadow-md" : ""
        } ${selected ? "outline outline-2 -outline-offset-2 outline-orange-500" : ""}`}
        style={{
          background,
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">{slots}</div>
        <span className="sr-only">{name}</span>
      </nav>
      {needsSpacer && <div style={{ height: headerHeight }} aria-hidden />}
    </>
  );
}

function PomahFooter({ name }: { name: string }) {
  return (
    <footer className="bg-teal-800 text-teal-100">
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
            className="mt-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-teal-600 text-teal-200 transition hover:border-white hover:text-white"
          >
            <Instagram className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div className="border-t border-teal-700/60 py-5 text-center text-xs text-teal-300/70">
        © {new Date().getFullYear()} {name}. Semua hak dilindungi.
      </div>
    </footer>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <h2 className="font-serif text-3xl font-bold uppercase tracking-tight text-stone-800 md:text-4xl">
        {children}
      </h2>
      <span className="mt-3 h-1 w-16 rounded-full bg-teal-600" />
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
