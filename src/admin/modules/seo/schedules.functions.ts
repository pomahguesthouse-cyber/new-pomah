/**
 * SEO article schedules + generated-article CRUD.
 *
 * The cron worker (api/cron/run-article-schedules) reads/updates the same
 * tables via the service role; this module is the human-side API.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/* ─── Display-time date label recovery ────────────────────────────────────── */
/**
 * Scans Bahasa-Indonesia text for a date phrase. Used at read-time so
 * existing rows whose event_date_label is NULL still display a usable
 * date in the slider — without needing to regenerate or backfill.
 */
const INDO_MONTHS_RE =
  "(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)";
const DATE_RANGE = new RegExp(
  `\\b(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+${INDO_MONTHS_RE}(?:\\s+(\\d{4}))?`,
  "i",
);
const SINGLE_DATE = new RegExp(`\\b(\\d{1,2})\\s+${INDO_MONTHS_RE}(?:\\s+(\\d{4}))?`, "i");
const RECURRING =
  /\b(Setiap|Tiap)\s+(Hari|Minggu|Bulan|Akhir Pekan|Weekend|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu|Jum'?at(?:[\s-]*(?:Minggu|Sabtu))?)\b[^.,;\n]*/i;
const HINGGA = new RegExp(`Hingga\\s+(\\d{1,2}\\s+${INDO_MONTHS_RE}(?:\\s+\\d{4})?)`, "i");
const SEPANJANG = new RegExp(`Sepanjang\\s+${INDO_MONTHS_RE}(?:\\s+\\d{4})?`, "i");

export function extractDateFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m1 = cleaned.match(DATE_RANGE);
  if (m1) return `${m1[1]}–${m1[2]} ${m1[3]}${m1[4] ? " " + m1[4] : ""}`;
  const m2 = cleaned.match(HINGGA);
  if (m2) return `Hingga ${m2[1]}`;
  const m3 = cleaned.match(SEPANJANG);
  if (m3) return m3[0];
  const m4 = cleaned.match(RECURRING);
  if (m4) return m4[0].trim().slice(0, 60);
  const m5 = cleaned.match(SINGLE_DATE);
  if (m5) return `${m5[1]} ${m5[2]}${m5[3] ? " " + m5[3] : ""}`;
  return null;
}

/** Pick the best date label for display — works for both fresh and legacy rows. */
export function resolveEventDateLabel(row: {
  event_date_label?: string | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  meta_description?: string | null;
  description?: string | null;
  paragraphs?: string[] | null;
}): string {
  if (row.event_date_label && row.event_date_label.trim()) return row.event_date_label.trim();

  const fmt = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  if (row.event_start_date && row.event_end_date && row.event_start_date !== row.event_end_date) {
    return `${fmt(row.event_start_date)} – ${fmt(row.event_end_date)}`;
  }
  if (row.event_start_date) return fmt(row.event_start_date);
  if (row.event_end_date) return fmt(row.event_end_date);

  const haystack = [
    row.meta_description,
    row.description,
    ...(Array.isArray(row.paragraphs) ? row.paragraphs : []),
  ]
    .filter(Boolean)
    .join(" ");
  return extractDateFromText(haystack) ?? "Tanggal menyusul";
}

export type Frequency = "daily" | "weekly" | "monthly";
export type ArticleCategory = "pariwisata" | "event" | "destinasi";

export type ScheduleRow = {
  id: string;
  created_at: string;
  updated_at: string;
  topic: string;
  category: ArticleCategory;
  frequency: Frequency;
  hour: number;
  minute: number;
  day_of_week: number | null;
  day_of_month: number | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  last_error: string | null;
};

export type GeneratedArticleRow = {
  id: string;
  created_at: string;
  schedule_id: string | null;
  category: ArticleCategory;
  title: string;
  topic: string | null;
  meta_description: string | null;
  paragraphs: string[];
  tags: string[];
  sources: Array<{ title: string; url: string }>;
  event_start_date: string | null;
  event_end_date: string | null;
  event_date_label: string | null;
  event_location: string | null;
  image_url: string | null;
  status: "active" | "expired" | "archived";
};

/* ─── Time helpers (WIB = UTC+7) ──────────────────────────────────────────── */

