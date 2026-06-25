/**
 * Tool: send_invoice
 *
 * Fetches everything the Finance Agent needs to deliver an invoice to a
 * guest: booking summary, payment account, and the public confirmation
 * URL (which the guest can open to view + download the rendered PDF).
 *
 * Lookup priority:
 *   1. reference_code argument (preferred — explicit)
 *   2. ctx.phone — the most recent pending/confirmed booking for the guest
 *
 * Returns a JSON payload the agent can paraphrase into a warm message.
 * Does NOT itself send any WhatsApp message — that is the agent's job
 * via its normal reply path (which the WA worker post-processes and
 * delivers through Fonnte).
 */

import { fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function buildInvoiceUrl(refOrId: string, ctx: ToolContext): string {
  const domain = (ctx.property as any)?.public_domain as string | undefined;
  const base = domain
    ? domain.startsWith("http")
      ? domain
      : `https://${domain}`
    : (ctx.origin ?? "https://pomahguesthouse.com");
  return `${base.replace(/\/+$/, "")}/book/confirmation/${encodeURIComponent(refOrId)}`;
}

const BOOKING_SELECT =
  "id, reference_code, status, total_amount, paid_amount, payment_status, check_in, check_out, nights, " +
  "guests(full_name, email, phone), booking_rooms(room_type_id, nightly_rate, room_types(name))";

function phoneVariants(phone: string): string[] {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, "");
  const variants = new Set<string>([raw]);

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);

    if (digits.startsWith("62")) {
      variants.add(`0${digits.slice(2)}`);
      variants.add(`+${digits}`);
    } else if (digits.startsWith("0")) {
      variants.add(`62${digits.slice(1)}`);
      variants.add(`+62${digits.slice(1)}`);
    }
  }

  return [...variants].filter(Boolean);
}

export const sendInvoice: ToolHandler = async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
  const refCode = str(args.reference_code);

  // ── 1. Locate the booking ──────────────────────────────────────────────
  let bookingRow: any = null;
  try {
    if (refCode) {
      const { data, error } = await (ctx.supabaseAdmin as any)
        .from("bookings")
        .select(BOOKING_SELECT)
        .ilike("reference_code", refCode)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      bookingRow = data;
    } else if (ctx.phone) {
      // Find guests for this phone, then their newest pending/confirmed booking.
      const variants = phoneVariants(ctx.phone);
      const { data: guests, error: guestErr } = await (ctx.supabaseAdmin as any)
        .from("guests")
        .select("id")
        .in("phone", variants)
        .order("created_at", { ascending: false })
        .limit(5);
      if (guestErr) throw guestErr;
      const ids = ((guests ?? []) as Array<{ id: string }>).map((g) => g.id);
      if (ids.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "Tidak menemukan booking untuk nomor ini.",
        });
      }
      const { data, error } = await (ctx.supabaseAdmin as any)
        .from("bookings")
        .select(BOOKING_SELECT)
        .in("guest_id", ids)
        .in("status", ["pending", "confirmed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      bookingRow = data;
    } else {
      return JSON.stringify({
        ok: false,
        error: "Tidak ada kode booking dan tidak ada nomor tamu — sebutkan kode booking dulu.",
      });
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal mencari booking: ${m}` });
  }

  if (!bookingRow) {
    return JSON.stringify({
      ok: false,
      error: refCode
        ? `Booking dengan kode "${refCode}" tidak ditemukan.`
        : "Belum ada booking aktif untuk nomor tamu ini.",
    });
  }

  // ── 2. Build payload ───────────────────────────────────────────────────
  const b = bookingRow;
  const g = Array.isArray(b.guests) ? b.guests[0] : b.guests;
  const br = Array.isArray(b.booking_rooms) ? b.booking_rooms[0] : b.booking_rooms;
  const rt = ctx.rooms.find((r) => r.id === br?.room_type_id);
  const roomTypeName = br?.room_types?.name ?? rt?.name ?? "Kamar";

  const prop = ctx.property as Record<string, unknown>;
  const total = Number(b.total_amount ?? 0);
  const paid = Number(b.paid_amount ?? 0);
  const remaining = Math.max(0, total - paid);
  const paymentStatus: string = b.payment_status ?? "unpaid";

  return JSON.stringify({
    ok: true,
    booking: {
      reference_code: b.reference_code,
      status: b.status,
      room_type: roomTypeName,
      check_in: b.check_in,
      check_out: b.check_out,
      check_in_tampil: fmtDateID(String(b.check_in ?? "")),
      check_out_tampil: fmtDateID(String(b.check_out ?? "")),
      nights: b.nights,
      total_amount: total,
      total_tampil: `Rp ${total.toLocaleString("id-ID")}`,
      paid_amount: paid,
      paid_tampil: paid > 0 ? `Rp ${paid.toLocaleString("id-ID")}` : null,
      remaining_amount: remaining,
      remaining_tampil: remaining > 0 ? `Rp ${remaining.toLocaleString("id-ID")}` : null,
      payment_status: paymentStatus,
      // Label ramah untuk agent: "Sudah DP", "Lunas", "Belum Bayar"
      payment_label:
        paymentStatus === "paid" ? "LUNAS ✅" : paymentStatus === "partial" ? "SUDAH DP 🔄" : "BELUM DIBAYAR",
      guest: {
        full_name: g?.full_name,
        email: g?.email,
        phone: g?.phone,
      },
    },
    payment_account: {
      bank: prop.payment_bank_name ?? null,
      no_rekening: prop.payment_account_number ?? null,
      atas_nama: prop.payment_account_holder ?? null,
    },
    invoice_url: buildInvoiceUrl(b.reference_code ?? b.id, ctx),
  });
};
