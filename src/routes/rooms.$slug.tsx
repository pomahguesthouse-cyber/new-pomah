/**
 * /rooms/$slug — dedicated booking page for one room type.
 *
 * Image gallery, room details, facilities & specs, and a sticky booking
 * widget. "Book This Room" opens a full confirmation dialog (dates,
 * times, guest details, hotel policy, payment method) that creates the
 * reservation directly.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, notFound, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronRight,
  Home,
  Minus,
  Plus,
  Users,
  BedDouble,
  Maximize,
  CheckCircle2,
  Loader2,
  CalendarDays,
  Clock,
  AlertCircle,
  FileText,
  CreditCard,
  Building2,
  MapPin,
} from "lucide-react";
import {
  getRoomTypeDetail,
  checkRoomTypeAvailability,
  submitPublicBooking,
} from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DatePickerID } from "@/components/ui/date-picker";

export const Route = createFileRoute("/rooms/$slug")({
  // Optional date prefill carried from the homepage date picker.
  validateSearch: (s: Record<string, unknown>): { checkIn?: string; checkOut?: string; guests?: number } => {
    const out: { checkIn?: string; checkOut?: string; guests?: number } = {};
    if (typeof s.checkIn === "string") out.checkIn = s.checkIn;
    if (typeof s.checkOut === "string") out.checkOut = s.checkOut;
    const g = Number(s.guests);
    if (Number.isFinite(g) && g >= 1) out.guests = Math.floor(g);
    return out;
  },
  loader: async ({ params }) => {
    if (params.slug === "deluxe-ocean-view") {
      throw redirect({
        to: "/rooms",
        statusCode: 301,
      });
    }
    const { getRoomTypeDetail } = await import("@/public/functions/public.functions");
    const result = await getRoomTypeDetail({ data: { slug: params.slug } });
    // Slug tidak ditemukan di database → lempar 404 agar mesin pencari tidak mengindeks
    // halaman "Kamar tidak ditemukan" sebagai halaman valid.
    if (!result.room) throw notFound();
    return result;
  },
  head: ({ loaderData }) => {
    const room = loaderData?.room;
    // Jika room tidak ditemukan, tambahkan noindex agar tidak terindeks oleh mesin pencari
    if (!room) {
      return {
        meta: [
          { title: "Kamar Tidak Ditemukan — Pomah Guesthouse" },
          { name: "robots", content: "noindex, follow" },
        ],
      };
    }
    const name = room.name ?? "Kamar";
    const desc = room.description ?? "Kamar di Pomah Guesthouse Semarang";
    const domain = loaderData?.property?.public_domain || "pomahliving.com";
    const canonicalUrl = `https://${domain.replace(/^https?:\/\//, "")}/rooms/${room.slug || ""}`;
    return {
      meta: [
        { title: `${name} — Pomah Guesthouse Semarang` },
        { name: "description", content: desc },
        { name: "robots", content: "index, follow" },
        { property: "og:title", content: `${name} — Pomah Guesthouse Semarang` },
        { property: "og:description", content: desc },
        { property: "og:image", content: room?.hero_image_url || undefined },
      ],
      links: [
        { rel: "canonical", href: canonicalUrl }
      ],
    };
  },
  component: RoomBookingPage,
});

export type RoomRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_rate: number | string | null;
  capacity: number | null;
  bed_type: string | null;
  floor_info: string | null;
  size_sqm: number | null;
  amenities: string[] | null;
  hero_image_url: string | null;
  images: string[] | null;
  extrabed_rate?: number | string | null;
  extrabed_capacity?: number | null;
  total_physical_rooms?: number | null;
};

export const DEFAULT_HOTEL_POLICY = [
  "Tidak diperbolehkan membawa makanan/buah berbau menyengat seperti durian",
  "Tidak diperbolehkan mengkonsumsi alkohol di penginapan ini",
  "Tidak diperbolehkan melakukan pesta",
  "Tidak boleh merokok di dalam kamar",
  "Area merokok pada lokasi tertentu seperti balkon dan lobby lantai 2",
].join("\n");

/* ---- date helpers (Indonesian) ----------------------------------- */
const MONTHS_ID = [
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
/** "2026-05-18" -> "18/05/2026" */
function fmtDateID(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}
const todayISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
function isoAddDays(iso: string, n: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}
function nightsBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

const idr = (n: number) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

const formatIDR = (
  n: number,
  sizeClass = "text-inherit",
  numberClass = "font-sans font-bold tabular-nums"
) => {
  return (
    <span className={`${sizeClass} inline-flex items-baseline font-sans`}>
      <span className="text-[0.75em] font-normal text-stone-500 mr-0.5 tracking-normal">Rp</span>
      <span className={numberClass}>{Number(n || 0).toLocaleString("id-ID")}</span>
    </span>
  );
};

/** All gallery images for a room, cover first, with sensible fallbacks. */
function galleryOf(room: RoomRow): string[] {
  const imgs = (room.images ?? []).filter(Boolean);
  if (imgs.length) return imgs;
  if (room.hero_image_url) return [room.hero_image_url];
  return [];
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

function RoomBookingPage() {
  const loaderData = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const fn = useServerFn(getRoomTypeDetail);
  const availFn = useServerFn(checkRoomTypeAvailability);

  const { data, isLoading } = useQuery({
    queryKey: ["room-detail", slug],
    queryFn: () => fn({ data: { slug } }),
    initialData: loaderData,
  });

  const room = (data?.room ?? null) as RoomRow | null;
  const others = (data?.others ?? []) as RoomRow[];
  const roomCount = data?.roomCount ?? 0;
  const property = useMemo(() => (data?.property ?? {}) as Record<string, unknown>, [data]);

  const gallery = useMemo(() => (room ? galleryOf(room) : []), [room]);
  const [active, setActive] = useState(0);

  // Defaults: today → +1 night, unless the homepage date picker passed dates.
  const today = todayISO();
  const [checkIn, setCheckIn] = useState(search.checkIn || today);
  const [checkOut, setCheckOut] = useState(
    search.checkOut || isoAddDays(search.checkIn || today, 1),
  );
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);

  const handleCheckInChange = (val: string) => {
    setCheckIn(val);
    setCheckInOpen(false);
    if (!checkOut || checkOut <= val) {
      setCheckOut(isoAddDays(val, 1));
    }
    setTimeout(() => {
      setCheckOutOpen(true);
    }, 150);
  };
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState<number>(search.guests ?? 1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const capacity = room?.capacity ?? 2;
  const maxRooms = Math.max(1, roomCount || 1);
  const maxGuests = Math.max(1, capacity * rooms);

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

  const displayRoom = useMemo(() => {
    if (!room) return null;
    const resolvedRates = availData?.rates ?? null;
    if (resolvedRates && resolvedRates[room.id]) {
      return {
        ...room,
        base_rate: resolvedRates[room.id].base_rate,
        extrabed_rate: resolvedRates[room.id].extrabed_rate,
      };
    }
    return room;
  }, [room, availData?.rates]);

  const displayOthers = useMemo(() => {
    const resolvedRates = availData?.rates ?? null;
    if (!resolvedRates) return others;
    return others.map((o) => {
      const rateInfo = resolvedRates[o.id];
      if (rateInfo) {
        return {
          ...o,
          base_rate: rateInfo.base_rate,
          extrabed_rate: rateInfo.extrabed_rate,
        };
      }
      return o;
    });
  }, [others, availData?.rates]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center text-sm text-stone-400">
          Memuat kamar…
        </div>
      </div>
    );
  }

  // Fallback client-side: room null setelah hydration (sangat jarang terjadi
  // karena loader sudah melempar notFound(), tapi sebagai safety net).
  if (!room) {
    return <RoomNotFoundPage property={data?.property} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <PublicNav property={data?.property} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-stone-500">
          <Link to="/" className="flex items-center gap-1 hover:text-amber-700">
            <Home className="h-3.5 w-3.5" />
            Home
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to="/rooms" className="hover:text-amber-700">
            Rooms
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-stone-700">{room.name}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Left — gallery + details */}
          <div>
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
                      i === active ? "border-amber-600" : "border-transparent opacity-80",
                    )}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <h1 className="mt-8 text-3xl font-bold tracking-tight">{room.name}</h1>
            {room.description && (
              <p className="mt-3 max-w-2xl leading-relaxed text-stone-500">{room.description}</p>
            )}

            {room.amenities && room.amenities.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-bold">Fasilitas Kamar</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {room.amenities.map((a) => (
                    <div
                      key={a}
                      className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm text-stone-700 ring-1 ring-stone-200"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-600" />
                      {a}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-lg font-bold">Spesifikasi Kamar</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                {room.floor_info && (
                  <Spec
                    icon={<MapPin className="h-4 w-4" />}
                    label="Lokasi"
                    value={room.floor_info}
                  />
                )}
              </div>
            </section>
          </div>

          {/* Right — booking widget */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-medium text-stone-500">Harga Kamar</p>
              <p className="mt-1 text-3xl font-bold text-amber-700">
                {formatIDR(Number(displayRoom?.base_rate ?? 0), "text-3xl", "font-sans font-bold text-amber-700 tabular-nums")}
              </p>
              <p className="text-xs text-stone-400">per malam</p>

              <div className="mt-5 space-y-4">
                <Labeled label="Check-in">
                  <DateField
                    value={checkIn}
                    min={today}
                    onChange={handleCheckInChange}
                    open={checkInOpen}
                    onOpenChange={setCheckInOpen}
                  />
                </Labeled>
                <Labeled label="Check-out">
                  <DateField
                    value={checkOut}
                    min={checkIn ? isoAddDays(checkIn, 1) : today}
                    onChange={setCheckOut}
                    open={checkOutOpen}
                    onOpenChange={setCheckOutOpen}
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
                  onClick={() => {
                    if (checkIn >= checkOut) {
                      toast.error("Tanggal check-out harus setelah check-in");
                      return;
                    }
                    setDialogOpen(true);
                  }}
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
        {displayOthers.length > 0 && (
          <section className="mt-16">
            <h2 className="text-center text-2xl font-bold">Kamar Lainnya</h2>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              {displayOthers.map((o) => {
                const cover = galleryOf(o)[0];
                return (
                  <Link
                    key={o.id}
                    to="/rooms/$slug"
                    params={{ slug: o.slug }}
                    search={{}}
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
                        <span className="text-sm font-semibold text-amber-700">
                          {formatIDR(Number(o.base_rate), "text-sm", "font-sans font-bold text-amber-700 tabular-nums")}
                        </span>
                      </div>
                      {o.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-stone-500">{o.description}</p>
                      )}
                      <span className="mt-3 inline-block rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white transition group-hover:bg-amber-800">
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

      <BookingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        room={displayRoom || room}
        checkIn={checkIn}
        checkOut={checkOut}
        onCheckInChange={handleCheckInChange}
        onCheckOutChange={setCheckOut}
        rooms={rooms}
        maxRooms={maxRooms}
        guests={guests}
        hotelPolicy={(property.hotel_policy as string | null) || DEFAULT_HOTEL_POLICY}
      />
    </div>
  );
}

/* ================================================================== */
/* Booking confirmation dialog                                         */
/* ================================================================== */

export function BookingDialog({
  open,
  onClose,
  room,
  checkIn,
  checkOut,
  onCheckInChange,
  onCheckOutChange,
  rooms: initialRooms,
  extrabed: initialExtrabed = 0,
  maxRooms,
  guests,
  hotelPolicy,
}: {
  open: boolean;
  onClose: () => void;
  room: RoomRow;
  checkIn: string;
  checkOut: string;
  onCheckInChange: (v: string) => void;
  onCheckOutChange: (v: string) => void;
  rooms: number;
  extrabed?: number;
  maxRooms: number;
  guests: number;
  hotelPolicy: string;
}) {
  const navigate = useNavigate();
  const submit = useServerFn(submitPublicBooking);

  const [rooms, setRooms] = useState(initialRooms);
  const [extrabed, setExtrabed] = useState(initialExtrabed);
  const [checkInTime, setCheckInTime] = useState("14:00");
  const [checkOutTime, setCheckOutTime] = useState("12:00");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [payment, setPayment] = useState<"transfer" | "onsite">("transfer");
  const [pending, setPending] = useState(false);

  const nights = nightsBetween(checkIn, checkOut);
  const rate = Number(room.base_rate ?? 0);
  const extrabedRate = Number(room.extrabed_rate ?? 0);
  const perRoomExtrabedCap = Math.max(0, Number(room.extrabed_capacity ?? 0));
  const maxExtrabed = perRoomExtrabedCap * rooms;
  const total = rate * nights * rooms + extrabedRate * nights * extrabed;
  const policyLines = hotelPolicy
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const submitBooking = async () => {
    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      toast.error("Lengkapi nama, email, dan nomor telepon");
      return;
    }
    if (!agreed) {
      toast.error("Setujui kebijakan hotel terlebih dahulu");
      return;
    }
    setPending(true);
    try {
      const res = await submit({
        data: {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          roomTypeId: room.id,
          checkIn,
          checkOut,
          adults: guests,
          children: 0,
          rooms,
          extrabed,
          checkInTime,
          checkOutTime,
          paymentMethod: payment,
          specialRequests: "",
        },
      });
      toast.success("Pemesanan berhasil dibuat");
      navigate({ to: "/book/confirmation/$id", params: { id: res.reference_code ?? res.id }, search: {} });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Book {room.name}</DialogTitle>
          <DialogDescription>Isi formulir di bawah untuk melakukan reservasi</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Dates — editable */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 font-semibold">Check-in</p>
              <DateField
                value={checkIn}
                min={todayISO()}
                onChange={(v) => {
                  onCheckInChange(v);
                  if (!checkOut || checkOut <= v) onCheckOutChange(isoAddDays(v, 1));
                }}
              />
            </div>
            <div>
              <p className="mb-1 font-semibold">Check-out</p>
              <DateField
                value={checkOut}
                min={checkIn ? isoAddDays(checkIn, 1) : todayISO()}
                onChange={onCheckOutChange}
              />
            </div>
          </div>

          {/* Rooms */}
          <div className="rounded-lg bg-stone-100 p-4">
            <p className="mb-2 font-semibold">Jumlah Kamar</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const newRooms = Math.max(1, rooms - 1);
                  setRooms(newRooms);
                  // Clamp extrabed to new max
                  const newMax = perRoomExtrabedCap * newRooms;
                  if (extrabed > newMax) setExtrabed(newMax);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 text-amber-700"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-xl font-bold text-amber-700">{rooms}</span>
              <button
                onClick={() => setRooms((v) => Math.min(maxRooms, v + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 text-amber-700"
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="text-sm text-stone-400">Maks: {maxRooms} kamar</span>
            </div>
          </div>

          {/* Extra bed */}
          {maxExtrabed > 0 && (
            <div className="rounded-lg bg-stone-100 p-4">
              <p className="mb-2 flex items-baseline justify-between font-semibold">
                <span>
                  Extrabed{" "}
                  <span className="text-xs font-normal text-stone-500">
                    (Maksimal {maxExtrabed})
                  </span>
                </span>
                {extrabedRate > 0 && (
                  <span className="text-xs font-normal text-stone-500">
                    +{formatIDR(extrabedRate, "text-xs", "font-sans font-medium tabular-nums")} / malam
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExtrabed((v) => Math.max(0, v - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 text-amber-700"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-xl font-bold text-amber-700">{extrabed}</span>
                <button
                  onClick={() => setExtrabed((v) => Math.min(maxExtrabed, v + 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300 text-amber-700"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 font-semibold">Waktu Check-in</p>
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2">
                <Clock className="h-4 w-4 text-stone-400" />
                <input
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  className="w-full text-sm outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-stone-400">Default: 14:00</p>
            </div>
            <div>
              <p className="mb-1 font-semibold">Waktu Check-out</p>
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2">
                <Clock className="h-4 w-4 text-stone-400" />
                <input
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  className="w-full text-sm outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-stone-400">Default: 12:00</p>
            </div>
          </div>

          {/* Guest details */}
          <Input2
            label="Nama Lengkap"
            required
            value={fullName}
            onChange={setFullName}
            placeholder="Faizal"
          />
          <Input2
            label="Email"
            required
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="email@contoh.com"
          />
          <Input2
            label="Nomor Telepon"
            required
            value={phone}
            onChange={setPhone}
            placeholder="+62 812 3456 7890"
          />

          {/* Price breakdown */}
          <div className="rounded-lg bg-stone-100 p-4 text-sm">
            <div className="flex items-center justify-between text-stone-600">
              <span>
                Kamar: {formatIDR(rate, "text-xs", "font-sans font-medium tabular-nums")} × {nights} malam × {rooms} kamar
              </span>
              <span>{formatIDR(rate * nights * rooms, "text-sm", "font-sans font-semibold tabular-nums")}</span>
            </div>
            {extrabed > 0 && (
              <div className="mt-1 flex items-center justify-between text-stone-600">
                <span>
                  Extrabed: {formatIDR(extrabedRate, "text-xs", "font-sans font-medium tabular-nums")} × {nights} malam × {extrabed}
                </span>
                <span>{formatIDR(extrabedRate * nights * extrabed, "text-sm", "font-sans font-semibold tabular-nums")}</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2">
              <span className="text-base font-bold">Total</span>
              <span className="text-xl font-bold text-amber-700">{formatIDR(total, "text-xl", "font-sans font-bold text-amber-700 tabular-nums")}</span>
            </div>
          </div>

          {/* Non-refundable */}
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Harga Non-Refundable</p>
              <p className="text-xs text-amber-700">
                Pemesanan ini tidak dapat dibatalkan dan tidak ada pengembalian dana.
              </p>
            </div>
          </div>

          {/* Hotel policy */}
          <div className="rounded-lg border border-stone-200 p-4">
            <p className="mb-2 flex items-center gap-1.5 font-semibold">
              <FileText className="h-4 w-4 text-stone-500" />
              Kebijakan Hotel
            </p>
            <ul className="max-h-32 list-disc space-y-1 overflow-y-auto rounded bg-stone-50 px-5 py-3 text-sm text-stone-600">
              {policyLines.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-stone-100 pt-3 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 accent-amber-700"
              />
              Saya telah membaca dan menyetujui kebijakan hotel di atas
            </label>
          </div>

          {/* Payment method */}
          <div>
            <p className="mb-2 font-semibold">Metode Pembayaran</p>
            <div className="space-y-2">
              <PaymentOption
                active={payment === "transfer"}
                onClick={() => setPayment("transfer")}
                icon={<CreditCard className="h-4 w-4" />}
                title="Transfer Bank"
                desc="Bayar via transfer bank sebelum check-in. Detail rekening dikirim setelah konfirmasi."
              />
              <PaymentOption
                active={payment === "onsite"}
                onClick={() => setPayment("onsite")}
                icon={<Building2 className="h-4 w-4" />}
                title="Bayar di Tempat"
                desc="Bayar tunai/transfer saat check-in. Reservasi dikonfirmasi admin via WhatsApp lebih dulu."
              />
            </div>
          </div>

          <button
            onClick={submitBooking}
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-700 py-3 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Memproses…</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                Konfirmasi Pemesanan · {formatIDR(total, "text-sm text-white", "font-sans font-bold text-white tabular-nums")}
              </span>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---- small components -------------------------------------------- */

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-stone-400">
        <span className="text-amber-600">{icon}</span>
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

function DateField({
  value,
  min,
  onChange,
  open,
  onOpenChange,
}: {
  value: string;
  min?: string;
  onChange: (v: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <div>
      <DatePickerID
        value={value}
        min={min}
        onChange={onChange}
        open={open}
        onOpenChange={onOpenChange}
        className="h-[42px] border-stone-200 bg-white shadow-none hover:bg-stone-50"
      />
    </div>
  );
}

function ReadOnlyDate({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 font-semibold">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-amber-500 px-3 py-2.5 text-sm font-medium text-amber-700">
        <CalendarDays className="h-4 w-4" />
        {fmtDateID(value)}
      </div>
    </div>
  );
}

function Input2({
  label,
  required,
  type = "text",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1 font-semibold">
        {label} {required && <span className="text-rose-500">*</span>}
      </p>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
      />
    </div>
  );
}

function PaymentOption({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full gap-3 rounded-lg border p-3 text-left transition",
        active ? "border-amber-500 bg-amber-50/50" : "border-stone-200 hover:bg-stone-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
          active ? "border-amber-600" : "border-stone-300",
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-amber-600" />}
      </span>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-amber-600">{icon}</span>
          {title}
        </p>
        <p className="mt-0.5 text-xs text-stone-500">{desc}</p>
      </div>
    </button>
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

/* ================================================================== */
/* 404 Room Not Found Page                                             */
/* ================================================================== */

/**
 * Halaman 404 khusus untuk slug kamar yang tidak ada di database.
 * Menampilkan meta noindex (via head) dan menyediakan navigasi keluar.
 * Komponen ini hanya tampil sebagai client-side fallback — biasanya
 * loader sudah melempar notFound() sebelum render ini tercapai.
 */
function RoomNotFoundPage({ property }: { property?: Record<string, unknown> | null }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* noindex injected di sisi klien sebagai safety net */}
      <meta name="robots" content="noindex, follow" />

      <PublicNav property={property} />

      <main className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
        {/* Angka 404 besar */}
        <div className="relative mb-6 select-none">
          <span className="block font-mono text-[120px] font-extrabold leading-none tracking-tighter text-stone-200">
            404
          </span>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-5xl font-extrabold tracking-tight text-amber-700">
            404
          </span>
        </div>

        <h1 className="text-2xl font-bold text-stone-800">
          Kamar Tidak Ditemukan
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-stone-500">
          Halaman kamar yang kamu cari tidak tersedia atau URL-nya tidak valid.
          Mungkin kamar ini sudah tidak ada, atau ada kesalahan pengetikan pada alamat.
        </p>

        {/* Tombol navigasi */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 hover:shadow"
          >
            <Home className="h-4 w-4" />
            Kembali ke Beranda
          </Link>
          <Link
            to="/rooms"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-800"
          >
            <BedDouble className="h-4 w-4" />
            Lihat Semua Kamar
          </Link>
        </div>

        {/* Divider dekoratif */}
        <div className="mt-12 flex items-center gap-4 text-stone-300">
          <span className="h-px w-16 bg-stone-200" />
          <span className="text-xs uppercase tracking-widest">Pomah Guesthouse</span>
          <span className="h-px w-16 bg-stone-200" />
        </div>
      </main>

      <PublicFooter property={property} />
    </div>
  );
}
