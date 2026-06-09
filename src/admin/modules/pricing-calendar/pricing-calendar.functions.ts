/**
 * Server functions for the admin Pricing Calendar.
 *
 * Mirrors the same data model the managerial Pricing Agent tools use
 * (`room_daily_rates`), but exposed as plain `createServerFn` endpoints
 * so the React UI can call them directly without going through the LLM
 * tool layer.
 *
 * Write paths (upsert / delete) accept a list of explicit dates rather
 * than a (from_date, to_date) range — drag-select can produce
 * non-contiguous selections, and the calendar grid already has the
 * exact YYYY-MM-DD strings in hand.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const MAX_BATCH_DATES = 366;
const MAX_RATE        = 50_000_000;

// ─── List room types ────────────────────────────────────────────────────────

export const listRoomTypesForPricingCalendar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("room_types")
      .select("id, name, base_rate, extrabed_rate")
      .order("name");
    if (error) throw error;
    return { roomTypes: (data ?? []) as Array<{
      id:            string;
      name:          string;
      base_rate:     number | null;
      extrabed_rate: number | null;
    }> };
  });

// ─── Get one month of overrides for a single room type ─────────────────────

export const getMonthDailyRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_type_id: z.string().uuid(),
      /** Inclusive YYYY-MM-DD. */
      from_date:    ISO_DATE,
      /** Inclusive YYYY-MM-DD. */
      to_date:      ISO_DATE,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.to_date < data.from_date) {
      throw new Error("to_date sebelum from_date");
    }
    const { data: rows, error } = await context.supabase
      .from("room_daily_rates")
      .select("date, rate, extrabed_rate, min_stay, stop_sell, note")
      .eq("room_type_id", data.room_type_id)
      .gte("date", data.from_date)
      .lte("date", data.to_date);
    if (error) throw error;
    return {
      overrides: (rows ?? []) as Array<{
        date:          string;
        rate:          number;
        extrabed_rate: number | null;
        min_stay:      number;
        stop_sell:     boolean;
        note:          string | null;
      }>,
    };
  });

// ─── Upsert overrides for a list of dates ──────────────────────────────────

export const upsertDailyRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_type_id:  z.string().uuid(),
      dates:         z.array(ISO_DATE).min(1).max(MAX_BATCH_DATES),
      rate:          z.number().min(0).max(MAX_RATE).optional(),
      extrabed_rate: z.number().min(0).max(MAX_RATE).nullable().optional(),
      stop_sell:     z.boolean().optional(),
      min_stay:      z.number().int().min(1).max(30).optional(),
      note:          z.string().max(500).nullable().optional(),
    })
      // Mirror the agent tool: refuse no-op upserts so the UI can't silently
      // create blank rows.
      .refine(
        (v) =>
          v.rate          !== undefined ||
          v.extrabed_rate !== undefined ||
          v.stop_sell     !== undefined ||
          v.min_stay      !== undefined ||
          v.note          !== undefined,
        { message: "Tidak ada perubahan." },
      )
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Read existing rows so we can preserve untouched fields. Same smart-
    // default policy as `set_daily_room_rate`:
    //   • new row, no rate provided → snapshot room_types.base_rate
    //   • new row, no extrabed_rate → null (means fallback at read time)
    //   • new row, other fields     → false / 1 / null
    const [{ data: existing, error: readErr }, { data: rt, error: rtErr }] = await Promise.all([
      context.supabase
        .from("room_daily_rates")
        .select("date, rate, extrabed_rate, min_stay, stop_sell, note")
        .eq("room_type_id", data.room_type_id)
        .in("date", data.dates),
      context.supabase
        .from("room_types")
        .select("base_rate")
        .eq("id", data.room_type_id)
        .maybeSingle(),
    ]);
    if (readErr) throw readErr;
    if (rtErr)   throw rtErr;
    if (!rt) throw new Error("Tipe kamar tidak ditemukan");

    const baseRate = Number(rt.base_rate ?? 0);
    type ExistingRow = {
      date:          string;
      rate:          number;
      extrabed_rate: number | null;
      min_stay:      number;
      stop_sell:     boolean;
      note:          string | null;
    };
    const existingByDate = new Map<string, ExistingRow>(
      ((existing ?? []) as ExistingRow[]).map((r) => [r.date, r]),
    );

    const rows = data.dates.map((date) => {
      const prev = existingByDate.get(date);
      return {
        room_type_id: data.room_type_id,
        date,
        rate:          data.rate          !== undefined ? data.rate
                     : prev != null ? prev.rate
                     : baseRate,
        extrabed_rate: data.extrabed_rate !== undefined ? data.extrabed_rate
                     : prev != null ? prev.extrabed_rate
                     : null,
        min_stay:      data.min_stay      !== undefined ? data.min_stay
                     : prev != null ? prev.min_stay
                     : 1,
        stop_sell:     data.stop_sell     !== undefined ? data.stop_sell
                     : prev != null ? prev.stop_sell
                     : false,
        note:          data.note          !== undefined ? data.note
                     : prev != null ? prev.note
                     : null,
      };
    });

    const { error } = await context.supabase
      .from("room_daily_rates")
      .upsert(rows, { onConflict: "room_type_id,date" });
    if (error) throw error;
    return { ok: true, count: rows.length };
  });

// ─── Update room_types.base_rate / extrabed_rate ───────────────────────────

/**
 * Update a room type's base rate and/or extrabed rate. This used to live in
 * the standalone /admin/pricing page; consolidated here so all pricing edits
 * happen in one place. The Pricing Agent's `update_room_rate` tool does the
 * same thing for the Telegram/WhatsApp managerial path.
 */
export const updateRoomTypeRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_type_id:  z.string().uuid(),
      base_rate:     z.number().min(0).max(MAX_RATE).optional(),
      extrabed_rate: z.number().min(0).max(MAX_RATE).optional(),
    })
      .refine(
        (v) => v.base_rate !== undefined || v.extrabed_rate !== undefined,
        { message: "Tidak ada perubahan." },
      )
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, number> = {};
    if (data.base_rate     !== undefined) patch.base_rate     = data.base_rate;
    if (data.extrabed_rate !== undefined) patch.extrabed_rate = data.extrabed_rate;

    const { error } = await (context.supabase
      .from("room_types") as any)
      .update(patch)
      .eq("id", data.room_type_id);
    if (error) throw error;
    return { ok: true };
  });

// ─── Delete overrides (= reset to base) ────────────────────────────────────

export const deleteDailyRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      room_type_id: z.string().uuid(),
      dates:        z.array(ISO_DATE).min(1).max(MAX_BATCH_DATES),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await context.supabase
      .from("room_daily_rates")
      .delete()
      .eq("room_type_id", data.room_type_id)
      .in("date", data.dates)
      .select("date");
    if (error) throw error;
    return {
      ok: true,
      deleted_count: (deleted ?? []).length,
    };
  });
