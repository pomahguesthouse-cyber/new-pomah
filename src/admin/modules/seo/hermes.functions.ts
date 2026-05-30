/**
 * Hermes Agent — Admin server functions (Pola A).
 *
 * Pola A: Hermes runs on the user's laptop and is exposed to them via a
 * Telegram bot. When Hermes finishes a task, it writes a row to
 * public.hermes_tasks using the Supabase service role key. The Admin
 * never sends commands to Hermes from the web — it only reads the feed.
 *
 * Hence: this module only exposes SELECT and DELETE. There is no write path.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export type HermesTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type HermesTask = {
  id: string;
  created_at: string;
  updated_at: string;
  source_chat_id: string | null;
  source_username: string | null;
  source_message_id: string | null;
  task_type: string;
  title: string;
  prompt: string | null;
  output: string | null;
  status: HermesTaskStatus;
  error_message: string | null;
  metadata: Record<string, any>;
};

/** List the most recent Hermes tasks, newest first. */
export const listHermesTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        task_type: z.string().max(60).optional(),
        status: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
      })
      .partial()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const base = db(context.supabase)
      .from("hermes_tasks")
      .select(
        "id, created_at, updated_at, source_chat_id, source_username, source_message_id, task_type, title, prompt, output, status, error_message, metadata",
      );

    let q: any = base.order("created_at", { ascending: false }).limit(data.limit ?? 50);
    if (data.task_type) q = q.eq("task_type", data.task_type);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    const result: { tasks: HermesTask[]; migration_missing: boolean } = {
      tasks: [],
      migration_missing: false,
    };
    if (error) {
      // Table may not exist yet (migration not applied). Degrade gracefully.
      result.migration_missing = true;
      return result;
    }
    result.tasks = (rows ?? []) as HermesTask[];
    return result;
  });

/** Delete a single Hermes task from the feed. */
export const deleteHermesTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("hermes_tasks")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Aggregate counts shown above the feed. */
export const getHermesTaskStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("hermes_tasks")
      .select("status, task_type, created_at");
    if (error) {
      return {
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        last_24h: 0,
        by_type: {} as Record<string, number>,
      };
    }
    const rows = (data ?? []) as Array<{ status: string; task_type: string; created_at: string }>;
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const by_type: Record<string, number> = {};
    let completed = 0,
      failed = 0,
      pending = 0,
      last_24h = 0;
    for (const r of rows) {
      by_type[r.task_type] = (by_type[r.task_type] ?? 0) + 1;
      if (r.status === "completed") completed++;
      else if (r.status === "failed") failed++;
      else pending++;
      if (new Date(r.created_at).getTime() > dayAgo) last_24h++;
    }
    return { total: rows.length, completed, failed, pending, last_24h, by_type };
  });
