import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  listBookings,
  updateBookingStatus,
  deleteBooking,
} from "@/admin/functions/bookings.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewBookingDialog } from "@/admin/components/new-booking-dialog";
import { EditBookingDialog, type EditableBooking } from "@/admin/components/edit-booking-dialog";

export const Route = createFileRoute("/admin/bookings")({
  component: BookingsPage,
});

const STATUSES = ["pending", "confirmed", "checked_in", "checked_out", "cancelled"] as const;
type BookingStatus = (typeof STATUSES)[number];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Semua status" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked-in" },
  { value: "checked_out", label: "Checked-out" },
  { value: "cancelled", label: "Cancelled" },
];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Semua sumber" },
  { value: "direct", label: "Direct" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
];

const PAGE_SIZE = 20;

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
  const removeFn = useServerFn(deleteBooking);
  const qc = useQueryClient();

  // ---- filter + pagination state ----
  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");

  // Debounce the search box so we don't hit the server on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtersActive = statusFilter !== "all" || sourceFilter !== "all" || search !== "";

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["bookings", { page, statusFilter, sourceFilter, search }],
    queryFn: () =>
      fn({
        data: {
          page,
          pageSize: PAGE_SIZE,
          status: statusFilter === "all" ? undefined : (statusFilter as BookingStatus),
          source: sourceFilter === "all" ? undefined : sourceFilter,
          search: search || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });

  useRealtimeInvalidate(
    "admin-bookings-stream",
    ["bookings", "guests", "rooms"],
    [["bookings"], ["dashboard"]],
  );

  const mut = useMutation({
    mutationFn: (vars: { id: string; status: BookingStatus }) => update({ data: vars }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Booking dihapus");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setDeleteCtx(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [newOpen, setNewOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<EditableBooking | null>(null);
  const [deleteCtx, setDeleteCtx] = React.useState<{ id: string; ref: string } | null>(null);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  const resetFilters = () => {
    setStatusFilter("all");
    setSourceFilter("all");
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Reservations
          </p>
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
            terbaru di Supabase (SQL Editor → paste isi file{" "}
            <code>supabase/migrations/20260515130000_*.sql</code> dan
            <code>20260515120000_*.sql</code> → Run).
          </p>
        </div>
      )}

      {data?.degraded && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Mode terbatas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Kolom payment & internal notes belum ada di database — daftar tetap tampil tapi fitur
            pembayaran tidak aktif. Apply migration{" "}
            <code>20260515130000_add_booking_payment_and_internal_notes.sql</code> untuk
            mengaktifkannya.
          </p>
        </div>
      )}

      {/* ---- filter bar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari nama tamu atau kode referensi…"
            className="h-9 pl-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Bersihkan pencarian"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sourceFilter}
          onValueChange={(v) => {
            setSourceFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={resetFilters}>
            <X className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>

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
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && !error && (data?.bookings.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {filtersActive ? (
                    <>Tidak ada booking yang cocok dengan filter ini.</>
                  ) : (
                    <>
                      Belum ada booking. Klik <strong>Booking Baru</strong> di kanan atas untuk
                      membuat yang pertama.
                    </>
                  )}
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
                    {("reference_code" in b ? b.reference_code : null) ?? "—"}
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
                  <p>
                    {formatDateID(b.check_in)} → {formatDateID(b.check_out)}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {nightsBetween(b.check_in, b.check_out)} malam
                  </p>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{b.source}</Badge>
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {formatIDR(Number(b.total_amount))}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={b.status}
                    onValueChange={(v) => mut.mutate({ id: b.id, status: v as BookingStatus })}
                  >
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Hapus booking"
                    onClick={() =>
                      setDeleteCtx({ id: b.id, ref: b.reference_code ?? "booking ini" })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- pagination footer ---- */}
        {!error && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Menampilkan <span className="font-medium text-foreground">{rangeFrom}</span>–
              <span className="font-medium text-foreground">{rangeTo}</span> dari{" "}
              <span className="font-medium text-foreground">{total}</span> booking
              {isFetching && <span className="ml-2 italic opacity-70">memuat…</span>}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Sebelumnya
              </Button>
              <span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Berikutnya
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <NewBookingDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <EditBookingDialog open={!!editCtx} booking={editCtx} onClose={() => setEditCtx(null)} />

      <Dialog open={!!deleteCtx} onOpenChange={(o) => !o && setDeleteCtx(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Hapus booking {deleteCtx?.ref}?</DialogTitle>
            <DialogDescription>
              Seluruh data booking ini akan dihapus permanen dan tidak bisa dikembalikan. Data tamu
              tidak ikut terhapus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCtx(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteCtx && deleteMut.mutate(deleteCtx.id)}
            >
              {deleteMut.isPending ? "Menghapus…" : "Hapus booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
