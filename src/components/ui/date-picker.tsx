import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn, formatDateID } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ID_MONTHS = [
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
const ID_DOW = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** "YYYY-MM-DD" → Date (local midnight). Invalid → null. */
function parseIso(value?: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
/** Date → "YYYY-MM-DD" (local). */
function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Props = {
  /** Selected date as "YYYY-MM-DD". */
  value?: string | null;
  /** Called with the new "YYYY-MM-DD" string. */
  onChange: (iso: string) => void;
  /** Earliest selectable date, "YYYY-MM-DD". Dates before are disabled. */
  min?: string | null;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Date picker with an Indonesian dd/mm/yyyy trigger label and an
 * Indonesian month grid — a drop-in replacement for `<input type="date">`,
 * which renders in the browser's OS locale and cannot be reformatted.
 */
export function DatePickerID({
  value,
  onChange,
  min,
  placeholder = "Pilih tanggal",
  disabled,
  id,
  className,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => {
    if (onOpenChange) onOpenChange(o);
    if (!isControlled) setUncontrolledOpen(o);
  };

  const selected = parseIso(value);
  const minDate = parseIso(min ?? undefined);

  // Month currently shown in the grid
  const [viewMonth, setViewMonth] = React.useState<Date>(() => selected ?? new Date());
  React.useEffect(() => {
    if (open) setViewMonth(selected ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = new Date();

  // Build the 6x7 grid of dates for the current view month
  const weeks = React.useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startOffset = first.getDay(); // 0 = Sunday
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    const rows: Date[][] = [];
    for (let i = 0; i < 6; i++) rows.push(days.slice(i * 7, i * 7 + 7));
    return rows;
  }, [viewMonth]);

  function isDisabled(d: Date) {
    if (!minDate) return false;
    // disable strictly-before min
    return (
      d.getTime() < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()).getTime()
    );
  }

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          {value ? formatDateID(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 z-[9999]" align="start">
        {/* Month navigation */}
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label="Bulan sebelumnya"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">
            {ID_MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label="Bulan berikutnya"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-0.5">
          {ID_DOW.map((d) => (
            <div
              key={d}
              className="py-1 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {weeks.flat().map((d) => {
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const isSel = selected && sameDay(d, selected);
            const isToday = sameDay(d, today);
            const off = isDisabled(d);
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={off}
                onClick={() => {
                  onChange(toIso(d));
                  setOpen(false);
                }}
                className={cn(
                  "h-8 w-9 rounded-md text-xs tabular-nums transition-colors",
                  inMonth ? "text-foreground" : "text-muted-foreground/40",
                  !off && !isSel && "hover:bg-accent hover:text-accent-foreground",
                  isSel && "bg-primary font-semibold text-primary-foreground",
                  !isSel && isToday && "border border-primary/50 font-semibold",
                  off && "cursor-not-allowed opacity-30",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
