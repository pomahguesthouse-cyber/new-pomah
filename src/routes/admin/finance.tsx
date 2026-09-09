import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Download, FileUp, Plus, Printer, Trash2, Pencil } from "lucide-react";

import {
  EXPENSE_CATEGORIES,
  createExpense,
  deleteExpense,
  getFinanceReport,
  importExpenses,
  updateExpense,
} from "@/admin/modules/finance/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/finance")({
  component: FinancePage,
});

type PeriodMode = "month" | "year" | "custom";

type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  description: string | null;
  vendor: string | null;
  amount: number;
  payment_method: string | null;
};

const MONTH_LABELS = [
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

const CATEGORY_LABELS: Record<string, string> = {
  "gaji-karyawan": "Gaji karyawan",
  "listrik-air": "Listrik & air",
  "internet-telepon": "Internet & telepon",
  "linen-laundry": "Linen & laundry",
  "amenities-kamar": "Amenities kamar",
  kebersihan: "Kebersihan",
  "perbaikan-perawatan": "Perbaikan & perawatan",
  "pemasaran-iklan": "Pemasaran & iklan",
  "komisi-ota": "Komisi OTA",
  "pajak-retribusi": "Pajak & retribusi",
  sewa: "Sewa",
  "konsumsi-sarapan": "Konsumsi & sarapan",
  "perlengkapan-kantor": "Perlengkapan kantor",
  "lain-lain": "Lain-lain",
};

function rupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function formatDateID(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function FinancePage() {
  const now = new Date();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [customFrom, setCustomFrom] = useState(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
  );
  const [customTo, setCustomTo] = useState(now.toISOString().slice(0, 10));

  const range = useMemo(() => {
    if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    if (mode === "custom") return { from: customFrom, to: customTo };
    return {
      from: `${year}-${pad(month)}-01`,
      to: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
    };
  }, [mode, year, month, customFrom, customTo]);

  const fetchReport = useServerFn(getFinanceReport);
  const { data, isLoading } = useQuery({
    queryKey: ["finance-report", range.from, range.to],
    queryFn: () => fetchReport({ data: range }),
  });

  const periodLabel =
    mode === "year"
      ? `Tahun ${year}`
      : mode === "month"
        ? `${MONTH_LABELS[month - 1]} ${year}`
        : `${formatDateID(range.from)} – ${formatDateID(range.to)}`;

  const expenseRows = (data?.expenses ?? []) as ExpenseRow[];

  function exportCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`Laporan Keuangan;${periodLabel}`);
    lines.push("");
    lines.push("Ringkasan;Nominal");
    lines.push(`Pendapatan (akrual);${data.revenue.accrual}`);
    lines.push(`Pendapatan diterima (kas);${data.revenue.cash}`);
    lines.push(`Total pengeluaran;${data.expense.total}`);
    lines.push(`Laba/rugi (akrual);${data.profit.accrual}`);
    lines.push(`Laba/rugi (kas);${data.profit.cash}`);
    lines.push("");
    lines.push("Statistik kamar;Nilai");
    lines.push(`Okupansi (%);${data.stats.occupancy}`);
    lines.push(`Malam kamar terjual;${data.stats.roomNightsSold}`);
    lines.push(`ADR;${data.stats.adr}`);
    lines.push(`RevPAR;${data.stats.revpar}`);
    lines.push("");
    lines.push("Pengeluaran per kategori;Nominal");
    for (const [key, value] of Object.entries(data.expense.byCategory)) {
      lines.push(`${CATEGORY_LABELS[key] ?? key};${value}`);
    }
    lines.push("");
    lines.push("Tanggal;Kategori;Keterangan;Vendor;Nominal");
    for (const row of expenseRows) {
      lines.push(
        [
          row.expense_date,
          CATEGORY_LABELS[row.category] ?? row.category,
          (row.description ?? "").replace(/;/g, ","),
          (row.vendor ?? "").replace(/;/g, ","),
          row.amount,
        ].join(";"),
      );
    }
    lines.push("");
    lines.push("Piutang tamu;Check-in;Check-out;Total;Dibayar;Sisa");
    for (const r of data.receivables) {
      lines.push(
        [
          `${r.reference_code ?? "-"} ${r.guest_name}`.replace(/;/g, ","),
          r.check_in,
          r.check_out,
          r.total,
          r.paid,
          r.outstanding,
        ].join(";"),
      );
    }

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-keuangan-${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8 p-4 md:p-8 lg:p-10 print:p-0">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Keuangan
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Laporan keuangan</h1>
          <p className="mt-1 text-sm text-muted-foreground">{periodLabel}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <div className="space-y-1">
            <Label className="text-xs">Periode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Bulanan</SelectItem>
                <SelectItem value="year">Tahunan</SelectItem>
                <SelectItem value="custom">Rentang khusus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "month" && (
            <div className="space-y-1">
              <Label className="text-xs">Bulan</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode !== "custom" && (
            <div className="space-y-1">
              <Label className="text-xs">Tahun</Label>
              <Input
                type="number"
                className="w-[110px]"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
              />
            </div>
          )}

          {mode === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Dari</Label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sampai</Label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </>
          )}

          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download className="mr-2 h-4 w-4" />
            Excel/CSV
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </header>

      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground">Menghitung laporan…</div>
      ) : (
        <>
          <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
            <Kpi label="Pendapatan (akrual)" value={rupiah(data.revenue.accrual)} sub="kamar terpakai" />
            <Kpi label="Uang diterima (kas)" value={rupiah(data.revenue.cash)} sub="pembayaran masuk" />
            <Kpi label="Pengeluaran" value={rupiah(data.expense.total)} sub="periode ini" />
            <Kpi
              label="Laba/rugi (akrual)"
              value={rupiah(data.profit.accrual)}
              sub={`margin ${data.profit.marginAccrual}%`}
            />
          </section>

          <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
            <Kpi label="Okupansi" value={`${data.stats.occupancy}%`} sub={`${data.stats.roomNightsSold} malam kamar`} />
            <Kpi label="ADR" value={rupiah(data.stats.adr)} sub="rata-rata per malam" />
            <Kpi label="RevPAR" value={rupiah(data.stats.revpar)} sub="per kamar tersedia" />
            <Kpi
              label="Piutang tamu"
              value={rupiah(data.payments.outstanding)}
              sub={`dari tagihan ${rupiah(data.payments.billed)}`}
            />
          </section>

          <Card className="p-5">
            <h2 className="font-semibold">Pendapatan vs pengeluaran harian</h2>
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer>
                <ComposedChart data={data.series}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeOpacity={0.1} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={70} />
                  <Tooltip formatter={(v) => rupiah(Number(v))} />
                  <Legend />
                  <Area
                    name="Pendapatan"
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--accent))"
                    fill="url(#rev)"
                  />
                  <Bar name="Pengeluaran" dataKey="expense" fill="hsl(var(--destructive))" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold">Laba rugi</h2>
              <Table className="mt-3">
                <TableBody>
                  <PlRow label="Pendapatan kamar (akrual)" value={data.revenue.accrual} />
                  <PlRow label="Uang diterima (kas)" value={data.revenue.cash} muted />
                  {Object.entries(data.expense.byCategory).map(([key, value]) => (
                    <PlRow
                      key={key}
                      label={`− ${CATEGORY_LABELS[key] ?? key}`}
                      value={-value}
                      muted
                    />
                  ))}
                  <PlRow label="Total pengeluaran" value={-data.expense.total} />
                  <PlRow label="Laba/rugi (akrual)" value={data.profit.accrual} strong />
                  <PlRow label="Laba/rugi (kas)" value={data.profit.cash} strong />
                </TableBody>
              </Table>
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold">Piutang tamu belum lunas</h2>
              {data.receivables.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Semua tagihan pada periode ini sudah lunas.
                </p>
              ) : (
                <div className="mt-3 max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tamu</TableHead>
                        <TableHead>Menginap</TableHead>
                        <TableHead className="text-right">Sisa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.receivables.map((r) => (
                        <TableRow key={`${r.reference_code}-${r.check_in}`}>
                          <TableCell>
                            <div className="font-medium">{r.guest_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.reference_code ?? "-"} · {r.payment_status}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatDateID(r.check_in)} – {formatDateID(r.check_out)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {rupiah(r.outstanding)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </div>

          <ExpenseSection rows={expenseRows} range={range} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PlRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className={strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}>
        {label}
      </TableCell>
      <TableCell
        className={`text-right font-mono ${strong ? "font-semibold" : ""} ${
          value < 0 ? "text-destructive" : ""
        }`}
      >
        {rupiah(value)}
      </TableCell>
    </TableRow>
  );
}

type ExpenseForm = {
  id?: string;
  expense_date: string;
  category: string;
  description: string;
  vendor: string;
  amount: string;
  payment_method: string;
  notes: string;
};

function emptyForm(): ExpenseForm {
  return {
    expense_date: new Date().toISOString().slice(0, 10),
    category: "lain-lain",
    description: "",
    vendor: "",
    amount: "",
    payment_method: "",
    notes: "",
  };
}

function ExpenseSection({
  rows,
  range,
}: {
  rows: ExpenseRow[];
  range: { from: string; to: string };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(emptyForm());

  const create = useServerFn(createExpense);
  const update = useServerFn(updateExpense);
  const remove = useServerFn(deleteExpense);
  const doImport = useServerFn(importExpenses);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["finance-report"] });
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: ExpenseForm) => {
      const body = {
        expense_date: payload.expense_date,
        category: payload.category,
        description: payload.description || null,
        vendor: payload.vendor || null,
        amount: Number(payload.amount.replace(/[^\d]/g, "")) || 0,
        payment_method: payload.payment_method || null,
        notes: payload.notes || null,
      };
      return payload.id
        ? update({ data: { ...body, id: payload.id } })
        : create({ data: body });
    },
    onSuccess: () => {
      toast.success("Pengeluaran disimpan");
      setOpen(false);
      setForm(emptyForm());
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Pengeluaran dihapus");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importMutation = useMutation({
    mutationFn: (parsed: Array<Record<string, string>>) => {
      const payload = parsed.map((row) => ({
        expense_date: row.tanggal ?? row.date ?? range.from,
        category: row.kategori ?? row.category ?? "lain-lain",
        description: row.keterangan ?? row.description ?? null,
        vendor: row.vendor ?? null,
        amount: Number(String(row.nominal ?? row.amount ?? "0").replace(/[^\d]/g, "")) || 0,
        payment_method: row.metode ?? row.payment_method ?? null,
        notes: null,
      }));
      return doImport({ data: { rows: payload } });
    },
    onSuccess: (result) => {
      toast.success(`${result.inserted} pengeluaran diimpor`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleFile(file: File) {
    const text = await file.text();
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("File kosong atau tanpa baris data");
      return;
    }
    const delimiter = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
    const parsed = lines.slice(1).map((line) => {
      const cells = line.split(delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = (cells[index] ?? "").trim();
      });
      return row;
    });
    importMutation.mutate(parsed);
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Pengeluaran</h2>
        <div className="flex flex-wrap gap-2 print:hidden">
          <label className="inline-flex">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input px-3 text-sm hover:bg-accent hover:text-accent-foreground">
              <FileUp className="mr-2 h-4 w-4" />
              Impor CSV
            </span>
          </label>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setForm(emptyForm());
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Tambah pengeluaran
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{form.id ? "Ubah pengeluaran" : "Tambah pengeluaran"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tanggal</Label>
                  <Input
                    type="date"
                    value={form.expense_date}
                    onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Kategori</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {CATEGORY_LABELS[category] ?? category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nominal (Rp)</Label>
                  <Input
                    inputMode="numeric"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="250000"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Metode pembayaran</Label>
                  <Input
                    value={form.payment_method}
                    onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    placeholder="Transfer / tunai"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Keterangan</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Pembelian sabun & shampo kamar"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Vendor / penerima</Label>
                  <Input
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Catatan</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending || !form.amount}
                >
                  Simpan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Format impor CSV: kolom tanggal, kategori, keterangan, vendor, nominal, metode.
      </p>

      <div className="mt-4 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
              <TableHead className="w-20 print:hidden" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  Belum ada pengeluaran pada periode ini.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateID(row.expense_date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {CATEGORY_LABELS[row.category] ?? row.category}
                  </TableCell>
                  <TableCell className="text-sm">{row.description ?? "—"}</TableCell>
                  <TableCell className="text-sm">{row.vendor ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {rupiah(Number(row.amount))}
                  </TableCell>
                  <TableCell className="print:hidden">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setForm({
                            id: row.id,
                            expense_date: row.expense_date,
                            category: row.category,
                            description: row.description ?? "",
                            vendor: row.vendor ?? "",
                            amount: String(row.amount),
                            payment_method: row.payment_method ?? "",
                            notes: "",
                          });
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(row.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
