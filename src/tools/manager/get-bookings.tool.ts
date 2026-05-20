import type { ToolContext, ToolHandler } from "../types";

export const getBookings: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const status = typeof args.status === "string" ? args.status : null;
  const date = typeof args.date === "string" ? args.date : null;
  const limit = typeof args.limit === "number" ? args.limit : 10;

  let query = (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(`
      id,
      reference_code,
      check_in,
      check_out,
      status,
      total_amount,
      guests ( full_name, phone ),
      booking_rooms (
        room_types ( name ),
        rooms ( number )
      )
    `)
    .order("check_in", { ascending: true })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }
  if (date) {
    // Basic filter: bookings overlapping the date
    query = query.lte("check_in", date).gte("check_out", date);
  }

  const { data, error } = await query;

  if (error) {
    return JSON.stringify({ ok: false, error: error.message });
  }

  const results = (data ?? []).map((b: any) => ({
    id: b.id,
    ref: b.reference_code,
    check_in: b.check_in,
    check_out: b.check_out,
    status: b.status,
    total: b.total_amount,
    guest: b.guests?.full_name,
    phone: b.guests?.phone,
    rooms: b.booking_rooms?.map((br: any) => `${br.room_types?.name} (${br.rooms?.number ?? "Belum di-assign"})`).join(", "),
  }));

  return JSON.stringify({
    ok: true,
    count: results.length,
    bookings: results,
  });
};
