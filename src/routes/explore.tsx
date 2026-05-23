import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData, getPublicExploreItems, type PublicExploreItem } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { MapPin, Calendar, Coffee, Newspaper, ArrowRight, Star } from "lucide-react";

export const Route = createFileRoute("/explore")({
  loader: async () => {
    const [{ getPublicSiteData }, { getPublicExploreItems }] = await Promise.all([
      import("@/public/functions/public.functions"),
      import("@/public/functions/public.functions"),
    ]);
    const [site, items] = await Promise.all([
      getPublicSiteData(),
      getPublicExploreItems(),
    ]);
    return { site, items };
  },
  head: () => ({
    meta: [
      { title: "Jelajahi Semarang — Destinasi Wisata & Kuliner" },
      {
        name: "description",
        content:
          "Temukan destinasi wisata terkenal, kuliner terbaik, event seru, dan berita terbaru di Kota Semarang.",
      },
    ],
  }),
  component: ExploreSemarang,
});

function ExploreSemarang() {
  const loaderData = Route.useLoaderData();
  const siteFn = useServerFn(getPublicSiteData);
  const itemsFn = useServerFn(getPublicExploreItems);

  const { data: site } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => siteFn(),
    initialData: loaderData.site,
  });
  const { data: items } = useQuery({
    queryKey: ["public-explore-items"],
    queryFn: () => itemsFn(),
    initialData: loaderData.items,
  });

  const all = (items ?? []) as PublicExploreItem[];
  const destinations = all.filter((i) => i.category === "destination");
  const culinary = all.filter((i) => i.category === "culinary");
  const events = all.filter((i) => i.category === "event");
  const news = all.filter((i) => i.category === "news");

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav property={site?.property} />

      {/* Hero */}
      <header className="relative bg-teal-800 py-24 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1629827014691-30cc0ed06927?auto=format&fit=crop&q=80&w=1600')] bg-cover bg-center opacity-20 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/80 via-stone-900/20 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-6 text-center">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-teal-300">
            <span className="h-px w-6 bg-teal-300" />
            City Guide
            <span className="h-px w-6 bg-teal-300" />
          </span>
          <h1 className="mt-5 font-serif text-5xl font-bold tracking-tight md:text-6xl drop-shadow-md">
            Jelajahi Semarang
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-teal-50 drop-shadow-sm leading-relaxed">
            Temukan pesona wisata bersejarah, ragam kuliner otentik, dan deretan acara seru di ibu
            kota Jawa Tengah.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16 space-y-24">
        {/* Destinasi Wisata */}
        {destinations.length > 0 && (
          <section>
            <div className="mb-10">
              <h2 className="flex items-center gap-2 font-serif text-3xl font-bold text-stone-900">
                <MapPin className="h-7 w-7 text-teal-700" />
                Destinasi Wisata Terkenal
              </h2>
              <p className="mt-2 text-stone-500">
                Ikon pariwisata yang wajib Anda kunjungi di Semarang.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {destinations.map((dest) => (
                <div
                  key={dest.id}
                  className="group overflow-hidden rounded-2xl bg-white shadow-sm border border-stone-200 transition hover:shadow-xl"
                >
                  {dest.image_url && (
                    <div className="relative h-48 overflow-hidden">
                      <img
                        src={dest.image_url}
                        alt={dest.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                      />
                      {dest.rating != null && (
                        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-xs font-bold text-stone-800 shadow-sm">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {dest.rating}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="p-6">
                    <h3 className="font-serif text-xl font-bold text-stone-900">{dest.title}</h3>
                    {dest.description && (
                      <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                        {dest.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Kuliner Terbaik */}
        {culinary.length > 0 && (
          <section>
            <div className="mb-10 text-center">
              <h2 className="flex items-center justify-center gap-2 font-serif text-3xl font-bold text-stone-900">
                <Coffee className="h-7 w-7 text-amber-600" />
                Kuliner Terbaik
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-stone-500">
                Manjakan lidah Anda dengan cita rasa lokal yang menggugah selera.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {culinary.map((cul) => (
                <div
                  key={cul.id}
                  className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm border border-stone-200 transition hover:-translate-y-1 hover:shadow-lg"
                >
                  {cul.image_url && (
                    <div className="h-40 overflow-hidden bg-stone-100">
                      <img
                        src={cul.image_url}
                        alt={cul.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    {cul.badge && (
                      <span className="mb-2 w-max rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        {cul.badge}
                      </span>
                    )}
                    <h3 className="font-serif text-lg font-bold text-stone-900">{cul.title}</h3>
                    {cul.description && (
                      <p className="mt-2 text-sm text-stone-600 flex-1">{cul.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Event & Berita */}
        {(events.length > 0 || news.length > 0) && (
          <div className="grid gap-12 lg:grid-cols-3">
            {events.length > 0 && (
              <section className="lg:col-span-2">
                <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-stone-900 mb-6">
                  <Calendar className="h-6 w-6 text-teal-700" />
                  Event Mendatang
                </h2>
                <div className="space-y-4">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl bg-white p-5 shadow-sm border border-stone-200 hover:border-teal-300 transition"
                    >
                      <div className="shrink-0 sm:w-32">
                        {ev.date_text && (
                          <p className="text-sm font-bold text-teal-700">{ev.date_text}</p>
                        )}
                        {ev.location_text && (
                          <p className="text-xs text-stone-400 mt-0.5 flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {ev.location_text}
                          </p>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-serif text-lg font-bold text-stone-900">{ev.title}</h3>
                        {ev.description && (
                          <p className="mt-1 text-sm text-stone-600">{ev.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {news.length > 0 && (
              <section>
                <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-stone-900 mb-6">
                  <Newspaper className="h-6 w-6 text-stone-700" />
                  Berita Lainnya
                </h2>
                <div className="space-y-6 rounded-xl bg-stone-100 p-6 border border-stone-200/60">
                  {news.map((nw) => (
                    <article key={nw.id} className="group cursor-pointer">
                      {nw.date_text && (
                        <p className="text-[11px] font-semibold text-teal-700 uppercase tracking-widest">
                          {nw.date_text}
                        </p>
                      )}
                      <h3 className="mt-1 font-serif text-base font-bold text-stone-900 group-hover:text-teal-700 transition">
                        {nw.title}
                      </h3>
                      {nw.description && (
                        <p className="mt-2 text-sm text-stone-600 line-clamp-3">{nw.description}</p>
                      )}
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 group-hover:gap-2 transition-all">
                        Baca selengkapnya <ArrowRight className="h-3 w-3" />
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <PublicFooter property={site?.property} />
    </div>
  );
}
