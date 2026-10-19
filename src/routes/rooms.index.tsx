/**
 * /rooms — daftar tipe kamar (SSR). Target item breadcrumb "Kamar" di halaman
 * kamar dan masuk sitemap. Harga = room_types.base_rate (sumber kebenaran).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { PomahFooter } from "@/public/components/public-shell";
import { buildStorageImageUrl } from "@/lib/storage-image";
import { formatRupiah } from "@/public/content/approved-seo";
import { canonicalHeadTags, publicSeoMeta, ROOMS_INDEX_PATH } from "@/public/lib/public-seo";

type ListedRoom = {
  id: string;
  name: string | null;
  slug: string | null;
  base_rate: number | string | null;
  capacity: number | null;
  size_sqm: number | null;
  bedrooms?: number | null;
  hero_image_url?: string | null;
};

const ROOMS_SEO = {
  title: "Tipe Kamar & Harga | Pomah Guesthouse Semarang",
  description:
    "Daftar kamar Pomah Guesthouse Sampangan, Semarang: Single, Deluxe, Grand Deluxe, dan kamar keluarga 2 kamar tidur. Lihat kapasitas, ukuran, dan harga mulai.",
  h1: "Tipe Kamar di Pomah Guesthouse",
};

export function roomsIndexPriceLabel(baseRate: number | string | null | undefined): string {
  const rate = Number(baseRate);
  return Number.isFinite(rate) && rate > 0 ? `${formatRupiah(rate)}/malam` : "";
}

export const Route = createFileRoute("/rooms/")({
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => {
    const canonical = canonicalHeadTags(ROOMS_INDEX_PATH);
    return {
      meta: [
        ...publicSeoMeta(
          { title: ROOMS_SEO.title, description: ROOMS_SEO.description, robots: "index, follow" },
          { title: ROOMS_SEO.title, description: ROOMS_SEO.description },
        ),
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: RoomsIndexPage,
});

function RoomsIndexPage() {
  const data = Route.useLoaderData() as { property?: { name?: string | null } | null; roomTypes?: ListedRoom[] };
  const rooms = (data?.roomTypes ?? []).filter((room) => room.slug);
  const name = data?.property?.name?.trim() || "Pomah Guesthouse";
  return (
    <div className="min-h-screen bg-[#f3ece0]">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="font-serif text-xl font-bold text-stone-900">{name}</Link>
          <Link to="/book" className="rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800">
            Pesan kamar
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
          <Link to="/" className="hover:text-amber-800">Beranda</Link> <span aria-hidden>›</span> <span>Kamar</span>
        </nav>
        <div className="mt-4 flex flex-col items-center text-center">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{ROOMS_SEO.h1}</h1>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => {
            const href = `/rooms/${room.slug}`;
            const price = roomsIndexPriceLabel(room.base_rate);
            return (
              <article key={room.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-amber-50">
                  {room.hero_image_url ? (
                    <img
                      src={buildStorageImageUrl(room.hero_image_url, { width: 640, quality: 60 })}
                      width={640}
                      height={480}
                      alt={room.name ?? "Kamar"}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center font-serif text-lg text-amber-800/70">{room.name}</div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-stone-400">Kamar</p>
                      <h2 className="font-serif text-xl font-semibold text-stone-900">
                        <a href={href} className="transition hover:text-amber-800">{room.name}</a>
                      </h2>
                    </div>
                    {price ? (
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] font-medium text-stone-400">Harga mulai dari</p>
                        <p className="text-lg font-bold text-amber-700">{price}</p>
                      </div>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-stone-100 pt-3 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium text-stone-400">Kapasitas</dt>
                      <dd className="text-stone-700">{room.capacity ? `${room.capacity} tamu` : "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-stone-400">Ukuran</dt>
                      <dd className="text-stone-700">{room.size_sqm ? `${room.size_sqm} m²` : "-"}</dd>
                    </div>
                  </dl>
                  <a href={href} className="mt-5 inline-flex items-center justify-center rounded-full border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-700 hover:text-white">
                    Lihat kamar
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-stone-500">Harga bisa berbeda di tanggal tertentu. Untuk harga pasti, pilih tanggal di halaman pemesanan.</p>
      </main>
      <PomahFooter name={name} property={(data?.property as never) ?? null} rooms={rooms} />
    </div>
  );
}
