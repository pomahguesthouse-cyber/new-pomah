import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { MapPin, Calendar, Coffee, Newspaper, ArrowRight, Star } from "lucide-react";
import { mergeExploreConfig } from "@/admin/modules/explore/explore.config";

export const Route = createFileRoute("/explore")({
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => ({
    meta: [
      { title: "Jelajahi Semarang — Destinasi Wisata & Kuliner" },
      {
        name: "description",
        content: "Temukan destinasi wisata terkenal, kuliner terbaik, event seru, dan berita terbaru di Kota Semarang.",
      },
    ],
  }),
  component: ExploreSemarang,
});

function ExploreSemarang() {
  const loaderData = Route.useLoaderData();
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fn(),
    initialData: loaderData,
  });

  const config = mergeExploreConfig(data?.property?.explore_config);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav property={data?.property} />

      {/* Hero Section */}
      <header className="relative bg-teal-800 py-24 text-white overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-20 mix-blend-overlay"
          style={{ backgroundImage: `url('${config.hero.bgImageUrl}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/80 via-stone-900/20 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-6 text-center">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-teal-300">
            <span className="h-px w-6 bg-teal-300" />
            City Guide
            <span className="h-px w-6 bg-teal-300" />
          </span>
          <h1 className="mt-5 font-serif text-5xl font-bold tracking-tight md:text-6xl drop-shadow-md">
            {config.hero.heading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-teal-50 drop-shadow-sm leading-relaxed whitespace-pre-wrap">
            {config.hero.subheading}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16 space-y-24">
        
        {/* 1. Destinasi Wisata */}
        <section>
          <div className="mb-10 flex items-end justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-serif text-3xl font-bold text-stone-900">
                <MapPin className="h-7 w-7 text-teal-700" />
                Destinasi Wisata Terkenal
              </h2>
              <p className="mt-2 text-stone-500">Ikon pariwisata yang wajib Anda kunjungi di Semarang.</p>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {config.destinations.map((dest, i) => (
              <div key={i} className="group overflow-hidden rounded-2xl bg-white shadow-sm border border-stone-200 transition hover:shadow-xl">
                <div className="relative h-48 overflow-hidden">
                  <img src={dest.image} alt={dest.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                  <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-xs font-bold text-stone-800 shadow-sm">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {dest.rating}
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="font-serif text-xl font-bold text-stone-900">{dest.name}</h3>
                  <p className="mt-2 text-sm text-stone-600 leading-relaxed">{dest.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Kuliner Terbaik */}
        <section>
          <div className="mb-10 text-center">
            <h2 className="flex items-center justify-center gap-2 font-serif text-3xl font-bold text-stone-900">
              <Coffee className="h-7 w-7 text-amber-600" />
              Kuliner Terbaik
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-stone-500">Manjakan lidah Anda dengan cita rasa lokal yang menggugah selera.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {config.culinary.map((cul, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm border border-stone-200 transition hover:-translate-y-1 hover:shadow-lg">
                <div className="h-40 overflow-hidden bg-stone-100">
                  <img src={cul.image} alt={cul.name} className="h-full w-full object-cover" />
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <span className="mb-2 w-max rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    {cul.category}
                  </span>
                  <h3 className="font-serif text-lg font-bold text-stone-900">{cul.name}</h3>
                  <p className="mt-2 text-sm text-stone-600 flex-1">{cul.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Event & 4. Berita */}
        <div className="grid gap-12 lg:grid-cols-3">
          
          {/* Event */}
          <section className="lg:col-span-2">
            <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-stone-900 mb-6">
              <Calendar className="h-6 w-6 text-teal-700" />
              Event Mendatang
            </h2>
            <div className="space-y-4">
              {config.events.map((ev, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl bg-white p-5 shadow-sm border border-stone-200 hover:border-teal-300 transition">
                  <div className="shrink-0 sm:w-32">
                    <p className="text-sm font-bold text-teal-700">{ev.date}</p>
                    <p className="text-xs text-stone-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {ev.location}
                    </p>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-serif text-lg font-bold text-stone-900">{ev.title}</h3>
                    <p className="mt-1 text-sm text-stone-600">{ev.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Berita */}
          <section>
            <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-stone-900 mb-6">
              <Newspaper className="h-6 w-6 text-stone-700" />
              Berita Lainnya
            </h2>
            <div className="space-y-6 rounded-xl bg-stone-100 p-6 border border-stone-200/60">
              {config.news.map((nw, i) => (
                <a href={nw.url} key={i} className="group cursor-pointer block">
                  <p className="text-[11px] font-semibold text-teal-700 uppercase tracking-widest">{nw.date}</p>
                  <h3 className="mt-1 font-serif text-base font-bold text-stone-900 group-hover:text-teal-700 transition">
                    {nw.title}
                  </h3>
                  <p className="mt-2 text-sm text-stone-600 line-clamp-3">{nw.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 group-hover:gap-2 transition-all">
                    Baca selengkapnya <ArrowRight className="h-3 w-3" />
                  </span>
                </a>
              ))}
            </div>
          </section>

        </div>
      </main>

      <PublicFooter property={data?.property} />
    </div>
  );
}
