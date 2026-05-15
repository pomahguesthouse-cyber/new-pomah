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
  Pencil,
  Receipt,
  User,
} from "lucide-react";

import { listRooms, updateBookingFull } from "@/lib/bookings.functions";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  { value: "unpaid", label: "Belum Bayar", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20" },
  { value: "partial", label: "Sebagian", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  { value: "paid", label: "Lunas", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
] as const;

type RoomRow = {
  id: string;
  number: string;
  status: "clean" | "dirty" | "maintenance" | "out_of_order";
  room_types?: { id: string; name: string; base_rate: number; capacity: number } | null;
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
  nightly_rate: number;
  total_amount: number;
  room_id?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  guests?: {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
  } | null;
  rooms?: { id: string; number: string } | null;
  room_types?: { id: string; name: string } | null;
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
  const allRooms = (roomsData?.rooms ?? []) as RoomRow[];

  const [guest, setGuest] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    country: "",
  });
  const [roomId, setRoomId] = React.useState<string>("");
  const [checkIn, setCheckIn] = React.useState("");
  const [checkOut, setCheckOut] = React.useState("");
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]["value"]>("confirmed");
  const [source, setSource] = React.useState<(typeof SOURCES)[number]["value"]>("direct");
  const [paymentStatus, setPaymentStatus] = React.useState<(typeof PAYMENT_STATUSES)[number]["value"]>("unpaid");
  const [paidAmount, setPaidAmount] = React.useState(0);
  const [nightlyRate, setNightlyRate] = React.useState(0);
  const [specialRequests, setSpecialRequests] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");

  // Hydrate from booking when opening
  React.useEffect(() => {
    if (!open || !booking) return;
    setGuest({
      full_name: booking.guests?.full_name ?? "",
      email: booking.guests?.email ?? "",
      phone: booking.guests?.phone ?? "",
      country: booking.guests?.country ?? "",
    });
    setRoomId(booking.room_id ?? booking.rooms?.id ?? "");
    setCheckIn(booking.check_in);
    setCheckOut(booking.check_out);
    setAdults(booking.adults);
    setChildren(booking.children);
    setStatus(booking.status);
    setSource(booking.source);
    setPaymentStatus(booking.payment_status ?? "unpaid");
    setPaidAmount(Number(booking.paid_amount ?? 0));
    setNightlyRate(Number(booking.nightly_rate ?? 0));
    setSpecialRequests(booking.special_requests ?? "");
    setInternalNotes(booking.internal_notes ?? "");
  }, [open, booking?.id]);

  const nights = nightsBetween(checkIn, checkOut);
  const total = nightlyRate * Math.max(nights, 1);
  const outstanding = Math.max(0, total - (paymentStatus === "paid" ? total : paidAmount));

  const updateMut = useMutation({
    mutationFn: () => {
      if (!booking || !booking.guests) throw new Error("Booking tidak valid");
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
          room_id: roomId || null,
          check_in: checkIn,
          check_out: checkOut,
          adults,
          children,
          status,
          source,
          payment_status: paymentStatus,
          paid_amount: paymentStatus === "paid" ? total : paidAmount,
          nightly_rate: nightlyRate,
          special_requests: specialRequests.trim() || null,
          internal_notes: internalNotes.trim() || null,
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
    !updateMut.isPending && guest.full_name.trim().length > 0 && nights >= 1;

  const paymentChip = PAYMENT_STATUSES.find((p) => p.value === paymentStatus)!.chip;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Hero header */}
        <div className="relative shrink-0 border-b border-border bg-gradient-to-br from-primary/15 via-accent/5 to-transparent px-6 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <Pencil className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  Edit Booking
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  <span className="font-semibold text-foreground">{booking.reference_code ?? booking.id.slice(0, 8)}</span>
                  {booking.guests?.full_name && (
                    <span className="text-muted-foreground"> · {booking.guests.full_name}</span>
                  )}
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

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-5 p-6">
            {/* Tamu */}
            <Section icon={<User className="h-4 w-4" />} title="Informasi Tamu">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama Lengkap" required>
                  <Input
                    value={guest.full_name}
                    onChange={(e) => setGuest((g) => ({ ...g, full_name: e.target.value }))}
                    maxLength={120}
                  />
                </Field>
                <Field label="Nomor HP / WhatsApp">
                  <Input
                    value={guest.phone}
                    onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))}
                    type="tel"
                    maxLength={40}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={guest.email}
                    onChange={(e) => setGuest((g) => ({ ...g, email: e.target.value }))}
                    type="email"
                    maxLength={200}
                  />
                </Field>
                <Field label="Negara Asal">
                  <Input
                    value={guest.country}
                    onChange={(e) => setGuest((g) => ({ ...g, country: e.target.value }))}
                    maxLength={60}
                  />
                </Field>
              </div>
            </Section>

            {/* Tanggal & Jumlah */}
            <Section icon={<CalendarRange className="h-4 w-4" />} title="Tanggal & Jumlah Tamu">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Check-In" required>
                  <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </Field>
                <Field label="Check-Out" required>
                  <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
                </Field>
                <Field label="Dewasa">
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
                <p className="mt-3 text-xs text-destructive">Tanggal check-out harus setelah check-in.</p>
              )}
            </Section>

            {/* Kamar */}
            <Section icon={<BedDouble className="h-4 w-4" />} title="Kamar">
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <Field label="Kamar Fisik">
                  <Select value={roomId || "__none"} onValueChange={(v) => setRoomId(v === "__none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Belum di-assign" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Belum di-assign</SelectItem>
                      {allRooms.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          #{r.number} · {r.room_types?.name ?? "—"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tarif/malam (Rp)">
                  <Input
                    type="number"
                    min={0}
                    step={10000}
                    value={nightlyRate}
                    onChange={(e) => setNightlyRate(Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                Total: <span className="text-foreground">{formatIDR(total)}</span> ({formatIDR(nightlyRate)} × {Math.max(nights, 1)} malam)
              </p>
            </Section>

            {/* Status & Sumber */}
            <Section icon={<ClipboardList className="h-4 w-4" />} title="Status">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status Booking">
                  <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Sumber">
                  <Select value={source} onValueChange={(v) => setSource(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
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
                      if (v === "paid") setPaidAmount(total);
                      if (v === "unpaid") setPaidAmount(0);
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Jumlah Dibayar (Rp)">
                  <Input
                    type="number"
                    min={0}
                    max={total}
                    step={10000}
                    value={paymentStatus === "paid" ? total : paidAmount}
                    disabled={paymentStatus !== "partial"}
                    onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3">
                <SummaryStat label="Total" value={formatIDR(total)} />
                <SummaryStat label="Dibayar" value={formatIDR(paymentStatus === "paid" ? total : paidAmount)} />
                <SummaryStat
                  label="Sisa"
                  value={formatIDR(outstanding)}
                  accent={outstanding > 0 ? "warn" : "ok"}
                />
              </div>
            </Section>

            {/* Notes */}
            <Section icon={<ClipboardList className="h-4 w-4" />} title="Catatan">
              <div className="space-y-3">
                <Field label="Permintaan Khusus (dari tamu)">
                  <Textarea
                    value={specialRequests}
                    onChange={(e) => setSpecialRequests(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
                <Field label="Catatan Internal (untuk staff)">
                  <Textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
              </div>
            </Section>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>
            Batal
          </Button>
          <Button onClick={() => updateMut.mutate()} disabled={!canSave} className="gap-1.5">
            {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {updateMut.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
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

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "ok" | "warn";
}) {
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
