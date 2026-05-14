import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isToday,
  isWeekend,
  parseISO,
  startOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";

import {
  getCalendarData,
  createBookingFromAdmin,
  updateBookingFromAdmin,
} from "@/lib/calendar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

const WINDOW_DAYS = 14;

type BookingRow = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  source: string;
  room_id: string | null;
  room_type_id: string;
  adults: number;
  children: number;
  nightly_rate: number;
  total_amount: number;
  special_requests: string | null;
  guests: { id: string; full_name: string; email: string | null; phone: string | null } | null;
};

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300",
  confirmed: "bg-primary/15 border-primary/40 text-primary",
  checked_in: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  checked_out: "bg-muted border-border text-muted-foreground",
  cancelled: "bg-destructive/10 border-destructive/30 text-destructive line-through",
};

function fmtIso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function CalendarPage() {
  const [anchor, setAnchor] = React.useState<Date>(startOfDay(new Date()));
  const days = React.useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(anchor, i)),
    [anchor],
  );
  const from = fmtIso(anchor);
  const to = fmtIso(addDays(anchor, WINDOW_DAYS));

  const fetchCalendar = useServerFn(getCalendarData);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-calendar", from, to],
    queryFn: () => fetchCalendar({ data: { from, to } }),
  });

  const [createCtx, setCreateCtx] = React.useState<
    | { roomId: string; roomNumber: string; roomTypeName: string; baseRate: number; date: Date }
    | null
  >(null);
  const [editCtx, setEditCtx] = React.useState<BookingRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
              Booking Calendar
            </h1>
            <p className="text-xs text-muted-foreground">
              {format(anchor, "d MMM")} – {format(addDays(anchor, WINDOW_DAYS - 1), "d MMM yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(addDays(anchor, -WINDOW_DAYS))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(addDays(anchor, WINDOW_DAYS))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <LegendDots />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading calendar…</p>
        ) : (
          <CalendarGrid
            days={days}
            rooms={data?.rooms ?? []}
            roomTypes={data?.roomTypes ?? []}
            bookings={(data?.bookings ?? []) as BookingRow[]}
            onCellClick={(roomId, date) => {
              const room = data?.rooms.find((r) => r.id === roomId);
              const rt = data?.roomTypes.find((t) => t.id === room?.room_type_id);
              if (!room || !rt) return;
              setCreateCtx({
                roomId,
                roomNumber: room.number,
                roomTypeName: rt.name,
                baseRate: Number(rt.base_rate),
                date,
              });
            }}
            onBookingClick={(b) => setEditCtx(b)}
          />
        )}
      </div>

      <CreateBookingDialog
        ctx={createCtx}
        onClose={() => setCreateCtx(null)}
        onSaved={() => {
          setCreateCtx(null);
          invalidate();
        }}
      />
      <EditBookingDialog
        booking={editCtx}
        rooms={data?.rooms ?? []}
        roomTypes={data?.roomTypes ?? []}
        onClose={() => setEditCtx(null)}
        onSaved={() => {
          setEditCtx(null);
          invalidate();
        }}
      />
    </div>
  );
}

function LegendDots() {
  const items: Array<[string, string]> = [
    ["Pending", "bg-amber-500"],
    ["Confirmed", "bg-primary"],
    ["Checked-in", "bg-emerald-500"],
    ["Checked-out", "bg-muted-foreground"],
  ];
  return (
    <div className="ml-2 hidden items-center gap-3 md:flex">
      {items.map(([label, c]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", c)} />
          {label}
        </span>
      ))}
    </div>
  );
}

