import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { listBookings, updateBookingStatus } from "@/lib/bookings.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NewBookingDialog } from "@/components/admin/new-booking-dialog";
import { EditBookingDialog, type EditableBooking } from "@/components/admin/edit-booking-dialog";

export const Route = createFileRoute("/_admin/bookings")({
  component: BookingsPage,
});

const STATUSES = ["pending", "confirmed", "checked_in", "checked_out", "cancelled"] as const;

function formatDateID(iso: string | null | undefined) {
  if (!iso) return "—";
  // iso is "YYYY-MM-DD"; build manually to avoid timezone surprises
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined) {
  if (!checkIn || !checkOut) return 0;
  // DATE columns: parse as UTC midnight to avoid timezone drift on the diff
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", "Rp.");
}

function BookingsPage() {
  const fn = useServerFn(listBookings);
  const update = useServerFn(updateBookingStatus);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => fn(),
  });
  useRealtimeInvalidate(
    "admin-bookings-stream",
    ["bookings", "guests", "rooms"],
    [["bookings"], ["dashboard"]],
  );

  const mut = useMutation({
    mutationFn: (vars: { id: string; status: typeof STATUSES[number] }) =>
      update({ data: vars }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [newOpen, setNewOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<EditableBooking | null>(null);

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Reservations</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Bookings</h1>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Booking Baru
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-semibold text-destructive">Gagal memuat booking</p>
          <p className="mt-1 font-mono text-xs text-destructive/80">{(error as Error).message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Kalau errornya menyebut kolom seperti <code>payment_status</code>, jalankan migration
            terbaru di Supabase (SQL Editor → paste isi file <code>supabase/migrations/20260515130000_*.sql</code> dan
            <code>20260515120000_*.sql</code> → Run).
          </p>
        </div>
      )}

      {data?.degraded && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Mode terbatas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Kolom payment & internal notes belum ada di database — daftar tetap tampil tapi fitur
            pembayaran tidak aktif. Apply migration <code>20260515130000_add_booking_payment_and_internal_notes.sql</code> untuk mengaktifkannya.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Ref</th>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && !error && (data?.bookings.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Belum ada booking. Klik <strong>Booking Baru</strong> di kanan atas untuk membuat yang pertama.
                </td>
              </tr>
            )}
            {data?.bookings.map((b) => (
              <tr
                key={b.id}
                onClick={() => setEditCtx(b as unknown as EditableBooking)}
                className="cursor-pointer transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {b.reference_code ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{b.guests?.full_name}</p>
                  <p className="font-mono text-xs text-muted-foreground tabular-nums">
                    {b.guests?.phone ?? "—"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p>{b.room_types?.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {b.rooms?.number ? `#${b.rooms.number}` : "Belum di-assign"}
                  </p>
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums">
                  <p>{formatDateID(b.check_in)} → {formatDateID(b.check_out)}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {nightsBetween(b.check_in, b.check_out)} malam
                  </p>
                </td>
                <td className="px-4 py-3"><Badge variant="outline">{b.source}</Badge></td>
                <td className="px-4 py-3 font-mono tabular-nums">{formatIDR(Number(b.total_amount))}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={b.status}
                    onValueChange={(v) => mut.mutate({ id: b.id, status: v as typeof STATUSES[number] })}
                  >
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewBookingDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <EditBookingDialog
        open={!!editCtx}
        booking={editCtx}
        onClose={() => setEditCtx(null)}
      />
    </div>
  );
}
