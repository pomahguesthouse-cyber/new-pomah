import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search, X, ChevronLeft, ChevronRight, Trash2, Receipt } from "lucide-react";
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

/** A booking row as rendered in the list (tolerates the degraded shape). */
type BookingListRow = {
  id: string;
  reference_code?: string | null;
  check_in: string;
  check_out: string;
  status: BookingStatus;
  source: string;
  total_amount: number;
  payment_status?: "unpaid" | "partial" | "paid" | null;
  paid_amount?: number | null;
  guests?: { full_name?: string | null; phone?: string | null } | null;
  booking_rooms?:
    | {
        id: string;
        room_id: string | null;
        nightly_rate: number;
        room_types?: { name?: string | null } | null;
        rooms?: { number?: string | null } | null;
      }[]
    | null;
};

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
  const [invoiceCtx, setInvoiceCtx] = React.useState<BookingListRow | null>(null);

  // listBookings returns a union of full / degraded shapes — normalize.
  const bookings = (data?.bookings ?? []) as BookingListRow[];
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
            Kalau errornya menyebut <code>booking_rooms</code> atau <code>relationship</code>,
            jalankan migration multi-kamar di Supabase (SQL Editor → paste isi file{" "}
            <code>supabase/migrations/20260516120000_create_booking_rooms.sql</code> → Run). Kalau
            menyebut kolom seperti <code>payment_status</code>, jalankan juga{" "}
            <code>20260515130000_*.sql</code> dan <code>20260515120000_*.sql</code>.
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
              <th className="px-4 py-3">Kode Booking</th>
              <th className="px-4 py-3">Nama Tamu</th>
              <th className="px-4 py-3">Kamar</th>
              <th className="px-4 py-3">Jumlah Kamar</th>
              <th className="px-4 py-3">Tanggal</th>
              <th className="px-4 py-3">Pembayaran</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Sumber</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && !error && bookings.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
            {bookings.map((b) => (
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
                  <RoomSummary rooms={b.booking_rooms} />
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">{b.booking_rooms?.length ?? 0}</td>
                <td className="px-4 py-3 text-xs">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Check-In
                  </p>
                  <p className="font-mono tabular-nums">{formatDateID(b.check_in)}</p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Check-Out
                  </p>
                  <p className="font-mono tabular-nums">{formatDateID(b.check_out)}</p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {nightsBetween(b.check_in, b.check_out)} malam
                  </p>
                </td>
                <td className="px-4 py-3">
                  <PaymentCell
                    total={Number(b.total_amount)}
                    paid={Number(b.paid_amount ?? 0)}
                    status={b.payment_status}
                    onInvoice={() => setInvoiceCtx(b)}
                  />
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={b.status}
                    onValueChange={(v) => mut.mutate({ id: b.id, status: v as BookingStatus })}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{b.source}</Badge>
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
      <InvoiceDialog booking={invoiceCtx} onClose={() => setInvoiceCtx(null)} />

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

/** Room column: rooms grouped by type — type name, then its room numbers. */
function RoomSummary({ rooms }: { rooms: BookingListRow["booking_rooms"] }) {
  const groups = new Map<string, string[]>();
  for (const br of rooms ?? []) {
    const name = br.room_types?.name ?? "—";
    const num = br.rooms?.number ?? "belum di-assign";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(num);
  }
  if (groups.size === 0) return <p className="text-muted-foreground">—</p>;
  return (
    <div className="space-y-1.5">
      {[...groups].map(([name, nums]) => (
        <div key={name} className="leading-tight">
          <p className="font-medium">{name}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{nums.join(", ")}</p>
        </div>
      ))}
    </div>
  );
}

/** Payment column: total plus a DP/Sisa breakdown or a Lunas / Belum bayar label. */
function PaymentCell({
  total,
  paid,
  status,
  onInvoice,
}: {
  total: number;
  paid: number;
  status?: "unpaid" | "partial" | "paid" | null;
  onInvoice: () => void;
}) {
  return (
    <div className="space-y-0.5 font-mono text-xs tabular-nums">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Total</span>
        <span className="font-semibold text-foreground">{formatIDR(total)}</span>
      </div>
      {status === "partial" && (
        <>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>DP</span>
            <span>{formatIDR(paid)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Sisa</span>
            <span className="text-amber-700 dark:text-amber-400">
              {formatIDR(Math.max(0, total - paid))}
            </span>
          </div>
        </>
      )}
      {status === "paid" && (
        <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
          Lunas
        </p>
      )}
      {(!status || status === "unpaid") && (
        <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-destructive">
          Belum bayar
        </p>
      )}
      <button
        type="button"
        title="Lihat invoice"
        onClick={(e) => {
          e.stopPropagation();
          onInvoice();
        }}
        className="mt-1 inline-flex items-center gap-1 font-sans text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Receipt className="h-3.5 w-3.5" />
        Invoice
      </button>
    </div>
  );
}

/** Read-only invoice dialog for a booking. */
function InvoiceDialog({
  booking,
  onClose,
}: {
  booking: BookingListRow | null;
  onClose: () => void;
}) {
  if (!booking) return null;
  const nights = Math.max(1, nightsBetween(booking.check_in, booking.check_out));
  const rooms = booking.booking_rooms ?? [];
  const total = Number(booking.total_amount);
  const paid = Number(booking.paid_amount ?? 0);
  const sisa = Math.max(0, total - paid);

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Invoice Pemesanan</DialogTitle>
          <DialogDescription className="font-mono">
            {booking.reference_code ?? booking.id.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Guest */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Tamu
            </p>
            <p className="font-medium">{booking.guests?.full_name ?? "—"}</p>
            {booking.guests?.phone && (
              <p className="font-mono text-xs text-muted-foreground">{booking.guests.phone}</p>
            )}
          </div>

          {/* Stay */}
          <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-3 text-xs">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Check-In
              </p>
              <p className="font-mono tabular-nums">{formatDateID(booking.check_in)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Check-Out
              </p>
              <p className="font-mono tabular-nums">{formatDateID(booking.check_out)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Malam
              </p>
              <p className="font-mono tabular-nums">{nights}</p>
            </div>
          </div>

          {/* Line items */}
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Rincian Kamar
            </p>
            <div className="divide-y divide-border rounded-md border border-border">
              {rooms.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Belum ada kamar.</p>
              )}
              {rooms.map((br) => {
                const rate = Number(br.nightly_rate);
                return (
                  <div key={br.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <p className="font-medium">
                        {br.room_types?.name ?? "—"}{" "}
                        {br.rooms?.number && (
                          <span className="text-muted-foreground">{br.rooms.number}</span>
                        )}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {formatIDR(rate)} × {nights} malam
                      </p>
                    </div>
                    <p className="font-mono tabular-nums">{formatIDR(rate * nights)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 font-mono text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">{formatIDR(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dibayar</span>
              <span>{formatIDR(paid)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">Sisa</span>
              <span
                className={
                  sisa > 0
                    ? "font-semibold text-amber-700 dark:text-amber-400"
                    : "font-semibold text-emerald-600 dark:text-emerald-400"
                }
              >
                {formatIDR(sisa)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
