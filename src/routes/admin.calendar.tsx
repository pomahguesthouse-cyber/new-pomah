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
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

const WINDOW_DAYS = 14; // Menampilkan 14 hari ke depan

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
  // Poin 3: Default anchor adalah startOfDay(new Date()) agar hari ini di paling kiri
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
    <div className="flex h-full flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-3 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <CalendarDays className="h-5 w-5 text-primary" />
            <span>Kalender Reservasi</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Select 
              value={getMonth(anchor).toString()} 
              onValueChange={(v) => setAnchor(startOfMonth(setMonth(anchor, parseInt(v))))}
            >
              <SelectTrigger className="h-9 w-[140px] bg-muted/50 border-none">
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
              <SelectTrigger className="h-9 w-[100px] bg-muted/50 border-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Poin 2: Tombol Today */}
          <Button 
            variant="outline" 
            size="sm" 
            className="font-medium px-4"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            Hari Ini
          </Button>
          <div className="flex items-center border rounded-md ml-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-r" onClick={() => setAnchor(addDays(anchor, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={() => setAnchor(addDays(anchor, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-muted/20 p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground animate-pulse">Sinkronisasi data kalender...</p>
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
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-lg ring-1 ring-black/5">
      <div style={{ minWidth: labelWidth + days.length * cellWidth }}>
        {/* Header Tanggal */}
        <div className="flex border-b border-border bg-muted/30 sticky top-0 z-30">
          <div style={{ width: labelWidth }} className="shrink-0 px-4 py-5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-end">
            Unit & Tipe
          </div>
          {days.map((d: Date) => (
            <div 
              key={d.toISOString()} 
              style={{ width: cellWidth }} 
              className={cn(
                "shrink-0 border-l border-border px-1 py-3 text-center transition-colors",
                isToday(d) ? "bg-primary/5" : ""
              )}
            >
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-tighter mb-1",
                isToday(d) ? "text-primary" : "text-muted-foreground/70"
              )}>
                {format(d, "EEEE", { locale: id })}
              </div>
              <div className={cn(
                "text-lg font-black leading-none",
                isToday(d) ? "text-primary" : "text-foreground"
              )}>
                {format(d, "dd")}
              </div>
              {isToday(d) && <div className="mt-1 mx-auto w-1 h-1 rounded-full bg-primary" />}
            </div>
          ))}
        </div>

        {/* Baris Per Tipe Kamar */}
        {roomTypes.map((type: any) => (
          <div key={type.id} className="group">
            <div className="flex bg-muted/40 border-b border-border px-4 py-2 text-[10px] font-extrabold text-foreground/60 uppercase tracking-widest">
              {type.name} <span className="mx-2 opacity-30">|</span> <span className="text-primary/80">{formatIDR(type.base_rate)}</span>
            </div>
            
            {rooms.filter((r: any) => r.room_type_id === type.id).map((room: any) => (
              <div key={room.id} className="relative flex border-b border-border h-[64px] hover:bg-muted/5 transition-colors">
                <div style={{ width: labelWidth }} className="flex shrink-0 items-center px-4 border-r border-border font-bold text-sm text-foreground/80">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    Unit {room.number}
                  </div>
                </div>

                {/* Grid Cells */}
                {days.map((d: Date) => (
                  <button 
                    key={d.toISOString()} 
                    onClick={() => onCellClick(room.id, d)} 
                    style={{ width: cellWidth }} 
                    className={cn(
                      "shrink-0 border-l border-border/50 hover:bg-primary/5 transition-colors focus:outline-none focus:bg-primary/5",
                      isToday(d) ? "bg-primary/[0.02]" : ""
                    )} 
                  />
                ))}

                {/* Booking Bars */}
                {(bookingsByRoom.get(room.id) ?? []).map((b: any) => {
                  const ci = parseISO(b.check_in);
                  const co = parseISO(b.check_out);
                  const startIdx = differenceInCalendarDays(ci, windowStart);
                  const endIdx = differenceInCalendarDays(co, windowStart);
                  
                  // Hitung posisi visual
                  if (endIdx < 0 || startIdx >= WINDOW_DAYS) return null;

                  const left = labelWidth + (Math.max(0, startIdx) * cellWidth);
                  const displayWidth = (Math.min(WINDOW_DAYS, endIdx) - Math.max(0, startIdx)) * cellWidth;

                  return (
                    <button
                      key={b.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBookingClick(b);
                      }}
                      className={cn(
                        "absolute top-2 bottom-2 flex items-center px-3 rounded-lg border text-[11px] font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-95 overflow-hidden z-10",
                        b.status === "confirmed" ? "bg-blue-50 border-blue-200 text-blue-700" : 
                        b.status === "checked_in" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                        "bg-amber-50 border-amber-200 text-amber-700"
                      )}
                      style={{ 
                        left: left + 4, 
                        width: displayWidth - 8,
                      }}
                    >
                      <span className="truncate uppercase tracking-tight">{b.guests?.full_name}</span>
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

// ... Sisanya (Dialog Create & Edit) tetap sama seperti sebelumnya