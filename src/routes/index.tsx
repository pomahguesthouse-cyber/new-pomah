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
} from "lucide-react";
import { getPublicSiteData } from "@/public/functions/public.functions";

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
      {
        property: "og:description",
        content: "Penginapan murah & nyaman di Kota Semarang.",
      },
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

const NAV = [
  { label: "Home", to: "/" as const },
  { label: "Rooms", to: "/rooms" as const },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function PomahHome() {
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

  const propertyName = property?.name ?? "Pomah Guesthouse";
  const wa = property?.whatsapp_number?.replace(/\D/g, "") ?? "";
  const address = property?.address ?? "Pomah Guesthouse Semarang";
  // logo_url comes from Settings → Branding; not in the generated types.
  const logoUrl = (property as { logo_url?: string | null } | null | undefined)?.logo_url ?? null;

  return (
    <div className="min-h-screen bg-[#f6f1e8] text-stone-800">
      <PomahNav name={propertyName} logo={logoUrl} />

      {/* ── HERO ── */}
      <header className="relative">
        <div className="relative h-[78vh] min-h-[460px] w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-800 via-teal-700 to-teal-900" />
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
            <h1 className="max-w-3xl font-serif text-4xl font-bold tracking-tight text-white drop-shadow md:text-6xl">
              Selamat Datang Di {propertyName}
            </h1>
            <span className="my-4 h-px w-40 bg-white/70" />
            <p className="text-base text-white/90 md:text-lg">
              {property?.tagline ?? "Penginapan Murah di Kota Semarang"}
            </p>
          </div>
        </div>

        {/* Booking bar */}
        <div className="mx-auto -mt-12 max-w-4xl px-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl md:flex-row md:items-end">
            <Field label="Check-In">
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-stone-200 px-3 text-sm"
              />
            </Field>
            <Field label="Check-Out">
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-stone-200 px-3 text-sm"
              />
            </Field>
            <Link
              to="/book"
              className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-teal-700 px-8 text-sm font-semibold text-white transition hover:bg-teal-800"
            >
              Cek Ketersediaan
            </Link>
          </div>
        </div>
      </header>

      {/* ── YOUR PERFECT STAY ── */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <SectionHeading>Your Perfect Stay</SectionHeading>
        <div className="mt-8 space-y-5 text-base leading-relaxed text-stone-500">
          <p>
            Kata <strong className="text-stone-700">Pomah</strong> dalam bahasa Jawa berarti Rumah.
            Terletak sedikit di pinggir kota Semarang yang dijuluki Venice of Java, {propertyName}{" "}
            memiliki filosofi yang mencerminkan kehangatan, kenyamanan dan standar pelayanan terbaik
            yang kami sajikan kepada tamu.
          </p>
          <p>
            Kami di Pomah yakin bahwa setiap perjalanan seharusnya memberikan cerita-cerita baru
            dimulai, kenangan indah tercipta dan momen kebersamaan terjalin.
          </p>
        </div>
      </section>

      {/* ── GOOGLE RATING ── */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="flex flex-col items-center">
          <p className="flex items-center gap-2 text-sm font-medium text-stone-600">
            <span className="font-bold text-base">G</span> Google Rating
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <span className="text-2xl font-bold text-stone-800">4.8</span>
          </div>
          <p className="mt-1 text-xs text-stone-400">Berdasarkan 76 ulasan Google</p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {REVIEWS.map((r) => (
            <div key={r} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <Quote className="h-5 w-5 text-teal-600/40" />
              <p className="mt-2 text-sm leading-relaxed text-stone-600">&ldquo;{r}&rdquo;</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── OUR ACCOMMODATIONS ── */}
      <section className="bg-[#f3ece0] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <SectionHeading>Our Accommodations</SectionHeading>
            <p className="mx-auto mt-4 max-w-md text-sm text-stone-500">
              Pilih tanggal check-in dan check-out untuk melihat ketersediaan kamar
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {rooms.map((rt) => (
              <article
                key={rt.id}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-teal-50">
                  {rt.hero_image_url ? (
                    <img
                      src={rt.hero_image_url}
                      alt={rt.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-teal-600/50">
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
                  <Link
                    to="/book"
                    className="mt-5 block rounded-lg bg-teal-700 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-teal-800"
                  >
                    Pesan Kamar
                  </Link>
                </div>
              </article>
            ))}
            {rooms.length === 0 && (
              <p className="col-span-full text-center text-sm text-stone-400">
                Belum ada kamar tersedia.
              </p>
            )}
          </div>
        </div>
      </section>

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

      {/* Floating WhatsApp */}
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
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

function PomahNav({ name, logo }: { name: string; logo: string | null }) {
  return (
    <nav className="sticky top-0 z-40 bg-teal-700 text-white shadow-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-baseline gap-1.5" title={name}>
          {logo ? (
            <img src={logo} alt={name} className="h-10 w-auto max-w-[180px] object-contain" />
          ) : (
            <>
              <span className="font-serif text-2xl font-bold">Pomah</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
                guesthouse
              </span>
            </>
          )}
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium md:flex">
          {NAV.map((n) => (
            <Link key={n.label} to={n.to} className="transition hover:text-white/70">
              {n.label}
            </Link>
          ))}
          <a href="#facilities" className="transition hover:text-white/70">
            Facilities
          </a>
          <a href="#lokasi" className="transition hover:text-white/70">
            Lokasi
          </a>
        </div>
        <Link
          to="/book"
          className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-white/90"
        >
          Pesan Kamar
        </Link>
        <button className="text-white md:hidden" aria-label="Menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      <span className="sr-only">{name}</span>
    </nav>
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
