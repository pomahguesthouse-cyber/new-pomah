/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isToday,
  isSunday,
  parseISO,
  startOfDay,
  startOfMonth,
  setMonth,
  setYear,
  getYear,
  getMonth,
} from "date-fns";
import { id } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, FileDown, Printer, Loader2, Ban } from "lucide-react";

import {
  getCalendarData,
  createBookingFromAdmin,
  updateBookingFromAdmin,
} from "@/admin/functions/calendar.functions";
import {
  downloadCsv,
  openPrintView,
  openBlankPrintWindow,
  type ExportRow,
} from "@/admin/lib/booking-export";
import { NewBookingDialog } from "@/admin/components/new-booking-dialog";
import { BlockRoomDialog } from "@/admin/components/block-room-dialog";
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

const WINDOW_DAYS = 30;
/** Extra day(s) shown before the anchor, at the far left of the grid. */
const LEAD_DAYS = 1;
const MONTHS = [
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
const YEARS = Array.from({ length: 5 }, (_, i) => getYear(new Date()) - 1 + i);

const formatIDR = (amount: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(amount)
    .replace("IDR", "Rp.");
};

function fmtIso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function nightsBetween(checkIn?: string | null, checkOut?: string | null) {
  if (!checkIn || !checkOut) return 0;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * The calendar loads bookings flattened one-entry-per-room. Collapse them back
 * to one export row per booking, building room labels from the room/type lookups.
 */
function calendarRowsToExport(bookings: any[], rooms: any[], roomTypes: any[]): ExportRow[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const typeById = new Map(roomTypes.map((t) => [t.id, t]));
  const byId = new Map<string, any>();
  for (const b of bookings) {
    const entry = byId.get(b.id) ?? { ...b, _labels: [] as string[], _rates: [] as number[] };
    const room = roomById.get(b.room_id);
    const type = typeById.get(b.room_type_id ?? room?.room_type_id);
    const name = type?.name ?? "?";
    entry._labels.push(room?.number ? `${name} (${room.number})` : name);
    entry._rates.push(Number(b.nightly_rate ?? 0));
    byId.set(b.id, entry);
  }
  return [...byId.values()].map((b) => {
    const total = Number(b.total_amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);
    return {
      reference_code: b.reference_code ?? "",
      guest_name: b.guests?.full_name ?? "",
      guest_email: b.guests?.email ?? "",
      guest_phone: b.guests?.phone ?? "",
      check_in: b.check_in ?? "",
      check_out: b.check_out ?? "",
      nights: nightsBetween(b.check_in, b.check_out),
      rooms: b._labels.join("; "),
      room_count: b._labels.length,
      adults: Number(b.adults ?? 0),
      children: Number(b.children ?? 0),
      status: b.status ?? "",
      source: b.source ?? "",
      payment_status: b.payment_status ?? "",
      total_amount: total,
      paid_amount: paid,
      outstanding: Math.max(0, total - paid),
      nightly_rate_min: b._rates.length ? Math.min(...b._rates) : 0,
      nightly_rate_max: b._rates.length ? Math.max(...b._rates) : 0,
      created_at: b.created_at ?? "",
    } as ExportRow;
  });
}

function CalendarPage() {
  const [anchor, setAnchor] = React.useState<Date>(startOfDay(new Date()));
  const queryClient = useQueryClient();

  const days = React.useMemo(
    () => Array.from({ length: WINDOW_DAYS + LEAD_DAYS }, (_, i) => addDays(anchor, i - LEAD_DAYS)),
    [anchor],
  );

  const from = fmtIso(days[0]);
  const to = fmtIso(days[days.length - 1]);

  const fetchCalendar = useServerFn(getCalendarData);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-calendar", from, to],
    queryFn: () => fetchCalendar({ data: { from, to } }),
  });

  const [createCtx, setCreateCtx] = React.useState<any>(null);
  const [editCtx, setEditCtx] = React.useState<any>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState<null | "csv" | "pdf">(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });

  async function runExport(kind: "csv" | "pdf") {
    let printWindow: Window | null = null;
    if (kind === "pdf") {
      printWindow = openBlankPrintWindow();
      if (!printWindow) {
        toast.error("Tidak bisa membuka tab cetak. Izinkan popup lalu coba lagi.");
        return;
      }
    }
    setExporting(kind);
    try {
      const rows = calendarRowsToExport(
        data?.bookings ?? [],
        data?.rooms ?? [],
        data?.roomTypes ?? [],
      );
      if (rows.length === 0) {
        toast.info("Tidak ada booking pada rentang tanggal ini.");
        printWindow?.close();
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        downloadCsv(rows, `calendar_${from}_${to}_${stamp}`);
        toast.success(`CSV diunduh — ${rows.length} booking.`);
      } else {
        openPrintView(rows, { filterSummary: `Kalender ${from} → ${to}`, targetWindow: printWindow });
        toast.success("Dialog cetak terbuka — pilih Save as PDF.");
      }
    } catch (e) {
      printWindow?.close();
      toast.error((e as Error).message ?? "Export gagal.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background w-full overflow-hidden">
      {/* Header Utama - Z-Index 40 agar di bawah Sidebar (biasanya z-50) tapi di atas Kalender */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-3 shadow-sm z-40 relative">
        <div className="flex flex-wrap items-center gap-4">
          <div className="mr-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Reservations
            </p>
            <h1 className="text-xl font-semibold uppercase tracking-tight text-foreground">
              Calendar
            </h1>
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
                {MONTHS.map((name, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {name}
                  </SelectItem>
                ))}
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
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1 border">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-background"
              onClick={() => setAnchor(addDays(anchor, -7))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-background"
              onClick={() => setAnchor(addDays(anchor, 7))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            disabled={exporting !== null}
            onClick={() => runExport("csv")}
          >
            {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            disabled={exporting !== null}
            onClick={() => runExport("pdf")}
          >
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Cetak / PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            onClick={() => setBlockOpen(true)}
          >
            <Ban className="h-4 w-4" />
            Blokir Kamar
          </Button>
          <Button size="sm" className="h-9 gap-2" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
            Booking Baru
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
            blocks={data?.blocks ?? []}
            onCellClick={(roomId: string, date: Date) => {
              const room = data?.rooms.find((r: any) => r.id === roomId);
              const rt = data?.roomTypes.find((t: any) => t.id === room?.room_type_id);
              setCreateCtx({
                roomId,
                roomNumber: room?.number,
                roomTypeName: rt?.name,
                baseRate: rt?.base_rate,
                date,
              });
            }}
            onBookingClick={(b: any) => setEditCtx(b)}
          />
        )}
      </div>

      <CreateBookingDialog
        ctx={createCtx}
        onClose={() => setCreateCtx(null)}
        onSaved={invalidate}
      />
      <EditBookingDialog
        booking={editCtx}
        rooms={data?.rooms ?? []}
        onClose={() => setEditCtx(null)}
        onSaved={invalidate}
      />
      <NewBookingDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <BlockRoomDialog
        open={blockOpen}
        roomTypes={(data?.roomTypes ?? []) as Array<{ id: string; name: string }>}
        defaultDate={from}
        onClose={() => setBlockOpen(false)}
        onSaved={invalidate}
      />
    </div>
  );
}

function CalendarGrid({ days, rooms, roomTypes, bookings, blocks, onCellClick, onBookingClick }: any) {
  const cellWidth = 72;
  const labelWidth = 160;
  const windowStart = days[0];

  // Gabungkan tanggal stop_sell per tipe kamar menjadi rentang kontigu
  // agar bisa dirender sebagai satu bar "Blokir" per periode.
  const blockRangesByType = React.useMemo(() => {
    const byType = new Map<string, Array<{ date: string; note: string | null }>>();
    for (const b of blocks ?? []) {
      if (!byType.has(b.room_type_id)) byType.set(b.room_type_id, []);
      byType.get(b.room_type_id)!.push({ date: b.date, note: b.note });
    }
    const rangesByType = new Map<string, Array<{ startIdx: number; endIdx: number; note: string | null }>>();
    for (const [typeId, entries] of byType) {
      entries.sort((a, b) => (a.date < b.date ? -1 : 1));
      const ranges: Array<{ startIdx: number; endIdx: number; note: string | null }> = [];
      let curStart: string | null = null;
      let curEnd: string | null = null;
      let curNote: string | null = null;
      const flush = () => {
        if (curStart == null) return;
        const sIdx = differenceInCalendarDays(parseISO(curStart), windowStart);
        const eIdx = differenceInCalendarDays(parseISO(curEnd!), windowStart);
        // Hanya simpan rentang yang overlap dengan jendela tampilan.
        if (eIdx >= 0 && sIdx < days.length) {
          ranges.push({
            startIdx: Math.max(sIdx, 0),
            endIdx: Math.min(eIdx, days.length - 1),
            note: curNote,
          });
        }
      };
      for (const e of entries) {
        if (curEnd == null) {
          curStart = e.date;
          curEnd = e.date;
          curNote = e.note;
        } else {
          const expected = format(addDays(parseISO(curEnd), 1), "yyyy-MM-dd");
          if (e.date === expected) {
            curEnd = e.date;
            if (!curNote && e.note) curNote = e.note;
          } else {
            flush();
            curStart = e.date;
            curEnd = e.date;
            curNote = e.note;
          }
        }
      }
      flush();
      rangesByType.set(typeId, ranges);
    }
    return rangesByType;
  }, [blocks, windowStart, days.length]);

  const bookingsByRoom = React.useMemo(() => {
    const m = new Map();
    bookings.forEach((b: any) => {
      if (!b.room_id) return;
      if (!m.has(b.room_id)) m.set(b.room_id, []);
      m.get(b.room_id).push(b);
    });
    return m;
  }, [bookings]);

  // Bookings without a room yet (e.g. from the website or AI chatbot),
  // grouped by room type so staff can see and assign them.
  const unassignedByType = React.useMemo(() => {
    const m = new Map();
    bookings.forEach((b: any) => {
      if (b.room_id) return;
      if (!m.has(b.room_type_id)) m.set(b.room_type_id, []);
      m.get(b.room_type_id).push(b);
    });
    return m;
  }, [bookings]);

  /** Render the absolutely-positioned booking bars for one row. */
  const renderBars = (list: any[]) =>
    list.map((b: any) => {
      const ci = parseISO(b.check_in);
      const co = parseISO(b.check_out);
      const startIdx = differenceInCalendarDays(ci, windowStart);
      const endIdx = differenceInCalendarDays(co, windowStart);
      if (endIdx < 0 || startIdx >= days.length) return null;
      const left = labelWidth + startIdx * cellWidth + cellWidth / 2;
      const width = (endIdx - startIdx) * cellWidth;
      return (
        <button
          key={b.booking_room_id ?? b.id}
          onClick={(e) => {
            e.stopPropagation();
            onBookingClick(b);
          }}
          className={cn(
            "absolute top-2.5 bottom-2.5 flex items-center px-3 rounded-lg border text-[10px] font-black shadow-md transition-all hover:scale-[1.01] overflow-hidden z-10",
            b.status === "confirmed"
              ? "bg-emerald-600 border-emerald-700 text-white"
              : b.status === "checked_in"
                ? "bg-emerald-800 border-emerald-900 text-white"
                : b.status === "pending"
                  ? "bg-amber-100 border-amber-300 text-amber-800"
                  : "bg-rose-100 border-rose-300 text-rose-700",
          )}
          style={{ left: left + 2, width: Math.max(width - 4, 40) }}
        >
          <span className="truncate uppercase tracking-tighter">{b.guests?.full_name}</span>
        </button>
      );
    });

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
                    isSunday(d) ? "bg-rose-100" : today ? "bg-primary/5" : "",
                  )}
                >
                  <div
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-tight",
                      today ? "text-primary" : "text-muted-foreground/70",
                    )}
                  >
                    {format(d, "EEE", { locale: id })}
                  </div>
                  <div
                    className={cn(
                      "text-base font-black leading-tight mt-0.5",
                      today ? "text-primary" : "text-foreground",
                    )}
                  >
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
                    {type.name} <span className="mx-2 opacity-30">|</span>{" "}
                    {formatIDR(type.base_rate)}
                  </span>
                </div>

                {/* Sel tanggal kosong pada baris tipe agar lebar baris sama
                    dengan grid tanggal (bar blokir dirender di baris kamar). */}
                {days.map((d: Date) => (
                  <div
                    key={d.toISOString()}
                    style={{ width: cellWidth }}
                    className="shrink-0 border-l border-border/40"
                  />
                ))}

              </div>

              {rooms
                .filter((r: any) => r.room_type_id === type.id)
                .map((room: any) => (
                  <div
                    key={room.id}
                    className="relative flex border-b border-border h-[60px] hover:bg-muted/5 transition-colors"
                  >
                    {/* Nomor Kamar - STICKY HORIZONTAL (left-0) */}
                    {/* Z-Index 20 agar bar booking terpotong di bawahnya saat scroll horizontal */}
                    <div
                      style={{ width: labelWidth }}
                      className="flex shrink-0 items-center px-4 border-r border-border font-bold text-xs text-foreground/70 sticky left-0 z-20 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                    >
                      {room.number}
                    </div>

                    {/* Day Cells */}
                    {days.map((d: Date) => (
                      <button
                        key={d.toISOString()}
                        onClick={() => onCellClick(room.id, d)}
                        style={{ width: cellWidth }}
                        className={cn(
                          "shrink-0 border-l border-border/50 transition-colors focus:outline-none",
                          isSunday(d) ? "bg-rose-50" : isToday(d) ? "bg-primary/[0.02]" : "",
                        )}
                      />
                    ))}

                    {/* Bar Booking */}
                    {renderBars(bookingsByRoom.get(room.id) ?? [])}
                  </div>
                ))}

              {/* Bookings of this type without a room assigned yet */}
              {(unassignedByType.get(type.id) ?? []).length > 0 && (
                <div className="relative flex border-b border-border h-[60px] bg-amber-50/50">
                  <div
                    style={{ width: labelWidth }}
                    className="flex shrink-0 items-center gap-1.5 px-4 border-r border-border text-[10px] font-black uppercase tracking-tight text-amber-700 sticky left-0 z-20 bg-amber-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                  >
                    Belum ditugaskan
                  </div>
                  {days.map((d: Date) => (
                    <div
                      key={d.toISOString()}
                      style={{ width: cellWidth }}
                      className="shrink-0 border-l border-border/50"
                    />
                  ))}
                  {renderBars(unassignedByType.get(type.id) ?? [])}
                </div>
              )}
            </div>
          ))}

          {/* Bookings with unknown or missing room type */}
          {(unassignedByType.get(undefined) || unassignedByType.get(null) || []).length > 0 && (
            <div className="mb-8">
              <div className="sticky top-0 z-30 flex h-10 items-center border-y border-border bg-red-50 text-red-800 px-4 font-black text-sm tracking-tighter uppercase shadow-sm">
                Tipe Kamar Tidak Diketahui
              </div>
              <div className="relative flex border-b border-border h-[60px] bg-red-50/50">
                <div
                  style={{ width: labelWidth }}
                  className="flex shrink-0 items-center gap-1.5 px-4 border-r border-border text-[10px] font-black uppercase tracking-tight text-red-700 sticky left-0 z-20 bg-red-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                >
                  Perlu Diperiksa
                </div>
                {days.map((d: Date) => (
                  <div
                    key={d.toISOString()}
                    style={{ width: cellWidth }}
                    className="shrink-0 border-l border-border/50"
                  />
                ))}
                {renderBars([
                  ...(unassignedByType.get(undefined) || []),
                  ...(unassignedByType.get(null) || []),
                ])}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Dialog-dialog (CreateBookingDialog, EditBookingDialog, Field) tetap sama seperti kode Bapak sebelumnya.
function CreateBookingDialog({ ctx, onClose, onSaved }: any) {
  const createFn = useServerFn(createBookingFromAdmin);
  const [form, setForm] = React.useState({
    guestName: "",
    checkIn: "",
    checkOut: "",
    nightlyRate: 0,
  });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (ctx)
      setForm({
        ...form,
        checkIn: fmtIso(ctx.date),
        checkOut: fmtIso(addDays(ctx.date, 1)),
        nightlyRate: ctx.baseRate,
      });
  }, [ctx]);
  return (
    <Dialog open={!!ctx} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-black text-xl tracking-tighter uppercase">
            New Booking {ctx?.roomNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Nama Tamu">
            <Input
              value={form.guestName}
              onChange={(e) => setForm({ ...form, guestName: e.target.value })}
              placeholder="NAMA..."
              className="font-bold"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-In">
              <Input
                type="date"
                value={form.checkIn}
                onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                className="font-bold"
              />
            </Field>
            <Field label="Check-Out">
              <Input
                type="date"
                value={form.checkOut}
                onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                className="font-bold"
              />
            </Field>
          </div>
          <Field label="Harga/Malam">
            <Input
              type="number"
              value={form.nightlyRate}
              onChange={(e) => setForm({ ...form, nightlyRate: Number(e.target.value) })}
              className="font-bold"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="font-bold" onClick={onClose} disabled={saving}>
            BATAL
          </Button>
          <Button
            className="font-bold"
            disabled={saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await createFn({
                  data: { ...form, roomId: ctx.roomId, status: "confirmed" },
                });
                toast.success("BOOKING BERHASIL!");
                onSaved();
                onClose();
              } catch (e) {
                // Dulu: `toast.error("Gagal menyimpan booking.")` — pesan asli
                // dari server (mis. "Kamar sudah terpakai pada 7 Agu sampai
                // 8 Agu") ikut terbuang, sehingga admin tidak tahu apa yang
                // harus diperbaiki dan masalahnya mustahil didiagnosis.
                const message =
                  e instanceof Error && e.message.trim()
                    ? e.message
                    : "Gagal menyimpan booking. Cek console untuk detail.";
                console.error("[CreateBookingDialog] gagal menyimpan booking:", e);
                toast.error(message, { duration: 8000 });
              } finally {
                setSaving(false);
              }
            }}
          >
            SIMPAN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBookingDialog({ booking, rooms, onClose, onSaved }: any) {
  const updateFn = useServerFn(updateBookingFromAdmin);
  const [status, setStatus] = React.useState("");
  const [roomId, setRoomId] = React.useState("");
  React.useEffect(() => {
    if (booking) {
      setStatus(booking.status);
      setRoomId(booking.room_id ?? "");
    }
  }, [booking]);
  if (!booking) return null;
  const typeRooms = (rooms ?? []).filter((r: any) => r.room_type_id === booking.room_type_id);
  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-black text-xl tracking-tighter uppercase">
            Update: {booking.guests?.full_name}
          </DialogTitle>
          {booking.reference_code && (
            <p className="font-mono text-xs font-semibold text-muted-foreground tracking-wider">
              Ref: <span className="text-foreground">{booking.reference_code}</span>
            </p>
          )}
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Field label="Kamar">
            <Select
              value={roomId || "none"}
              onValueChange={(v) => setRoomId(v === "none" ? "" : v)}
            >
              <SelectTrigger className="font-bold">
                <SelectValue placeholder="Pilih kamar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">BELUM DITUGASKAN</SelectItem>
                {typeRooms.map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="font-bold">
                <SelectValue />
              </SelectTrigger>
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
          <Button variant="outline" className="font-bold" onClick={onClose}>
            TUTUP
          </Button>
          <Button
            className="font-bold"
            onClick={async () => {
              await updateFn({
                data: {
                  id: booking.id,
                  status,
                  bookingRoomId: booking.booking_room_id,
                  roomId,
                },
              });
              toast.success("UPDATE BERHASIL!");
              onSaved();
            }}
          >
            SIMPAN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-black text-muted-foreground/80 tracking-widest uppercase">
        {label}
      </Label>
      {children}
    </div>
  );
}
