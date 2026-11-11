import { fmtDateID, nextDay } from "@/lib/date";
import { normalizePhone } from "@/services/wa-autoreply/identity";
import { presentPhone, roleCanUseTool, unauthorizedToolMessage } from "@/services/manager-chat/rbac";
import type { ToolContext, ToolHandler } from "../types";

type BookingReportType =
  | "recent_created_not_checked_in"
  | "upcoming_checkin"
  | "today_checkin"
  | "today_checkout"
  | "tomorrow_checkin"
  | "tomorrow_checkout"
  | "unpaid"
  | "active_stay"
  | "cancelled"
  | "date_range"
  | "search"
  | "detail";

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

function addDays(iso: string, days: number): string {
  if (days === 1) return nextDay(iso);
  const d = new Date(`${iso}T00:00:00+07:00`);
  d.setTime(d.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function normalizeReportType(args: Record<string, unknown>): BookingReportType {
  const raw = typeof args.report_type === "string" ? args.report_type : "";
  const known: BookingReportType[] = [
    "recent_created_not_checked_in",
    "upcoming_checkin",
    "today_checkin",
    "today_checkout",
    "tomorrow_checkin",
    "tomorrow_checkout",
    "unpaid",
    "active_stay",
    "cancelled",
    "date_range",
    "search",
    "detail",
  ];
  if (known.includes(raw as BookingReportType)) return raw as BookingReportType;

  if (typeof args.reference_code === "string" && args.reference_code.trim()) return "detail";
  if (typeof args.search === "string" && args.search.trim()) return "search";
  if (typeof args.date_from === "string" || typeof args.date_to === "string") return "date_range";

  const sortRaw = typeof args.sort === "string" ? args.sort.toLowerCase() : "recent";
  return sortRaw === "upcoming" ? "upcoming_checkin" : "recent_created_not_checked_in";
}

const SELECT = `
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
`;

export const getBookings: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({ ok: false, error: "Hanya staf terdaftar yang boleh melihat daftar booking." });
  }
  if (!roleCanUseTool(ctx.managerRole, "get_bookings")) {
    return JSON.stringify({ ok: false, error: unauthorizedToolMessage(ctx.managerRole, "get_bookings") });
  }

  const status = typeof args.status === "string" ? args.status : null;
  const paymentStatusRaw = args.payment_status;
  const explicitPaymentStatuses: string[] | null =
    typeof paymentStatusRaw === "string"
      ? [paymentStatusRaw]
      : Array.isArray(paymentStatusRaw)
        ? paymentStatusRaw.filter((v): v is string => typeof v === "string")
        : null;
  const date = typeof args.date === "string" ? args.date : null;
  const dateFrom = typeof args.date_from === "string" ? args.date_from : null;
  const dateTo = typeof args.date_to === "string" ? args.date_to : null;
  const search = typeof args.search === "string" ? args.search.trim() : "";
  const referenceCode = typeof args.reference_code === "string" ? args.reference_code.trim() : "";
  const today = typeof ctx.today === "string" ? ctx.today : new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);
  const effectiveDate = date ?? today;
  const rawLimit = typeof args.limit === "number" ? args.limit : 10;
  const limit = Math.max(1, Math.min(30, Math.floor(rawLimit) || 10));
  const rawOffset = typeof args.offset === "number" ? args.offset : 0;
  const offset = Math.max(0, Math.floor(rawOffset) || 0);
  const reportType = normalizeReportType(args);

  const fetchLimit = reportType === "search" ? Math.max(limit + 1, 100) : limit + 1;
  const fetchOffset = reportType === "search" ? 0 : offset;
  let query = (ctx.supabaseAdmin as any)
    .from("bookings")
    .select(SELECT)
    .range(fetchOffset, fetchOffset + fetchLimit - 1);

  if (reportType === "detail" && referenceCode) {
    query = query.ilike("reference_code", referenceCode.replace(/[%_]/g, ""));
  } else if (reportType === "recent_created_not_checked_in") {
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
  } else if (reportType === "tomorrow_checkin") {
    query = query
      .eq("check_in", tomorrow)
      .not("status", "in", "(checked_out,cancelled)")
      .order("created_at", { ascending: false });
  } else if (reportType === "tomorrow_checkout") {
    query = query
      .eq("check_out", tomorrow)
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
  } else if (reportType === "date_range") {
    const from = dateFrom ?? date ?? today;
    const to = dateTo ?? dateFrom ?? date ?? today;
    query = query
      .lte("check_in", to)
      .gt("check_out", from)
      .not("status", "in", "(cancelled)")
      .order("check_in", { ascending: true });
  } else if (reportType === "search") {
    query = query
      .not("status", "in", "(cancelled)")
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
    query = query.lte("check_in", date).gte("check_out", date);
  }

  const { data, error } = await query;

  if (error) {
    return JSON.stringify({ ok: false, error: error.message });
  }

  let rows = (data ?? []) as any[];

  if (reportType === "search" && search) {
    const needle = search.toLowerCase();
    const needleDigits = needle.replace(/\D/g, "");
    rows = rows.filter((b) => {
      const ref = String(b.reference_code ?? "").toLowerCase();
      const name = String(b.guests?.full_name ?? "").toLowerCase();
      const phone = String(b.guests?.phone ?? "");
      const phoneNorm = phone ? normalizePhone(phone) : "";
      if (ref.includes(needle) || name.includes(needle)) return true;
      if (needleDigits.length >= 4) {
        return phoneNorm.includes(needleDigits) || phone.replace(/\D/g, "").includes(needleDigits);
      }
      return false;
    });
  }

  if (reportType === "detail" && referenceCode) {
    const exact = referenceCode.toUpperCase();
    rows = rows.filter((b) => String(b.reference_code ?? "").toUpperCase() === exact);
  }

  const pagedSource = reportType === "search" ? rows.slice(offset) : rows;
  const hasMore = pagedSource.length > limit;
  const page = hasMore ? pagedSource.slice(0, limit) : pagedSource;

  const results = page.map((b: any) => {
    const total       = Number(b.total_amount ?? 0);
    const paid        = Number(b.paid_amount  ?? 0);
    const outstanding = Math.max(0, total - paid);
    const rawPhone = b.guests?.phone ?? "";
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
      paid,
      outstanding,
      guest: b.guests?.full_name,
      phone: presentPhone(rawPhone, ctx.managerRole, { forceMask: reportType !== "detail" }),
      phone_masked: rawPhone ? true : false,
      rooms: b.booking_rooms?.map((br: any) => `${br.room_types?.name} (${br.rooms?.number ?? "Belum di-assign"})`).join(", "),
    };
  });

  const totalOutstanding = results.reduce((sum: number, r: { outstanding: number }) => sum + r.outstanding, 0);

  return JSON.stringify({
    ok: true,
    report_type: reportType,
    count: results.length,
    offset,
    limit,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    total_outstanding: totalOutstanding,
    bookings: results,
  });
};
