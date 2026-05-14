import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
        .select("id, check_in, guest_id, room_type_id, status, guests(full_name), room_types(name)")
        .eq("check_in", today)
        .neq("status", "cancelled"),
      supabase
        .from("bookings")
        .select("id, check_out, guest_id, room_type_id, status, guests(full_name), room_types(name)")
        .eq("check_out", today)
        .in("status", ["checked_in", "confirmed"]),
      supabase.from("rooms").select("id, status, number, room_types(name)").order("number"),
      supabase
        .from("bookings")
        .select("id, check_in, check_out, status, total_amount, source, guests(full_name), room_types(name)")
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
      .select("id")
      .lte("check_in", today)
      .gt("check_out", today)
      .in("status", ["confirmed", "checked_in"]);
    const occupied = stays?.length ?? 0;
    const totalRooms = rooms?.length ?? 0;

    const { data: revenueRows } = await supabase
      .from("bookings")
      .select("total_amount, status")
      .neq("status", "cancelled");
    const revenue = (revenueRows ?? []).reduce(
      (sum, b) => sum + Number(b.total_amount ?? 0),
      0,
    );

    return {
      kpis: {
        totalBookings: totalBookings ?? 0,
        occupied,
        totalRooms,
        occupancy: totalRooms ? Math.round((occupied / totalRooms) * 100) : 0,
        revenue,
        unread: (threads ?? []).reduce((s, t) => s + (t.unread_count ?? 0), 0),
      },
      arrivals: arrivals ?? [],
      departures: departures ?? [],
      rooms: rooms ?? [],
      recent: recent ?? [],
      suggestions: suggestions ?? [],
      threads: threads ?? [],
    };
  });
