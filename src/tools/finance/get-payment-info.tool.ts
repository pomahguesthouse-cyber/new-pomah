/**
 * Tool: get_payment_info
 *
 * Returns payment details for a booking (by reference code or guest phone),
 * plus the property's bank account details for transfer.
 * Used by Finance Agent to answer payment-related questions.
 */

import { fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const getPaymentInfo: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const referenceCode = str(args.reference_code);
  const guestPhone    = str(args.guest_phone);

  const prop = ctx.property as Record<string, unknown>;

  const paymentAccount = {
    bank:       prop.payment_bank_name       ?? null,
    no_rekening: prop.payment_account_number ?? null,
    atas_nama:  prop.payment_account_holder  ?? null,
  };

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
        "id, reference_code, status, total_amount, check_in, check_out, nights, " +
        "guests(full_name, email, phone)"
      )
      .order("created_at", { ascending: false })
      .limit(1);

    if (referenceCode) {
      query = query.ilike("reference_code", referenceCode);
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

    return JSON.stringify({
      ok:     true,
      booking: {
        reference_code:   b.reference_code,
        status:           b.status,
        total_amount:     b.total_amount,
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
      payment_account: paymentAccount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal mengambil data pembayaran: ${msg}` });
  }
};
