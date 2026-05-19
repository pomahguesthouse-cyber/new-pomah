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
  Plus,
  Receipt,
  User,
  Users,
  Sparkles,
} from "lucide-react";

import { createMultiRoomBooking, listRooms } from "@/admin/functions/bookings.functions";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerID } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";

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
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  },
] as const;

type RoomStatus = "clean" | "dirty" | "maintenance" | "out_of_order";
type RoomRow = {
  id: string;
  number: string;
  status: RoomStatus;
  room_types?: { id: string; name: string; base_rate: number; capacity: number } | null;
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(Math.round(n))
    .replace("IDR", "Rp.");

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function plusDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function nightsBetween(ci: string, co: string) {
  const a = Date.parse(`${ci}T00:00:00Z`);
  const b = Date.parse(`${co}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

type SelectedRoom = { room_id: string; nightly_rate: number };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (refs: string[]) => void;
};

export function NewBookingDialog({ open, onClose, onCreated }: Props) {
  const fnCreate = useServerFn(createMultiRoomBooking);
  const fnRooms = useServerFn(listRooms);
  const qc = useQueryClient();

  const { data: roomsData } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => fnRooms(),
    enabled: open,
  });
  const allRooms = (roomsData?.rooms ?? []) as RoomRow[];

  // Form state
  const [guest, setGuest] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    country: "",
  });
  const [checkIn, setCheckIn] = React.useState(todayIso());
  const [checkOut, setCheckOut] = React.useState(plusDaysIso(todayIso(), 1));
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]["value"]>("confirmed");
  const [source, setSource] = React.useState<(typeof SOURCES)[number]["value"]>("direct");
  const [paymentStatus, setPaymentStatus] =
    React.useState<(typeof PAYMENT_STATUSES)[number]["value"]>("unpaid");
  const [paidAmount, setPaidAmount] = React.useState(0);
  const [specialRequests, setSpecialRequests] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");
  const [selectedRooms, setSelectedRooms] = React.useState<SelectedRoom[]>([]);
  const [allotmentMode, setAllotmentMode] = React.useState<"auto" | "manual">("auto");
  const [autoCounts, setAutoCounts] = React.useState<Record<string, number>>({});

  // Reset on open
  React.useEffect(() => {
    if (!open) return;
    setGuest({ full_name: "", email: "", phone: "", country: "" });
    setCheckIn(todayIso());
    setCheckOut(plusDaysIso(todayIso(), 1));
    setAdults(2);
    setChildren(0);
    setStatus("confirmed");
    setSource("direct");
    setPaymentStatus("unpaid");
    setPaidAmount(0);
    setSpecialRequests("");
    setInternalNotes("");
    setSelectedRooms([]);
    setAllotmentMode("auto");
    setAutoCounts({});
  }, [open]);

  const nights = nightsBetween(checkIn, checkOut);

  /** A room can't be booked while it's out of order or under maintenance. */
  const isUnavailable = (r: RoomRow) =>
    r.status === "out_of_order" || r.status === "maintenance";

  // Group rooms by type for the picker.
  const roomsByType = React.useMemo(() => {
    const m = new Map<
      string,
      { typeId: string; typeName: string; baseRate: number; rooms: RoomRow[] }
    >();
    for (const r of allRooms) {
      const tid = r.room_types?.id ?? "_none";
      if (!m.has(tid)) {
        m.set(tid, {
          typeId: tid,
          typeName: r.room_types?.name ?? "Tanpa Tipe",
          baseRate: Number(r.room_types?.base_rate ?? 0),
          rooms: [],
        });
      }
      m.get(tid)!.rooms.push(r);
    }
    return [...m.values()];
  }, [allRooms]);

  // The rooms actually sent to the server. In manual mode these are the
  // user's picks; in auto-allotment mode they're the first N available
  // rooms of each chosen type.
  const effectiveRooms = React.useMemo<SelectedRoom[]>(() => {
    if (allotmentMode === "manual") return selectedRooms;
    const out: SelectedRoom[] = [];
    for (const group of roomsByType) {
      const want = autoCounts[group.typeId] ?? 0;
      const available = group.rooms.filter((r) => !isUnavailable(r));
      for (let i = 0; i < Math.min(want, available.length); i++) {
        out.push({ room_id: available[i].id, nightly_rate: group.baseRate });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allotmentMode, selectedRooms, roomsByType, autoCounts]);

  const grandTotal = effectiveRooms.reduce(
    (sum, r) => sum + r.nightly_rate * Math.max(nights, 1),
    0,
  );
  const outstanding = Math.max(0, grandTotal - paidAmount);

  function toggleRoom(room: RoomRow) {
    setSelectedRooms((cur) => {
      const exists = cur.find((r) => r.room_id === room.id);
      if (exists) return cur.filter((r) => r.room_id !== room.id);
      return [...cur, { room_id: room.id, nightly_rate: Number(room.room_types?.base_rate ?? 0) }];
    });
  }

  function setAutoCount(typeId: string, n: number) {
    setAutoCounts((cur) => ({ ...cur, [typeId]: Math.max(0, n) }));
  }

  const createMut = useMutation({
    mutationFn: () =>
      fnCreate({
        data: {
          guest: {
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
      }),
    onSuccess: (res) => {
      const ref = (res as { booking?: { reference_code?: string | null } })?.booking
        ?.reference_code;
      const count = effectiveRooms.length;
      toast.success(
        ref ? `Booking dibuat: ${ref} (${count} kamar)` : `Booking dibuat (${count} kamar)`,
      );
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["admin-calendar"] });
      onCreated?.(ref ? [ref] : []);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSubmit =
    !createMut.isPending &&
    guest.full_name.trim().length > 0 &&
    nights >= 1 &&
    effectiveRooms.length > 0;

  const paymentChip = PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.chip;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[920px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Hero header */}
        <div className="relative shrink-0 border-b border-border bg-gradient-to-br from-primary/15 via-accent/5 to-transparent px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  Booking Baru
                </DialogTitle>
                <DialogDescription className="text-xs">
                  1 tamu bisa pesan beberapa kamar sekaligus — semua kamar masuk dalam satu booking
                  dengan satu reference code.
                </DialogDescription>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                  paymentChip,
                )}
              >
                <Receipt className="h-3 w-3" />
                {PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.label}
              </span>
            </div>
          </DialogHeader>
        </div>

        {/* Body — 2-col on lg+, stacked on mobile */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1fr_320px]">
          <ScrollArea className="border-r border-border">
            <div className="space-y-5 p-6">
              {/* Tamu */}
              <Section icon={<User className="h-4 w-4" />} title="Informasi Tamu">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama Lengkap" required>
                    <Input
                      value={guest.full_name}
                      onChange={(e) => setGuest((g) => ({ ...g, full_name: e.target.value }))}
                      placeholder="Nama tamu…"
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Nomor HP / WhatsApp">
                    <Input
                      value={guest.phone}
                      onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))}
                      placeholder="+62…"
                      type="tel"
                      maxLength={40}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      value={guest.email}
                      onChange={(e) => setGuest((g) => ({ ...g, email: e.target.value }))}
                      placeholder="email@…"
                      type="email"
                      maxLength={200}
                    />
                  </Field>
                  <Field label="Negara Asal">
                    <Input
                      value={guest.country}
                      onChange={(e) => setGuest((g) => ({ ...g, country: e.target.value }))}
                      placeholder="mis. Indonesia"
                      maxLength={60}
                    />
                  </Field>
                </div>
              </Section>

              {/* Tanggal */}
              <Section icon={<CalendarRange className="h-4 w-4" />} title="Tanggal Menginap">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Check-In" required>
                    <DatePickerID
                      value={checkIn}
                      onChange={(iso) => {
                        setCheckIn(iso);
                        if (iso && checkOut <= iso) {
                          setCheckOut(plusDaysIso(iso, 1));
                        }
                      }}
                    />
                  </Field>
                  <Field label="Check-Out" required>
                    <DatePickerID
                      value={checkOut}
                      min={plusDaysIso(checkIn, 1)}
                      onChange={(iso) => setCheckOut(iso)}
                    />
                  </Field>
                  <Field label="Dewasa" icon={<Users className="h-3 w-3" />}>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={adults}
                      onChange={(e) => setAdults(Number(e.target.value) || 1)}
                    />
                  </Field>
                  <Field label="Anak">
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={children}
                      onChange={(e) => setChildren(Number(e.target.value) || 0)}
                    />
                  </Field>
                </div>
                {nights >= 1 ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <CalendarRange className="h-3 w-3" />
                    {nights} malam
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-destructive">
                    Tanggal check-out harus setelah check-in.
                  </p>
                )}
              </Section>

              {/* Pemilihan Kamar */}
              <Section
                icon={<BedDouble className="h-4 w-4" />}
                title={`Pilihan Kamar${effectiveRooms.length ? ` · ${effectiveRooms.length} dipilih` : ""}`}
                required
              >
                {/* Mode: auto allotment vs manual */}
                <div className="mb-2 flex gap-0.5 rounded-lg bg-muted p-0.5">
                  {(
                    [
                      ["auto", "Otomatis"],
                      ["manual", "Manual"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAllotmentMode(m)}
                      className={cn(
                        "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                        allotmentMode === m
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
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

                {roomsByType.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Belum ada kamar — tambah kamar dulu di halaman Rooms.
                  </p>
                )}
                <div className="space-y-3">
                  {roomsByType.map((group) => {
                    const availableCount = group.rooms.filter((r) => !isUnavailable(r)).length;
                    const count = autoCounts[group.typeId] ?? 0;
                    return (
                      <div key={group.typeId} className="rounded-lg border border-border">
                        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
                          <p className="text-xs font-semibold">{group.typeName}</p>
                          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            {formatIDR(group.baseRate)}/malam
                          </p>
                        </div>

                        {allotmentMode === "auto" ? (
                          <div className="flex items-center justify-between px-3 py-2.5">
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {availableCount} kamar tersedia
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                disabled={count <= 0}
                                onClick={() => setAutoCount(group.typeId, count - 1)}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <span className="w-6 text-center font-mono text-sm font-semibold tabular-nums">
                                {Math.min(count, availableCount)}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                disabled={count >= availableCount}
                                onClick={() => setAutoCount(group.typeId, count + 1)}
                              >
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
                                    unavailable
                                      ? "cursor-not-allowed opacity-50"
                                      : "cursor-pointer hover:bg-muted/40",
                                    sel && "bg-primary/5",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={unavailable}
                                    checked={!!sel}
                                    onChange={() => toggleRoom(room)}
                                    className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                                  />
                                  <span className="font-mono text-xs font-semibold">
                                    {room.number}
                                  </span>
                                  {unavailable && (
                                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                      tidak tersedia
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Status & Sumber */}
              <Section icon={<ClipboardList className="h-4 w-4" />} title="Status Booking">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Status">
                    <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Sumber">
                    <Select value={source} onValueChange={(v) => setSource(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </Section>

              {/* Payment */}
              <Section icon={<CircleDollarSign className="h-4 w-4" />} title="Pembayaran">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Status Pembayaran">
                    <Select
                      value={paymentStatus}
                      onValueChange={(v) => {
                        setPaymentStatus(v as any);
                        if (v === "paid") setPaidAmount(grandTotal);
                        if (v === "unpaid") setPaidAmount(0);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_STATUSES.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Jumlah Dibayar (Rp)">
                    <Input
                      type="number"
                      min={0}
                      step={10000}
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                    />
                  </Field>
                </div>
                {paymentStatus === "partial" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Untuk multi-kamar, jumlah ini akan dibagi proporsional antar kamar berdasarkan
                    total per kamar.
                  </p>
                )}
              </Section>

              {/* Notes */}
              <Section icon={<ClipboardList className="h-4 w-4" />} title="Catatan">
                <div className="space-y-3">
                  <Field label="Permintaan Khusus (dari tamu)">
                    <Textarea
                      value={specialRequests}
                      onChange={(e) => setSpecialRequests(e.target.value)}
                      placeholder="Permintaan tamu, mis. early check-in, tempat tidur tambahan…"
                      rows={2}
                      maxLength={2000}
                    />
                  </Field>
                  <Field label="Catatan Internal (untuk staff)">
                    <Textarea
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      placeholder="Catatan internal, tidak terlihat oleh tamu…"
                      rows={2}
                      maxLength={2000}
                    />
                  </Field>
                </div>
              </Section>
            </div>
          </ScrollArea>

          {/* Summary side panel */}
          <aside className="bg-muted/20">
            <div className="sticky top-0 p-5 space-y-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Ringkasan
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live preview — berubah mengikuti input.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <SummaryRow label="Tamu" value={guest.full_name || "—"} />
                <SummaryRow
                  label="Periode"
                  value={
                    nights >= 1 ? `${formatDateShort(checkIn)} → ${formatDateShort(checkOut)}` : "—"
                  }
                />
                <SummaryRow label="Lama" value={`${nights} malam`} mono />
                <SummaryRow
                  label="Tamu"
                  value={`${adults} dewasa${children > 0 ? ` + ${children} anak` : ""}`}
                />
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Kamar Dipilih ({effectiveRooms.length})
                  </p>
                  {effectiveRooms.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Belum ada kamar dipilih.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {effectiveRooms.map((sr) => {
                        const room = allRooms.find((r) => r.id === sr.room_id);
                        return (
                          <li
                            key={sr.room_id}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="font-mono">
                              {room?.number}{" "}
                              <span className="text-muted-foreground">
                                · {room?.room_types?.name}
                              </span>
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatIDR(sr.nightly_rate * Math.max(nights, 1))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                <SummaryRow label="Subtotal" value={formatIDR(grandTotal)} mono bold />
                <SummaryRow
                  label="Dibayar"
                  value={formatIDR(paidAmount)}
                  mono
                />
                <div className="border-t border-border pt-2">
                  <SummaryRow
                    label="Sisa"
                    value={formatIDR(outstanding)}
                    mono
                    bold
                    accent={outstanding > 0 ? "warn" : "ok"}
                  />
                </div>
              </div>

              <Badge
                variant="outline"
                className={cn(
                  "w-full justify-center font-mono text-[10px] uppercase tracking-widest",
                  paymentChip,
                )}
              >
                {PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.label}
              </Badge>
            </div>
          </aside>
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} disabled={createMut.isPending}>
            Batal
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={!canSubmit} className="gap-1.5">
            {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {createMut.isPending ? "Menyimpan…" : "Buat Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  required,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <h3 className="text-sm font-semibold">
          {title}
          {required && <span className="ml-1 text-destructive">*</span>}
        </h3>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  icon,
  children,
}: {
  label: string;
  required?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  bold,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  accent?: "ok" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right",
          mono && "font-mono tabular-nums",
          bold && "font-semibold text-foreground",
          accent === "warn" && "text-amber-600 dark:text-amber-400",
          accent === "ok" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatDateShort(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
