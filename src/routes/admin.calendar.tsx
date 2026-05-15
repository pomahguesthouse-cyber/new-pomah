import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  setMonth,
  setYear,
  getYear,
  getMonth,
} from "date-fns";
import { id } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

const WINDOW_DAYS = 14;

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const YEARS = Array.from({ length: 5 }, (_, i) => getYear(new Date()) + i);

const formatIDR = (amount: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount).replace("IDR", "Rp.");
};

function fmtIso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function CalendarPage() {
  const [anchor, setAnchor] = React.useState<Date>(startOfDay(new Date()));
  const queryClient = useQueryClient();

  const days = React.useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(anchor, i)),
    [anchor]
  );

  const from = fmtIso(anchor);
  const to = fmtIso(addDays(anchor, WINDOW_DAYS));

  const fetchCalendar = useServerFn(getCalendarData);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-calendar", from, to],
    queryFn: () => fetchCalendar({ data: { from, to } }),
  });

  const [createCtx, setCreateCtx] = React.useState<any>(null);
  const [editCtx, setEditCtx] = React.useState<any>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-6 py-4">
        <div className="flex items-center gap-4">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div className="flex items-center gap-2">
            <Select value={getMonth(anchor).toString()} onValueChange={(v) => setAnchor(startOfMonth(setMonth(anchor, parseInt(v))))}>
              <SelectTrigger className="h-8 w-[130px] text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, i) => <SelectItem key={i} value={i.toString()}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={getYear(anchor).toString()} onValueChange={(v) => setAnchor(setYear(anchor, parseInt(v)))}>
              <SelectTrigger className="h-8 w-[90px] text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -WINDOW_DAYS))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            Hari Ini
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, WINDOW_DAYS))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Memuat data...</p>
        ) : (
          <CalendarGrid
            days={days}
            rooms={data?.rooms ?? []}
            roomTypes={data?.roomTypes ?? []}
            bookings={data?.bookings ?? []}
            onCellClick={(roomId: string, date: Date) => {
              const room = data?.rooms.find((r: any) => r.id === roomId);
              const rt = data?.roomTypes.find((t: any) => t.id === room?.room_type_id);
              setCreateCtx({ roomId, roomNumber: room?.number, baseRate: rt?.base_rate, date });
            }}
            onBookingClick={(b: any) => setEditCtx(b)}
          />
        )}
      </div>

      <CreateBookingDialog ctx={createCtx} onClose={() => setCreateCtx(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-calendar"] })} />
      <EditBookingDialog booking={editCtx} rooms={data?.rooms ?? []} onClose={() => setEditCtx(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-calendar"] })} />
    </div>
  );
}

function CalendarGrid({ days, rooms, roomTypes, bookings, onCellClick, onBookingClick }: any) {
  const cellWidth = 100;
  const labelWidth = 160;
  const windowStart = days[0];

  const bookingsByRoom = React.useMemo(() => {
    const m = new Map();
    bookings.forEach((b: any) => {
      if (!m.has(b.room_id)) m.set(b.room_id, []);
      m.get(b.room_id).push(b);
    });
    return m;
  }, [bookings]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div style={{ minWidth: labelWidth + days.length * cellWidth }}>
        <div className="flex border-b border-border bg-muted/40 sticky top-0 z-30">
          <div style={{ width: labelWidth }} className="shrink-0 px-3 py-4 text-[10px] font-bold uppercase text-muted-foreground">Unit</div>
          {days.map((d: Date) => (
            <div key={d.toISOString()} style={{ width: cellWidth }} className={cn("shrink-0 border-l border-border px-1 py-2 text-center", isToday(d) && "bg-primary/10")}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase">{format(d, "EEEE", { locale: id })}</div>
              <div className="text-sm font-bold">{format(d, "dd")}</div>
            </div>
          ))}
        </div>

        {roomTypes.map((type: any) => (
          <div key={type.id}>
            <div className="flex bg-muted/10 border-b border-border px-3 py-1.5 text-[10px] font-bold text-foreground/50">
              {type.name.toUpperCase()} · {formatIDR(type.base_rate)}
            </div>
            {rooms.filter((r: any) => r.room_type_id === type.id).map((room: any) => (
              <div key={room.id} className="relative flex border-b border-border h-[56px]">
                <div style={{ width: labelWidth }} className="flex shrink-0 items-center px-3 border-r border-border font-medium text-xs">#{room.number}</div>
                {days.map((d: Date) => (
                  <button key={d.toISOString()} onClick={() => onCellClick(room.id, d)} style={{ width: cellWidth }} className="shrink-0 border-l border-border hover:bg-accent/30 transition-colors" />
                ))}
                {(bookingsByRoom.get(room.id) ?? []).map((b: any) => {
                  const ci = parseISO(b.check_in);
                  const co = parseISO(b.check_out);
                  const startIdx = differenceInCalendarDays(ci, windowStart);
                  const endIdx = differenceInCalendarDays(co, windowStart);
                  const left = labelWidth + (startIdx * cellWidth) + (cellWidth / 2);
                  const width = (endIdx - startIdx) * cellWidth;

                  return (
                    <button
                      key={b.id}
                      onClick={() => onBookingClick(b)}
                      className="absolute top-2 bottom-2 flex items-center px-2 rounded border text-[10px] font-bold shadow-sm bg-primary/20 border-primary/40 text-primary overflow-hidden"
                      style={{ left: left + 2, width: width - 4, zIndex: 10 }}
                    >
                      <span className="truncate">{b.guests?.full_name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateBookingDialog({ ctx, onClose, onSaved }: any) {
  const createFn = useServerFn(createBookingFromAdmin);
  const [form, setForm] = React.useState({ guestName: "", checkIn: "", checkOut: "", nightlyRate: 0 });

  React.useEffect(() => {
    if (ctx) setForm({ guestName: "", checkIn: fmtIso(ctx.date), checkOut: fmtIso(addDays(ctx.date, 1)), nightlyRate: ctx.baseRate });
  }, [ctx]);

  return (
    <Dialog open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Booking Baru: #{ctx?.roomNumber}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-4">
          <Field label="Nama Tamu"><Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in (14:00)"><Input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></Field>
            <Field label="Check-out (12:00)"><Input type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></Field>
          </div>
          <Field label="Harga/Malam"><Input type="number" value={form.nightlyRate} onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={async () => { await createFn({ data: { ...form, roomId: ctx.roomId, adults: 1, children: 0, status: "confirmed" } }); onSaved(); }}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBookingDialog({ booking, rooms, onClose, onSaved }: any) {
  const updateFn = useServerFn(updateBookingFromAdmin);
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    if (booking) setStatus(booking.status);
  }, [booking]);

  if (!booking) return null;

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{booking.guests?.full_name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Ubah Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">Dikonfirmasi</SelectItem>
                <SelectItem value="checked_in">Check-in</SelectItem>
                <SelectItem value="checked_out">Check-out</SelectItem>
                <SelectItem value="cancelled">Dibatalkan</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <Button onClick={async () => { await updateFn({ data: { id: booking.id, status, roomId: booking.room_id } }); onSaved(); }}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}