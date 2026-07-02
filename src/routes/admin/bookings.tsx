import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, X, ChevronLeft, ChevronRight, Trash2, Receipt, FileDown, Printer, Loader2, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv, openPrintView, openBlankPrintWindow, type ExportRow } from "@/admin/lib/booking-export";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NewBookingDialog } from "@/admin/components/new-booking-dialog";
import { EditBookingDialog, type EditableBooking } from "@/admin/components/edit-booking-dialog";

export const Route = createFileRoute("/admin/bookings")({ component: BookingsPage });

const STATUSES = ["pending", "confirmed", "checked_in", "checked_out", "cancelled"] as const;
type BookingStatus = (typeof STATUSES)[number];

const STATUS_OPTIONS = [
  { value: "all", label: "Semua status" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked-in" },
  { value: "checked_out", label: "Checked-out" },
  { value: "cancelled", label: "Cancelled" },
];
const SOURCE_OPTIONS = [
  { value: "all", label: "Semua sumber" },
  { value: "direct", label: "Direct" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
  { value: "manager_chat", label: "Manager Chat" },
];
const PAGE_SIZE = 20;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const FULL_SELECT = "id, reference_code, check_in, check_out, created_at, status, source, total_amount, adults, children, payment_status, paid_amount, internal_notes, special_requests, guests(id, full_name, email, phone, country), booking_rooms(id, room_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(id, name), rooms(id, number))";
const BASE_SELECT = "id, check_in, check_out, created_at, status, source, total_amount, adults, children, special_requests, guests(id, full_name, email, phone), booking_rooms(id, room_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(id, name), rooms(id, number))";

type BookingListRow = {
  id: string;
  reference_code?: string | null;
  check_in: string;
  check_out: string;
  created_at?: string | null;
  status: BookingStatus;
  source: string;
  total_amount: number;
  payment_status?: "unpaid" | "partial" | "paid" | null;
  paid_amount?: number | null;
  guests?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  booking_rooms?: { id: string; room_id: string | null; nightly_rate: number; room_types?: { name?: string | null } | null; rooms?: { number?: string | null } | null }[] | null;
};

type ListResult = { bookings: BookingListRow[]; total: number; page: number; pageSize: number; degraded?: boolean };
type SortKey = "created_at" | "status";
type SortDir = "asc" | "desc";

function formatDateID(iso?: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
function formatDateTimeID(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
}
function nightsBetween(checkIn?: string | null, checkOut?: string | null) {
  if (!checkIn || !checkOut) return 0;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}
function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n).replace("IDR", "Rp.");
}
function getWhatsAppLink(phone: string) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "62" + cleaned.slice(1);
  return `https://wa.me/${cleaned}`;
}
function sanitizeSearch(v?: string) {
  return (v ?? "").replace(/[,()*:%]/g, " ").trim();
}
async function getGuestIds(search: string) {
  if (!search) return [] as string[];
  const { data } = await supabase.from("guests").select("id").ilike("full_name", `%${search}%`).limit(500);
  return (data ?? []).map((g: any) => g.id as string);
}
function applyFilters(
  q: any,
  status?: string,
  source?: string,
  search?: string,
  guestIds: string[] = [],
  includeRef = true,
) {
  if (status && status !== "all") q = q.eq("status", status);
  if (source && source !== "all") q = q.eq("source", source as never);
  if (search) {
    const ors: string[] = [];
    if (includeRef) ors.push(`reference_code.ilike.*${search}*`);
    if (guestIds.length) ors.push(`guest_id.in.(${guestIds.join(",")})`);
    q = ors.length ? q.or(ors.join(",")) : q.eq("id", ZERO_UUID);
  }
  return q;
}
function applySort(q: any, sortBy: SortKey, sortDir: SortDir) {
  q = q.order(sortBy, { ascending: sortDir === "asc" });
  if (sortBy !== "created_at") q = q.order("created_at", { ascending: false });
  return q;
}
async function fetchBookings(args: { page: number; pageSize: number; status?: string; source?: string; search?: string; sortBy: SortKey; sortDir: SortDir }): Promise<ListResult> {
  const from = (args.page - 1) * args.pageSize;
  const to = from + args.pageSize - 1;
  const search = sanitizeSearch(args.search);
  const guestIds = await getGuestIds(search);

  let q = supabase.from("bookings").select(FULL_SELECT, { count: "exact" });
  q = applyFilters(q, args.status, args.source, search, guestIds, true);
  const full = await applySort(q, args.sortBy, args.sortDir).range(from, to);
  if (!full.error) return { bookings: (full.data ?? []) as any, total: full.count ?? 0, page: args.page, pageSize: args.pageSize, degraded: false };

  if ((full.error as any).code !== "42703") throw full.error;

  let qb = supabase.from("bookings").select(BASE_SELECT, { count: "exact" });
  qb = applyFilters(qb, args.status, args.source, search, guestIds, false);
  const base = await applySort(qb, args.sortBy, args.sortDir).range(from, to);
  if (base.error) throw base.error;
  return { bookings: (base.data ?? []) as any, total: base.count ?? 0, page: args.page, pageSize: args.pageSize, degraded: true };
}
function flattenExportRows(rows: any[]): ExportRow[] {
  return rows.map((b: any) => {
    const brs: any[] = Array.isArray(b.booking_rooms) ? b.booking_rooms : [];
    const roomLabels = brs.map((br) => {
      const name = br?.room_types?.name ?? "?";
      const num = br?.rooms?.number;
      return num ? `${name} (${num})` : name;
    });
    const checkIn = b.check_in as string;
    const checkOut = b.check_out as string;
    const nights = nightsBetween(checkIn, checkOut);
    const total = Number(b.total_amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);
    const nightlyRates = brs.map((br) => Number(br?.nightly_rate ?? 0));
    return {
      reference_code: b.reference_code ?? "",
      guest_name: b.guests?.full_name ?? "",
      guest_email: b.guests?.email ?? "",
      guest_phone: b.guests?.phone ?? "",
      check_in: checkIn ?? "",
      check_out: checkOut ?? "",
      nights,
      rooms: roomLabels.join("; "),
      room_count: brs.length,
      adults: Number(b.adults ?? 0),
      children: Number(b.children ?? 0),
      status: b.status,
      source: b.source ?? "",
      payment_status: b.payment_status ?? "",
      total_amount: total,
      paid_amount: paid,
      outstanding: Math.max(0, total - paid),
      nightly_rate_min: nightlyRates.length ? Math.min(...nightlyRates) : 0,
      nightly_rate_max: nightlyRates.length ? Math.max(...nightlyRates) : 0,
      created_at: b.created_at ?? "",
    } as ExportRow;
  });
}
async function fetchExportRows(args: { status?: string; source?: string; search?: string; sortBy: SortKey; sortDir: SortDir }) {
  const search = sanitizeSearch(args.search);
  const guestIds = await getGuestIds(search);
  let q = supabase.from("bookings").select(FULL_SELECT);
  q = applyFilters(q, args.status, args.source, search, guestIds, true);
  const res = await applySort(q, args.sortBy, args.sortDir).limit(5000);
  if (res.error) throw res.error;
  const rows = flattenExportRows(res.data ?? []);
  return { rows, capped: rows.length >= 5000 };
}