/**
 * Compute next_run_at in UTC from a WIB local schedule.
 *
 * - daily   → next time today/tomorrow that matches hour+minute (WIB).
 * - weekly  → next occurrence of day_of_week (0=Sun..6=Sat in WIB) at hour:minute.
 * - monthly → next day_of_month (1..28, WIB) at hour:minute.
 */
export function computeNextRunUTC(args: {
  frequency: Frequency;
  hour: number;
  minute: number;
  day_of_week: number | null;
  day_of_month: number | null;
  from?: Date;
}): Date {
  const from = args.from ?? new Date();
  const WIB_OFFSET_MS = 7 * 3600 * 1000;
  const wibNow = new Date(from.getTime() + WIB_OFFSET_MS);

  // Build a "candidate" in WIB then convert back
  const makeWibCandidate = (year: number, month: number, day: number, h: number, m: number) =>
    new Date(Date.UTC(year, month, day, h, m, 0, 0) - WIB_OFFSET_MS); // back to UTC

  const yy = wibNow.getUTCFullYear();
  const mo = wibNow.getUTCMonth();
  const dd = wibNow.getUTCDate();

  if (args.frequency === "daily") {
    let cand = makeWibCandidate(yy, mo, dd, args.hour, args.minute);
    if (cand <= from) cand = makeWibCandidate(yy, mo, dd + 1, args.hour, args.minute);
    return cand;
  }

  if (args.frequency === "weekly") {
    const target = args.day_of_week ?? 0;
    const wibDow = wibNow.getUTCDay(); // 0..6 in WIB
    let delta = (target - wibDow + 7) % 7;
    let cand = makeWibCandidate(yy, mo, dd + delta, args.hour, args.minute);
    if (cand <= from) cand = makeWibCandidate(yy, mo, dd + delta + 7, args.hour, args.minute);
    return cand;
  }

  // monthly
  const target = Math.min(28, Math.max(1, args.day_of_month ?? 1));
  let cand = makeWibCandidate(yy, mo, target, args.hour, args.minute);
  if (cand <= from) cand = makeWibCandidate(yy, mo + 1, target, args.hour, args.minute);
  return cand;
}

/* ─── Schedules CRUD ──────────────────────────────────────────────────────── */

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("seo_article_schedules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { schedules: [] as ScheduleRow[], migration_missing: true };
    return { schedules: (data ?? []) as ScheduleRow[], migration_missing: false };
  });

export const createSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        topic: z.string().min(3).max(300),
        category: z.enum(["pariwisata", "event", "destinasi"]),
        frequency: z.enum(["daily", "weekly", "monthly"]),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59).optional(),
        day_of_week: z.number().int().min(0).max(6).nullable().optional(),
        day_of_month: z.number().int().min(1).max(28).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const next = computeNextRunUTC({
      frequency: data.frequency,
      hour: data.hour,
      minute: data.minute ?? 0,
      day_of_week: data.day_of_week ?? null,
      day_of_month: data.day_of_month ?? null,
    });
    const { data: row, error } = await db(context.supabase)
      .from("seo_article_schedules")
      .insert({
        topic: data.topic,
        category: data.category,
        frequency: data.frequency,
        hour: data.hour,
        minute: data.minute ?? 0,
        day_of_week: data.frequency === "weekly" ? data.day_of_week ?? 0 : null,
        day_of_month: data.frequency === "monthly" ? data.day_of_month ?? 1 : null,
        enabled: data.enabled ?? true,
        next_run_at: next.toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return { schedule: row as ScheduleRow };
  });

