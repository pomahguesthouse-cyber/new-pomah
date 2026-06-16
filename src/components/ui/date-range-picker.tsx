import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * OTA-style range date picker (Traveloka / Booking-like).
 *
 * Trigger: two side-by-side "cards" showing the selected dates with
 * weekday + day month year, similar to the screenshot from common
 * Indonesian booking sites.
 *
 * Popover: two months shown side by side on desktop, single month on
 * mobile. Range selection: first click sets check-in, second click sets
 * check-out. In-between days get a light highlight, start/end darker.
 * A header "Pilih tanggal untuk melihat harga" + yellow summary bar
 * mirror the reference screenshot.
 */

const ID_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const ID_MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
const ID_DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const ID_DOW_FULL = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function parseIso(value?: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function isoAddDays(iso: string, days: number): string {
  const d = parseIso(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIso(d);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
/** Indonesian weekday for Monday-first calendar — Mon=0..Sun=6. */
function idDowIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}
function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

interface MonthGridProps {
  viewMonth:  Date;
  checkIn:    Date | null;
  checkOut:   Date | null;
  minDate:    Date;
  hover:      Date | null;
  onPick:     (d: Date) => void;
  onHover:    (d: Date | null) => void;
}

function MonthGrid({ viewMonth, checkIn, checkOut, minDate, hover, onPick, onHover }: MonthGridProps) {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startOffset = idDowIndex(first); // Mon-first
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  // Compute range bounds for in-between highlighting.
  // Once checkIn is set but checkOut isn't, hover acts as a tentative checkOut.
  const rangeStart = checkIn;
  const rangeEnd   = checkOut ?? (checkIn && hover && hover > checkIn ? hover : null);

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const inMonth = d.getMonth() === viewMonth.getMonth();
    const off = d < minDate;
    const isStart = !!rangeStart && sameDay(d, rangeStart);
    const isEnd   = !!rangeEnd   && sameDay(d, rangeEnd);
    const isMiddle =
      !!rangeStart && !!rangeEnd
      && d > rangeStart && d < rangeEnd
      && !isStart && !isEnd;

    if (i >= 35 && !inMonth) {
      // last row contains only trailing days → skip to keep grid compact
      cells.push(<div key={i} />);
      continue;
    }

    cells.push(
      <div key={i} className="relative flex flex-col items-center">
        {/* Tooltip label above selected dates */}
        {isStart && (
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
            <span className="text-[9px] font-semibold text-white bg-sky-500 px-1.5 py-0.5 rounded-[4px] whitespace-nowrap">
              Check-in
            </span>
            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-sky-500" />
          </div>
        )}
        {isEnd && (
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
            <span className="text-[9px] font-semibold text-white bg-orange-500 px-1.5 py-0.5 rounded-[4px] whitespace-nowrap">
              Check-out
            </span>
            <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-orange-500" />
          </div>
        )}
        <div className="relative w-full">
          {/* Range middle band — full-width strip behind the day button */}
          {isMiddle && (
            <div className="absolute inset-y-1 inset-x-0 bg-sky-100" aria-hidden />
          )}
          {/* Range start/end half-band so the rounded button blends with the strip */}
          {(isStart && rangeEnd) && (
            <div className="absolute inset-y-1 right-0 left-1/2 bg-sky-100" aria-hidden />
          )}
          {(isEnd && rangeStart) && (
            <div className="absolute inset-y-1 left-0 right-1/2 bg-sky-100" aria-hidden />
          )}
          <button
            type="button"
            disabled={off || !inMonth}
            onMouseEnter={() => inMonth && !off && onHover(d)}
            onMouseLeave={() => onHover(null)}
            onClick={() => inMonth && !off && onPick(d)}
            className={cn(
              "relative z-10 h-9 w-9 sm:h-10 sm:w-10 mx-auto block rounded-full text-sm tabular-nums transition-colors",
              !inMonth && "invisible",
              off && "cursor-not-allowed text-stone-300",
              !off && inMonth && !isStart && !isEnd && "text-stone-800 hover:bg-sky-50",
              (isStart || isEnd) && "bg-sky-600 text-white font-semibold shadow-sm",
              isMiddle && "text-sky-900 font-medium",
            )}
          >
            {d.getDate()}
          </button>
        </div>
      </div>,
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="text-center font-semibold text-stone-800 mb-3 text-sm">
        {ID_MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {ID_DOW.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-medium text-stone-500">
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}

// ─── Public component ──────────────────────────────────────────────────────

interface Props {
  checkIn:  string | null;
  checkOut: string | null;
  onChange: (range: { checkIn: string; checkOut: string }) => void;
  /** Earliest selectable date, "YYYY-MM-DD". Defaults to today. */
  min?:     string;
  /** Trigger label override. */
  className?: string;
  /** Override the trigger button styling — caller renders their own. */
  trigger?: React.ReactNode;
}

export function DateRangePickerID({ checkIn, checkOut, onChange, min, className, trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const checkInDate  = parseIso(checkIn);
  const checkOutDate = parseIso(checkOut);
  const minDate = startOfDay(parseIso(min ?? null) ?? new Date());

  const [viewMonth, setViewMonth] = React.useState<Date>(() =>
    checkInDate ? new Date(checkInDate.getFullYear(), checkInDate.getMonth(), 1) : new Date(minDate.getFullYear(), minDate.getMonth(), 1),
  );
  const [hover, setHover] = React.useState<Date | null>(null);
  // Pending range while user is picking. Once both ends are set, we commit.
  const [pendingIn,  setPendingIn]  = React.useState<Date | null>(checkInDate);
  const [pendingOut, setPendingOut] = React.useState<Date | null>(checkOutDate);

  React.useEffect(() => {
    if (open) {
      setPendingIn(checkInDate);
      setPendingOut(checkOutDate);
      setViewMonth(checkInDate
        ? new Date(checkInDate.getFullYear(), checkInDate.getMonth(), 1)
        : new Date(minDate.getFullYear(), minDate.getMonth(), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handlePick(d: Date) {
    if (!pendingIn || (pendingIn && pendingOut)) {
      // Fresh start
      setPendingIn(d);
      setPendingOut(null);
      return;
    }
    if (d <= pendingIn) {
      // Picked before/equal current check-in → restart with this as check-in
      setPendingIn(d);
      setPendingOut(null);
      return;
    }
    // Second pick → commit
    setPendingOut(d);
    onChange({ checkIn: toIso(pendingIn), checkOut: toIso(d) });
    setOpen(false);
  }

  const nights = pendingIn && pendingOut ? diffDays(pendingIn, pendingOut) : 0;

  // Visible second month — desktop only.
  const nextMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            className={cn("w-full justify-start gap-2 font-normal h-12", className)}
          >
            <CalendarDays className="h-4 w-4 shrink-0 opacity-70" />
            {checkInDate && checkOutDate ? (
              <span className="text-sm">
                {checkInDate.getDate()} {ID_MONTHS_SHORT[checkInDate.getMonth()]} – {checkOutDate.getDate()} {ID_MONTHS_SHORT[checkOutDate.getMonth()]} {checkOutDate.getFullYear()}
              </span>
            ) : (
              <span className="opacity-90 text-sm">Pilih tanggal menginap</span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-[95vw] sm:w-auto p-0 z-[9999] overflow-hidden"
        align="start"
        sideOffset={6}
      >
        <div className="p-4 sm:p-5 sm:pb-4 max-w-[680px]">
          <div className="text-base sm:text-lg font-semibold text-stone-800 mb-3">
            Pilih tanggal untuk melihat harga
          </div>
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs sm:text-sm text-amber-900 mb-4">
            {pendingIn && pendingOut ? (
              <>
                {ID_DOW[idDowIndex(pendingIn)]}, {pendingIn.getDate()} {ID_MONTHS_SHORT[pendingIn.getMonth()]} {pendingIn.getFullYear()}
                {" – "}
                {ID_DOW[idDowIndex(pendingOut)]}, {pendingOut.getDate()} {ID_MONTHS_SHORT[pendingOut.getMonth()]} {pendingOut.getFullYear()}
                {" "}({nights} malam)
              </>
            ) : pendingIn ? (
              <>Pilih tanggal check-out. Check-in: {ID_DOW[idDowIndex(pendingIn)]}, {pendingIn.getDate()} {ID_MONTHS_SHORT[pendingIn.getMonth()]} {pendingIn.getFullYear()}.</>
            ) : (
              <>Klik tanggal pertama untuk check-in, lalu tanggal kedua untuk check-out.</>
            )}
          </div>
          <div className="flex items-center justify-between mb-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="h-5 w-5 text-sky-600" />
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="h-5 w-5 text-sky-600" />
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            <MonthGrid
              viewMonth={viewMonth}
              checkIn={pendingIn}
              checkOut={pendingOut}
              minDate={minDate}
              hover={hover}
              onPick={handlePick}
              onHover={setHover}
            />
            <div className="hidden sm:block">
              <MonthGrid
                viewMonth={nextMonth}
                checkIn={pendingIn}
                checkOut={pendingOut}
                minDate={minDate}
                hover={hover}
                onPick={handlePick}
                onHover={setHover}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Trigger sub-component (the two-card pill style from the screenshot) ────

/**
 * Renders the two-card check-in / check-out pill that mirrors the
 * screenshot. Drop into a flex row, side-by-side with a "tamu" card.
 */
interface PillTriggerProps {
  checkIn:  string | null;
  checkOut: string | null;
  onClick?: () => void;
}

export const DateRangeTriggerCards = React.forwardRef<HTMLButtonElement, PillTriggerProps>(
  function DateRangeTriggerCards({ checkIn, checkOut, onClick, ...rest }, ref) {
    const inD  = parseIso(checkIn);
    const outD = parseIso(checkOut);
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        {...rest}
        className="flex items-stretch divide-x divide-stone-200 rounded-xl bg-white border border-stone-200 shadow-sm overflow-hidden hover:border-sky-400 transition w-full"
      >
        <Card label="Check-in" date={inD} placeholderTop="Tanggal" placeholderBottom="check-in" />
        <Card label="Check-out" date={outD} placeholderTop="Tanggal" placeholderBottom="check-out" />
      </button>
    );
  },
);

function Card({ date, placeholderTop, placeholderBottom }: { label: string; date: Date | null; placeholderTop: string; placeholderBottom: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 flex-1 text-left">
      <CalendarDays className="h-5 w-5 text-stone-400 shrink-0" />
      <div className="min-w-0">
        {date ? (
          <>
            <div className="text-base font-bold text-stone-800 leading-tight tabular-nums">
              {date.getDate()} {ID_MONTHS_SHORT[date.getMonth()]} {date.getFullYear()}
            </div>
            <div className="text-xs text-stone-500 leading-tight">{ID_DOW_FULL[idDowIndex(date)]}</div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-stone-600 leading-tight">{placeholderTop}</div>
            <div className="text-xs text-stone-500 leading-tight">{placeholderBottom}</div>
          </>
        )}
      </div>
    </div>
  );
}

// Re-export the helper so callers can compute defaults consistently.
export { isoAddDays as addDaysIso };
