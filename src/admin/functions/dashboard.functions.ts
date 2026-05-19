import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDateID } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Comma-joined distinct room-type names of a booking (via booking_rooms). */
function withRoomsLabel<T extends Record<string, any>>(row: T): T & { rooms_label: string } {
  const names = ((row.booking_rooms as any[]) ?? [])
    .map((br) => br?.room_types?.name)
    .filter((n): n is string => !!n);
  return { ...row, rooms_label: names.length ? [...new Set(names)].join(", ") : "—" };
}

/** Number of rooms attached to a booking row. */
function roomCountOf(row: any): number {
  return ((row?.booking_rooms as any[]) ?? []).length || 0;
}

export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = new Date().toISOString().slice(0, 10);

    const [
      { count: totalBookings },
      { data: arrivals },
      { data: departures },
      { data: rooms },
      { data: recent },
      { data: suggestions },
      { data: threads },
    ] = await Promise.all([
      supabase.from("bookings").select("*", { count: "exact", head: true }),
      supabase
        .from("bookings")
        .select(
          "id, check_in, guest_id, status, guests(full_name), booking_rooms(room_types(name))",
        )
        .eq("check_in", today)
        .neq("status", "cancelled"),
      supabase
        .from("bookings")
        .select(
          "id, check_out, guest_id, status, guests(full_name), booking_rooms(room_types(name))",
        )
        .eq("check_out", today)
        .in("status", ["checked_in", "confirmed"]),
      supabase.from("rooms").select("id, status, number, room_types(name)").order("number"),
      supabase
        .from("bookings")
        .select(
          "id, check_in, check_out, status, total_amount, source, guests(full_name), booking_rooms(room_types(name))",
        )
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("ai_suggestions")
        .select("*")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("whatsapp_threads")
        .select("id, display_name, last_message_preview, last_message_at, unread_count")
        .order("last_message_at", { ascending: false })
        .limit(5),
    ]);

    void 0;
    const { data: stays } = await supabase
      .from("bookings")
      .select("id, booking_rooms(id)")
      .lte("check_in", today)
      .gt("check_out", today)
      .in("status", ["confirmed", "checked_in"]);
    // A stay can occupy several rooms — count rooms, not bookings.
    const occupied = (stays ?? []).reduce((s: number, b: any) => s + roomCountOf(b), 0);
    const totalRooms = rooms?.length ?? 0;

    const { data: revenueRows } = await supabase
      .from("bookings")
      .select("total_amount, status")
      .neq("status", "cancelled");
    const revenue = (revenueRows ?? []).reduce((sum, b) => sum + Number(b.total_amount ?? 0), 0);

    return {
      kpis: {
        totalBookings: totalBookings ?? 0,
        occupied,
        totalRooms,
        occupancy: totalRooms ? Math.round((occupied / totalRooms) * 100) : 0,
        revenue,
        unread: (threads ?? []).reduce((s, t) => s + (t.unread_count ?? 0), 0),
      },
      arrivals: (arrivals ?? []).map(withRoomsLabel),
      departures: (departures ?? []).map(withRoomsLabel),
      rooms: rooms ?? [],
      recent: (recent ?? []).map(withRoomsLabel),
      suggestions: suggestions ?? [],
      threads: threads ?? [],
    };
  });

// ──────────────────────────────────────────────────────────────────
// 30-day trends + AI / WhatsApp / Revenue / Availability metrics
// ──────────────────────────────────────────────────────────────────
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function buildDayBuckets(days: number) {
  const out: { day: string; label: string }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push({
      day: dayKey(d),
      label: formatDateID(d),
    });
  }
  return out;
}