function BookingsPage() {
  const [exporting, setExporting] = React.useState<null | "csv" | "pdf">(null);
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState<SortKey>("created_at");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<EditableBooking | null>(null);
  const [deleteCtx, setDeleteCtx] = React.useState<{ id: string; ref: string } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtersActive = statusFilter !== "all" || sourceFilter !== "all" || search !== "";
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["bookings", { page, statusFilter, sourceFilter, sortBy, sortDir, search }],
    queryFn: () => fetchBookings({ page, pageSize: PAGE_SIZE, status: statusFilter, source: sourceFilter, search, sortBy, sortDir }),
    placeholderData: keepPreviousData,
  });

  useRealtimeInvalidate("admin-bookings-stream", ["bookings", "guests", "rooms"], [["bookings"], ["dashboard"]]);

  const mut = useMutation({
    mutationFn: async (vars: { id: string; status: BookingStatus }) => {
      const { error } = await supabase.from("bookings").update({ status: vars.status }).eq("id", vars.id);
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["bookings"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => { toast.success("Booking dihapus"); qc.invalidateQueries({ queryKey: ["bookings"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); setDeleteCtx(null); },
    onError: (e) => toast.error((e as Error).message),
  });

  async function runExport(kind: "csv" | "pdf") {
    let printWindow: Window | null = null;
    if (kind === "pdf") {
      printWindow = openBlankPrintWindow();
      if (!printWindow) return toast.error("Tidak bisa membuka tab cetak. Izinkan popup untuk halaman ini lalu coba lagi.");
    }
    setExporting(kind);
    try {
      const res = await fetchExportRows({ status: statusFilter, source: sourceFilter, search, sortBy, sortDir });
      const rows = res.rows;
      if (rows.length === 0) { toast.info("Tidak ada booking yang cocok dengan filter saat ini."); printWindow?.close(); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      const stem = `bookings_${stamp}`;
      if (kind === "csv") {
        downloadCsv(rows, stem);
        toast.success(`CSV diunduh — ${rows.length} baris.`);
      } else {
        openPrintView(rows, { filterSummary: "Daftar booking", targetWindow: printWindow });
        toast.success("Dialog cetak terbuka — pilih Save as PDF untuk simpan ke file.");
      }
      if (res.capped) toast.warning("Hasil dipotong di 5000 baris. Persempit filter untuk export lebih spesifik.");
    } catch (e) {
      printWindow?.close();
      toast.error((e as Error).message ?? "Export gagal.");
    } finally {
      setExporting(null);
    }
  }

  const bookings = (data?.bookings ?? []) as BookingListRow[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);
  const resetFilters = () => { setStatusFilter("all"); setSourceFilter("all"); setSearchInput(""); setSearch(""); setPage(1); };
  const setSort = (key: SortKey) => {
    setPage(1);
    setSortBy((current) => {
      if (current === key) {
        setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
        return current;
      }
      setSortDir("desc");
      return key;
    });
  };
  const sortLabel = (key: SortKey) => (sortBy === key ? (sortDir === "desc" ? "↓" : "↑") : "");

  return (
    <div className="space-y-6 p-4 md:p-8 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Reservations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Bookings</h1></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => runExport("csv")} disabled={exporting !== null} className="gap-2">{exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Export CSV</Button>
          <Button variant="outline" onClick={() => runExport("pdf")} disabled={exporting !== null} className="gap-2">{exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}Cetak / PDF</Button>
          <Button onClick={() => setNewOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Booking Baru</Button>
        </div>
      </header>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm font-semibold text-destructive">Gagal memuat booking</p><p className="mt-1 font-mono text-xs text-destructive/80">{(error as Error).message}</p></div>}
      {data?.degraded && <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4"><p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Mode terbatas</p><p className="mt-1 text-xs text-muted-foreground">Kolom payment belum ada di database — daftar tetap tampil.</p></div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Cari nama tamu atau kode referensi…" className="h-9 pl-9" />{searchInput && <button onClick={() => setSearchInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Bersihkan pencarian"><X className="h-3.5 w-3.5" /></button>}</div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent>{SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
        {filtersActive && <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={resetFilters}><X className="h-3.5 w-3.5" />Reset</Button>}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto md:overflow-visible">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40"><tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground"><th className="px-4 py-3">Kode Booking</th><th className="px-4 py-3">Nama Tamu</th><th className="px-4 py-3">Kamar</th><th className="px-4 py-3 text-center">Jumlah Kamar</th><th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Pembayaran</th><th className="px-4 py-3"><button type="button" onClick={() => setSort("status")} className="inline-flex items-center gap-1 hover:text-foreground">Status <ArrowUpDown className="h-3 w-3" />{sortLabel("status")}</button></th><th className="px-4 py-3">Sumber</th><th className="px-4 py-3"><button type="button" onClick={() => setSort("created_at")} className="inline-flex items-center gap-1 hover:text-foreground">Tgl Pemesanan <ArrowUpDown className="h-3 w-3" />{sortLabel("created_at")}</button></th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && !error && bookings.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">{filtersActive ? "Tidak ada booking yang cocok dengan filter ini." : "Belum ada booking."}</td></tr>}
              {bookings.map((b) => (
                <tr key={b.id} onClick={() => setEditCtx(b as unknown as EditableBooking)} className="cursor-pointer transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3"><span className="font-mono text-xs font-semibold text-foreground">{b.reference_code ?? "—"}</span></td>
                  <td className="px-4 py-3"><p className="font-medium">{b.guests?.full_name}</p>{b.guests?.phone ? <a href={getWhatsAppLink(b.guests.phone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-primary hover:underline tabular-nums">{b.guests.phone}</a> : <p className="font-mono text-xs text-muted-foreground tabular-nums">—</p>}</td>
                  <td className="px-4 py-3"><RoomSummary rooms={b.booking_rooms} /></td>
                  <td className="px-4 py-3 font-mono tabular-nums text-center">{b.booking_rooms?.length ?? 0}</td>
                  <td className="px-4 py-3 text-xs"><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Check-In</p><p className="font-mono tabular-nums">{formatDateID(b.check_in)}</p><p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Check-Out</p><p className="font-mono tabular-nums">{formatDateID(b.check_out)}</p><p className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{nightsBetween(b.check_in, b.check_out)} malam</p></td>
                  <td className="px-4 py-3"><PaymentCell total={Number(b.total_amount)} paid={Number(b.paid_amount ?? 0)} status={b.payment_status} booking={b} /></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><Select value={b.status} onValueChange={(v) => mut.mutate({ id: b.id, status: v as BookingStatus })}><SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent></Select></td>
                  <td className="px-4 py-3"><Badge variant="outline">{b.source}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">{formatDateTimeID(b.created_at)}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Hapus booking" onClick={() => setDeleteCtx({ id: b.id, ref: b.reference_code ?? "booking ini" })}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!error && total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3"><p className="text-xs text-muted-foreground">Menampilkan <span className="font-medium text-foreground">{rangeFrom}</span>–<span className="font-medium text-foreground">{rangeTo}</span> dari <span className="font-medium text-foreground">{total}</span> booking{isFetching && <span className="ml-2 italic opacity-70">memuat…</span>}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="h-8 gap-1" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-3.5 w-3.5" />Sebelumnya</Button><span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">{page} / {totalPages}</span><Button variant="outline" size="sm" className="h-8 gap-1" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Berikutnya<ChevronRight className="h-3.5 w-3.5" /></Button></div></div>}
      </div>

      <NewBookingDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <EditBookingDialog open={!!editCtx} booking={editCtx} onClose={() => setEditCtx(null)} />
      <Dialog open={!!deleteCtx} onOpenChange={(o) => !o && setDeleteCtx(null)}><DialogContent className="sm:max-w-[440px]"><DialogHeader><DialogTitle>Hapus booking {deleteCtx?.ref}?</DialogTitle><DialogDescription>Seluruh data booking ini akan dihapus permanen dan tidak bisa dikembalikan. Data tamu tidak ikut terhapus.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteCtx(null)}>Batal</Button><Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteCtx && deleteMut.mutate(deleteCtx.id)}>{deleteMut.isPending ? "Menghapus…" : "Hapus booking"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function RoomSummary({ rooms }: { rooms: BookingListRow["booking_rooms"] }) {
  const groups = new Map<string, string[]>();
  for (const br of rooms ?? []) {
    const name = br.room_types?.name ?? "—";
    const num = br.rooms?.number ?? "belum di-assign";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(num);
  }
  if (groups.size === 0) return <p className="text-muted-foreground">—</p>;
  return <div className="space-y-1.5">{[...groups].map(([name, nums]) => <div key={name} className="leading-tight"><p className="font-medium">{name}</p><p className="font-mono text-[11px] text-muted-foreground">{nums.join(", ")}</p></div>)}</div>;
}

function PaymentCell({ total, paid, status, booking }: { total: number; paid: number; status?: "unpaid" | "partial" | "paid" | null; booking: BookingListRow }) {
  const invoiceRef = booking.reference_code || booking.id;
  return (
    <div className="space-y-0.5 font-mono text-xs tabular-nums">
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total</span><span className="font-semibold text-foreground">{formatIDR(total)}</span></div>
      {status === "partial" && <><div className="flex justify-between gap-4 text-muted-foreground"><span>DP</span><span>{formatIDR(paid)}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Sisa</span><span className="text-amber-700 dark:text-amber-400">{formatIDR(Math.max(0, total - paid))}</span></div></>}
      {status === "paid" && <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Lunas</p>}
      {(!status || status === "unpaid") && <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-destructive">Belum bayar</p>}
      <a href={`/book/confirmation/${encodeURIComponent(invoiceRef)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-1 inline-flex items-center gap-1 font-sans text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"><Receipt className="h-3.5 w-3.5" />Invoice</a>
    </div>
  );
}