function CalendarGrid({
  days,
  rooms,
  roomTypes,
  bookings,
  onCellClick,
  onBookingClick,
}: {
  days: Date[];
  rooms: Array<{ id: string; number: string; room_type_id: string; status: string }>;
  roomTypes: Array<{ id: string; name: string; base_rate: number; capacity: number }>;
  bookings: BookingRow[];
  onCellClick: (roomId: string, date: Date) => void;
  onBookingClick: (b: BookingRow) => void;
}) {
  const cellWidth = 96;
  const rowHeight = 56;
  const labelWidth = 200;
  const windowStart = days[0];
  const windowEnd = addDays(days[days.length - 1], 1); // exclusive

  // Group rooms by room type
  const grouped = React.useMemo(() => {
    return roomTypes
      .map((t) => ({
        type: t,
        rooms: rooms.filter((r) => r.room_type_id === t.id),
      }))
      .filter((g) => g.rooms.length > 0);
  }, [rooms, roomTypes]);

  const bookingsByRoom = React.useMemo(() => {
    const m = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      if (!b.room_id) continue;
      if (!m.has(b.room_id)) m.set(b.room_id, []);
      m.get(b.room_id)!.push(b);
    }
    return m;
  }, [bookings]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div style={{ minWidth: labelWidth + days.length * cellWidth }}>
        {/* Header row */}
        <div className="flex border-b border-border bg-muted/40">
          <div
            style={{ width: labelWidth }}
            className="shrink-0 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            Room
          </div>
          {days.map((d) => (
            <div
              key={d.toISOString()}
              style={{ width: cellWidth }}
              className={cn(
                "shrink-0 border-l border-border px-2 py-2 text-center",
                isToday(d) && "bg-primary/10",
                isWeekend(d) && !isToday(d) && "bg-muted/30",
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {format(d, "EEE")}
              </div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  isToday(d) && "text-primary",
                )}
              >
                {format(d, "d")}
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        {grouped.map((g) => (
          <div key={g.type.id}>
            <div className="flex bg-muted/20 border-b border-border">
              <div
                style={{ width: labelWidth }}
                className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/80"
              >
                {g.type.name} · ${Number(g.type.base_rate).toFixed(0)}/nt
              </div>
              <div className="flex-1" />
            </div>
            {g.rooms.map((room) => (
              <div
                key={room.id}
                className="relative flex border-b border-border last:border-b-0"
                style={{ height: rowHeight }}
              >
                <div
                  style={{ width: labelWidth }}
                  className="flex shrink-0 items-center gap-2 border-r border-border px-3"
                >
                  <span className="text-sm font-semibold">#{room.number}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {room.status.replace("_", " ")}
                  </Badge>
                </div>
                {/* Day cells (clickable empty) */}
                {days.map((d) => (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => onCellClick(room.id, d)}
                    style={{ width: cellWidth }}
                    className={cn(
                      "group/cell shrink-0 border-l border-border transition hover:bg-accent/30",
                      isToday(d) && "bg-primary/5",
                      isWeekend(d) && !isToday(d) && "bg-muted/10",
                    )}
                    aria-label={`Create booking for room ${room.number} on ${format(d, "PPP")}`}
                  >
                    <Plus className="mx-auto h-3.5 w-3.5 text-muted-foreground/0 transition group-hover/cell:text-muted-foreground" />
                  </button>
                ))}
                {/* Booking bars */}
                {(bookingsByRoom.get(room.id) ?? []).map((b) => {
                  const ci = parseISO(b.check_in);
                  const co = parseISO(b.check_out);
                  const startIdx = Math.max(0, differenceInCalendarDays(ci, windowStart));
                  const endIdx = Math.min(
                    days.length,
                    differenceInCalendarDays(co, windowStart),
                  );
                  if (endIdx <= 0 || startIdx >= days.length) return null;
                  const startsBefore = ci < windowStart;
                  const endsAfter = co > windowEnd;
                  const left = labelWidth + startIdx * cellWidth + (startsBefore ? 0 : cellWidth / 2);
                  const right = labelWidth + endIdx * cellWidth - (endsAfter ? 0 : cellWidth / 2);
                  const width = Math.max(40, right - left - 4);
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBookingClick(b);
                      }}
                      className={cn(
                        "absolute top-1.5 flex h-[calc(100%-12px)] items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left text-xs shadow-sm transition hover:scale-[1.01] hover:shadow-md",
                        statusStyles[b.status] ?? "bg-muted border-border",
                      )}
                      style={{ left: left + 2, width }}
                    >
                      <span className="truncate font-semibold">
                        {b.guests?.full_name ?? "Guest"}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider opacity-70">
                        {b.adults}+{b.children}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No rooms configured yet.</p>
        )}
      </div>
    </div>
  );
}

function CreateBookingDialog({
  ctx,
  onClose,
  onSaved,
}: {
  ctx: { roomId: string; roomNumber: string; roomTypeName: string; baseRate: number; date: Date } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createBookingFromAdmin);
  const m = useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      toast.success("Booking created");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create booking"),
  });

  const [form, setForm] = React.useState({
    checkIn: "",
    checkOut: "",
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    adults: 2,
    children: 0,
    nightlyRate: 0,
    status: "confirmed" as "pending" | "confirmed" | "checked_in",
    notes: "",
  });

  React.useEffect(() => {
    if (!ctx) return;
    setForm({
      checkIn: fmtIso(ctx.date),
      checkOut: fmtIso(addDays(ctx.date, 1)),
      guestName: "",
      guestEmail: "",
      guestPhone: "",
      adults: 2,
      children: 0,
      nightlyRate: ctx.baseRate,
      status: "confirmed",
      notes: "",
    });
  }, [ctx]);

  return (
    <Dialog open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            {ctx ? `Room #${ctx.roomNumber} · ${ctx.roomTypeName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in">
            <Input
              type="date"
              value={form.checkIn}
              onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            />
          </Field>
          <Field label="Check-out">
            <Input
              type="date"
              value={form.checkOut}
              onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            />
          </Field>
          <Field label="Guest name" className="col-span-2">
            <Input
              value={form.guestName}
              onChange={(e) => setForm({ ...form, guestName: e.target.value })}
              placeholder="Full name"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.guestEmail}
              onChange={(e) => setForm({ ...form, guestEmail: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.guestPhone}
              onChange={(e) => setForm({ ...form, guestPhone: e.target.value })}
            />
          </Field>
          <Field label="Adults">
            <Input
              type="number"
              min={1}
              value={form.adults}
              onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })}
            />
          </Field>
          <Field label="Children">
            <Input
              type="number"
              min={0}
              value={form.children}
              onChange={(e) => setForm({ ...form, children: Number(e.target.value) })}
            />
          </Field>
          <Field label="Nightly rate">
            <Input
              type="number"
              min={0}
              value={form.nightlyRate}
              onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="checked_in">Checked-in</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={m.isPending || !form.guestName || !form.checkIn || !form.checkOut}
            onClick={() =>
              ctx &&
              m.mutate({
                data: {
                  roomId: ctx.roomId,
                  checkIn: form.checkIn,
                  checkOut: form.checkOut,
                  guestName: form.guestName,
                  guestEmail: form.guestEmail,
                  guestPhone: form.guestPhone,
                  adults: form.adults,
                  children: form.children,
                  nightlyRate: form.nightlyRate,
                  status: form.status,
                  notes: form.notes,
                },
              })
            }
          >
            {m.isPending ? "Saving…" : "Create booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBookingDialog({
  booking,
  rooms,
  roomTypes,
  onClose,
  onSaved,
}: {
  booking: BookingRow | null;
  rooms: Array<{ id: string; number: string; room_type_id: string; status: string }>;
  roomTypes: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updateBookingFromAdmin);
  const m = useMutation({
    mutationFn: updateFn,
    onSuccess: () => {
      toast.success("Booking updated");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const [form, setForm] = React.useState({
    checkIn: "",
    checkOut: "",
    roomId: "",
    status: "confirmed" as "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled",
    nightlyRate: 0,
    notes: "",
  });

  React.useEffect(() => {
    if (!booking) return;
    setForm({
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      roomId: booking.room_id ?? "",
      status: booking.status as typeof form.status,
      nightlyRate: Number(booking.nightly_rate),
      notes: booking.special_requests ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id]);

  if (!booking) return null;

  const roomTypeName = (rid: string) => {
    const r = rooms.find((x) => x.id === rid);
    const t = roomTypes.find((x) => x.id === r?.room_type_id);
    return t?.name ?? "";
  };

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{booking.guests?.full_name ?? "Guest"}</DialogTitle>
          <DialogDescription>
            {booking.guests?.email || booking.guests?.phone || "—"} · {booking.adults} adults
            {booking.children > 0 ? `, ${booking.children} children` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in">
            <Input
              type="date"
              value={form.checkIn}
              onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
            />
          </Field>
          <Field label="Check-out">
            <Input
              type="date"
              value={form.checkOut}
              onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
            />
          </Field>
          <Field label="Room" className="col-span-2">
            <Select value={form.roomId} onValueChange={(v) => setForm({ ...form, roomId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select a room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    #{r.number} · {roomTypeName(r.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="checked_in">Checked-in</SelectItem>
                <SelectItem value="checked_out">Checked-out</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nightly rate">
            <Input
              type="number"
              min={0}
              value={form.nightlyRate}
              onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={m.isPending}
            onClick={() =>
              m.mutate({
                data: {
                  id: booking.id,
                  checkIn: form.checkIn,
                  checkOut: form.checkOut,
                  roomId: form.roomId,
                  status: form.status,
                  nightlyRate: form.nightlyRate,
                  notes: form.notes,
                },
              })
            }
          >
            {m.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// Silence unused warnings (kept for potential future use)
void isSameDay;
