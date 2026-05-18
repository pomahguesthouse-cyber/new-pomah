/**
 * /rooms/$slug — dedicated booking page for one room type.
 *
 * Image gallery, room details, facilities & specs, and a sticky booking
 * widget (dates, room/guest counts, live availability). "Book This Room"
 * carries the selection to the /book form to collect guest details.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight,
  Home,
  Minus,
  Plus,
  Users,
  BedDouble,
  Maximize,
  CheckCircle2,
} from "lucide-react";
import { getRoomTypeDetail, checkRoomTypeAvailability } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rooms/$slug")({
  component: RoomBookingPage,
});

type RoomRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_rate: number | string | null;
  capacity: number | null;
  bed_type: string | null;
  size_sqm: number | null;
  amenities: string[] | null;
  hero_image_url: string | null;
  images: string[] | null;
};

const idr = (n: number) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

/** All gallery images for a room, cover first, with sensible fallbacks. */
function galleryOf(room: RoomRow): string[] {
  const imgs = (room.images ?? []).filter(Boolean);
  if (imgs.length) return imgs;
  if (room.hero_image_url) return [room.hero_image_url];
  return [];
}

function RoomBookingPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(getRoomTypeDetail);
  const availFn = useServerFn(checkRoomTypeAvailability);

  const { data, isLoading } = useQuery({
    queryKey: ["room-detail", slug],
    queryFn: () => fn({ data: { slug } }),
  });

  const room = (data?.room ?? null) as RoomRow | null;
  const others = (data?.others ?? []) as RoomRow[];
  const roomCount = data?.roomCount ?? 0;

  const gallery = useMemo(() => (room ? galleryOf(room) : []), [room]);
  const [active, setActive] = useState(0);

  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(1);

  const capacity = room?.capacity ?? 2;
  const maxRooms = Math.max(1, roomCount || 1);
  const maxGuests = Math.max(1, capacity * rooms);

  // Live availability once both dates are chosen.
  const { data: availData } = useQuery({
    queryKey: ["room-avail", checkIn, checkOut],
    queryFn: () => availFn({ data: { checkIn, checkOut } }),
    enabled: !!checkIn && !!checkOut && checkIn < checkOut,
  });
  const availability: string =
    !checkIn || !checkOut
      ? "—"
      : checkIn >= checkOut
        ? "Tanggal tidak valid"
        : availData
          ? room && room.id in (availData.availability ?? {})
            ? availData.availability[room.id]
              ? "Tersedia"
              : "Penuh"
            : "Tersedia"
          : "Mengecek…";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <PublicNav />
        <div className="mx-auto max-w-6xl px-6 py-24 text-center text-sm text-stone-400">
          Memuat kamar…
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-stone-50">
        <PublicNav />
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold">Kamar tidak ditemukan</h1>
          <Link to="/rooms" className="mt-4 inline-block text-sm text-teal-700 underline">
            Kembali ke daftar kamar
          </Link>
        </div>
        <PublicFooter property={data?.property} />
      </div>
    );
  }

  const book = () => {
    navigate({
      to: "/book",
      search: {
        room: room.slug,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
        adults: guests || undefined,
      },
    });
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav />

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-stone-500">
          <Link to="/" className="flex items-center gap-1 hover:text-teal-700">
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to="/rooms" className="hover:text-teal-700">
            Rooms
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-stone-700">{room.name}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Left — gallery + details */}
          <div>
            {/* Gallery */}
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <div className="aspect-[16/10] w-full bg-stone-100">
                {gallery[active] ? (
                  <img
                    src={gallery[active]}
                    alt={room.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs uppercase tracking-widest text-stone-400">
                    Foto Kamar
                  </div>
                )}
              </div>
            </div>
            {gallery.length > 1 && (
              <div className="mt-3 flex gap-3">
                {gallery.map((src, i) => (
                  <button
                    key={src + i}
                    onClick={() => setActive(i)}
                    className={cn(
                      "h-20 w-28 shrink-0 overflow-hidden rounded-lg border-2 transition",
                      i === active ? "border-teal-600" : "border-transparent opacity-80",
                    )}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Title + description */}
            <h1 className="mt-8 text-3xl font-bold tracking-tight">{room.name}</h1>
            {room.description && (
              <p className="mt-3 max-w-2xl leading-relaxed text-stone-500">{room.description}</p>
            )}

            {/* Facilities */}
            {room.amenities && room.amenities.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-bold">Fasilitas Kamar</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {room.amenities.map((a) => (
                    <div
                      key={a}
                      className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm text-stone-700 ring-1 ring-stone-200"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" />
                      {a}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Specs */}
            <section className="mt-8">
              <h2 className="text-lg font-bold">Spesifikasi Kamar</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Spec
                  icon={<Users className="h-4 w-4" />}
                  label="Max Tamu"
                  value={`${capacity} persons`}
                />
                <Spec
                  icon={<Maximize className="h-4 w-4" />}
                  label="Ukuran Kamar"
                  value={room.size_sqm ? `${room.size_sqm} m²` : "—"}
                />
                <Spec
                  icon={<BedDouble className="h-4 w-4" />}
                  label="Kamar Tersedia"
                  value={`${roomCount} rooms`}
                />
              </div>
            </section>
          </div>

          {/* Right — booking widget */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-medium text-stone-500">Harga Kamar</p>
              <p className="mt-1 text-3xl font-bold text-teal-700">{idr(Number(room.base_rate))}</p>
              <p className="text-xs text-stone-400">per malam</p>

              <div className="mt-5 space-y-4">
                <Labeled label="Check-in">
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  />
                </Labeled>
                <Labeled label="Check-out">
                  <input
                    type="date"
                    value={checkOut}
                    min={checkIn || undefined}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  />
                </Labeled>

                <Stepper
                  icon={<BedDouble className="h-4 w-4" />}
                  label="Jumlah Kamar"
                  value={rooms}
                  hint={`Maks ${maxRooms}`}
                  onDec={() => setRooms((v) => Math.max(1, v - 1))}
                  onInc={() => setRooms((v) => Math.min(maxRooms, v + 1))}
                />
                <Stepper
                  icon={<Users className="h-4 w-4" />}
                  label="Jumlah Tamu"
                  value={guests}
                  hint={`Maks ${maxGuests} (${capacity}/kamar)`}
                  onDec={() => setGuests((v) => Math.max(1, v - 1))}
                  onInc={() => setGuests((v) => Math.min(maxGuests, v + 1))}
                />

                <button
                  onClick={book}
                  className="w-full rounded-lg bg-rose-400 py-3 text-sm font-semibold text-white transition hover:bg-rose-500"
                >
                  Book This Room
                </button>
              </div>

              <div className="mt-5 space-y-2 border-t border-stone-100 pt-4 text-sm">
                <Line label="Check-in" value="Mulai 14:00" />
                <Line label="Check-out" value="Sampai 12:00" />
                <Line
                  label="Availability"
                  value={availability}
                  highlight={availability === "Tersedia" || availability === "Penuh"}
                  bad={availability === "Penuh"}
                />
              </div>
            </div>
          </aside>
        </div>

        {/* Other rooms */}
        {others.length > 0 && (
          <section className="mt-16">
            <h2 className="text-center text-2xl font-bold">Kamar Lainnya</h2>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              {others.map((o) => {
                const cover = galleryOf(o)[0];
                return (
                  <Link
                    key={o.id}
                    to="/rooms/$slug"
                    params={{ slug: o.slug }}
                    className="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-lg"
                  >
                    <div className="aspect-[4/3] bg-stone-100">
                      {cover ? (
                        <img src={cover} alt={o.name} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold">{o.name}</h3>
                        <span className="text-sm font-semibold text-teal-700">
                          {idr(Number(o.base_rate))}
                        </span>
                      </div>
                      {o.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-stone-500">{o.description}</p>
                      )}
                      <span className="mt-3 inline-block rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition group-hover:bg-teal-800">
                        Lihat & Pesan
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <PublicFooter property={data?.property} />
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-stone-400">
        <span className="text-teal-600">{icon}</span>
        {label}
      </div>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-stone-600">{label}</p>
      {children}
    </div>
  );
}

function Stepper({
  icon,
  label,
  value,
  hint,
  onDec,
  onInc,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-stone-600">
        <span className="text-stone-400">{icon}</span>
        {label}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onDec}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-600 transition hover:bg-stone-50"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-sm font-semibold">{value}</span>
        <button
          onClick={onInc}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-600 transition hover:bg-stone-50"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="text-xs text-stone-400">{hint}</span>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  highlight,
  bad,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-500">{label}</span>
      <span
        className={cn(
          "font-medium",
          highlight ? (bad ? "text-rose-600" : "text-emerald-600") : "text-stone-700",
        )}
      >
        {value}
      </span>
    </div>
  );
}
