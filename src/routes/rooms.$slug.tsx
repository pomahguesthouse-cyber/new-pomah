/**
 * /rooms/$slug — dedicated booking page for one room type.
 *
 * Image gallery, room details, facilities & specs, and a sticky booking
 * widget. "Book This Room" opens a full confirmation dialog (dates,
 * times, guest details, hotel policy, payment method) that creates the
 * reservation directly.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import {
  getRoomTypeDetail,
  checkRoomTypeAvailability,
  submitPublicBooking,
} from "@/public/functions/public.functions";
import { PomahNav } from "@/routes/index";
import { PublicFooter } from "@/public/components/public-shell";
import { mergeHomepageConfig } from "@/admin/modules/homepage/homepage.config";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/rooms/$slug")({
  // Optional date prefill carried from the homepage date picker.
  validateSearch: (s: Record<string, unknown>): { checkIn?: string; checkOut?: string } => {
    const out: { checkIn?: string; checkOut?: string } = {};
    if (typeof s.checkIn === "string") out.checkIn = s.checkIn;
    if (typeof s.checkOut === "string") out.checkOut = s.checkOut;
    return out;
  },
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

const DEFAULT_HOTEL_POLICY = [
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
function fmtDateID(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
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
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const fn = useServerFn(getRoomTypeDetail);
  const availFn = useServerFn(checkRoomTypeAvailability);

  const { data, isLoading } = useQuery({
    queryKey: ["room-detail", slug],
    queryFn: () => fn({ data: { slug } }),
  });

  const room = (data?.room ?? null) as RoomRow | null;
  const others = (data?.others ?? []) as RoomRow[];
  const roomCount = data?.roomCount ?? 0;
  const property = useMemo(() => (data?.property ?? {}) as Record<string, unknown>, [data]);
  const cfg = useMemo(() => mergeHomepageConfig(property.homepage_config), [property]);

  const gallery = useMemo(() => (room ? galleryOf(room) : []), [room]);
  const [active, setActive] = useState(0);

  // Defaults: today → +1 night, unless the homepage date picker passed dates.
  const today = todayISO();
  const [checkIn, setCheckIn] = useState(search.checkIn || today);
  const [checkOut, setCheckOut] = useState(
    search.checkOut || isoAddDays(search.checkIn || today, 1),
  );
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(1);
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

  const header = (
    <PomahNav
      name={(property.name as string) ?? "Pomah Guesthouse"}
      logo={(property.logo_url as string | null) ?? null}
      header={cfg.header}
      pb={{ isBuilder: false, sel: null, onSelect: () => {} }}
    />
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50">
        {header}
        <div className="mx-auto max-w-6xl px-6 py-24 text-center text-sm text-stone-400">
          Memuat kamar…
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-stone-50">
        {header}
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

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {header}

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
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" />
                      {a}
                    </div>
                  ))}
                </div>
              </section>
            )}

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
                  <DateField value={checkIn} min={today} onChange={setCheckIn} />
                </Labeled>
                <Labeled label="Check-out">
                  <DateField value={checkOut} min={isoAddDays(checkIn, 1)} onChange={setCheckOut} />
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

      <BookingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        room={room}
        checkIn={checkIn}
        checkOut={checkOut}
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

function BookingDialog({
  open,
  onClose,
  room,
  checkIn,
  checkOut,
  rooms: initialRooms,
  maxRooms,
  guests,
  hotelPolicy,
}: {
  open: boolean;
  onClose: () => void;
  room: RoomRow;
  checkIn: string;
  checkOut: string;
  rooms: number;
  maxRooms: number;
  guests: number;
  hotelPolicy: string;
}) {
  const navigate = useNavigate();
  const submit = useServerFn(submitPublicBooking);

  const [rooms, setRooms] = useState(initialRooms);
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
  const total = rate * nights * rooms;
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
          checkInTime,
          checkOutTime,
          paymentMethod: payment,
          specialRequests: "",
        },
      });
      toast.success("Pemesanan berhasil dibuat");
      navigate({ to: "/book/confirmation/$id", params: { id: res.id }, search: {} });
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
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <ReadOnlyDate label="Check-in" value={checkIn} />
            <ReadOnlyDate label="Check-out" value={checkOut} />
          </div>

          {/* Rooms */}
          <div className="rounded-lg bg-stone-100 p-4">
            <p className="mb-2 font-semibold">Jumlah Kamar</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRooms((v) => Math.max(1, v - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-300 text-teal-700"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-xl font-bold text-teal-700">{rooms}</span>
              <button
                onClick={() => setRooms((v) => Math.min(maxRooms, v + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-300 text-teal-700"
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="text-sm text-stone-400">Maks: {maxRooms} kamar</span>
            </div>
          </div>

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
                Kamar: {idr(rate)} × {nights} malam × {rooms} kamar
              </span>
              <span>{idr(total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2">
              <span className="text-base font-bold">Total</span>
              <span className="text-xl font-bold text-teal-700">{idr(total)}</span>
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
                className="h-4 w-4 accent-teal-700"
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
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? "Memproses…" : `Konfirmasi Pemesanan · ${idr(total)}`}
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

/** Native date input with an Indonesian-formatted caption below it. */
function DateField({
  value,
  min,
  onChange,
}: {
  value: string;
  min?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
      />
      {value && <p className="mt-1 text-xs font-medium text-teal-700">{fmtDateID(value)}</p>}
    </div>
  );
}

function ReadOnlyDate({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 font-semibold">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-teal-500 px-3 py-2.5 text-sm font-medium text-teal-700">
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
        className="w-full rounded-lg border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
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
        active ? "border-teal-500 bg-teal-50/50" : "border-stone-200 hover:bg-stone-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
          active ? "border-teal-600" : "border-stone-300",
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-teal-600" />}
      </span>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-teal-600">{icon}</span>
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
