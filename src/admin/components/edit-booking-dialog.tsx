import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BedDouble,
  CalendarRange,
  CircleDollarSign,
  ClipboardList,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Receipt,
  User,
} from "lucide-react";

import { listRooms, updateBookingFull } from "@/admin/functions/bookings.functions";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerID } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked-In" },
  { value: "checked_out", label: "Checked-Out" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const SOURCES = [
  { value: "direct", label: "Direct" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
  { value: "manager_chat", label: "Manager Chat" },
] as const;

const PAYMENT_STATUSES = [
  {
    value: "unpaid",
    label: "Belum Bayar",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  },
  {
    value: "partial",
    label: "Sebagian",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  },
  {
    value: "paid",
    label: "Lunas",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
] as const;

type RoomRow = {
  id: string;
  number: string;
  status: "clean" | "dirty" | "maintenance" | "out_of_order";
  room_types?: {
    id: string;
    name: string;
    base_rate: number;
    capacity: number;
    extrabed_capacity?: number | null;
    extrabed_rate?: number | null;
  } | null;
};

type BookingRoom = {
  id: string;
  room_id: string | null;
  nightly_rate: number;
  extra_bed_count?: number | null;
  extra_bed_rate?: number | null;
  room_types?: { id: string; name: string } | null;
  rooms?: { id?: string | null; number?: string | null } | null;
};

export type EditableBooking = {
  id: string;
  reference_code?: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  status: (typeof STATUSES)[number]["value"];
  source: (typeof SOURCES)[number]["value"];
  payment_status?: (typeof PAYMENT_STATUSES)[number]["value"] | null;
  paid_amount?: number | null;
  total_amount: number;
  special_requests?: string | null;
  internal_notes?: string | null;
  guests?: {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
  } | null;
  booking_rooms?: BookingRoom[] | null;
};

type SelectedRoom = {
  room_id: string;
  nightly_rate: number;
  extra_bed_count: number;
  extra_bed_rate: number;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const isUuid = (v?: string | null) => !!v && UUID_RE.test(v.trim());
const isRoomToken = (v?: string | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 && !s.startsWith("_");
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(Math.round(n))
    .replace("IDR", "Rp.");

function nightsBetween(ci: string, co: string) {
  const a = Date.parse(`${ci}T00:00:00Z`);
  const b = Date.parse(`${co}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function getBookingRoomToken(br: BookingRoom): string | null {
  const candidates = [br.rooms?.id, br.room_id, br.rooms?.number]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(isRoomToken);
  return candidates[0] ?? null;
}

function findRoomByToken(token: string, rooms: RoomRow[]): RoomRow | null {
  return rooms.find((r) => r.id === token || r.number === token) ?? null;
}

function buildSyntheticRoomsFromBooking(booking: EditableBooking | null, allRooms: RoomRow[]): RoomRow[] {
  if (!booking?.booking_rooms?.length) return [];
  const existing = new Set<string>();
  for (const r of allRooms) {
    existing.add(r.id);
    existing.add(r.number);
  }

  const synthetic: RoomRow[] = [];
  const seen = new Set<string>();
  for (const br of booking.booking_rooms) {
    const token = getBookingRoomToken(br);
    if (!token || existing.has(token) || seen.has(token)) continue;
    const typeId = br.room_types?.id;
    if (!typeId) continue;
    seen.add(token);
    synthetic.push({
      id: token,
      number: br.rooms?.number?.trim() || token,
      status: "clean",
      room_types: {
        id: typeId,
        name: br.room_types?.name ?? "Kamar",
        base_rate: Number(br.nightly_rate ?? 0),
        capacity: 1,
        extrabed_capacity: Number(br.extra_bed_count ?? 0) > 0 ? Number(br.extra_bed_count ?? 0) : 0,
        extrabed_rate: Number(br.extra_bed_rate ?? 0),
      },
    });
  }
  return synthetic;
}

type Props = {
  open: boolean;
  booking: EditableBooking | null;
  onClose: () => void;
};

export function EditBookingDialog({ open, booking, onClose }: Props) {
  const fnUpdate = useServerFn(updateBookingFull);
  const fnRooms = useServerFn(listRooms);
  const qc = useQueryClient();

  const { data: roomsData } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => fnRooms(),
    enabled: open,
  });
  const allRooms = React.useMemo(() => (roomsData?.rooms ?? []) as RoomRow[], [roomsData]);
  const displayRooms = React.useMemo(
    () => [...allRooms, ...buildSyntheticRoomsFromBooking(booking, allRooms)],
    [allRooms, booking],
  );

  const [guest, setGuest] = React.useState({ full_name: "", email: "", phone: "", country: "" });
  const [checkIn, setCheckIn] = React.useState("");
  const [checkOut, setCheckOut] = React.useState("");
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]["value"]>("confirmed");
  const [source, setSource] = React.useState<(typeof SOURCES)[number]["value"]>("direct");
  const [paymentStatus, setPaymentStatus] =
    React.useState<(typeof PAYMENT_STATUSES)[number]["value"]>("unpaid");
  const [paidAmount, setPaidAmount] = React.useState(0);
  const [selectedRooms, setSelectedRooms] = React.useState<SelectedRoom[]>([]);
  const [allotmentMode, setAllotmentMode] = React.useState<"auto" | "manual">("manual");
  const [autoCounts, setAutoCounts] = React.useState<Record<string, number>>({});
  const [extraBedByType, setExtraBedByType] = React.useState<Record<string, number>>({});
  const [specialRequests, setSpecialRequests] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");

  React.useEffect(() => {
    if (!open || !booking) return;

    setGuest({
      full_name: booking.guests?.full_name ?? "",
      email: booking.guests?.email ?? "",
      phone: booking.guests?.phone ?? "",
      country: booking.guests?.country ?? "",
    });
    setCheckIn(booking.check_in);
    setCheckOut(booking.check_out);
    setAdults(booking.adults);
    setChildren(booking.children);
    setStatus(booking.status);
    setSource(booking.source);
    setPaymentStatus(booking.payment_status ?? "unpaid");
    setPaidAmount(Number(booking.paid_amount ?? 0));
    setSpecialRequests(booking.special_requests ?? "");
    setInternalNotes(booking.internal_notes ?? "");

    const dedup = new Set<string>();
    const nextSelected: SelectedRoom[] = [];
    for (const br of booking.booking_rooms ?? []) {
      const token = getBookingRoomToken(br);
      if (!token || dedup.has(token)) continue;
      const room = findRoomByToken(token, displayRooms);
      const type = room?.room_types;
      dedup.add(token);
      nextSelected.push({
        room_id: room?.id ?? token,
        nightly_rate: Number(br.nightly_rate || type?.base_rate || 0),
        extra_bed_count: Number(br.extra_bed_count ?? 0),
        extra_bed_rate: Number(br.extra_bed_rate ?? type?.extrabed_rate ?? 0),
      });
    }
    setSelectedRooms(nextSelected);

    const counts: Record<string, number> = {};
    const ebByType: Record<string, number> = {};
    for (const sr of nextSelected) {
      const room = findRoomByToken(sr.room_id, displayRooms);
      const tid = room?.room_types?.id;
      if (tid) {
        counts[tid] = (counts[tid] ?? 0) + 1;
        ebByType[tid] = (ebByType[tid] ?? 0) + Number(sr.extra_bed_count ?? 0);
      }
    }
    setAutoCounts(counts);
    setExtraBedByType(ebByType);
    setAllotmentMode("manual");
  }, [open, booking?.id, displayRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const nights = nightsBetween(checkIn, checkOut);
  const isUnavailable = (r: RoomRow) => r.status === "out_of_order" || r.status === "maintenance";

  const roomsByType = React.useMemo(() => {
    const m = new Map<
      string,
      {
        typeId: string;
        typeName: string;
        baseRate: number;
        extraBedRate: number;
        extraBedCapacityPerRoom: number;
        rooms: RoomRow[];
      }
    >();
    for (const r of displayRooms) {
      if (!isRoomToken(r.id) || !r.room_types?.id) continue;
      const tid = r.room_types.id;
      if (!m.has(tid)) {
        m.set(tid, {
          typeId: tid,
          typeName: r.room_types.name ?? "Tanpa Tipe",
          baseRate: Number(r.room_types.base_rate ?? 0),
          extraBedRate: Number(r.room_types.extrabed_rate ?? 0),
          extraBedCapacityPerRoom: Number(r.room_types.extrabed_capacity ?? 0),
          rooms: [],
        });
      }
      m.get(tid)!.rooms.push(r);
    }
    return [...m.values()];
  }, [displayRooms]);

  const roomCountByType = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (allotmentMode === "auto") {
      for (const group of roomsByType) {
        const want = autoCounts[group.typeId] ?? 0;
        const available = group.rooms.filter((r) => !isUnavailable(r) && isRoomToken(r.id)).length;
        counts[group.typeId] = Math.min(want, available);
      }
    } else {
      for (const sr of selectedRooms) {
        const room = findRoomByToken(sr.room_id, displayRooms);
        const tid = room?.room_types?.id;
        if (tid) counts[tid] = (counts[tid] ?? 0) + 1;
      }
    }
    return counts;
  }, [allotmentMode, autoCounts, roomsByType, selectedRooms, displayRooms]);

  const extraBedErrors = React.useMemo<Record<string, string>>(() => {
    const errs: Record<string, string> = {};
    for (const group of roomsByType) {
      const requested = extraBedByType[group.typeId] ?? 0;
      const rooms = roomCountByType[group.typeId] ?? 0;
      const maxAllowed = group.extraBedCapacityPerRoom * rooms;
      if (requested > 0 && group.extraBedCapacityPerRoom === 0) {
        errs[group.typeId] = `${group.typeName} tidak mendukung extra bed.`;
      } else if (requested > maxAllowed) {
        errs[group.typeId] =
          `Extra bed ${group.typeName} melebihi kapasitas: diminta ${requested}, ` +
          `maksimum ${maxAllowed} (${group.extraBedCapacityPerRoom}/kamar × ${rooms} kamar).`;
      }
    }
    return errs;
  }, [roomsByType, extraBedByType, roomCountByType]);
  const hasExtraBedError = Object.keys(extraBedErrors).length > 0;

  const effectiveRooms = React.useMemo<SelectedRoom[]>(() => {
    const base: { room_id: string; nightly_rate: number; typeId: string; extraBedRate: number }[] = [];

    if (allotmentMode === "manual") {
      for (const sr of selectedRooms) {
        if (!isRoomToken(sr.room_id)) continue;
        const room = findRoomByToken(sr.room_id, displayRooms);
        const tid = room?.room_types?.id ?? sr.room_id;
        const group = roomsByType.find((g) => g.typeId === tid);
        base.push({
          room_id: room?.id ?? sr.room_id,
          nightly_rate: sr.nightly_rate || Number(room?.room_types?.base_rate ?? 0),
          typeId: tid,
          extraBedRate: group?.extraBedRate ?? sr.extra_bed_rate ?? 0,
        });
      }
    } else {
      for (const group of roomsByType) {
        const want = autoCounts[group.typeId] ?? 0;
        const available = group.rooms.filter((r) => !isUnavailable(r) && isRoomToken(r.id));
        for (let i = 0; i < Math.min(want, available.length); i++) {
          base.push({
            room_id: available[i].id,
            nightly_rate: group.baseRate,
            typeId: group.typeId,
            extraBedRate: group.extraBedRate,
          });
        }
      }
    }

    const seenType = new Set<string>();
    return base.map((row) => {
      const first = !seenType.has(row.typeId);
      seenType.add(row.typeId);
      return {
        room_id: row.room_id,
        nightly_rate: row.nightly_rate,
        extra_bed_count: first ? Math.max(0, extraBedByType[row.typeId] ?? 0) : 0,
        extra_bed_rate: row.extraBedRate,
      };
    });
  }, [allotmentMode, selectedRooms, roomsByType, autoCounts, extraBedByType, displayRooms]);

  const invalidSelectedCount = Math.max(0, selectedRooms.length - effectiveRooms.length);
  const baseTotal = effectiveRooms.reduce(
    (s, r) =>
      s +
      r.nightly_rate * Math.max(nights, 1) +
      r.extra_bed_rate * r.extra_bed_count * Math.max(nights, 1),
    0,
  );

  const total = baseTotal;
  const outstanding = Math.max(0, total - paidAmount);

  React.useEffect(() => {
    if (paymentStatus !== "paid" || effectiveRooms.length === 0 || nights < 1) return;
    const next = Math.round(baseTotal);
    setPaidAmount((current) => (current === next ? current : next));
  }, [paymentStatus, baseTotal, effectiveRooms.length, nights]);

  function toggleRoom(room: RoomRow) {
    if (!isRoomToken(room.id) || !room.room_types?.id) {
      toast.error("Kamar ini belum valid. Cek data kamar di halaman Rooms.");
      return;
    }
    setSelectedRooms((cur) => {
      const exists = cur.find((r) => r.room_id === room.id);
      if (exists) return cur.filter((r) => r.room_id !== room.id);
      return [
        ...cur,
        {
          room_id: room.id,
          nightly_rate: Number(room.room_types?.base_rate ?? 0),
          extra_bed_count: 0,
          extra_bed_rate: Number(room.room_types?.extrabed_rate ?? 0),
        },
      ];
    });
  }

  const setAutoCount = (typeId: string, n: number) =>
    setAutoCounts((cur) => ({ ...cur, [typeId]: Math.max(0, n) }));
  const setExtraBed = (typeId: string, n: number) =>
    setExtraBedByType((cur) => ({ ...cur, [typeId]: Math.max(0, n) }));

  const updateMut = useMutation({
    mutationFn: () => {
      if (!booking || !booking.guests) throw new Error("Booking tidak valid");
      if (effectiveRooms.length === 0) throw new Error("Pilih minimal 1 kamar fisik yang valid");
      const firstEbErr = Object.values(extraBedErrors)[0];
      if (firstEbErr) throw new Error(firstEbErr);
      return fnUpdate({
        data: {
          id: booking.id,
          guest: {
            id: booking.guests.id,
            full_name: guest.full_name.trim(),
            email: guest.email.trim() || null,
            phone: guest.phone.trim() || null,
            country: guest.country.trim() || null,
          },
          check_in: checkIn,
          check_out: checkOut,
          adults,
          children,
          status,
          source,
          payment_status: paymentStatus,
          paid_amount: paidAmount,
          special_requests: specialRequests.trim() || null,
          internal_notes: internalNotes.trim() || null,
          rooms: effectiveRooms,
        },
      });
    },
    onSuccess: () => {
      toast.success("Booking diperbarui");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["admin-calendar"] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!booking) return null;

  const canSave =
    !updateMut.isPending &&
    guest.full_name.trim().length > 0 &&
    nights >= 1 &&
    effectiveRooms.length > 0 &&
    !hasExtraBedError;

  const paymentChip = PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.chip;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="relative shrink-0 border-b border-border bg-gradient-to-br from-primary/15 via-accent/5 to-transparent px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <Pencil className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-semibold tracking-tight">Edit Booking</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  <span className="font-semibold text-foreground">
                    {booking.reference_code ?? booking.id.slice(0, 8)}
                  </span>
                  {booking.guests?.full_name && (
                    <span className="text-muted-foreground"> · {booking.guests.full_name}</span>
                  )}
                </DialogDescription>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest", paymentChip)}>
                <Receipt className="h-3 w-3" />
                {PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.label}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="space-y-5 p-6">
            <Section icon={<User className="h-4 w-4" />} title="Informasi Tamu">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama Lengkap" required>
                  <Input value={guest.full_name} onChange={(e) => setGuest((g) => ({ ...g, full_name: e.target.value }))} maxLength={120} />
                </Field>
                <Field label="Nomor HP / WhatsApp">
                  <Input value={guest.phone} onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))} type="tel" maxLength={40} />
                </Field>
                <Field label="Email">
                  <Input value={guest.email} onChange={(e) => setGuest((g) => ({ ...g, email: e.target.value }))} type="email" maxLength={200} />
                </Field>
                <Field label="Negara Asal">
                  <Input value={guest.country} onChange={(e) => setGuest((g) => ({ ...g, country: e.target.value }))} maxLength={60} />
                </Field>
              </div>
            </Section>

            <Section icon={<CalendarRange className="h-4 w-4" />} title="Tanggal & Jumlah Tamu">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Check-In" required>
                  <DatePickerID value={checkIn} onChange={(iso) => setCheckIn(iso)} />
                </Field>
                <Field label="Check-Out" required>
                  <DatePickerID value={checkOut} min={checkIn || undefined} onChange={(iso) => setCheckOut(iso)} />
                </Field>
                <Field label="Dewasa">
                  <Input type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Number(e.target.value) || 1)} />
                </Field>
                <Field label="Anak">
                  <Input type="number" min={0} max={20} value={children} onChange={(e) => setChildren(Number(e.target.value) || 0)} />
                </Field>
              </div>
              {nights >= 1 ? (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <CalendarRange className="h-3 w-3" />
                  {nights} malam
                </p>
              ) : (
                <p className="mt-3 text-xs text-destructive">Tanggal check-out harus setelah check-in.</p>
              )}
            </Section>

            <Section icon={<BedDouble className="h-4 w-4" />} title={`Kamar${effectiveRooms.length ? ` · ${effectiveRooms.length} dipilih` : ""}`}>
              <div className="mb-2 flex gap-0.5 rounded-lg bg-muted p-0.5">
                {([ ["auto", "Otomatis"], ["manual", "Manual"] ] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAllotmentMode(m)}
                    className={cn(
                      "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                      allotmentMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mb-3 text-[10px] text-muted-foreground">
                {allotmentMode === "auto"
                  ? "Otomatis — tentukan jumlah kamar per tipe, sistem yang memilih kamarnya."
                  : "Manual — pilih kamar tertentu satu per satu."}
              </p>

              {invalidSelectedCount > 0 && (
                <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                  Ada {invalidSelectedCount} data kamar lama yang tidak valid dan tidak akan dikirim saat disimpan. Pilih kamar fisik yang terlihat di daftar ini.
                </p>
              )}

              {roomsByType.length === 0 && <p className="text-xs text-muted-foreground">Belum ada kamar — tambah kamar dulu di halaman Rooms.</p>}
              <div className="space-y-3">
                {roomsByType.map((group) => {
                  const availableCount = group.rooms.filter((r) => !isUnavailable(r) && isRoomToken(r.id)).length;
                  const count = autoCounts[group.typeId] ?? 0;
                  return (
                    <div key={group.typeId} className="rounded-lg border border-border">
                      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
                        <p className="text-xs font-semibold">{group.typeName}</p>
                        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{formatIDR(group.baseRate)}/malam</p>
                      </div>

                      {allotmentMode === "auto" ? (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{availableCount} kamar tersedia</p>
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={count <= 0} onClick={() => setAutoCount(group.typeId, count - 1)}>
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-6 text-center font-mono text-sm font-semibold tabular-nums">{Math.min(count, availableCount)}</span>
                            <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={count >= availableCount} onClick={() => setAutoCount(group.typeId, count + 1)}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 p-2">
                          {group.rooms.map((room) => {
                            const sel = selectedRooms.find((s) => s.room_id === room.id);
                            const unavailable = isUnavailable(room);
                            return (
                              <label
                                key={room.id}
                                className={cn(
                                  "flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors",
                                  unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/40",
                                  sel && "bg-primary/5",
                                )}
                              >
                                <input type="checkbox" disabled={unavailable} checked={!!sel} onChange={() => toggleRoom(room)} className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary" />
                                <span className="font-mono text-xs font-semibold">{room.number}</span>
                                {unavailable && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">tidak tersedia</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {group.extraBedCapacityPerRoom > 0 && (roomCountByType[group.typeId] ?? 0) > 0 && (
                        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
                          <div>
                            <p className="text-[11px] font-medium">Extra Bed</p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatIDR(group.extraBedRate)}/malam · maks {group.extraBedCapacityPerRoom * (roomCountByType[group.typeId] ?? 0)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={(extraBedByType[group.typeId] ?? 0) <= 0} onClick={() => setExtraBed(group.typeId, (extraBedByType[group.typeId] ?? 0) - 1)}>
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-6 text-center font-mono text-sm font-semibold tabular-nums">{extraBedByType[group.typeId] ?? 0}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={(extraBedByType[group.typeId] ?? 0) >= group.extraBedCapacityPerRoom * (roomCountByType[group.typeId] ?? 0)}
                              onClick={() => setExtraBed(group.typeId, (extraBedByType[group.typeId] ?? 0) + 1)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                      {extraBedErrors[group.typeId] && (
                        <p className="border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] font-medium text-destructive">{extraBedErrors[group.typeId]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                Total: <span className="text-foreground">{formatIDR(total)}</span> · {effectiveRooms.length} kamar × {Math.max(nights, 1)} malam
              </p>
            </Section>

            <Section icon={<ClipboardList className="h-4 w-4" />} title="Status">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status Booking">
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Sumber">
                  <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>

            <Section icon={<CircleDollarSign className="h-4 w-4" />} title="Pembayaran">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status Pembayaran">
                  <Select
                    value={paymentStatus}
                    onValueChange={(v) => {
                      setPaymentStatus(v as typeof paymentStatus);
                      if (v === "paid") setPaidAmount(baseTotal);
                      if (v === "unpaid") setPaidAmount(0);
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_STATUSES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Jumlah Dibayar (Rp)">
                  <Input type="number" min={0} step={10000} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value) || 0)} />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3">
                <SummaryStat label="Total" value={formatIDR(total)} />
                <SummaryStat label="Dibayar" value={formatIDR(paidAmount)} />
                <SummaryStat label="Sisa" value={formatIDR(outstanding)} accent={outstanding > 0 ? "warn" : "ok"} />
              </div>
            </Section>

            <Section icon={<ClipboardList className="h-4 w-4" />} title="Catatan">
              <div className="space-y-3">
                <Field label="Permintaan Khusus (dari tamu)">
                  <Textarea value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} rows={2} maxLength={2000} />
                </Field>
                <Field label="Catatan Internal (untuk staff)">
                  <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} maxLength={2000} />
                </Field>
              </div>
            </Section>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>Batal</Button>
          <Button onClick={() => updateMut.mutate()} disabled={!canSave} className="gap-1.5">
            {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {updateMut.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: "ok" | "warn" }) {
  return (
    <div className="text-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-xs font-semibold tabular-nums",
          accent === "warn" && "text-amber-600 dark:text-amber-400",
          accent === "ok" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
