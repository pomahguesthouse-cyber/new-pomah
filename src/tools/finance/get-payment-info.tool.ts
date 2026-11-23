/**
 * Tool: get_payment_info
 *
 * Returns payment details for a booking (by reference code or guest phone),
 * plus the property's bank account details for transfer.
 * Used by Finance Agent to answer payment-related questions.
 */

import {
  bookingBelongsToPhone,
  invalidBookingCodeError,
  normalizeBookingCode,
} from "@/lib/booking-code";
import { fmtDateID } from "@/lib/date";
import { toPaymentAccountFields } from "@/lib/payment-account";
import { buildOnsiteInvoicePaymentLines, isOnsitePaymentChoice, ONSITE_STATUS_LABEL } from "@/lib/guest-payment-copy";
import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const getPaymentInfo: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const referenceCode = str(args.reference_code);
  // Audit 7 Agu 2026 (S3): di kanal tamu, `guest_phone` dari argumen LLM tidak
  // boleh dipercaya — tamu bisa menyebut nomor orang lain untuk mengintip
  // booking mereka. Nomor percakapan yang berlaku, bukan yang diketik.
  const guestPhone =
    ctx.isManager === true ? str(args.guest_phone) : (ctx.phone ?? str(args.guest_phone));

  const paymentAccount = toPaymentAccountFields(ctx.property);

  // If no lookup key, just return payment account info
  if (!referenceCode && !guestPhone) {
    return JSON.stringify({
      ok:              true,
      booking:         null,
      payment_account: paymentAccount,
      message:         "Informasi rekening tersedia; tidak ada kode booking yang diberikan.",
    });
  }

  // Lookup booking
  try {
    let query = (ctx.supabaseAdmin as any)
      .from("bookings")
      .select(
        "id, reference_code, status, total_amount, paid_amount, payment_status, payment_method, expires_at, check_in, check_out, nights, " +
        "guests(full_name, email, phone)"
      )
      .order("created_at", { ascending: false })
      .limit(1);

    if (referenceCode) {
      const code = normalizeBookingCode(referenceCode);
      if (!code) {
        return JSON.stringify({ ok: false, error: invalidBookingCodeError(referenceCode) });
      }
      if (ctx.isManager !== true) {
        const owned = await bookingBelongsToPhone(ctx.supabaseAdmin as any, code, ctx.phone);
        if (owned !== true) {
          console.warn(
            `[get_payment_info] BLOCKED cross-guest lookup (phone=${(ctx.phone ?? "-").slice(-6)}, ref=${code})`,
          );
          return JSON.stringify({
            ok: false,
            booking: null,
            payment_account: paymentAccount,
            error: `Booking ${code} tidak terdaftar atas nomor ini. Mohon konfirmasi ulang kode booking-nya.`,
          });
        }
      }
      query = query.eq("reference_code", code);
    } else {
      // Join via guests table
      const { data: guests } = await (ctx.supabaseAdmin as any)
        .from("guests")
        .select("id")
        .eq("phone", guestPhone)
        .limit(5);

      const guestIds = ((guests ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (guestIds.length === 0) {
        return JSON.stringify({
          ok:              true,
          booking:         null,
          payment_account: paymentAccount,
          message:         "Tidak ada booking yang ditemukan untuk nomor HP tersebut.",
        });
      }
      query = query.in("guest_id", guestIds);
    }

    const { data: booking, error } = await query.single();

    if (error || !booking) {
      return JSON.stringify({
        ok:              true,
        booking:         null,
        payment_account: paymentAccount,
        message:         referenceCode
          ? `Booking dengan kode "${referenceCode}" tidak ditemukan.`
          : "Tidak ada booking yang ditemukan.",
      });
    }

    const b = booking as Record<string, unknown>;
    const g = (b.guests as Record<string, unknown>) ?? {};
    const paymentMethod = typeof b.payment_method === "string" ? b.payment_method : null;
    const paymentStatus = typeof b.payment_status === "string" ? b.payment_status : "unpaid";
    const total = Number(b.total_amount ?? 0);
    const payAtProperty = paymentStatus !== "paid" && isOnsitePaymentChoice(paymentMethod);

    return JSON.stringify({
      ok:     true,
      pay_at_property: payAtProperty,
      guest_payment_text: payAtProperty ? buildOnsiteInvoicePaymentLines(total) : null,
      payment_label: payAtProperty ? ONSITE_STATUS_LABEL : null,
      booking: {
        reference_code:   b.reference_code,
        status:           b.status,
        total_amount:     b.total_amount,
        paid_amount:      b.paid_amount ?? 0,
        payment_status:   paymentStatus,
        payment_method:   paymentMethod,
        expires_at:       b.expires_at ?? null,
        check_in:         b.check_in,
        check_out:        b.check_out,
        check_in_tampil:  fmtDateID(String(b.check_in  ?? "")),
        check_out_tampil: fmtDateID(String(b.check_out ?? "")),
        nights:           b.nights,
        guest: {
          full_name: g.full_name,
          email:     g.email,
          phone:     g.phone,
        },
      },
      payment_account: payAtProperty ? null : paymentAccount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal mengambil data pembayaran: ${msg}` });
  }
};
