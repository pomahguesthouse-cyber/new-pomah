/**
 * Cron worker: run due article schedules + expire past events + notify admin.
 *
 * Hit by pg_cron every 5 minutes (see
 * supabase/migrations/20260530150000_seo_article_schedules.sql).
 * Also safe to invoke manually via GET/POST.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  generateArticleCore,
  type ArticleCategory,
} from "@/admin/modules/seo/article-generator.functions";
import { computeNextRunUTC, type Frequency } from "@/admin/modules/seo/schedules.functions";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { getWaitUntil, runDeferred } from "@/lib/cf-context";

type DueRow = {
  id: string;
  topic: string;
  category: ArticleCategory;
  frequency: Frequency;
  hour: number;
  minute: number;
  day_of_week: number | null;
  day_of_month: number | null;
};

async function expireOldEvents(client: SupabaseClient) {
  // Mark events whose end-date has passed as 'expired'
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await (client as any)
    .from("seo_generated_articles")
    .update({ status: "expired" })
    .eq("category", "event")
    .eq("status", "active")
    .not("event_end_date", "is", null)
    .lt("event_end_date", today)
    .select("id");
  if (error) {
    console.warn("[article-cron] expireOldEvents failed:", error.message);
    return 0;
  }
  return (data ?? []).length;
}

async function notifyAdmins(
  client: SupabaseClient,
  message: string,
): Promise<void> {
  // Pull token + admin phones
  const { data: prop } = await (client as any)
    .from("properties")
    .select("fonnte_token, public_domain")
    .limit(1)
    .maybeSingle();
  const token = (prop?.fonnte_token as string | null)?.trim();
  if (!token) return;
  const { data: managers } = await (client as any)
    .from("property_managers")
    .select("phone, role")
    .in("role", ["super_admin"])
    .limit(20);
  const phones = (managers ?? [])
    .map((m: any) => (m.phone as string | null)?.trim())
    .filter(Boolean) as string[];
  if (phones.length === 0) return;
  await Promise.all(
    phones.map((p) => sendWhatsAppMessage(token, p, message).catch(() => undefined)),
  );
}

async function runDueSchedule(
  client: SupabaseClient,
  row: DueRow,
): Promise<{ ok: boolean; titles?: string[]; error?: string }> {
  try {
    const result = await generateArticleCore(client, {
      topic: row.topic,
      category: row.category,
    });

    let insertedTitles: string[] = [];
    if (result.mode === "events") {
      const rows = result.events.map((e) => ({
        schedule_id: row.id,
        category: "event" as const,
        title: e.title,
        topic: row.topic,
        meta_description: e.description,
        paragraphs: e.paragraphs,
        tags: e.tags,
        sources: result.web_sources,
        event_start_date: e.event_start_date,
        event_end_date: e.event_end_date,
        event_date_label: e.event_date_label,
        event_location: e.event_location,
        image_url: e.image_url,
        status: "active",
      }));
      if (rows.length > 0) {
        const { data: ins } = await (client as any)
          .from("seo_generated_articles")
          .insert(rows)
          .select("title");
        insertedTitles = (ins ?? []).map((r: any) => r.title);
      }
    } else {
      const { data: inserted } = await (client as any)
        .from("seo_generated_articles")
        .insert({
          schedule_id: row.id,
          category: result.article.category,
          title: result.article.title,
          topic: row.topic,
          meta_description: result.article.meta_description,
          paragraphs: result.article.paragraphs,
          tags: result.article.tags,
          sources: result.web_sources,
          event_start_date: result.article.event_start_date,
          event_end_date: result.article.event_end_date,
          event_location: result.article.event_location,
          image_url: result.article.image_url,
          status: "active",
        })
        .select("title")
        .single();
      if (inserted?.title) insertedTitles = [inserted.title];
    }

    // Advance schedule
    const next = computeNextRunUTC({
      frequency: row.frequency,
      hour: row.hour,
      minute: row.minute,
      day_of_week: row.day_of_week,
      day_of_month: row.day_of_month,
    });
    await (client as any)
      .from("seo_article_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: next.toISOString(),
        last_error: null,
      })
      .eq("id", row.id);

    return { ok: true, titles: insertedTitles };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[article-cron] schedule ${row.id} failed:`, msg);
    // Push the next run forward to avoid hammering on failure
    const next = computeNextRunUTC({
      frequency: row.frequency,
      hour: row.hour,
      minute: row.minute,
      day_of_week: row.day_of_week,
      day_of_month: row.day_of_month,
    });
    await (client as any)
      .from("seo_article_schedules")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: next.toISOString(),
        last_error: msg.slice(0, 500),
      })
      .eq("id", row.id);
    return { ok: false, error: msg };
  }
}

async function handle(_request: Request): Promise<Response> {
  const client = supabaseAdmin as unknown as SupabaseClient;

  // 1. Expire old events first
  const expired = await expireOldEvents(client);

  // 2. Find schedules due now
  const nowIso = new Date().toISOString();
  const { data: due, error } = await (client as any)
    .from("seo_article_schedules")
    .select("id, topic, category, frequency, hour, minute, day_of_week, day_of_month")
    .eq("enabled", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(5); // safety cap per run

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, expired }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const results: Array<{ id: string; ok: boolean; titles?: string[]; error?: string }> = [];
  for (const r of (due ?? []) as DueRow[]) {
    const out = await runDueSchedule(client, r);
    results.push({ id: r.id, ...out });
  }

  // 3. WhatsApp notify for successful generations
  const allNewTitles = results.flatMap((r) => (r.ok ? r.titles ?? [] : []));
  if (allNewTitles.length > 0) {
    const lines = allNewTitles.map((t) => `• ${t}`).join("\n");
    await notifyAdmins(
      client,
      `🤖 *Konten SEO Baru* (${allNewTitles.length})\n\n${lines}\n\nCek di Admin → SEO → Content Studio.`,
    );
  }

  return new Response(
    JSON.stringify({ ok: true, expired_events: expired, runs: results }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/cron/run-article-schedules")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
