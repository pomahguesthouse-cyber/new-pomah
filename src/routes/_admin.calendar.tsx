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
const YEARS = Array.from({ length: 5 }, (_, i) => getYear(new Date()) - 1 + i);

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });

  return (
    <div className="flex h-full flex-col bg-background w-full overflow-hidden">
      {/* Header Utama - Z-Index 40 agar di bawah Sidebar (biasanya z-50) tapi di atas Kalender */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-3 shadow-sm z-40 relative">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-black text-primary mr-2">
            <CalendarDays className="h-6 w-6" />
            <span className="tracking-tighter hidden md:block uppercase">Calendar</span>
          </div>

          <Button 
            variant="default" 
            size="sm" 
            className="font-bold px-4 h-9 bg-primary hover:bg-primary/90 shadow-sm"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            HARI INI
          </Button>
          
          <div className="flex items-center gap-2">
            <Select 
              value={getMonth(anchor).toString()} 
              onValueChange={(v) => setAnchor(startOfMonth(setMonth(anchor, parseInt(v))))}
            >
              <SelectTrigger className="h-9 w-[130px] font-bold border-none bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, i) => <SelectItem key={i} value={i.toString()}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select 
              value={getYear(anchor).toString()} 
              onValueChange={(v) => setAnchor(setYear(anchor, parseInt(v)))}
            >
              <SelectTrigger className="h-9 w-[90px] font-bold border-none bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1 border">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background" onClick={() => setAnchor(addDays(anchor, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background" onClick={() => setAnchor(addDays(anchor, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Container Scroll Area */}
      <div className="flex-1 overflow-auto bg-muted/10 relative p-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center font-bold text-muted-foreground animate-pulse">
            LOADING DATA...
          </div>
        ) : (
          <CalendarGrid
            days={days}
            rooms={data?.rooms ?? []}
            roomTypes={data?.roomTypes ?? []}
            bookings={data?.bookings ?? []}
            onCellClick={(roomId: string, date: Date) => {
              const room = data?.rooms.find((r: any) => r.id === roomId);
              const rt = data?.roomTypes.find((t: any) => t.id === room?.room_type_id);
              setCreateCtx({ roomId, roomNumber: room?.number, roomTypeName: rt?.name, baseRate: rt?.base_rate, date });
            }}
            onBookingClick={(b: any) => setEditCtx(b)}
          />
        )}
      </div>

      <CreateBookingDialog ctx={createCtx} onClose={() => setCreateCtx(null)} onSaved={invalidate} />
      <EditBookingDialog booking={editCtx} rooms={data?.rooms ?? []} onClose={() => setEditCtx(null)} onSaved={invalidate} />
    </div>
  );
}

