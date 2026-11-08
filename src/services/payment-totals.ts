/**
 * Aturan total/status pembayaran (murni, teruji).
 * - total_amount tidak pernah ditimpa nominal dibayar.
 * - LUNAS hanya bila paid ≥ total; paid < total → partial (DP).
 */
export type PayStatus = "unpaid" | "partial" | "paid";

export function statusFromCumulative(paid: number, total: number): PayStatus {
  if (paid <= 0) return "unpaid";
  return paid >= total ? "paid" : "partial";
}

export function resolveEditedPaymentTotals(p: {
  computedTotal: number;
  status: string;
  paidAmount: number;
}): { total: number; paid: number; status: PayStatus } {
  const total = Math.max(0, Number(p.computedTotal) || 0);
  let paid = Math.max(0, Number(p.paidAmount) || 0);
  if (p.status === "unpaid") return { total, paid: 0, status: "unpaid" };
  // Admin menandai "lunas" tanpa mengisi nominal → anggap dibayar penuh.
  if (p.status === "paid" && paid === 0) paid = total;
  if (p.status === "partial" && paid === 0) return { total, paid: 0, status: "unpaid" };
  return { total, paid, status: statusFromCumulative(paid, total) };
}
