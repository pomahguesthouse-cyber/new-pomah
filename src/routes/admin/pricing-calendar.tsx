/**
 * Admin · Pricing Calendar (/admin/pricing-calendar)
 *
 * Per-room-type month grid. Each day cell shows the resolved nightly
 * rate (compact "Rp 350rb"), highlights override days, and lets the
 * admin drag-select a range of days to bulk-edit via a dialog.
 *
 * Workflow:
 *   1. Pick a room type from the pills row at the top.
 *   2. Navigate months (prev / next / today) — the grid invalidates and
 *      refetches.
 *   3. Click a day or drag across days to select. Release the mouse to
 *      open the editor.
 *   4. Editor: set rate / extrabed_rate / stop_sell / note, or "Reset
 *      ke base price" to delete the override(s).
 *
 * Drag-select is mouse-only for now — touch fallback is single-tap to
 * edit one day at a time.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  upsertDailyRates,
  deleteDailyRates,
} from "@/admin/modules/pricing-calendar/pricing-calendar.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDateID, todayWIB, nextDay } from "@/lib/date";

export const Route = createFileRoute("/admin/pricing-calendar")({
  component: PricingCalendarPage,
});

// ─── Date helpers (calendar grid math) ─────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(year: number, monthIdx0: number, day: number): string {
  return `${year}-${pad2(monthIdx0 + 1)}-${pad2(day)}`;
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}

function daysInMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}

/** Weekday index for the 1st of the month, 0=Sun … 6=Sat. */
function firstWeekday(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0, 1)).getUTCDay();
}

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli",    "Agustus",  "September", "Oktober", "November", "Desember",
] as const;
const WEEKDAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] as const;

/** Format a number as a compact rupiah label: "Rp 350rb" / "Rp 1.2jt". */
function compactRp(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "Rp 0";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const trimmed = Math.round(v * 10) / 10;
    return `Rp ${Number.isInteger(trimmed) ? trimmed.toFixed(0) : trimmed.toFixed(1)}jt`;
  }
  if (n >= 1_000) {
    return `Rp ${Math.round(n / 1_000)}rb`;
  }
  return `Rp ${n}`;
}

/** Inclusive range expansion of two YYYY-MM-DD strings (in any order). */
function expandRange(a: string, b: string): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  let cur = lo;
  while (cur <= hi) {
    out.push(cur);
    cur = nextDay(cur);
  }
  return out;
}

// ─── Editor state ───────────────────────────────────────────────────────────

interface EditorState {
  open:   boolean;
  dates:  string[];        // sorted YYYY-MM-DD
}

interface EditorFormFields {
  rate:          string;   // string input → parsed on submit
  extrabedRate:  string;
  stopSell:      boolean;
  note:          string;
  // Track whether the form is bound to existing overrides for the
  // editor's "mode" label and the disabled state of Reset.
  anyExistingOverride: boolean;
}

// ─── Page component ─────────────────────────────────────────────────────────

