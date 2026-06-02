/**
 * Client helpers to turn an exportBookings() result into a downloadable
 * CSV file or a print-friendly HTML window (manager picks "Save as PDF").
 *
 * No external libs — keeps the bundle small. PDFs go through the
 * browser's print dialog which already supports Save as PDF on every
 * modern OS / browser.
 */

export interface ExportRow {
  reference_code: string;
  guest_name:     string;
  guest_email:    string;
  guest_phone:    string;
  check_in:       string;
  check_out:      string;
  nights:         number;
  rooms:          string;
  room_count:     number;
  adults:         number;
  children:       number;
  status:         string;
  source:         string;
  payment_status: string;
  total_amount:   number;
  paid_amount:    number;
  outstanding:    number;
  nightly_rate_min: number;
  nightly_rate_max: number;
  created_at:     string;
}

const CSV_HEADERS: Array<[keyof ExportRow, string]> = [
  ["reference_code", "Kode Booking"],
  ["guest_name",     "Nama Tamu"],
  ["guest_phone",    "No. HP"],
  ["guest_email",    "Email"],
  ["check_in",       "Check-in"],
  ["check_out",      "Check-out"],
  ["nights",         "Malam"],
  ["rooms",          "Kamar"],
  ["adults",         "Dewasa"],
  ["children",       "Anak"],
  ["status",         "Status"],
  ["source",         "Sumber"],
  ["payment_status", "Pembayaran"],
  ["total_amount",   "Total"],
  ["paid_amount",    "Dibayar"],
  ["outstanding",    "Sisa"],
  ["created_at",     "Tgl Pemesanan"],
];

function escapeCsvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Quote when contains comma, quote, newline.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: ExportRow[]): string {
  const head = CSV_HEADERS.map(([, label]) => escapeCsvCell(label)).join(",");
  const body = rows.map((r) =>
    CSV_HEADERS.map(([k]) => escapeCsvCell(r[k])).join(","),
  ).join("\n");
  // BOM so Excel renders UTF-8 (rupiah currency safe, even though we
  // emit plain numbers, but guest names may have diacritics).
  return "﻿" + head + "\n" + body;
}

export function downloadCsv(rows: ExportRow[], filenameStem: string) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari finishes the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtIDR(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  return "Rp " + n.toLocaleString("id-ID");
}
function fmtDateID(iso: string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Open a new window with a clean tabular layout and auto-trigger the
 * print dialog. Browser handles "Save as PDF" from there.
 */
export function openPrintView(
  rows: ExportRow[],
  meta: {
    propertyName?:    string;
    filterSummary?:   string;
    generatedAtIso?:  string;
  } = {},
) {
  const w = window.open("", "_blank", "noopener,width=1100,height=800");
  if (!w) {
    // Popup blocked → bail; caller should toast.
    throw new Error("Tidak bisa membuka window cetak. Pastikan popup tidak diblokir browser.");
  }

  const totalRevenue   = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const totalPaid      = rows.reduce((s, r) => s + (Number(r.paid_amount)  || 0), 0);
  const totalOutstand  = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0);

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Daftar Booking — ${escapeHtml(meta.propertyName ?? "")}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; margin: 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #334155; padding-bottom: 12px; margin-bottom: 16px; }
  header h1 { font-size: 18px; margin: 0; color: #0f172a; }
  header .meta { text-align: right; font-size: 11px; color: #64748b; }
  .summary { display: flex; gap: 16px; margin-bottom: 16px; }
  .summary .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; }
  .summary .card .label { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; }
  .summary .card .value { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f1f5f9; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; border-bottom: 1px solid #cbd5e1; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tbody tr:nth-child(2n) td { background: #fafbfc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .small { font-size: 10px; color: #64748b; }
  .status { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .status-pending   { background: #fef3c7; color: #92400e; }
  .status-confirmed { background: #dcfce7; color: #166534; }
  .status-checked_in  { background: #dbeafe; color: #1e40af; }
  .status-checked_out { background: #e0e7ff; color: #3730a3; }
  .status-cancelled { background: #fee2e2; color: #991b1b; }
  footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    body { margin: 12mm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Daftar Booking${meta.propertyName ? ` — ${escapeHtml(meta.propertyName)}` : ""}</h1>
    ${meta.filterSummary ? `<div class="small">${escapeHtml(meta.filterSummary)}</div>` : ""}
  </div>
  <div class="meta">
    Dicetak ${escapeHtml(new Date(meta.generatedAtIso ?? new Date().toISOString()).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }))}<br/>
    ${rows.length} baris
  </div>
</header>

<div class="summary">
  <div class="card"><div class="label">Total Booking</div><div class="value">${rows.length}</div></div>
  <div class="card"><div class="label">Pendapatan</div><div class="value">${fmtIDR(totalRevenue)}</div></div>
  <div class="card"><div class="label">Sudah Dibayar</div><div class="value">${fmtIDR(totalPaid)}</div></div>
  <div class="card"><div class="label">Outstanding</div><div class="value">${fmtIDR(totalOutstand)}</div></div>
</div>

<table>
  <thead>
    <tr>
      <th>Kode</th>
      <th>Tamu</th>
      <th>Kamar</th>
      <th>Check-in</th>
      <th>Check-out</th>
      <th class="num">Malam</th>
      <th>Status</th>
      <th>Pembayaran</th>
      <th class="num">Total</th>
      <th class="num">Sisa</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((r) => `
      <tr>
        <td><strong>${escapeHtml(r.reference_code)}</strong></td>
        <td>
          ${escapeHtml(r.guest_name)}<br/>
          <span class="small">${escapeHtml(r.guest_phone)}</span>
        </td>
        <td>${escapeHtml(r.rooms || "—")}</td>
        <td>${escapeHtml(fmtDateID(r.check_in))}</td>
        <td>${escapeHtml(fmtDateID(r.check_out))}</td>
        <td class="num">${r.nights}</td>
        <td><span class="status status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(r.payment_status || "—")}</td>
        <td class="num">${fmtIDR(r.total_amount)}</td>
        <td class="num">${fmtIDR(r.outstanding)}</td>
      </tr>
    `).join("")}
  </tbody>
</table>

<footer>
  Total ${rows.length} booking · Pendapatan ${fmtIDR(totalRevenue)} · Sudah dibayar ${fmtIDR(totalPaid)} · Outstanding ${fmtIDR(totalOutstand)}
</footer>

<script>
  // Auto-open the print dialog. User can pick "Save as PDF" from there.
  window.addEventListener("load", function () {
    setTimeout(function () { window.print(); }, 100);
  });
</script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}
