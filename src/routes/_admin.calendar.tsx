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
import { ChevronLeft, ChevronRight, CalendarDays, Calendar as CalendarIcon } from "lucide-react";

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
  // Default anchor ke startOfDay agar hari ini tampil di kolom paling kiri saat load
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
    <div className="flex h-full flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-3 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <CalendarDays className="h-6 w-6" />
            <span className="tracking-tight">KALENDER RESERVASI</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Select 
              value={getMonth(anchor).toString()} 
              onValueChange={(v) => setAnchor(startOfMonth(setMonth(anchor, parseInt(v))))}
            >
              <SelectTrigger className="h-9 w-[140px] font-medium border-none bg-muted/50">
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
              <SelectTrigger className="h-9 w-[100px] font-medium border-none bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tombol HARI INI - Mereset anchor ke tanggal sekarang */}
          <Button 
            variant="default" 
            size="sm" 
            className="font-bold px-4 shadow-md bg-primary hover:bg-primary/90"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            HARI INI
          </Button>
          
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border">
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background" onClick={() => setAnchor(addDays(anchor, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background" onClick={() => setAnchor(addDays(anchor, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-muted/10 p-4 md:p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
               <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
               <p className="text-sm font-medium text-muted-foreground">Sinkronisasi Kalender...</p>
            </div>
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
  const cellWidth = 110;
  const labelWidth = 180;
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
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xl ring-1 ring-black/5">
      <div style={{ minWidth: labelWidth + days.length * cellWidth }}>
        {/* Header Tanggal */}
        <div className="flex border-b border-border bg-muted/30 sticky top-0 z-30 backdrop-blur-sm">
          <div style={{ width: labelWidth }} className="shrink-0 px-4 py-5 text-[11px] font-black uppercase tracking-widest text-muted-foreground flex items-end">
            KAMAR & UNIT
          </div>
          {days.map((d: Date) => (
            <div 
              key={d.toISOString()} 
              style={{ width: cellWidth }} 
              className={cn(
                "shrink-0 border-l border-border px-1 py-3 text-center transition-all",
                isToday(d) ? "bg-primary/10" : ""
              )}
            >
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-tighter mb-1",
                isToday(d) ? "text-primary" : "text-muted-foreground/70"
              )}>
                {format(d, "EEEE", { locale: id })}
              </div>
              <div className={cn(
                "text-xl font-black leading-none",
                isToday(d) ? "text-primary" : "text-foreground"
              )}>
                {format(d, "dd")}
              </div>
              {isToday(d) && <div className="mt-1 mx-auto w-1.5 h-1.5 rounded-full bg-primary" />}
            </div>
          ))}
        </div>

        {/* List Kamar */}
        {roomTypes.map((type: any) => (
          <div key={type.id} className="group">
            <div className="flex bg-muted/50 border-b border-border px-4 py-2.5 text-[10px] font-black text-foreground/70 uppercase tracking-widest">
              {type.name} <span className="mx-2 opacity-20">|</span> <span className="text-primary font-bold">{formatIDR(type.base_rate)}</span>
            </div>
            
            {rooms.filter((r: any) => r.room_type_id === type.id).map((room: any) => (
              <div key={room.id} className="relative flex border-b border-border h-[64px] hover:bg-muted/5 transition-colors">
                <div style={{ width: labelWidth }} className="flex shrink-0 items-center px-4 border-r border-border font-bold text-sm text-foreground/80 bg-card/50">
                   Unit {room.number}
                </div>

                {days.map((d: Date) => (
                  <button 
                    key={d.toISOString()} 
                    onClick={() => onCellClick(room.id, d)} 
                    style={{ width: cellWidth }} 
                    className={cn(
                      "shrink-0 border-l border-border/50 hover:bg-primary/5 transition-colors focus:outline-none",
                      isToday(d) ? "bg-primary/[0.03]" : ""
                    )} 
                  />
                ))}

                {(bookingsByRoom.get(room.id) ?? []).map((b: any) => {
                  const ci = parseISO(b.check_in);
                  const co = parseISO(b.check_out);
                  const startIdx = differenceInCalendarDays(ci, windowStart);
                  const endIdx = differenceInCalendarDays(co, windowStart);
                  
                  if (endIdx < 0 || startIdx >= WINDOW_DAYS) return null;

                  const left = labelWidth + (Math.max(0, startIdx) * cellWidth) + (cellWidth / 2);
                  const width = (endIdx - startIdx) * cellWidth;

                  return (
                    <button
                      key={b.id}
                      onClick={(e) => { e.stopPropagation(); onBookingClick(b); }}
                      className={cn(
                        "absolute top-2.5 bottom-2.5 flex items-center px-3 rounded-lg border text-[11px] font-black shadow-md transition-all hover:scale-[1.01] hover:brightness-95 active:scale-95 overflow-hidden z-10",
                        b.status === "confirmed" ? "bg-blue-100 border-blue-300 text-blue-800" : 
                        b.status === "checked_in" ? "bg-emerald-100 border-emerald-300 text-emerald-800" :
                        "bg-amber-100 border-amber-300 text-amber-800"
                      )}
                      style={{ left: left + 2, width: width - 4 }}
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
  );
}

// Dialog Komponen
function CreateBookingDialog({ ctx, onClose, onSaved }: any) {
  const createFn = useServerFn(createBookingFromAdmin);
  const [form, setForm] = React.useState({ guestName: "", checkIn: "", checkOut: "", nightlyRate: 0 });

  React.useEffect(() => {
    if (ctx) setForm({ ...form, checkIn: fmtIso(ctx.date), checkOut: fmtIso(addDays(ctx.date, 1)), nightlyRate: ctx.baseRate });
  }, [ctx]);

  const handleSave = async () => {
    try {
      await createFn({ data: { ...form, roomId: ctx.roomId, adults: 2, children: 0, status: "confirmed" } });
      toast.success("Booking Berhasil!");
      onSaved();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={!!ctx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-black text-xl">BOOKING UNIT {ctx?.roomNumber}</DialogTitle>
          <DialogDescription className="font-medium">{ctx?.roomTypeName}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Nama Tamu"><Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} placeholder="Input Nama..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in"><Input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></Field>
            <Field label="Check-out"><Input type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></Field>
          </div>
          <Field label="Harga/Malam"><Input type="number" value={form.nightlyRate} onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="font-bold" onClick={onClose}>BATAL</Button>
          <Button className="font-bold" onClick={handleSave}>SIMPAN BOOKING</Button>
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
        <DialogHeader>
           <DialogTitle className="font-black text-xl uppercase">Detail Tamu: {booking.guests?.full_name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Update Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">DIKONFIRMASI</SelectItem>
                <SelectItem value="checked_in">CHECK-IN</SelectItem>
                <SelectItem value="checked_out">CHECK-OUT</SelectItem>
                <SelectItem value="cancelled">DIBATALKAN</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="font-bold" onClick={onClose}>TUTUP</Button>
          <Button className="font-bold" onClick={async () => { await updateFn({ data: { id: booking.id, status, roomId: booking.room_id } }); toast.success("Update Berhasil!"); onSaved(); }}>SIMPAN PERUBAHAN</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-black uppercase text-muted-foreground/80 tracking-widest">{label}</Label>
      {children}
    </div>
  );
}