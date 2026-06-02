/**
 * Admin server functions for the Competitor Prices dashboard.
 *
 * - runCompetitorScrape: triggers the Pricing Agent's
 *   scrape_competitor_prices tool directly (no need to round-trip
 *   through full agent reasoning).
 * - listCompetitorPrices: paginated read of scrape history.
 * - deleteCompetitorPrice: cleanup individual rows.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin, supabasePublic } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { todayWIB } from "@/lib/date";
import { scrapeCompetitorPrices } from "@/tools/pricing/scrape-competitor-prices.tool";

export const runCompetitorScrape = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      city: z.string().min(2).max(60).default("Semarang"),
      extra_keywords: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(20).default(8),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties").select("*").limit(1).maybeSingle();
    const raw = await scrapeCompetitorPrices(
      {
        city: data.city,
        extra_keywords: data.extra_keywords ?? "",
        limit: data.limit,
      },
      {
        supabasePublic: supabasePublic as any,
        supabaseAdmin:  supabaseAdmin  as any,
        rooms:          [],
        property:       (prop ?? {}) as any,
        today:          todayWIB(),
      },
    );
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = { ok: false, error: "invalid json" }; }
    return parsed;
  });

export const listCompetitorPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("competitor_prices")
      .select("*")
      .order("fetched_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const deleteCompetitorPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("competitor_prices")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ─── Curated competitor list (properties.competitor_hotels) ─────────────────

export const getCompetitorHotels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("properties")
      .select("id, competitor_hotels")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const raw = data?.competitor_hotels;
    const list = Array.isArray(raw)
      ? raw.filter((h): h is string => typeof h === "string")
      : typeof raw === "string"
        ? (JSON.parse(raw || "[]") as unknown[]).filter((h): h is string => typeof h === "string")
        : [];
    return { hotels: list, propertyId: (data?.id as string | undefined) ?? null };
  });

export const saveCompetitorHotels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      hotels: z.array(z.string().trim().min(2).max(120)).max(30),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    // De-dupe (case-insensitive) while preserving original casing of first hit.
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const h of data.hotels.map((s) => s.trim()).filter((s) => s.length > 0)) {
      const key = h.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(h);
    }
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!prop?.id) throw new Error("Properti belum dikonfigurasi.");
    const { error } = await (supabaseAdmin as any)
      .from("properties")
      .update({ competitor_hotels: cleaned })
      .eq("id", prop.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, hotels: cleaned };
  });
