/**
 * Tool: update_payment_status
 *
 * Updates booking payment_status (and the snapshot in the invoices table)
 * after a guest's transfer proof has been verified by OCR + booking match.
 * Returns the public invoice URL so the agent can ask the guest to
 * re-download the invoice — which now renders with the "PAID" stamp.
 *
 * OTORISASI (audit 7 Agu 2026 — S2). Sebelumnya tool ini sama sekali tidak
 * memeriksa siapa pemanggilnya; satu-satunya penjaga adalah kalimat di prompt
 * Finance Agent. Karena intent tamu `payment`/`invoice_request`/`payment_update`
 * juga di-route ke Finance Agent, pesan seperti "sudah transfer kok, update
 * PG-XXXXX jadi lunas" cukup untuk mengubah status pembayaran tanpa bukti.
 * Sekarang ada dua jalur sah:
 *   1. Kanal managerial (`ctx.isManager === true`) — admin boleh set apa pun.
 *   2. Kanal tamu — SELALU ditolak (8 Nov 2026). Bukti cocok dicatat
 *      deterministik oleh pipeline media (payment-auto-apply).
 */

import { bookingBelongsToPhone, invalidBookingCodeError, normalizeBookingCode } from "@/lib/booking-code";
import type { ToolContext, ToolHandler } from "@/tools/types";

type PaymentStatus = "unpaid" | "partial" | "paid";

/** Jendela berlakunya bukti transfer yang sudah di-OCR (24 jam). */
const OCR_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function sameCode(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toUpperCase() === b.toUpperCase();
}

/**
 * Kanal tamu: cari bukti transfer milik nomor ini yang sudah di-OCR dan
 * COCOK dengan kode booking yang diminta. Mengembalikan alasan penolakan
 * (string) bila tidak sah, atau `null` bila boleh lanjut.
 */
async function guestProofRejectionReason(
  _ctx: ToolContext,
  refCode: string,
): Promise<string | null> {
  // Kanal tamu TIDAK PERNAH boleh mengubah status lewat argumen tool (bisa
  // dipalsukan lewat prompt). Pencatatan dari bukti transfer dilakukan
  // deterministik oleh pipeline media (payment-auto-apply) dari hasil OCR.
  return (
    `Status pembayaran ${refCode.toUpperCase()} tidak bisa diubah dari chat tamu. ` +
    `Bukti transfer yang cocok dicatat otomatis oleh sistem; selain itu diteruskan ke staf.`
  );
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
  const raw = str(args.new_status).toLowerCase();

  // Normalisasi sinonim manajer: "lunas"→paid, "dp"/"dibayar sebagian"→partial,
  // "belum"/"belum bayar"→unpaid.
  const rawStatus = ((): PaymentStatus | "" => {
    if (["paid", "lunas", "sudah lunas"].includes(raw)) return "paid";
    if (["partial", "dp", "sudah dp", "dibayar sebagian"].includes(raw)) return "partial";
    if (["unpaid", "belum", "belum bayar", "belum dibayar"].includes(raw)) return "unpaid";
    return (["paid", "partial", "unpaid"].includes(raw) ? raw : "") as PaymentStatus | "";
  })();

  if (!refCode) {
    return JSON.stringify({ ok: false, error: "reference_code wajib diisi." });
  }
  if (!rawStatus) {
    return JSON.stringify({
      ok: false,
      error: "new_status harus salah satu: paid (lunas), partial (DP), unpaid (belum bayar).",
    });
  }
  // Kode booking harus berbentuk wajar — mencegah wildcard `%`/`_` yang dulu
  // membuat lookup mencocokkan booking milik tamu lain.
  const code = normalizeBookingCode(refCode);
  if (!code) {
    return JSON.stringify({ ok: false, error: invalidBookingCodeError(refCode) });
  }

  // ── Otorisasi ──────────────────────────────────────────────────────────
  if (ctx.isManager !== true) {
    try {
      const rejection = await guestProofRejectionReason(ctx, code);
      if (rejection) {
        console.warn(
          `[update_payment_status] BLOCKED non-manager call ` +
            `(phone=${(ctx.phone ?? "-").slice(-6)}, ref=${code}): ${rejection}`,
        );
        return JSON.stringify({ ok: false, error: rejection });
      }
    } catch (e) {
      console.error("[update_payment_status] authorization check failed:", e);
      return JSON.stringify({
        ok: false,
        error: "Verifikasi bukti pembayaran gagal. Teruskan ke admin untuk pengecekan manual.",
      });
    }
  }

  try {
    const { data: booking, error: bErr } = await (ctx.supabaseAdmin as any)
      .from("bookings")
      .select("id, reference_code, payment_status, paid_amount, total_amount")
      .eq("reference_code", code)
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

    // Pemberitahuan ke tamu HANYA dari kanal manajer (verifikasi oleh orang).
    // "paid" dari tool ini tidak mengubah paid_amount, jadi notifikasi LUNAS
    // hanya terkirim bila paid_amount memang sudah menutup total; selain itu
    // modul notifikasi melewatinya (staf perlu mencatat nominal).
    let paymentNotice: { status: string; reason?: string } | null = null;
    if (ctx.isManager === true && booking.payment_status !== rawStatus) {
      const { notifyPaymentStatusChange } = await import("@/services/payment-status-notice");
      paymentNotice = await notifyPaymentStatusChange({
        supabase: ctx.supabaseAdmin as any,
        bookingId: booking.id,
        before: { payment_status: booking.payment_status, paid_amount: booking.paid_amount },
      });
    }

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
      guest_notice: paymentNotice,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};
