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
  const paid = Math.max(0, Number(p.paidAmount) || 0);
  if (p.status === "unpaid") return { total, paid: 0, status: "unpaid" };
  // Tidak ada inferensi "lunas tanpa nominal = penuh": UI admin sudah mengisi
  // nominal = total saat memilih Lunas. Status murni dari nominal kumulatif.
  return { total, paid, status: statusFromCumulative(paid, total) };
}
