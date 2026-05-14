import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ days: z.number().int().min(7).max(180).default(30) }).parse(d ?? { days: 30 }))
  .handler(async ({ data, context }) => {
    const days = data.days;
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);

    const [{ data: bookings }, { data: rooms }] = await Promise.all([
      context.supabase
        .from("bookings")
        .select("check_in, check_out, total_amount, nightly_rate, status, source")
        .gte("check_in", startStr)
        .neq("status", "cancelled"),
      context.supabase.from("rooms").select("id"),
    ]);

    const totalRooms = rooms?.length ?? 1;
    const series: Array<{ date: string; occupancy: number; revenue: number; bookings: number }> = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const occupied = (bookings ?? []).filter((b) => ds >= b.check_in && ds < b.check_out).length;
      const dayRevenue = (bookings ?? [])
        .filter((b) => b.check_in === ds)
        .reduce((s, b) => s + Number(b.total_amount ?? 0), 0);
      const dayBookings = (bookings ?? []).filter((b) => b.check_in === ds).length;
      series.push({
        date: ds,
        occupancy: Math.round((occupied / totalRooms) * 100),
        revenue: Math.round(dayRevenue),
        bookings: dayBookings,
      });
    }

    const totalRevenue = (bookings ?? []).reduce((s, b) => s + Number(b.total_amount ?? 0), 0);
    const nights = (bookings ?? []).reduce((s, b) => {
      const ci = new Date(b.check_in);
      const co = new Date(b.check_out);
      return s + Math.max(1, Math.round((+co - +ci) / 86400000));
    }, 0);
    const adr = nights ? totalRevenue / nights : 0;
    const revpar = (totalRevenue / (totalRooms * days));

    const sourceMix: Record<string, number> = {};
    for (const b of bookings ?? []) {
      sourceMix[b.source] = (sourceMix[b.source] ?? 0) + 1;
    }

    return {
      series,
      kpis: {
        totalRevenue: Math.round(totalRevenue),
        adr: Math.round(adr),
        revpar: Math.round(revpar),
        bookings: bookings?.length ?? 0,
      },
      sourceMix,
    };
  });