function PricingCalendarPage() {
  const qc = useQueryClient();

  // ── Room types (read directly from Supabase, bypass server fn) ──
  // The server function detour adds ~200–600ms of TanStack Start RPC +
  // auth-middleware overhead per call, which dominated perceived load
  // on this page. Reads here are guarded by RLS (anon SELECT allowed
  // on room_types) so going direct is safe; writes still go through
  // server fns for staff-auth enforcement.
  const roomQ = useQuery({
    queryKey: ["pricing-calendar", "room-types"],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("room_types")
        .select("id, name, base_rate, extrabed_rate")
        .order("name");
      if (error) throw error;
      return { roomTypes: (data ?? []) as Array<{
        id:            string;
        name:          string;
        base_rate:     number | null;
        extrabed_rate: number | null;
      }> };
    },
    staleTime: 5 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
  });
  const roomTypes = roomQ.data?.roomTypes ?? [];

  // Hydrate `selectedRoomId` from localStorage synchronously so the
  // month query fires on the FIRST render instead of waiting for the
  // room-types query to land. Eliminates the waterfall on subsequent
  // visits — first visit still pays one roundtrip.
  const LS_KEY = "pricing-calendar:selectedRoomId";
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(LS_KEY); } catch { return null; }
  });
  // Auto-pick the first room type once the list lands if none stored.
  useEffect(() => {
    if (selectedRoomId == null && roomTypes.length > 0) {
      setSelectedRoomId(roomTypes[0].id);
    }
  }, [roomTypes, selectedRoomId]);
  // Persist whenever it changes.
  useEffect(() => {
    if (selectedRoomId == null) return;
    try { window.localStorage.setItem(LS_KEY, selectedRoomId); } catch { /* ignore */ }
  }, [selectedRoomId]);

  const selectedRoom = roomTypes.find((r) => r.id === selectedRoomId) ?? null;

  // ── Month nav ──
  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const t = parseYmd(todayWIB());
    return { year: t.y, month: t.m };
  });
  const monthStart = ymd(cursor.year, cursor.month, 1);
  const monthEnd   = ymd(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));

  // ── Overrides for the visible month ──
  // Read overrides directly via the browser Supabase client too — same
  // reasoning as room types: anon SELECT is allowed by RLS, and direct
  // queries skip the server-fn / auth-middleware roundtrip.
  const monthQ = useQuery({
    queryKey: ["pricing-calendar", "month", selectedRoomId, monthStart, monthEnd],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("room_daily_rates")
        .select("date, rate, extrabed_rate, min_stay, stop_sell, note")
        .eq("room_type_id", selectedRoomId!)
        .gte("date", monthStart)
        .lte("date", monthEnd);
      if (error) throw error;
      return { overrides: (data ?? []) as Array<{
        date:          string;
        rate:          number;
        extrabed_rate: number | null;
        min_stay:      number;
        stop_sell:     boolean;
        note:          string | null;
      }> };
    },
    enabled: !!selectedRoomId,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  // Realtime invalidation: any write to room_daily_rates from elsewhere
  // (LLM tools, other admin tabs) refreshes the grid.
  useRealtimeInvalidate(
    "admin-pricing-calendar-stream",
    ["room_daily_rates"],
    [["pricing-calendar"]],
  );

  const overridesByDate = useMemo(() => {
    const m = new Map<string, NonNullable<typeof monthQ.data>["overrides"][number]>();
    for (const ov of monthQ.data?.overrides ?? []) m.set(ov.date, ov);
    return m;
  }, [monthQ.data]);

  // ── Selection + drag ──
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const dragStateRef = useRef<{
    dragging:  boolean;
    anchor:    string | null;   // first cell mousedown'd
    fired:     boolean;         // dragged across at least one other cell
  }>({ dragging: false, anchor: null, fired: false });

  const [editor, setEditor] = useState<EditorState>({ open: false, dates: [] });

  const beginDrag = useCallback((date: string) => {
    dragStateRef.current = { dragging: true, anchor: date, fired: false };
    setSelection(new Set([date]));
  }, []);

  const extendDrag = useCallback((date: string) => {
    const st = dragStateRef.current;
    if (!st.dragging || !st.anchor) return;
    const range = expandRange(st.anchor, date);
    if (range.length > 1) st.fired = true;
    setSelection(new Set(range));
  }, []);

  const endDrag = useCallback(() => {
    const st = dragStateRef.current;
    if (!st.dragging) return;
    dragStateRef.current = { dragging: false, anchor: null, fired: false };
    setSelection((sel) => {
      if (sel.size === 0) return sel;
      const sorted = Array.from(sel).sort();
      // Open the editor seeded with whatever fields the first cell
      // already has (or blank for fresh base-rate cells).
      setEditor({ open: true, dates: sorted });
      return sel;
    });
  }, []);

  // Cancel drag if mouse released outside the grid.
  useEffect(() => {
    const onUp = () => endDrag();
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [endDrag]);

  // Touch drag-select. The day cell handles `onTouchStart` to anchor
  // (mirrors mousedown). `touchmove` runs on `document` so the finger
  // can leave the originating element — we resolve the cell underneath
  // via elementFromPoint and read its `data-iso`. `touchend` finalises.
  useEffect(() => {
    const onMove = (ev: TouchEvent) => {
      if (!dragStateRef.current.dragging) return;
      const t = ev.touches[0];
      if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      if (!el) return;
      const cell = el.closest("[data-iso]") as HTMLElement | null;
      const iso  = cell?.dataset.iso;
      if (iso) {
        ev.preventDefault();  // suppress scroll while dragging across cells
        extendDrag(iso);
      }
    };
    const onEnd = () => endDrag();
    // `passive: false` so preventDefault actually suppresses scroll.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend",  onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend",  onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [extendDrag, endDrag]);

  // ── Mutations ──
  const upsertFn = useServerFn(upsertDailyRates);
  const deleteFn = useServerFn(deleteDailyRates);

  const upsertM = useMutation({
    mutationFn: (v: {
      dates:         string[];
      rate?:         number;
      extrabed_rate?: number | null;
      stop_sell?:    boolean;
      note?:         string | null;
    }) =>
      upsertFn({
        data: {
          room_type_id: selectedRoomId!,
          ...v,
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pricing-calendar"] });
      toast.success(`${res.count} tanggal disimpan`);
      setEditor({ open: false, dates: [] });
      setSelection(new Set());
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Gagal simpan");
    },
  });

  const deleteM = useMutation({
    mutationFn: (dates: string[]) =>
      deleteFn({ data: { room_type_id: selectedRoomId!, dates } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pricing-calendar"] });
      toast.success(`${res.deleted_count} override dihapus, kembali ke base price`);
      setEditor({ open: false, dates: [] });
      setSelection(new Set());
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Gagal hapus");
    },
  });

  // ── Render ──
  const baseRate     = Number(selectedRoom?.base_rate     ?? 0);
  const baseExtraBed = Number(selectedRoom?.extrabed_rate ?? 0);

  // Pre-compute the 6×7 calendar grid for the current month.
  const grid = useMemo<Array<{
    key:           string;
    iso:           string;
    label:         number;
    inMonth:       boolean;
  }>>(() => {
    const startW = firstWeekday(cursor.year, cursor.month);
    const days   = daysInMonth(cursor.year, cursor.month);
    const cells: Array<{ key: string; iso: string; label: number; inMonth: boolean }> = [];

    // Previous-month padding.
    const prevYear  = cursor.month === 0 ? cursor.year - 1 : cursor.year;
    const prevMonth = cursor.month === 0 ? 11 : cursor.month - 1;
    const prevDays  = daysInMonth(prevYear, prevMonth);
    for (let i = startW - 1; i >= 0; i--) {
      const d = prevDays - i;
      cells.push({
        key:     `prev-${d}`,
        iso:     ymd(prevYear, prevMonth, d),
        label:   d,
        inMonth: false,
      });
    }
    // Current-month days.
    for (let d = 1; d <= days; d++) {
      cells.push({
        key:     `cur-${d}`,
        iso:     ymd(cursor.year, cursor.month, d),
        label:   d,
        inMonth: true,
      });
    }
    // Trailing padding to reach a multiple of 7 (always 42 cells = 6 rows).
    const nextYear  = cursor.month === 11 ? cursor.year + 1 : cursor.year;
    const nextMonth = cursor.month === 11 ? 0 : cursor.month + 1;
    let trail = 1;
    while (cells.length < 42) {
      cells.push({
        key:     `next-${trail}`,
        iso:     ymd(nextYear, nextMonth, trail),
        label:   trail,
        inMonth: false,
      });
      trail++;
    }
    return cells;
  }, [cursor]);

  const todayIso = todayWIB();

  const goToday = () => {
    const t = parseYmd(todayIso);
    setCursor({ year: t.y, month: t.m });
  };
  const goPrev = () => {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  };
  const goNext = () => {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  };

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pricing Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Atur harga harian per tipe kamar. Tanggal tanpa override pakai harga dasar.
          Drag untuk pilih beberapa tanggal sekaligus, lalu edit.
        </p>
      </header>

      {/* Room-type pills */}
      <div className="flex flex-wrap gap-2">
        {roomTypes.map((rt) => {
          const active = rt.id === selectedRoomId;
          return (
            <button
              key={rt.id}
              type="button"
              onClick={() => setSelectedRoomId(rt.id)}
              className={
                "rounded-full border px-4 py-1.5 text-sm transition-colors " +
                (active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-input bg-background text-foreground hover:bg-accent")
              }
            >
              <span className="font-medium">{rt.name}</span>
              <span className={active ? "ml-2 text-xs opacity-80" : "ml-2 text-xs text-muted-foreground"}>
                base {compactRp(Number(rt.base_rate ?? 0))}
              </span>
            </button>
          );
        })}
        {roomTypes.length === 0 && !roomQ.isLoading && (
          <div className="text-sm text-muted-foreground">Belum ada tipe kamar.</div>
        )}
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={goPrev} aria-label="Bulan sebelumnya">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[160px] text-center text-sm font-medium">
            {MONTHS_ID[cursor.month]} {cursor.year}
          </div>
          <Button variant="ghost" size="icon" onClick={goNext} aria-label="Bulan berikutnya">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Hari ini
          </Button>
        </div>
      </div>

      {/* Calendar grid. `pricesReady` is false until room types arrive
          so cells skip rendering "Rp 0" before we know the base rate. */}
      <CalendarGrid
        grid={grid}
        overrides={overridesByDate}
        baseRate={baseRate}
        pricesReady={selectedRoom != null}
        todayIso={todayIso}
        selection={selection}
        // Only disable the grid while the FIRST month load is in flight
        // (no placeholder available). Subsequent month nav keeps showing
        // the previous month thanks to keepPreviousData and stays clickable.
        disabled={!selectedRoomId || (monthQ.isLoading && !monthQ.data)}
        onCellMouseDown={beginDrag}
        onCellMouseEnter={extendDrag}
      />

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <LegendDot tone="base" label="Harga dasar" />
        <LegendDot tone="override" label="Override harga harian" />
        <LegendDot tone="stop" label="Stop sell" />
        <span>Tip: klik + drag untuk pilih beberapa tanggal.</span>
      </div>

      <EditDialog
        editor={editor}
        baseRate={baseRate}
        baseExtraBed={baseExtraBed}
        overridesByDate={overridesByDate}
        onClose={() => {
          setEditor({ open: false, dates: [] });
          setSelection(new Set());
        }}
        onSubmit={(payload) => upsertM.mutate(payload)}
        onReset={(dates)   => deleteM.mutate(dates)}
        isSaving={upsertM.isPending}
        isResetting={deleteM.isPending}
      />
    </div>
  );
}

// ─── Calendar grid ──────────────────────────────────────────────────────────

interface CalendarGridProps {
  grid: Array<{ key: string; iso: string; label: number; inMonth: boolean }>;
  overrides: Map<string, {
    date:          string;
    rate:          number;
    extrabed_rate: number | null;
    min_stay:      number;
    stop_sell:     boolean;
    note:          string | null;
  }>;
  baseRate:        number;
  /** False until room types load — suppresses "Rp 0" cells on first paint. */
  pricesReady:     boolean;
  todayIso:        string;
  selection:       Set<string>;
  disabled:        boolean;
  onCellMouseDown: (iso: string) => void;
  onCellMouseEnter:(iso: string) => void;
}

function CalendarGrid({
  grid, overrides, baseRate, pricesReady, todayIso, selection, disabled,
  onCellMouseDown, onCellMouseEnter,
}: CalendarGridProps) {
  return (
    <div className="select-none rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS_ID.map((w) => (
          <div key={w} className="px-3 py-2 text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((cell) => {
          const ov         = overrides.get(cell.iso);
          const isOverride = !!ov;
          const isStop     = !!ov?.stop_sell;
          const rate       = ov ? Number(ov.rate) : baseRate;
          const isSelected = selection.has(cell.iso);
          const isToday    = cell.iso === todayIso;

          // Tailwind class composition — no inline styles per the spec.
          // Variant precedence: stop-sell > override > base; selected overlays
          // a ring; out-of-month dims everything.
          const base = "relative flex h-20 flex-col gap-1 border-b border-r p-2 text-left text-xs cursor-pointer transition-colors";
          const outOfMonth = !cell.inMonth ? "bg-muted/30 text-muted-foreground/60" : "";
          const tone =
            isStop     ? "bg-destructive/10 hover:bg-destructive/15"
          : isOverride ? "bg-primary/10  hover:bg-primary/15"
          :              "hover:bg-accent/40";
          const ring = isSelected ? "ring-2 ring-primary ring-inset z-10" : "";
          const todayMark = isToday ? "outline outline-1 outline-foreground/30" : "";
          const disabledCls = disabled ? "pointer-events-none opacity-60" : "";

          return (
            <div
              key={cell.key}
              data-iso={cell.iso}
              onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => {
                if (disabled) return;
                e.preventDefault();   // suppress text-selection while dragging
                onCellMouseDown(cell.iso);
              }}
              onMouseEnter={() => {
                if (disabled) return;
                onCellMouseEnter(cell.iso);
              }}
              onTouchStart={() => {
                if (disabled) return;
                // touchmove + touchend are handled at document level so the
                // drag survives finger excursions outside the originating cell.
                onCellMouseDown(cell.iso);
              }}
              className={[base, outOfMonth, tone, ring, todayMark, disabledCls].filter(Boolean).join(" ")}
            >
              <div className="flex items-start justify-between gap-1">
                <span className={cell.inMonth ? "font-medium" : ""}>{cell.label}</span>
                {isStop && (
                  <span
                    className="rounded-sm bg-destructive px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-destructive-foreground"
                    aria-label="Stop sell"
                  >
                    stop
                  </span>
                )}
              </div>
              <div className="mt-auto truncate text-[11px] font-medium">
                {pricesReady
                  ? compactRp(rate)
                  : <span className="inline-block h-3 w-12 animate-pulse rounded bg-muted-foreground/20" />}
              </div>
              {isOverride && !isStop && (
                <span
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                  aria-label="Override"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Legend dot ─────────────────────────────────────────────────────────────

function LegendDot({ tone, label }: { tone: "base" | "override" | "stop"; label: string }) {
  const cls =
    tone === "base"     ? "bg-background border border-input"
  : tone === "override" ? "bg-primary"
  :                       "bg-destructive";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

// ─── Edit dialog ────────────────────────────────────────────────────────────

interface EditDialogProps {
  editor: EditorState;
  baseRate:     number;
  baseExtraBed: number;
  overridesByDate: Map<string, {
    date:          string;
    rate:          number;
    extrabed_rate: number | null;
    min_stay:      number;
    stop_sell:     boolean;
    note:          string | null;
  }>;
  onClose:  () => void;
  onSubmit: (v: {
    dates:         string[];
    rate?:         number;
    extrabed_rate?: number | null;
    stop_sell?:    boolean;
    note?:         string | null;
  }) => void;
  onReset:    (dates: string[]) => void;
  isSaving:   boolean;
  isResetting:boolean;
}

function EditDialog({
  editor, baseRate, baseExtraBed, overridesByDate,
  onClose, onSubmit, onReset, isSaving, isResetting,
}: EditDialogProps) {
  // Seed form from the first selected date (most common case). If
  // multiple dates have different overrides, the inputs are blank
  // placeholders and submitting only writes the fields the admin touched.
  const seed = useMemo<EditorFormFields>(() => {
    const dates = editor.dates;
    if (dates.length === 0) {
      return { rate: "", extrabedRate: "", stopSell: false, note: "", anyExistingOverride: false };
    }
    const first = overridesByDate.get(dates[0]);
    const anyExisting = dates.some((d) => overridesByDate.has(d));
    return {
      rate:         first ? String(first.rate) : "",
      extrabedRate: first && first.extrabed_rate != null ? String(first.extrabed_rate) : "",
      stopSell:     first ? first.stop_sell : false,
      note:         first?.note ?? "",
      anyExistingOverride: anyExisting,
    };
  }, [editor.dates, overridesByDate]);

  const [form, setForm] = useState<EditorFormFields>(seed);
  // Reset form when a new selection opens the dialog.
  useEffect(() => {
    if (editor.open) setForm(seed);
  }, [editor.open, seed]);

  if (!editor.open) {
    return (
      <Dialog open={false} onOpenChange={() => onClose()}>
        <DialogContent />
      </Dialog>
    );
  }

  const dates = editor.dates;
  const isSingle = dates.length === 1;

  // Parse the form on submit. Empty string for a numeric field = don't
  // touch (server preserves existing / snapshots base for new rows).
  const handleSave = () => {
    const payload: Parameters<typeof onSubmit>[0] = { dates };
    const rateNum = form.rate.trim() === "" ? undefined : Number(form.rate);
    if (rateNum !== undefined) {
      if (!Number.isFinite(rateNum) || rateNum < 0) {
        toast.error("Rate tidak valid");
        return;
      }
      payload.rate = rateNum;
    }
    const ebrNum = form.extrabedRate.trim() === "" ? undefined : Number(form.extrabedRate);
    if (ebrNum !== undefined) {
      if (!Number.isFinite(ebrNum) || ebrNum < 0) {
        toast.error("Extrabed rate tidak valid");
        return;
      }
      payload.extrabed_rate = ebrNum;
    }
    // Stop-sell + note are always sent — switch state and text are
    // unambiguous, no "untouched" concept for them.
    payload.stop_sell = form.stopSell;
    payload.note      = form.note.trim() === "" ? null : form.note.trim();

    if (rateNum === undefined && ebrNum === undefined && payload.stop_sell === false && payload.note == null) {
      // Nothing the server would change. Bail out so we don't write blank rows.
      toast.error("Tidak ada perubahan.");
      return;
    }
    onSubmit(payload);
  };

  const handleResetToBase = () => {
    onReset(dates);
  };

  const dateLabel = isSingle
    ? fmtDateID(dates[0])
    : `${dates.length} tanggal (${fmtDateID(dates[0])} – ${fmtDateID(dates[dates.length - 1])})`;

  // Cap visible-date chip list so the dialog stays small.
  const chipCap = 14;
  const chipDates = dates.slice(0, chipCap);
  const chipRest  = dates.length - chipCap;

  return (
    <Dialog open={editor.open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Edit harga harian</DialogTitle>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date chips */}
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {chipDates.map((d) => (
              <span key={d} className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono">
                {d}
              </span>
            ))}
            {chipRest > 0 && (
              <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-muted-foreground">
                +{chipRest} lagi
              </span>
            )}
          </div>

          {/* Rate */}
          <div className="space-y-1.5">
            <Label htmlFor="rate">Rate per malam (Rp)</Label>
            <Input
              id="rate"
              type="number"
              inputMode="decimal"
              placeholder={`Kosongkan = pakai base ${compactRp(baseRate)}`}
              value={form.rate}
              onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
            />
          </div>

          {/* Extrabed */}
          <div className="space-y-1.5">
            <Label htmlFor="extrabed">Extrabed rate per malam (Rp)</Label>
            <Input
              id="extrabed"
              type="number"
              inputMode="decimal"
              placeholder={`Kosongkan = fallback ${compactRp(baseExtraBed)}`}
              value={form.extrabedRate}
              onChange={(e) => setForm((f) => ({ ...f, extrabedRate: e.target.value }))}
            />
          </div>

          {/* Stop sell */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Stop sell</div>
              <div className="text-xs text-muted-foreground">
                Tipe kamar ini tidak dijual untuk tanggal terpilih.
              </div>
            </div>
            <Switch
              checked={form.stopSell}
              onCheckedChange={(v) => setForm((f) => ({ ...f, stopSell: v }))}
              aria-label="Stop sell"
            />
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">Catatan</Label>
            <Input
              id="note"
              type="text"
              placeholder="Opsional, mis. 'Long weekend HUT RI'"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleResetToBase}
            disabled={!seed.anyExistingOverride || isResetting}
            className="text-destructive hover:text-destructive"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset ke base price
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

