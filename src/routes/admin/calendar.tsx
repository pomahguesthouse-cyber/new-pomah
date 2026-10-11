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
  isWeekend,
  parseISO,
  startOfDay,
  startOfMonth,
  setMonth,
  setYear,
  getYear,
  getMonth,
} from "date-fns";
import { id } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, FileDown, Printer, Loader2, Ban, MoreHorizontal } from "lucide-react";
import {
  calendarGridMetrics,
  guessCalendarContentWidth,
  type CalendarGridMetrics,
} from "@/admin/lib/calendar-grid-layout";
import {
  buildCalendarFixture,
  calendarFixtureDialog,
  isCalendarFixtureRequest,
} from "@/admin/lib/calendar-fixture";

import {
  getCalendarData,
  createBookingFromAdmin,
  updateBookingFromAdmin,
} from "@/admin/functions/calendar.functions";
import { resendInvoice } from "@/admin/functions/bookings.functions";
import { toastBookingInvoice } from "@/admin/lib/invoice-toast";
import type { BookingInvoiceOutcome } from "@/services/invoice-dispatch";
import {
  downloadCsv,
  type ExportRow,
} from "@/admin/lib/booking-export";
import { downloadBookingListPdf } from "@/admin/lib/booking-list-pdf-client";
import { bookingListPdfMessage, formatDateId } from "@/admin/lib/booking-list-pdf-model";
import { NewBookingDialog } from "@/admin/components/new-booking-dialog";
import { BlockRoomDialog } from "@/admin/components/block-room-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Sheet/dialog shell: 90dvh, internal scroll, safe-area. The width class is kept for the invoice dispatch check. */
const calendarSheetClass =
  "safe-bottom-sheet flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px] max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl";

const calendarSheetFooterClass =
  "sticky bottom-0 z-10 shrink-0 gap-2 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,var(--safe-bottom))]";

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
    const entry = byId.get(b.id) ?? { ...b, _labels: [] as string[], _types: [] as string[], _numbers: [] as string[], _rates: [] as number[] };
    const room = roomById.get(b.room_id);
    const type = typeById.get(b.room_type_id ?? room?.room_type_id);
    const name = type?.name ?? "?";
    const number = room?.number ? String(room.number) : "—";
    entry._labels.push(number !== "—" ? `${name} (${number})` : name);
    entry._types.push(name);
    entry._numbers.push(number);
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
      room_types: b._types.join(", "),
      room_numbers: b._numbers.join(", "),
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

