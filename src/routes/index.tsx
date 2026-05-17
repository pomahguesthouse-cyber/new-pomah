import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, MessageCircle, Star, Wifi, Coffee, ShowerHead, MapPin } from "lucide-react";
import { getPublicSiteData } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { Button } from "@/components/ui/button";
import { cn, formatDateID } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pomah Living — Boutique Guesthouse" },
      {
        name: "description",
        content:
          "Pomah Living adalah guesthouse butik yang nyaman di jantung kota. Nikmati pengalaman menginap yang personal dengan sentuhan lokal.",
      },
      { property: "og:title", content: "Pomah Living — Boutique Guesthouse" },
      {
        property: "og:description",
        content: "Menginap dengan nyaman, bukan sekadar tempat tidur.",
      },
    ],
  }),
  component: PublicHome,
});

/* ------------------------------------------------------------------ */
/* Home page                                                            */
/* ------------------------------------------------------------------ */
function PublicHome() {
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

  return (
    <div className="min-h-screen bg-white text-stone-900">
      <PublicNav />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-stone-50">
        <div className="mx-auto grid max-w-6xl gap-0 px-6 py-16 md:grid-cols-2 md:py-24">
          {/* Text */}
          <div className="flex flex-col justify-center">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
              <span className="h-px w-6 bg-amber-700" />
              Boutique Guesthouse
            </span>
            <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-stone-900 md:text-6xl">
              {property?.tagline ?? "Tempat istirahat\nyang terasa\nseperti rumah."}
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-stone-500">
              {property?.description ??
                "Pomah Living menawarkan pengalaman menginap yang nyaman dan personal. Kamar-kamar kami dirancang untuk kenyamanan, bukan sekadar tempat tidur."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-amber-700 hover:bg-amber-800 text-white">
                <Link to="/book">
                  Pesan Kamar <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-stone-300 text-stone-700 hover:bg-stone-100"
              >
                <Link to="/rooms">Lihat Kamar</Link>
              </Button>
            </div>
            {/* Rating badge */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-8 w-8 rounded-full border-2 border-white bg-amber-100"
                  />
                ))}
              </div>
              <div>
                <div className="flex items-center gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">Dipercaya ratusan tamu</p>
              </div>
            </div>
          </div>

          {/* Hero image placeholder */}
          <div className="relative mt-10 md:mt-0 md:pl-10">
            <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-amber-50">
              <div className="h-full w-full bg-gradient-to-br from-amber-50 via-stone-100 to-amber-100 flex items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto h-24 w-24 rounded-full bg-amber-200/60" />
                  <p className="mt-4 font-mono text-xs uppercase tracking-widest text-stone-400">
                    Hero Image
                  </p>
                </div>
              </div>
            </div>
            {/* Floating badge */}
            <div className="absolute -bottom-4 -left-4 rounded-xl border border-stone-200 bg-white font-sans text-sm font-bold shadow-lg">
              <p className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
                Check-in
              </p>
              <p className="mt-0.5 text-sm font-semibold text-stone-900">
                {formatDateID(new Date())}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <section className="border-y border-stone-200 bg-amber-700">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-amber-600 md:grid-cols-4">
          {[
            { value: `${rooms.length}+`, label: "Tipe tamu" },
            { value: "24/7", label: "Layanan WhatsApp" },
            { value: "100%", label: "Respon Cepat" },
            { value: "0%", label: "Biaya Booking" },
          ].map((s) => (
            <div key={s.label} className="bg-amber-700 px-8 py-6 text-center">
              <p className="font-serif text-3xl font-semibold text-white">{s.value}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-amber-200">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── ROOMS ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-end justify-between">
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
              <span className="h-px w-6 bg-amber-700" />
              tamu Kami
            </span>
            <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight">
              Dipilih dengan cermat
            </h2>
          </div>
          <Link
            to="/rooms"
            className="hidden text-sm font-medium text-amber-700 underline-offset-4 hover:underline md:block"
          >
            Lihat semua →
          </Link>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {rooms.slice(0, 3).map((rt, i) => (
            <article
              key={rt.id}
              className="group overflow-hidden rounded-xl border border-stone-200 bg-white transition hover:shadow-lg"
            >
              {/* Image placeholder */}
              <div
                className={cn(
                  "aspect-[4/3] w-full overflow-hidden",
                  i === 0 ? "bg-amber-50" : i === 1 ? "bg-stone-100" : "bg-emerald-50",
                )}
              >
                <div className="flex h-full w-full items-center justify-center">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">
                    Foto Kamar
                  </p>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-stone-900">{rt.name}</h3>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-stone-400">
                      {[
                        rt.bed_type,
                        rt.capacity && `${rt.capacity} tamu`,
                        rt.size_sqm && `${rt.size_sqm}m²`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-amber-700">
                      Rp {Number(rt.base_rate).toLocaleString("id-ID")}
                    </p>
                    <p className="font-mono text-[10px] text-stone-400">/malam</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-500">
                  {rt.description}
                </p>
                {rt.amenities && rt.amenities.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {rt.amenities.slice(0, 3).map((a) => (
                      <span
                        key={a}
                        className="rounded-md bg-stone-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-stone-500"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  asChild
                  size="sm"
                  className="mt-4 w-full bg-stone-900 hover:bg-amber-700 text-white transition-colors"
                >
                  <Link to="/book">Pesan Kamar Ini</Link>
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 text-center md:hidden">
          <Button asChild variant="outline">
            <Link to="/rooms">Lihat Semua Kamar</Link>
          </Button>
        </div>
      </section>

      {/* ── FASILITAS ── */}
      <section className="bg-stone-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
              <span className="h-px w-6 bg-amber-700" />
              Fasilitas
              <span className="h-px w-6 bg-amber-700" />
            </span>
            <h2 className="mt-3 font-serif text-3xl font-semibold">Semua yang Anda butuhkan</h2>
            <p className="mt-3 mx-auto max-w-md text-sm text-stone-500">
              Setiap kamar dilengkapi fasilitas modern untuk kenyamanan menginap Anda.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Wifi, title: "WiFi Cepat", desc: "Koneksi internet stabil di seluruh area." },
              {
                icon: Coffee,
                title: "Sarapan",
                desc: "Tersedia pilihan sarapan setiap pagi hari.",
              },
              {
                icon: ShowerHead,
                title: "Kamar Mandi Dalam",
                desc: "Kamar mandi pribadi di setiap kamar.",
              },
              {
                icon: MessageCircle,
                title: "WhatsApp 24 Jam",
                desc: "Kami selalu siap membantu kapan saja.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-stone-200 bg-white p-6 text-center"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                  <f.icon className="h-5 w-5 text-amber-700" />
                </div>
                <h3 className="mt-4 font-semibold text-stone-900">{f.title}</h3>
                <p className="mt-1.5 text-sm text-stone-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ABOUT / STORY ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          {/* Image placeholder */}
          <div className="order-2 md:order-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="aspect-square rounded-xl bg-amber-50" />
              <div className="aspect-square rounded-xl bg-stone-100 mt-8" />
              <div className="aspect-square rounded-xl bg-stone-100 -mt-4" />
              <div className="aspect-square rounded-xl bg-amber-50 mt-4" />
            </div>
          </div>
          {/* Text */}
          <div className="order-1 md:order-2">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
              <span className="h-px w-6 bg-amber-700" />
              Cerita Kami
            </span>
            <h2 className="mt-4 font-serif text-3xl font-semibold leading-snug">
              Bukan sekadar tempat menginap
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-stone-500">
              {property?.description ??
                "Pomah Living lahir dari keinginan sederhana: menciptakan tempat yang terasa seperti rumah. Setiap sudut dirancang dengan penuh perhatian, setiap tamu disambut seperti teman."}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-stone-500">
              Kami percaya perjalanan terbaik dimulai dari akomodasi yang tepat — nyaman, bersih,
              dan dikelola oleh orang-orang yang peduli.
            </p>
            <div className="mt-8 flex items-center gap-4">
              <Button asChild className="bg-amber-700 hover:bg-amber-800">
                <Link to="/book">Pesan Sekarang</Link>
              </Button>
              <Button asChild variant="ghost" className="text-stone-700">
                <Link to="/rooms">Jelajahi Kamar →</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIAL ── */}
      <section className="bg-stone-900 py-20 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="flex justify-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <blockquote className="mt-6 font-serif text-2xl leading-relaxed text-stone-100 md:text-3xl">
            "Pengalaman menginap yang luar biasa. Staf yang ramah, kamar yang bersih, dan lokasinya
            sangat strategis. Pasti akan kembali lagi!"
          </blockquote>
          <div className="mt-6 flex items-center justify-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-700/40" />
            <div className="text-left">
              <p className="font-semibold text-white">Dewi R.</p>
              <p className="text-xs text-stone-400">Tamu dari Jakarta · Google Review</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BOOKING CTA ── */}
      <section className="border-y border-stone-200 bg-amber-50 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
            <span className="h-px w-6 bg-amber-700" />
            Reservasi
            <span className="h-px w-6 bg-amber-700" />
          </span>
          <h2 className="mt-4 font-serif text-4xl font-semibold tracking-tight">
            Rencanakan menginap Anda
          </h2>
          <p className="mt-4 text-stone-500">
            Pesan langsung tanpa biaya tambahan. Konfirmasi via WhatsApp dalam hitungan jam.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="bg-amber-700 hover:bg-amber-800 text-white">
              <Link to="/book">
                Pesan Kamar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            {property?.whatsapp_number && (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-stone-300 text-stone-700 hover:bg-white"
              >
                <a
                  href={`https://wa.me/${property.whatsapp_number.replace(/\D/g, "")}?text=Halo%2C%20saya%20ingin%20bertanya%20tentang%20kamar%20di%20Pomah%20Living`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Chat WhatsApp
                </a>
              </Button>
            )}
          </div>
          <p className="mt-5 text-xs text-stone-400">
            Tidak perlu deposit. Pembatalan gratis 24 jam sebelum check-in.
          </p>
        </div>
      </section>

      {/* ── LOKASI ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
              <span className="h-px w-6 bg-amber-700" />
              Lokasi
            </span>
            <h2 className="mt-4 font-serif text-3xl font-semibold">Mudah dijangkau</h2>
            <p className="mt-4 text-sm leading-relaxed text-stone-500">
              Terletak di lokasi strategis dengan akses mudah ke pusat kota, restoran, dan tempat
              wisata populer.
            </p>
            {property?.address && (
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="font-medium text-stone-900">{property.address}</p>
                  {property.city && <p className="text-sm text-stone-500">{property.city}</p>}
                </div>
              </div>
            )}
            <Button asChild variant="outline" className="mt-6 border-stone-300">
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(property?.address ?? "Pomah Living Guesthouse")}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MapPin className="mr-2 h-4 w-4" />
                Buka di Google Maps
              </a>
            </Button>
          </div>
          {/* Map placeholder */}
          <div className="aspect-video overflow-hidden rounded-2xl bg-stone-100 flex items-center justify-center border border-stone-200">
            <div className="text-center">
              <MapPin className="mx-auto h-8 w-8 text-stone-300" />
              <p className="mt-2 font-mono text-xs uppercase tracking-widest text-stone-400">
                Google Maps
              </p>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter property={property} />
    </div>
  );
}
