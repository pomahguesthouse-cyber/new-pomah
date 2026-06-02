import type { ToolContext, ToolHandler } from "../types";

export const getBookings: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const status = typeof args.status === "string" ? args.status : null;
  const paymentStatusRaw = args.payment_status;
  const paymentStatuses: string[] | null =
    typeof paymentStatusRaw === "string"
      ? [paymentStatusRaw]
      : Array.isArray(paymentStatusRaw)
        ? paymentStatusRaw.filter((v): v is string => typeof v === "string")
        : null;
  const date = typeof args.date === "string" ? args.date : null;
  const limit = typeof args.limit === "number" ? args.limit : 10;
  // "recent"  → urut booking yang paling baru dibuat dulu (default; ini yang
  //             dimaksud manajer saat bilang "5 booking terakhir").
  // "upcoming"→ urut tanggal check-in mendekat ke depan; cocok untuk
  //             "siapa check-in besok?" / "jadwal minggu ini".
  const sortRaw = typeof args.sort === "string" ? args.sort.toLowerCase() : "recent";
  const sort: "recent" | "upcoming" = sortRaw === "upcoming" ? "upcoming" : "recent";

  let query = (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(`
      id,
      reference_code,
      created_at,
      check_in,
      check_out,
      status,
      payment_status,
      total_amount,
      paid_amount,
      guests ( full_name, phone ),
      booking_rooms (
        room_types ( name ),
        rooms ( number )
      )
    `)
    .limit(limit);

  if (sort === "upcoming") {
    query = query.order("check_in", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  if (status) {
    query = query.eq("status", status);
  }
  if (paymentStatuses && paymentStatuses.length > 0) {
    query = paymentStatuses.length === 1
      ? query.eq("payment_status", paymentStatuses[0])
      : query.in("payment_status", paymentStatuses);
  }
  if (date) {
    // Basic filter: bookings overlapping the date
    query = query.lte("check_in", date).gte("check_out", date);
  }

  const { data, error } = await query;

  if (error) {
    return JSON.stringify({ ok: false, error: error.message });
  }

  const results = (data ?? []).map((b: any) => {
    const total       = Number(b.total_amount ?? 0);
    const paid        = Number(b.paid_amount  ?? 0);
    const outstanding = Math.max(0, total - paid);
    return {
      id: b.id,
      ref: b.reference_code,
      created_at: b.created_at,
      check_in: b.check_in,
      check_out: b.check_out,
      status: b.status,
      payment_status: b.payment_status,
      total,
      paid,            // jumlah DP yang sudah dibayar (0 kalau unpaid)
      outstanding,     // sisa tagihan = total − paid; PAKAI INI untuk laporan piutang, bukan total
      guest: b.guests?.full_name,
      phone: b.guests?.phone,
      rooms: b.booking_rooms?.map((br: any) => `${br.room_types?.name} (${br.rooms?.number ?? "Belum di-assign"})`).join(", "),
    };
  });

  const totalOutstanding = results.reduce((sum, r) => sum + r.outstanding, 0);

  return JSON.stringify({
    ok: true,
    count: results.length,
    total_outstanding: totalOutstanding, // jumlahkan sisa tagihan seluruh booking di hasil
    bookings: results,
  });
};
