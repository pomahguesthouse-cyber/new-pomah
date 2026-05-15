import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: roomTypes }, { data: seasonal }] = await Promise.all([
      context.supabase.from("room_types").select("id, name, slug, base_rate").order("name"),
      context.supabase.from("seasonal_rates").select("*").order("start_date", { ascending: true }),
    ]);
    return { roomTypes: roomTypes ?? [], seasonal: seasonal ?? [] };
  });

export const updateBaseRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), base_rate: z.number().min(0).max(100000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("room_types")
      .update({ base_rate: data.base_rate })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const upsertSeasonalRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        room_type_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        start_date: z.string(),
        end_date: z.string(),
        multiplier: z.number().min(0).max(10),
        nightly_rate: z.number().min(0).max(100000).nullable().optional(),
        min_stay: z.number().int().min(1).max(60).default(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("seasonal_rates")
        .update({
          room_type_id: data.room_type_id,
          name: data.name,
          start_date: data.start_date,
          end_date: data.end_date,
          multiplier: data.multiplier,
          nightly_rate: data.nightly_rate ?? null,
          min_stay: data.min_stay,
        })
        .eq("id", data.id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase.from("seasonal_rates").insert({
        room_type_id: data.room_type_id,
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        multiplier: data.multiplier,
        nightly_rate: data.nightly_rate ?? null,
        min_stay: data.min_stay,
      });
      if (error) throw error;
    }
    return { ok: true };
  });

export const deleteSeasonalRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("seasonal_rates").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
