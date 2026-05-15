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
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";

import {
  getCalendarData,
  createBookingFromAdmin,
  updateBookingFromAdmin,
} from "@/lib/calendar.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
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
  useRealtimeInvalidate(
    "admin-calendar-stream",
    ["bookings", "rooms", "room_types", "booking_events"],
    [["admin-calendar"], ["dashboard"], ["bookings"]],
  );

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
  const cellWidth = 100; // Lebar sel sedikit diperbesar untuk visual jam
  const rowHeight = 60;
  const labelWidth = 200;
  const windowStart = days[0];

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
        <div className="flex border-b border-border bg-muted/40 sticky top-0 z-30">
          <div style={{ width: labelWidth }} className="shrink-0 px-3 py-4 text-xs font-bold uppercase tracking-wider">Room</div>
          {days.map((d) => (
            <div
              key={d.toISOString()}
              style={{ width: cellWidth }}
              className={cn(
                "shrink-0 border-l border-border px-2 py-2 text-center",
                isToday(d) && "bg-primary/10",
              )}
            >
              <div className="text-[10px] uppercase text-muted-foreground">{format(d, "EEE")}</div>
              <div className="text-sm font-semibold">{format(d, "d")}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        {grouped.map((g) => (
          <div key={g.type.id}>
            <div className="flex bg-muted/20 border-b border-border">
              <div style={{ width: labelWidth }} className="px-3 py-1.5 text-[10px] font-bold uppercase text-foreground/60">
                {g.type.name}
              </div>
            </div>
            {g.rooms.map((room) => (
              <div
                key={room.id}
                className="relative flex border-b border-border h-[60px]"
              >
                <div style={{ width: labelWidth }} className="flex shrink-0 items-center px-3 border-r border-border font-medium">
                  #{room.number}
                </div>

                {/* Day cells */}
                {days.map((d) => (
                  <button
                    key={d.toISOString()}
                    onClick={() => onCellClick(room.id, d)}
                    style={{ width: cellWidth }}
                    className="shrink-0 border-l border-border hover:bg-accent/30 transition-colors"
                  />
                ))}

                {/* Booking bars: Logic Jam 14:00 - 12:00 */}
                {(bookingsByRoom.get(room.id) ?? []).map((b) => {
                  const ci = parseISO(b.check_in);
                  const co = parseISO(b.check_out);
                  const startIdx = differenceInCalendarDays(ci, windowStart);
                  const endIdx = differenceInCalendarDays(co, windowStart);
                  
                  // Mulai bar dari tengah kolom (jam 14:00)
                  const left = labelWidth + (startIdx * cellWidth) + (cellWidth / 2);
                  // Berakhir di tengah kolom check-out (jam 12:00)
                  const right = labelWidth + (endIdx * cellWidth) + (cellWidth / 2);
                  const width = right - left;

                  if (right <= labelWidth || left >= labelWidth + days.length * cellWidth) return null;

                  return (
                    <button
                      key={b.id}
                      onClick={() => onBookingClick(b)}
                      className={cn(
                        "absolute top-2 bottom-2 flex items-center px-2 rounded border shadow-sm text-[11px] font-bold overflow-hidden transition-all hover:z-20",
                        statusStyles[b.status]
                      )}
                      style={{ 
                        left: left + 2, 
                        width: Math.max(width - 4, 40),
                        zIndex: 10
                      }}
                    >
                      <span className="truncate">{b.guests?.full_name ?? "Guest"}</span>
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

// ... CreateBookingDialog & EditBookingDialog tetap sama seperti kode Bapak sebelumnya ...
// Pastikan untuk mengimpor CreateBookingDialog dan EditBookingDialog yang sudah Bapak miliki.