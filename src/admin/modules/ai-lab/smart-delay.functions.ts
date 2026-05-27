import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartDelayConfig {
  enabled: boolean;
  /** Delay (ms) for very short messages < 15 chars — e.g. "ok", "ya" */
  shortMs: number;
  /** Delay (ms) for medium messages 15–80 chars — typical questions */
  mediumMs: number;
  /** Delay (ms) for long messages > 80 chars — detailed queries */
  longMs: number;
  /** Delay (ms) when a "wait" signal keyword is detected */
  waitSignalMs: number;
  /** Absolute cap — never sleep longer than this */
  maxDelayMs: number;
}

export const DEFAULT_SMART_DELAY: SmartDelayConfig = {
  enabled: true,
  shortMs: 5000,
  mediumMs: 4000,
  longMs: 2000,
  waitSignalMs: 7000,
  // Hard cap from the first message of a burst. The delay now lives in the DB
  // (process_after), not in the request, so this can comfortably exceed the old
  // edge-timeout-driven 8s — giving multi-message bursts room to group fully.
  maxDelayMs: 12000,
};

const SmartDelayConfigSchema = z.object({
  enabled:      z.boolean(),
  shortMs:      z.number().int().min(0).max(30000),
  mediumMs:     z.number().int().min(0).max(30000),
  longMs:       z.number().int().min(0).max(30000),
  waitSignalMs: z.number().int().min(0).max(30000),
  maxDelayMs:   z.number().int().min(0).max(30000),
});

// ─── Server functions ─────────────────────────────────────────────────────────

export const getSmartDelayConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, smart_delay_config")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const raw = data?.smart_delay_config as Partial<SmartDelayConfig> | null;
    const config: SmartDelayConfig = {
      enabled:      raw?.enabled      ?? DEFAULT_SMART_DELAY.enabled,
      shortMs:      raw?.shortMs      ?? DEFAULT_SMART_DELAY.shortMs,
      mediumMs:     raw?.mediumMs     ?? DEFAULT_SMART_DELAY.mediumMs,
      longMs:       raw?.longMs       ?? DEFAULT_SMART_DELAY.longMs,
      waitSignalMs: raw?.waitSignalMs ?? DEFAULT_SMART_DELAY.waitSignalMs,
      maxDelayMs:   raw?.maxDelayMs   ?? DEFAULT_SMART_DELAY.maxDelayMs,
    };
    return { id: data?.id ?? null, config };
  });

export const saveSmartDelayConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id:     z.string().uuid(),
        config: SmartDelayConfigSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("properties")
      .update({ smart_delay_config: data.config })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const getQueueStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Summary stats across all statuses for today
    type QueueRow = {
      hour_wib:     string;
      total:        number;
      replied:      number;
      superseded:   number;
      still_pending: number;
      avg_delay_ms: number | null;
    };

    const { data, error } = await (context.supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => Promise<{ data: QueueRow[] | null; error: unknown }>;
      };
    })
      .from("wa_queue_stats_today")
      .select("*");

    if (error) {
      // View may not exist yet (migration pending) — return empty gracefully
      return { rows: [] as QueueRow[], totals: { total: 0, replied: 0, superseded: 0, avgDelayMs: null as number | null } };
    }

    const rows = (data ?? []) as QueueRow[];
    const totals = rows.reduce(
      (acc, r) => ({
        total:      acc.total      + (r.total ?? 0),
        replied:    acc.replied    + (r.replied ?? 0),
        superseded: acc.superseded + (r.superseded ?? 0),
        avgDelayMs: null, // computed separately below
      }),
      { total: 0, replied: 0, superseded: 0, avgDelayMs: null as number | null },
    );

    // Weighted average delay
    const weightedSum = rows.reduce((s, r) => s + (r.avg_delay_ms ?? 0) * (r.replied + r.superseded), 0);
    const weightedN   = rows.reduce((s, r) => s + r.replied + r.superseded, 0);
    totals.avgDelayMs = weightedN > 0 ? Math.round(weightedSum / weightedN) : null;

    return { rows, totals };
  });