function CalendarGrid({ days, rooms, roomTypes, bookings, onCellClick, onBookingClick }: any) {
  const cellWidth = 72;
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
    <div className="rounded-xl border border-border bg-card shadow-xl overflow-hidden ring-1 ring-black/5">
      <div className="overflow-x-auto">
        <div style={{ minWidth: labelWidth + days.length * cellWidth }} className="relative">
          
          {/* Header Tanggal - STICKY VERTICAL (top-0) */}
          <div className="flex border-b border-border bg-card sticky top-0 z-30 shadow-sm">

            {/* Pojok Kiri Atas (Label Unit) - STICKY VERTICAL & HORIZONTAL (top-0 & left-0) */}
            {/* Z-Index 40 agar selalu di atas Header Tanggal dan Kolom Kamar */}
            <div
              style={{ width: labelWidth }}
              className="shrink-0 px-4 py-5 text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-end sticky top-0 left-0 z-40 bg-card border-r border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
            >
              UNIT
            </div>

            {days.map((d: Date) => {
              const today = isToday(d);
              return (
                <div
                  key={d.toISOString()}
                  style={{ width: cellWidth }}
                  className={cn(
                    "shrink-0 border-l border-border px-1 py-2 text-center transition-all relative",
                    today ? "bg-primary/5" : ""
                  )}
                >
                  <div className={cn(
                    "text-[9px] font-bold uppercase tracking-tight",
                    today ? "text-primary" : "text-muted-foreground/70"
                  )}>
                    {format(d, "EEE", { locale: id })}
                  </div>
                  <div className={cn(
                    "text-base font-black leading-tight mt-0.5",
                    today ? "text-primary" : "text-foreground"
                  )}>
                    {format(d, "dd")}
                  </div>
                  {today && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-1.5 py-px text-[8px] font-black uppercase tracking-wider text-primary-foreground shadow-sm">
                      Today
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Body Kalender */}
          {roomTypes.map((type: any) => (
            <div key={type.id} className="group">
              {/* Tipe Kamar - bar membentang seluruh grid, label sticky di kiri */}
              <div className="relative flex bg-muted border-b border-border h-9">
                <div
                  style={{ width: labelWidth }}
                  className="shrink-0 sticky left-0 z-20 bg-muted flex items-center px-4 text-[9px] font-black text-foreground/70 uppercase tracking-widest border-r border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                >
                  <span className="truncate">
                    {type.name} <span className="mx-2 opacity-30">|</span> {formatIDR(type.base_rate)}
                  </span>
                </div>
              </div>

              {rooms.filter((r: any) => r.room_type_id === type.id).map((room: any) => (
                <div key={room.id} className="relative flex border-b border-border h-[60px] hover:bg-muted/5 transition-colors">

                  {/* Nomor Kamar - STICKY HORIZONTAL (left-0) */}
                  {/* Z-Index 20 agar bar booking terpotong di bawahnya saat scroll horizontal */}
                  <div
                    style={{ width: labelWidth }}
                    className="flex shrink-0 items-center px-4 border-r border-border font-bold text-xs text-foreground/70 sticky left-0 z-20 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                  >
                     #{room.number}
                  </div>

                  {/* Day Cells */}
                  {days.map((d: Date) => (
                    <button 
                      key={d.toISOString()} 
                      onClick={() => onCellClick(room.id, d)} 
                      style={{ width: cellWidth }} 
                      className={cn(
                        "shrink-0 border-l border-border/50 transition-colors focus:outline-none",
                        isToday(d) ? "bg-primary/[0.02]" : ""
                      )} 
                    />
                  ))}

                  {/* Bar Booking */}
                  {(bookingsByRoom.get(room.id) ?? []).map((b: any) => {
                    const ci = parseISO(b.check_in);
                    const co = parseISO(b.check_out);
                    const startIdx = differenceInCalendarDays(ci, windowStart);
                    const endIdx = differenceInCalendarDays(co, windowStart);
                    
                    if (endIdx < 0 || startIdx >= WINDOW_DAYS) return null;

                    const left = labelWidth + (startIdx * cellWidth) + (cellWidth / 2);
                    const width = (endIdx - startIdx) * cellWidth;

                    return (
                      <button
                        key={b.id}
                        onClick={(e) => { e.stopPropagation(); onBookingClick(b); }}
                        className={cn(
                          "absolute top-2.5 bottom-2.5 flex items-center px-3 rounded-lg border text-[10px] font-black shadow-md transition-all hover:scale-[1.01] overflow-hidden z-10",
                          b.status === "confirmed" ? "bg-blue-100 border-blue-300 text-blue-800" : 
                          b.status === "checked_in" ? "bg-emerald-100 border-emerald-300 text-emerald-800" :
                          "bg-amber-100 border-amber-300 text-amber-800"
                        )}
                        style={{ 
                          left: left + 2, 
                          width: Math.max(width - 4, 40),
                        }}
                      >
                        <span className="truncate uppercase tracking-tighter">{b.guests?.full_name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Dialog-dialog (CreateBookingDialog, EditBookingDialog, Field) tetap sama seperti kode Bapak sebelumnya.
function CreateBookingDialog({ ctx, onClose, onSaved }: any) {
  const createFn = useServerFn(createBookingFromAdmin);
  const [form, setForm] = React.useState({ guestName: "", checkIn: "", checkOut: "", nightlyRate: 0 });
  React.useEffect(() => {
    if (ctx) setForm({ ...form, checkIn: fmtIso(ctx.date), checkOut: fmtIso(addDays(ctx.date, 1)), nightlyRate: ctx.baseRate });
  }, [ctx]);
  return (
    <Dialog open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader><DialogTitle className="font-black text-xl tracking-tighter uppercase">New Booking #{ctx?.roomNumber}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Nama Tamu"><Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} placeholder="NAMA..." className="font-bold"/></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-In"><Input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} className="font-bold"/></Field>
            <Field label="Check-Out"><Input type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} className="font-bold"/></Field>
          </div>
          <Field label="Harga/Malam"><Input type="number" value={form.nightlyRate} onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })} className="font-bold"/></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="font-bold" onClick={onClose}>BATAL</Button>
          <Button className="font-bold" onClick={async () => { await createFn({ data: { ...form, roomId: ctx.roomId, adults: 2, children: 0, status: "confirmed" } }); toast.success("BOOKING BERHASIL!"); onSaved(); }}>SIMPAN</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBookingDialog({ booking, rooms, onClose, onSaved }: any) {
  const updateFn = useServerFn(updateBookingFromAdmin);
  const [status, setStatus] = React.useState("");
  React.useEffect(() => { if (booking) setStatus(booking.status); }, [booking]);
  if (!booking) return null;
  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-black text-xl tracking-tighter uppercase">Update: {booking.guests?.full_name}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">CONFIRMED</SelectItem>
                <SelectItem value="checked_in">CHECKED-IN</SelectItem>
                <SelectItem value="checked_out">CHECKED-OUT</SelectItem>
                <SelectItem value="cancelled">CANCELLED</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="font-bold" onClick={onClose}>TUTUP</Button>
          <Button className="font-bold" onClick={async () => { await updateFn({ data: { id: booking.id, status, roomId: booking.room_id } }); toast.success("UPDATE BERHASIL!"); onSaved(); }}>SIMPAN</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-black text-muted-foreground/80 tracking-widest uppercase">{label}</Label>
      {children}
    </div>
  );
}