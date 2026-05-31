/**
 * Tool: update_payment_status
 *
 * Updates booking payment_status (and the snapshot in the invoices table)
 * after a guest's transfer proof has been verified by OCR + booking match.
 * Returns the public invoice URL so the agent can ask the guest to
 * re-download the invoice — which now renders with the "PAID" stamp.
 *
 * Designed to be called ONLY by the Finance Agent after a high-confidence
 * OCR match (`match.status === "matched"`). The agent prompt guards
 * against marking unmatched / ambiguous proofs as paid.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

type PaymentStatus = "unpaid" | "partial" | "paid";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function buildInvoiceUrl(refOrId: string, ctx: ToolContext): string {
  const domain = (ctx.property as any)?.public_domain as string | undefined;
  const base = domain
    ? (domain.startsWith("http") ? domain : `https://${domain}`)
    : (ctx.origin ?? "https://pomahguesthouse.com");
  return `${base.replace(/\/+$/, "")}/book/confirmation/${encodeURIComponent(refOrId)}`;
}

export const updatePaymentStatus: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const refCode = str(args.reference_code);
  const rawStatus = str(args.new_status).toLowerCase() as PaymentStatus;

  if (!refCode) {
    return JSON.stringify({ ok: false, error: "reference_code wajib diisi." });
  }
  if (!["paid", "partial", "unpaid"].includes(rawStatus)) {
    return JSON.stringify({
      ok: false,
      error: "new_status harus salah satu: paid, partial, unpaid.",
    });
  }

  try {
    const { data: booking, error: bErr } = await (ctx.supabaseAdmin as any)
      .from("bookings")
      .select("id, reference_code")
      .ilike("reference_code", refCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bErr || !booking) {
      return JSON.stringify({
        ok: false,
        error: `Booking "${refCode}" tidak ditemukan.`,
      });
    }

    const nowIso = new Date().toISOString();

    const { error: updErr } = await (ctx.supabaseAdmin as any)
      .from("bookings")
      .update({ payment_status: rawStatus })
      .eq("id", booking.id);
    if (updErr) {
      return JSON.stringify({
        ok: false,
        error: `Gagal update payment_status: ${updErr.message}`,
      });
    }

    // Keep the invoices snapshot in sync so any cached PDF/HTML rendered
    // off the invoices table also shows the new status.
    await (ctx.supabaseAdmin as any)
      .from("invoices")
      .update({
        payment_status_snapshot: rawStatus,
        regenerated_at: nowIso,
      })
      .eq("booking_id", booking.id);

    // Once payment is confirmed paid, release the booking state machine
    // so the guest's next turn is handled normally instead of staying
    // pinned to PAYMENT_PENDING.
    if (rawStatus === "paid" && ctx.phone) {
      try {
        await (ctx.supabasePublic as any).rpc("update_booking_state", {
          p_phone:   ctx.phone,
          p_state:   "COMPLETED",
          p_context: {},
        });
      } catch (e) {
        console.warn("[update_payment_status] failed to reset booking state:", e);
      }
    }

    return JSON.stringify({
      ok: true,
      reference_code: booking.reference_code ?? refCode,
      new_status: rawStatus,
      status_label: rawStatus === "paid" ? "LUNAS" : rawStatus === "partial" ? "DIBAYAR SEBAGIAN" : "BELUM DIBAYAR",
      invoice_url: buildInvoiceUrl(booking.reference_code ?? booking.id, ctx),
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};
