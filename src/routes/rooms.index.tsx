import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";

export const Route = createFileRoute("/rooms/")({
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => ({
    meta: [
      { title: "Pilihan Kamar & Tarif — Pomah Guesthouse Semarang" },
      {
        name: "description",
        content: "Temukan berbagai tipe kamar bersih dan nyaman di Pomah Guesthouse Semarang. Pesan sekarang secara langsung dengan harga terbaik.",
      },
      { property: "og:title", content: "Pilihan Kamar & Tarif — Pomah Guesthouse Semarang" },
      {
        property: "og:description",
        content: "Temukan berbagai tipe kamar bersih dan nyaman di Pomah Guesthouse Semarang.",
      },
    ],
  }),
  component: PublicRooms,
});

function PublicRooms() {
  const loaderData = Route.useLoaderData();
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fn(),
    initialData: loaderData,
  });
  const rooms = data?.roomTypes ?? [];

  return (
    <div className="min-h-screen bg-white text-stone-900">
      <PublicNav property={data?.property} />

      {/* Header */}
      <header className="border-b border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
            <span className="h-px w-6 bg-amber-700" />
            Kamar Kami
          </span>
          <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight md:text-5xl">
            Dipilih dengan cermat
          </h1>
          <p className="mt-3 max-w-xl text-sm text-stone-500">
            Setiap kamar dirancang untuk kenyamanan maksimal — tenang, bersih, dan penuh perhatian.
          </p>
        </div>
      </header>

      {/* Rooms grid */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-8 md:grid-cols-2">
          {rooms.map((rt: any) => (
            <article
              key={rt.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-xl"
            >
              {/* Image */}
              <div className="aspect-[4/3] overflow-hidden bg-stone-100">
                {rt.hero_image_url ? (
                  <img
                    src={rt.hero_image_url}
                    alt={rt.name}
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">
                      Foto Kamar
                    </p>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col p-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-stone-900">{rt.name}</h2>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-stone-400">
                      {[
                        rt.bed_type,
                        rt.capacity && `Maks. ${rt.capacity} tamu`,
                        rt.size_sqm && `${rt.size_sqm} m²`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-semibold text-amber-700">
                      Rp {Number(rt.base_rate).toLocaleString("id-ID")}
                    </p>
                    <p className="font-mono text-[10px] text-stone-400">/malam</p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-stone-500">{rt.description}</p>

                {rt.amenities && rt.amenities.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {rt.amenities.map((a) => (
                      <span
                        key={a}
                        className="rounded-full border border-stone-200 px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider text-stone-500"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center gap-3 pt-6">
                  <Link
                    to="/rooms/$slug"
                    params={{ slug: rt.slug }}
                    search={{}}
                    className="flex-1 rounded-lg bg-stone-900 py-2.5 text-center text-sm font-medium text-white transition hover:bg-amber-700"
                  >
                    Pesan Kamar Ini
                  </Link>
                  <Link
                    to="/rooms/$slug"
                    params={{ slug: rt.slug }}
                    search={{}}
                    className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm text-stone-600 transition hover:bg-stone-50"
                  >
                    Detail
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <PublicFooter property={data?.property} />
    </div>
  );
}