export const getDashboardMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 29);
    const startISO = start.toISOString().slice(0, 10);
    const todayISO = dayKey(today);

    const [
      { data: recentBookings },
      { data: stayBookings },
      { data: aiLogs },
      { data: waMessages },
      { data: waThreads },
      { count: roomCount },
      { data: pendingBookings },
    ] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, total_amount, status, created_at")
        .gte("created_at", `${startISO}T00:00:00.000Z`),
      supabase
        .from("bookings")
        .select("id, check_in, check_out, total_amount, status, booking_rooms(id)")
        .gte("check_out", startISO)
        .neq("status", "cancelled"),
      supabase
        .from("ai_conversation_logs")
        .select("id, created_at, used, rating")
        .gte("created_at", `${startISO}T00:00:00.000Z`),
      supabase
        .from("whatsapp_messages")
        .select("id, direction, sent_at, ai_draft, thread_id")
        .gte("sent_at", `${startISO}T00:00:00.000Z`),
      supabase.from("whatsapp_threads").select("id, status, guest_id, created_at"),
      supabase.from("rooms").select("*", { count: "exact", head: true }),
      // Pending payment = bookings not fully paid (unpaid / partial),
      // regardless of the booking lifecycle status.
      supabase
        .from("bookings")
        .select(
          "id, total_amount, paid_amount, payment_status, status, created_at, guests(full_name)",
        )
        .in("payment_status", ["unpaid", "partial"])
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }),
    ]);

    const totalRooms = roomCount ?? 0;
    const buckets = buildDayBuckets(30);

    const bookingByDay = new Map(buckets.map((b) => [b.day, 0]));
    const revenueByDay = new Map(buckets.map((b) => [b.day, 0]));
    for (const b of recentBookings ?? []) {
      const k = (b.created_at as string).slice(0, 10);
      if (bookingByDay.has(k)) {
        bookingByDay.set(k, (bookingByDay.get(k) ?? 0) + 1);
        if (b.status !== "cancelled") {
          revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + Number(b.total_amount ?? 0));
        }
      }
    }

    // occupancy per day = stays covering that day / totalRooms
    const occupancyByDay = new Map(buckets.map((b) => [b.day, 0]));
    for (const s of stayBookings ?? []) {
      const ci = new Date(s.check_in as string);
      const co = new Date(s.check_out as string);
      const roomCount = roomCountOf(s);
      for (const b of buckets) {
        const d = new Date(b.day);
        if (d >= ci && d < co) {
          occupancyByDay.set(b.day, (occupancyByDay.get(b.day) ?? 0) + roomCount);
        }
      }
    }

    const aiByDay = new Map(buckets.map((b) => [b.day, { total: 0, used: 0 }]));
    for (const a of aiLogs ?? []) {
      const k = (a.created_at as string).slice(0, 10);
      const cur = aiByDay.get(k);
      if (cur) {
        cur.total += 1;
        if (a.used) cur.used += 1;
      }
    }

    const waByDay = new Map(buckets.map((b) => [b.day, { inbound: 0, outbound: 0 }]));
    for (const m of waMessages ?? []) {
      const k = (m.sent_at as string).slice(0, 10);
      const cur = waByDay.get(k);
      if (!cur) continue;
      if (m.direction === "in") cur.inbound += 1;
      else cur.outbound += 1;
    }

    const trend = buckets.map((b) => ({
      day: b.day,
      label: b.label,
      bookings: bookingByDay.get(b.day) ?? 0,
      revenue: revenueByDay.get(b.day) ?? 0,
      occupancy: totalRooms ? Math.round(((occupancyByDay.get(b.day) ?? 0) / totalRooms) * 100) : 0,
      aiTotal: aiByDay.get(b.day)?.total ?? 0,
      aiUsed: aiByDay.get(b.day)?.used ?? 0,
      waIn: waByDay.get(b.day)?.inbound ?? 0,
      waOut: waByDay.get(b.day)?.outbound ?? 0,
    }));

    const revenue30d = trend.reduce((s, t) => s + t.revenue, 0);
    const bookings30d = trend.reduce((s, t) => s + t.bookings, 0);
    const aiTotal30d = trend.reduce((s, t) => s + t.aiTotal, 0);
    const aiUsed30d = trend.reduce((s, t) => s + t.aiUsed, 0);
    const waIn30d = trend.reduce((s, t) => s + t.waIn, 0);
    const waOut30d = trend.reduce((s, t) => s + t.waOut, 0);

    // WhatsApp -> booking conversion (rough): threads with linked guest who has a booking
    const guestIds = (waThreads ?? []).map((t) => t.guest_id).filter((g): g is string => !!g);
    let convertedThreads = 0;
    if (guestIds.length) {
      const { data: convBookings } = await supabase
        .from("bookings")
        .select("guest_id")
        .in("guest_id", guestIds)
        .gte("created_at", `${startISO}T00:00:00.000Z`);
      const set = new Set((convBookings ?? []).map((b) => b.guest_id));
      convertedThreads = set.size;
    }

    // Outstanding balance = total minus what has been paid so far.
    const pendingPaymentTotal = (pendingBookings ?? []).reduce(
      (s, b) => s + Math.max(0, Number(b.total_amount ?? 0) - Number(b.paid_amount ?? 0)),
      0,
    );

    // Today occupancy snapshot
    let occupiedToday = 0;
    for (const s of stayBookings ?? []) {
      if (s.check_in <= todayISO && s.check_out > todayISO) occupiedToday += roomCountOf(s);
    }

    return {
      trend,
      summary: {
        revenue30d,
        bookings30d,
        aiTotal30d,
        aiUsed30d,
        aiAdoptionPct: aiTotal30d ? Math.round((aiUsed30d / aiTotal30d) * 100) : 0,
        waIn30d,
        waOut30d,
        waThreads: waThreads?.length ?? 0,
        waConversionPct: waThreads?.length
          ? Math.round((convertedThreads / waThreads.length) * 100)
          : 0,
        occupiedToday,
        totalRooms,
        availableToday: Math.max(0, totalRooms - occupiedToday),
      },
      pendingPayments: (pendingBookings ?? []).slice(0, 8),
      pendingPaymentCount: (pendingBookings ?? []).length,
      pendingPaymentTotal,
    };
  });
