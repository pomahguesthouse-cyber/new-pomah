import { fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "../types";

type BookingReportType =
  | "recent_created_not_checked_in"
  | "upcoming_checkin"
  | "today_checkin"
  | "today_checkout"
  | "unpaid"
  | "active_stay"
  | "cancelled";

function formatStayDates(checkIn: unknown, checkOut: unknown): string {
  const start = typeof checkIn === "string" ? checkIn : "";
  const end = typeof checkOut === "string" ? checkOut : "";

  if (!start && !end) return "Tanggal menginap belum diisi";
  if (start && !end) return fmtDateID(start);
  if (!start && end) return `Sampai ${fmtDateID(end)}`;

  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);

  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
    return `${fmtDateID(start)} – ${fmtDateID(end)}`;
  }

  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}–${endDay} ${fmtDateID(start).split(" ").slice(1).join(" ")}`;
  }

  return `${fmtDateID(start)} – ${fmtDateID(end)}`;
}

function normalizeReportType(args: Record<string, unknown>): BookingReportType {
  const raw = typeof args.report_type === "string" ? args.report_type : "";
  const known: BookingReportType[] = [
    "recent_created_not_checked_in",
    "upcoming_checkin",
    "today_checkin",
    "today_checkout",
    "unpaid",
    "active_stay",
    "cancelled",
  ];
  if (known.includes(raw as BookingReportType)) return raw as BookingReportType;

  const sortRaw = typeof args.sort === "string" ? args.sort.toLowerCase() : "recent";
  return sortRaw === "upcoming" ? "upcoming_checkin" : "recent_created_not_checked_in";
}

export const getBookings: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const status = typeof args.status === "string" ? args.status : null;
  const paymentStatusRaw = args.payment_status;
  const explicitPaymentStatuses: string[] | null =
    typeof paymentStatusRaw === "string"
      ? [paymentStatusRaw]
      : Array.isArray(paymentStatusRaw)
        ? paymentStatusRaw.filter((v): v is string => typeof v === "string")
        : null;
  const date = typeof args.date === "string" ? args.date : null;
  const today = typeof ctx.today === "string" ? ctx.today : new Date().toISOString().slice(0, 10);
  const effectiveDate = date ?? today;
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const reportType = normalizeReportType(args);

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

  if (reportType === "recent_created_not_checked_in") {
    query = query
      .gte("check_in", today)
      .not("status", "in", "(checked_in,checked_out,cancelled)")
      .order("created_at", { ascending: false });
  } else if (reportType === "upcoming_checkin") {
    query = query
      .gte("check_in", effectiveDate)
      .not("status", "in", "(checked_out,cancelled)")
      .order("check_in", { ascending: true });
  } else if (reportType === "today_checkin") {
    query = query
      .eq("check_in", effectiveDate)
      .not("status", "in", "(checked_out,cancelled)")
      .order("created_at", { ascending: false });
  } else if (reportType === "today_checkout") {
    query = query
      .eq("check_out", effectiveDate)
      .not("status", "in", "(cancelled)")
      .order("created_at", { ascending: false });
  } else if (reportType === "unpaid") {
    query = query
      .in("payment_status", ["unpaid", "partial"])
      .not("status", "in", "(checked_out,cancelled)")
      .order("check_in", { ascending: true });
  } else if (reportType === "active_stay") {
    query = query
      .lte("check_in", effectiveDate)
      .gt("check_out", effectiveDate)
      .in("status", ["confirmed", "checked_in"])
      .order("check_in", { ascending: true });
  } else if (reportType === "cancelled") {
    query = query
      .eq("status", "cancelled")
      .order("created_at", { ascending: false });
  }

  if (status) {
    query = query.eq("status", status);
  }
  if (explicitPaymentStatuses && explicitPaymentStatuses.length > 0) {
    query = explicitPaymentStatuses.length === 1
      ? query.eq("payment_status", explicitPaymentStatuses[0])
      : query.in("payment_status", explicitPaymentStatuses);
  }
  if (date && reportType === "recent_created_not_checked_in") {
    // For recent-created report, date is an optional overlap filter.
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
      stay_dates: formatStayDates(b.check_in, b.check_out),
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

  const totalOutstanding = results.reduce((sum: number, r: { outstanding: number }) => sum + r.outstanding, 0);

  return JSON.stringify({
    ok: true,
    report_type: reportType,
    count: results.length,
    total_outstanding: totalOutstanding, // jumlahkan sisa tagihan seluruh booking di hasil
    bookings: results,
  });
};