export const updateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean().optional(),
        hour: z.number().int().min(0).max(23).optional(),
        minute: z.number().int().min(0).max(59).optional(),
        frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
        day_of_week: z.number().int().min(0).max(6).nullable().optional(),
        day_of_month: z.number().int().min(1).max(28).nullable().optional(),
        topic: z.string().min(3).max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Fetch existing to re-compute next_run_at if timing changed
    const { data: existing } = await db(context.supabase)
      .from("seo_article_schedules")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const cur = (existing ?? {}) as ScheduleRow;
    const patch: Record<string, unknown> = {};
    const timingChanged =
      data.hour !== undefined ||
      data.minute !== undefined ||
      data.frequency !== undefined ||
      data.day_of_week !== undefined ||
      data.day_of_month !== undefined;
    for (const k of ["enabled", "hour", "minute", "frequency", "day_of_week", "day_of_month", "topic"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (timingChanged) {
      patch.next_run_at = computeNextRunUTC({
        frequency: (data.frequency ?? cur.frequency) as Frequency,
        hour: data.hour ?? cur.hour,
        minute: data.minute ?? cur.minute,
        day_of_week: data.day_of_week ?? cur.day_of_week ?? null,
        day_of_month: data.day_of_month ?? cur.day_of_month ?? null,
      }).toISOString();
    }
    const { error } = await db(context.supabase)
      .from("seo_article_schedules")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("seo_article_schedules")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ─── Generated articles ──────────────────────────────────────────────────── */

export const listGeneratedArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        limit: z.number().int().min(1).max(100).optional(),
        include_expired: z.boolean().optional(),
      })
      .partial()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const base = db(context.supabase)
      .from("seo_generated_articles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 24);
    const q: any = data.include_expired ? base : base.eq("status", "active");
    const { data: rows, error } = await q;
    const result: { articles: GeneratedArticleRow[]; migration_missing: boolean } = {
      articles: [],
      migration_missing: false,
    };
    if (error) {
      result.migration_missing = true;
      return result;
    }
    // Backfill event_date_label at read-time for legacy rows that have null.
    result.articles = ((rows ?? []) as GeneratedArticleRow[]).map((r) => {
      if (r.category !== "event") return r;
      if (r.event_date_label && r.event_date_label.trim()) return r;
      return { ...r, event_date_label: resolveEventDateLabel(r) };
    });
    return result;
  });

export const deleteGeneratedArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("seo_generated_articles")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ─── Manual event creation (admin) ───────────────────────────────────────── */

export const createManualEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        title: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        event_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        event_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        event_date_label: z.string().max(100).optional(),
        event_location: z.string().max(300).optional(),
        image_url: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const start = data.event_start_date || null;
    const end = data.event_end_date || start || null;

    let dateLabel = (data.event_date_label || "").trim();
    if (!dateLabel) {
      const fmt = (iso: string) =>
        new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      if (start && end && start !== end) dateLabel = `${fmt(start)} – ${fmt(end)}`;
      else if (start) dateLabel = fmt(start);
      else dateLabel = "Tanggal menyusul";
    }

    const row = {
      category: "event" as const,
      title: data.title.trim(),
      topic: "manual",
      meta_description: data.description?.trim() || null,
      paragraphs: data.description?.trim() ? [data.description.trim()] : [],
      tags: [] as string[],
      sources: [] as unknown[],
      event_start_date: start,
      event_end_date: end,
      event_date_label: dateLabel,
      event_location: data.event_location?.trim() || null,
      image_url: data.image_url?.trim() || null,
      status: "active" as const,
    };

    const { data: inserted, error } = await db(context.supabase)
      .from("seo_generated_articles")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: (inserted as any)?.id ?? null };
  });

/* ─── Public getter for the city-guide event slider ───────────────────────── */

export type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  event_start_date: string | null;
  event_end_date: string | null;
  event_date_label: string | null;
  event_location: string | null;
  image_url: string | null;
  tags: string[];
};

/**
 * Public, no-auth getter for active (non-expired) event articles.
 * Reads the `active_public_events` view so the SELECT cannot leak
 * draft articles or other categories.
 */
export const listActivePublicEvents = createServerFn({ method: "GET" })
  .handler(async () => {
    // Use the anon client so this works on the public homepage / explore page
    const { supabasePublic } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabasePublic as any)
      .from("active_public_events")
      .select(
        "id, title, description, event_start_date, event_end_date, event_date_label, event_location, image_url, tags",
      )
      .limit(20);
    if (error) {
      // View may not exist yet (migration not applied).
      return { events: [] as PublicEvent[] };
    }
    // Backfill event_date_label at read-time for legacy rows.
    const events = ((data ?? []) as PublicEvent[]).map((r) => {
      if (r.event_date_label && r.event_date_label.trim()) return r;
      return { ...r, event_date_label: resolveEventDateLabel(r) };
    });
    return { events };
  });
