import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGENT_KEYS, mergeAiLabConfig } from "./ai-lab.functions";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

function nowIso() {
  return new Date().toISOString();
}

async function safeCount(client: SupabaseClient, table: string, filter?: (q: any) => any): Promise<number> {
  try {
    let q: any = (client as any).from(table).select("id", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows<T>(client: SupabaseClient, table: string, build: (q: any) => any): Promise<T[]> {
  try {
    const { data, error } = await build((client as any).from(table));
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export interface AiLabControlSnapshot {
  propertyId: string | null;
  activeAgents: number;
  totalAgents: number;
  autoReplyAgents: number;
  globalAutoReplyPaused: boolean;
  unreadThreads: number;
  unreadMessages: number;
  openThreads: number;
  queuePending: number;
  queueFailed: number;
  queueZombie: number;
  lastUpdatedIso: string;
}

export const getAiLabControlSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = db(context.supabase);
    const { data: prop } = await (client as any)
      .from("properties")
      .select("id, ai_lab_config")
      .limit(1)
      .maybeSingle();

    const config = mergeAiLabConfig((prop as any)?.ai_lab_config);
    const agentValues = Object.values(config.agents);
    const activeAgents = agentValues.filter((a) => a.enabled).length;
    const autoReplyAgents = agentValues.filter((a) => a.enabled && a.autoReply).length;

    const unreadThreads = await safeCount(client, "whatsapp_threads", (q) => q.gt("unread_count", 0));
    const openThreads = await safeCount(client, "whatsapp_threads", (q) => q.eq("status", "open"));

    const threadRows = await safeRows<{ unread_count?: number }>(client, "whatsapp_threads", (q) =>
      q.select("unread_count").gt("unread_count", 0).limit(500),
    );
    const unreadMessages = threadRows.reduce((sum, row) => sum + Number(row.unread_count ?? 0), 0);

    const queueRows = await safeRows<{ status?: string; last_error?: string | null }>(
      client,
      "wa_conversation_queue",
      (q) => q.select("status, last_error").in("status", ["queued", "processing", "retrying", "failed"]).limit(500),
    );
    const queuePending = queueRows.filter((r) => ["queued", "processing", "retrying"].includes(String(r.status))).length;
    const queueFailed = queueRows.filter((r) => String(r.status) === "failed").length;
    const queueZombie = queueRows.filter((r) => /zombie|timeout|max_wait/i.test(String(r.last_error ?? ""))).length;

    return {
      propertyId: (prop as any)?.id ?? null,
      activeAgents,
      totalAgents: AGENT_KEYS.length,
      autoReplyAgents,
      globalAutoReplyPaused: autoReplyAgents === 0,
      unreadThreads,
      unreadMessages,
      openThreads,
      queuePending,
      queueFailed,
      queueZombie,
      lastUpdatedIso: nowIso(),
    } satisfies AiLabControlSnapshot;
  });

export interface RagPreviewRow {
  id: string;
  userMessage: string;
  idealResponse: string;
  intent: string | null;
  agentKey: string | null;
  lexicalScore: number;
  createdAt: string | null;
  used: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function lexicalScore(query: string, candidate: string): number {
  const q = new Set(tokenize(query));
  const c = new Set(tokenize(candidate));
  if (q.size === 0 || c.size === 0) return 0;
  let hit = 0;
  for (const word of q) if (c.has(word)) hit += 1;
  return Math.round((hit / q.size) * 100);
}

export const previewTrainingRagMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ query: z.string().min(2).max(500), limit: z.number().int().min(1).max(10).default(5) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const rows = await safeRows<any>(client, "ai_conversation_logs", (q) =>
      q
        .select("id, user_message, ideal_response, ai_response, intent, agent_key, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    );

    const ranked = rows
      .map((row) => {
        const userMessage = String(row.user_message ?? "");
        const idealResponse = String(row.ideal_response ?? row.ai_response ?? "");
        const score = lexicalScore(data.query, `${userMessage} ${idealResponse}`);
        return {
          id: String(row.id ?? crypto.randomUUID()),
          userMessage,
          idealResponse,
          intent: row.intent ?? null,
          agentKey: row.agent_key ?? null,
          lexicalScore: score,
          createdAt: row.created_at ?? null,
          used: false,
        } satisfies RagPreviewRow;
      })
      .filter((row) => row.lexicalScore > 0 || row.userMessage.toLowerCase().includes(data.query.toLowerCase()))
      .sort((a, b) => b.lexicalScore - a.lexicalScore)
      .slice(0, data.limit)
      .map((row, idx) => ({ ...row, used: idx < Math.min(3, data.limit) }));

    return { rows: ranked, fallback: true, note: "Preview memakai lexical fallback agar tetap aman walau vector search tidak tersedia di admin UI." };
  });

export interface AgentQualityScore {
  agentKey: string;
  score: number;
  signal: string;
  retryCount: number;
  resolvedRetryCount: number;
}

export const getAgentQualityScores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = db(context.supabase);
    const retryRows = await safeRows<any>(client, "ai_retry_stats", (q) =>
      q.select("agent_key, total, resolved_count").limit(500),
    );
    const totals = new Map<string, { retry: number; resolved: number }>();
    for (const row of retryRows) {
      const key = String(row.agent_key ?? "unknown");
      const current = totals.get(key) ?? { retry: 0, resolved: 0 };
      current.retry += Number(row.total ?? 0);
      current.resolved += Number(row.resolved_count ?? 0);
      totals.set(key, current);
    }

    return AGENT_KEYS.map((agentKey) => {
      const t = totals.get(agentKey) ?? { retry: 0, resolved: 0 };
      const unresolved = Math.max(0, t.retry - t.resolved);
      const score = Math.max(55, Math.min(100, 100 - unresolved * 6 - t.retry * 1));
      return {
        agentKey,
        score,
        retryCount: t.retry,
        resolvedRetryCount: t.resolved,
        signal: t.retry === 0 ? "Belum ada retry tercatat" : `${t.resolved}/${t.retry} retry resolved`,
      } satisfies AgentQualityScore;
    });
  });

export const getAiLabAuditTrail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = db(context.supabase);
    const rows = await safeRows<any>(client, "ai_lab_config_audit", (q) =>
      q.select("id, changed_at, changed_by, section, reason, old_value, new_value").order("changed_at", { ascending: false }).limit(50),
    );
    return {
      installed: rows.length > 0,
      rows: rows.map((row) => ({
        id: String(row.id),
        changedAt: row.changed_at ?? null,
        changedBy: row.changed_by ?? "admin",
        section: row.section ?? "ai_lab_config",
        reason: row.reason ?? "manual update",
      })),
    };
  });