function useScrollportWidth() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(() =>
    typeof window === "undefined" ? 1280 : guessCalendarContentWidth(window.innerWidth),
  );
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setWidth(el.clientWidth);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function CalendarPage() {
  const [anchor, setAnchor] = React.useState<Date>(startOfDay(new Date()));
  const queryClient = useQueryClient();
  const fixture = isCalendarFixtureRequest();
  const scrollport = useScrollportWidth();
  const metrics = calendarGridMetrics(scrollport.width);

  const days = React.useMemo(
    () => Array.from({ length: WINDOW_DAYS + LEAD_DAYS }, (_, i) => addDays(anchor, i - LEAD_DAYS)),
    [anchor],
  );

  const from = fmtIso(days[0]);
  const to = fmtIso(days[days.length - 1]);

  const fetchCalendar = useServerFn(getCalendarData);
  const fixtureData = React.useMemo(() => (fixture ? buildCalendarFixture() : null), [fixture]);
  const { data: remote, isLoading } = useQuery({
    queryKey: ["admin-calendar", from, to],
    queryFn: () => fetchCalendar({ data: { from, to } }),
    enabled: !fixture,
  });
  const data = fixture ? fixtureData : remote;
  const loading = fixture ? false : isLoading;

  const [createCtx, setCreateCtx] = React.useState<any>(null);
  const [editCtx, setEditCtx] = React.useState<any>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState<null | "csv" | "pdf">(null);

  React.useEffect(() => {
    const dialog = calendarFixtureDialog();
    if (!dialog || !data) return;
    if (dialog === "new") setNewOpen(true);
    if (dialog === "block") setBlockOpen(true);
    if (dialog === "detail") {
      const booking = (data.bookings ?? []).find((b: any) => b.room_id) ?? data.bookings?.[0];
      if (booking) setEditCtx(booking);
    }
    if (dialog === "create") {
      const room = data.rooms?.[0];
      const rt = data.roomTypes?.find((t: any) => t.id === room?.room_type_id);
      if (room) {
        setCreateCtx({
          roomId: room.id,
          roomNumber: room.number,
          roomTypeName: rt?.name,
          baseRate: rt?.base_rate,
          date: startOfDay(new Date()),
        });
      }
    }
  }, [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });

  async function runExport(kind: "csv" | "pdf") {
    setExporting(kind);
    try {
      const rows = calendarRowsToExport(
        data?.bookings ?? [],
        data?.rooms ?? [],
        data?.roomTypes ?? [],
      );
      if (rows.length === 0) {
        toast.info("Tidak ada booking pada rentang tanggal ini.");
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        downloadCsv(rows, `calendar_${from}_${to}_${stamp}`);
        toast.success(`CSV diunduh — ${rows.length} booking.`);
      } else {
        const generatedAt = new Date();
        const result = await downloadBookingListPdf({
          rows,
          propertyName: "Pomah Guesthouse",
          filterSummary: `Kalender ${formatDateId(from)} s/d ${formatDateId(to)}`,
          generatedAt,
        });
        const message = bookingListPdfMessage(result, rows.length);
        if (message) toast.success(message);
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Export gagal.");
    } finally {
      setExporting(null);
    }
  }

  const jumpToDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const next = parseISO(value);
    if (Number.isNaN(next.getTime())) return;
    setAnchor(startOfDay(next));
  };

  return (
    <div className="admin-calendar-page flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <header
        data-calendar-toolbar
        className="relative z-40 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-card px-2 py-1.5 shadow-sm"
      >
        <h1 className="sr-only">Kalender booking</h1>
        <Button
          variant="default"
          size="sm"
          className="h-10 px-3 font-bold"
          onClick={() => setAnchor(startOfDay(new Date()))}
        >
          Hari ini
        </Button>

        <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label="7 hari sebelumnya"
            onClick={() => setAnchor(addDays(anchor, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label="7 hari berikutnya"
            onClick={() => setAnchor(addDays(anchor, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Select
          value={getMonth(anchor).toString()}
          onValueChange={(v) => setAnchor(startOfMonth(setMonth(anchor, parseInt(v))))}
        >
          <SelectTrigger className="h-10 w-[7.5rem] border-none bg-muted/50 font-bold sm:w-[8.5rem]" aria-label="Bulan">
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
          <SelectTrigger className="h-10 w-[5.25rem] border-none bg-muted/50 font-bold" aria-label="Tahun">
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
        <Input
          type="date"
          aria-label="Pilih tanggal"
          value={fmtIso(anchor)}
          onChange={(e) => jumpToDate(e.target.value)}
          className="h-10 w-[9.5rem] font-semibold"
        />

        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 min-[1100px]:flex">
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-2"
              disabled={exporting !== null}
              onClick={() => runExport("csv")}
            >
              {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-2"
              disabled={exporting !== null}
              onClick={() => runExport("pdf")}
            >
              {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Cetak / PDF
            </Button>
            <Button variant="outline" size="sm" className="h-10 gap-2" onClick={() => setBlockOpen(true)}>
              <Ban className="h-4 w-4" />
              Blokir Kamar
            </Button>
            <Button size="sm" className="h-10 gap-2" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" />
              Booking Baru
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 min-[1100px]:hidden"
                aria-label="Menu kalender"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="min-h-10" disabled={exporting !== null} onClick={() => runExport("csv")}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-10" disabled={exporting !== null} onClick={() => runExport("pdf")}>
                <Printer className="h-4 w-4" />
                Cetak / PDF
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-10" onClick={() => setBlockOpen(true)}>
                <Ban className="h-4 w-4" />
                Blokir Kamar
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-10" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" />
                Booking Baru
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        ref={scrollport.ref}
        data-calendar-scroll
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-card"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center font-bold text-muted-foreground animate-pulse">
            LOADING DATA...
          </div>
        ) : (
          <CalendarGrid
            days={days}
            metrics={metrics}
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

function CalendarGrid({
  days,
  metrics,
  rooms,
  roomTypes,
  bookings,
  blocks,
  onCellClick,
  onBookingClick,
}: {
  days: Date[];
  metrics: CalendarGridMetrics;
  rooms: any[];
  roomTypes: any[];
  bookings: any[];
  blocks: any[];
  onCellClick: (roomId: string, date: Date) => void;
  onBookingClick: (booking: any) => void;
}) {
  const { cellWidth, labelWidth, rowHeight } = metrics;
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
      const name = (b.guests?.full_name ?? "Tamu").trim();
      const code = (b.reference_code ?? "").trim();
      return (
        <button
          key={b.booking_room_id ?? b.id}
          type="button"
          data-booking-bar
          onClick={(e) => {
            e.stopPropagation();
            onBookingClick(b);
          }}
          className={cn(
            "absolute top-0.5 bottom-0.5 z-10 flex min-h-10 items-center overflow-hidden rounded-md border px-1.5 text-left text-[11px] font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            b.status === "confirmed"
              ? "bg-emerald-600 border-emerald-700 text-white"
              : b.status === "checked_in"
                ? "bg-emerald-800 border-emerald-900 text-white"
                : b.status === "pending"
                  ? "bg-amber-100 border-amber-300 text-amber-800"
                  : "bg-rose-100 border-rose-300 text-rose-700",
          )}
          style={{ left: left + 2, width: Math.max(width - 4, 40) }}
          title={code ? `${name} · ${code}` : name}
        >
          <span className="truncate">
            <span className="uppercase tracking-tight">{name}</span>
            {code ? <span className="ml-1 font-mono text-[10px] font-semibold normal-case tracking-normal opacity-90">{code}</span> : null}
          </span>
        </button>
      );
    });

  const gridWidth = labelWidth + days.length * cellWidth;

  return (
    <div style={{ width: gridWidth }} className="relative min-w-full select-none">
          <div data-calendar-header className="sticky top-0 z-30 flex border-b border-border bg-card shadow-sm">
            <div
              style={{ width: labelWidth }}
              className="sticky left-0 z-40 flex shrink-0 items-end border-r border-border bg-card px-2 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
            >
              Unit
            </div>

            {days.map((d: Date) => {
              const today = isToday(d);
              const weekend = isWeekend(d);
              return (
                <div
                  key={d.toISOString()}
                  data-day-header
                  data-today={today ? "true" : undefined}
                  style={{ width: cellWidth }}
                  className={cn(
                    "relative shrink-0 border-l border-border px-0.5 py-1.5 text-center",
                    today ? "bg-primary/15" : weekend ? "bg-rose-100" : "bg-card",
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
                      "mt-0.5 text-sm font-black leading-tight",
                      today ? "text-primary" : "text-foreground",
                    )}
                  >
                    {format(d, "dd")}
                  </div>
                  {today && (
                    <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-primary" aria-hidden />
                  )}
                </div>
              );
            })}
          </div>

          {/* Body Kalender */}
          {roomTypes.map((type: any) => (
            <div key={type.id} className="group">
              {/* Tipe Kamar - bar membentang seluruh grid, label sticky di kiri */}
              <div className="relative flex h-9 border-b border-border bg-muted">
                <div
                  style={{ width: labelWidth }}
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-muted px-2 text-[9px] font-black uppercase tracking-widest text-foreground/70 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
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
                    className={cn(
                      "shrink-0 border-l border-border/40",
                      isToday(d) ? "bg-primary/10" : isWeekend(d) ? "bg-rose-50/80" : "",
                    )}
                  />
                ))}

              </div>

              {rooms
                .filter((r: any) => r.room_type_id === type.id)
                .map((room: any) => (
                  <div
                    key={room.id}
                    data-room-row
                    className="relative flex border-b border-border"
                    style={{ height: rowHeight, minHeight: 40 }}
                  >
                    <div
                      data-room-label
                      style={{ width: labelWidth }}
                      className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-card px-2 text-sm font-semibold text-foreground/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                    >
                      <span className="truncate">{room.number}</span>
                    </div>

                    {days.map((d: Date) => (
                      <button
                        key={d.toISOString()}
                        type="button"
                        data-day-cell
                        aria-label={`${room.number} ${format(d, "d MMM", { locale: id })}`}
                        onClick={() => onCellClick(room.id, d)}
                        style={{ width: cellWidth }}
                        className={cn(
                          "h-full shrink-0 border-l border-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          isToday(d) ? "bg-primary/10" : isWeekend(d) ? "bg-rose-50" : "bg-card",
                        )}
                      />
                    ))}

                    {/* Bar Blokir (stop sell) — dirender di kolom tanggal,
                        sumber: room_daily_rates.stop_sell (sama dengan chatbot). */}
                    {(blockRangesByType.get(type.id) ?? []).map((r, i) => {
                      const left = labelWidth + r.startIdx * cellWidth;
                      const width = (r.endIdx - r.startIdx + 1) * cellWidth;
                      return (
                        <div
                          key={`block-${room.id}-${i}`}
                          title={r.note ?? "Diblokir (stop sell)"}
                          style={{ left: left + 2, width: Math.max(width - 4, 24) }}
                          className="pointer-events-none absolute top-0.5 bottom-0.5 z-[5] flex min-h-10 items-center gap-1 overflow-hidden rounded-md border border-rose-600/60 bg-rose-600/90 px-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
                        >
                          <Ban className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            Blokir{r.note ? ` · ${r.note}` : ""}
                          </span>
                        </div>
                      );
                    })}

                    {/* Bar Booking */}
                    {renderBars(bookingsByRoom.get(room.id) ?? [])}

                  </div>
                ))}

              {/* Bookings of this type without a room assigned yet */}
              {(unassignedByType.get(type.id) ?? []).length > 0 && (
                <div
                  className="relative flex border-b border-border bg-amber-50/50"
                  style={{ height: rowHeight, minHeight: 40 }}
                >
                  <div
                    style={{ width: labelWidth }}
                    className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-amber-50 px-2 text-[10px] font-black uppercase tracking-tight text-amber-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                  >
                    <span className="truncate">Belum ditugaskan</span>
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
              <div className="flex h-10 items-center border-y border-border bg-red-50 px-4 text-sm font-black uppercase tracking-tighter text-red-800">
                Tipe Kamar Tidak Diketahui
              </div>
              <div
                className="relative flex border-b border-border bg-red-50/50"
                style={{ height: rowHeight, minHeight: 40 }}
              >
                <div
                  style={{ width: labelWidth }}
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-red-50 px-2 text-[10px] font-black uppercase tracking-tight text-red-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                >
                  <span className="truncate">Perlu diperiksa</span>
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
  );
}

// Dialog-dialog (CreateBookingDialog, EditBookingDialog, Field) tetap sama seperti kode Bapak sebelumnya.
function CreateBookingDialog({ ctx, onClose, onSaved }: any) {
  const createFn = useServerFn(createBookingFromAdmin);
  const resendFn = useServerFn(resendInvoice);
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
      <DialogContent className={calendarSheetClass}>
        <DialogHeader className="shrink-0 space-y-1 px-4 pb-2 pr-10 pt-4">
          <DialogTitle className="break-words text-xl font-black uppercase tracking-tighter">
            New Booking {ctx?.roomNumber}
          </DialogTitle>
          <DialogDescription>
            {ctx?.roomTypeName ? `${ctx.roomTypeName} · kamar ${ctx.roomNumber}` : "Booking dari kalender"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-4 py-3">
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
            <NumericInput
              value={form.nightlyRate}
              onValueChange={(nightlyRate) => setForm({ ...form, nightlyRate })}
              className="font-bold"
            />
          </Field>
        </div>
        <DialogFooter className={calendarSheetFooterClass}>
          <Button variant="outline" className="h-10 w-full font-bold sm:w-auto" onClick={onClose} disabled={saving}>
            BATAL
          </Button>
          <Button
            className="h-10 w-full font-bold sm:w-auto"
            disabled={saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                const res = await createFn({
                  data: { ...form, roomId: ctx.roomId, status: "confirmed" },
                });
                toast.success("BOOKING BERHASIL!");
                toastBookingInvoice(
                  (res as { invoice?: BookingInvoiceOutcome }).invoice,
                  {
                    onResend: res.bookingId
                      ? async () => resendFn({ data: { bookingId: res.bookingId } })
                      : undefined,
                  },
                );
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
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (booking) {
      setStatus(booking.status ?? "");
      setRoomId(booking.room_id ?? "");
      setSaving(false);
    }
  }, [booking]);
  if (!booking) return null;
  const typeRooms = (rooms ?? []).filter((r: any) => r.room_type_id === booking.room_type_id);
  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className={calendarSheetClass}>
        <DialogHeader className="shrink-0 space-y-1 px-4 pb-2 pr-10 pt-4">
          <DialogTitle className="break-words text-xl font-black uppercase tracking-tighter">
            {booking.guests?.full_name ?? "Booking"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {booking.reference_code ? <span className="font-semibold text-foreground">{booking.reference_code}</span> : null}
            {booking.check_in && booking.check_out ? (
              <span>
                {booking.reference_code ? " · " : ""}
                {formatDateId(booking.check_in)} – {formatDateId(booking.check_out)}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-4 py-3">
          <Field label="Kamar">
            <Select
              value={roomId || "none"}
              onValueChange={(v) => setRoomId(v === "none" ? "" : v)}
              disabled={saving}
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
            {!booking.booking_room_id && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Booking ini belum punya baris kamar. Status tetap bisa disimpan jika kamar dibiarkan
                &quot;Belum ditugaskan&quot;. Untuk menetapkan kamar, gunakan halaman Bookings.
              </p>
            )}
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus} disabled={saving}>
              <SelectTrigger className="font-bold">
                <SelectValue placeholder="Pilih status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">PENDING</SelectItem>
                <SelectItem value="confirmed">CONFIRMED</SelectItem>
                <SelectItem value="checked_in">CHECKED-IN</SelectItem>
                <SelectItem value="checked_out">CHECKED-OUT</SelectItem>
                <SelectItem value="cancelled">CANCELLED</SelectItem>
                <SelectItem value="expired">EXPIRED</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter className={calendarSheetFooterClass}>
          <Button variant="outline" className="h-10 font-bold" onClick={onClose} disabled={saving}>
            TUTUP
          </Button>
          <Button
            className="h-10 font-bold"
            disabled={saving || !status}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await updateFn({
                  data: {
                    id: booking.id,
                    status,
                    // "" gagal validasi uuid. "Belum ditugaskan" harus null.
                    bookingRoomId: booking.booking_room_id || null,
                    roomId: roomId || null,
                  },
                });
                toast.success("UPDATE BERHASIL!");
                onSaved();
                onClose();
              } catch (e) {
                const message =
                  e instanceof Error && e.message.trim()
                    ? e.message
                    : "Gagal menyimpan booking. Cek console untuk detail.";
                console.error("[EditBookingDialog] gagal menyimpan booking:", e);
                toast.error(message, { duration: 8000 });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "MENYIMPAN..." : "SIMPAN"}
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
