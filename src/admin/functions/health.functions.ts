import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Ringkasan kesehatan chatbot 24 jam terakhir.
 * Dipakai halaman /admin/health untuk memantau delivery rate, zombie count,
 * dan distribusi intent — refresh 60 detik dari sisi klien.
 */
export const getChatbotHealthSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    // ── (1) Outbound delivery rate ─────────────────────────────────────────
    const { data: outbound } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("status, sent_at")
      .eq("direction", "out")
      .gte("sent_at", dayAgo)
      .limit(10000);

    const deliveryCounts = { sent: 0, pending: 0, failed: 0, other: 0 };
    for (const row of outbound ?? []) {
      const s = String((row as any).status ?? "other");
      if (s === "sent") deliveryCounts.sent += 1;
      else if (s === "pending") deliveryCounts.pending += 1;
      else if (s === "failed") deliveryCounts.failed += 1;
      else deliveryCounts.other += 1;
    }
    const totalOut = (outbound?.length ?? 0) || 1;
    const deliveryRate = deliveryCounts.sent / totalOut;

    // ── (2) Queue health ───────────────────────────────────────────────────
    const { data: queueRows } = await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("status, last_error, created_at, completed_at")
      .gte("created_at", dayAgo)
      .limit(5000);

    let zombieCount = 0;
    let terminalFailures = 0;
    let pending = 0;
    for (const row of (queueRows ?? []) as any[]) {
      if (typeof row.last_error === "string" && row.last_error.includes("zombie")) zombieCount += 1;
      if (row.status === "failed") terminalFailures += 1;
      if (row.status === "pending" || row.status === "retrying") pending += 1;
    }

    // ── (3) Latency p50/p95 dari metadata routing ──────────────────────────
    const { data: latencyRows } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("metadata")
      .eq("direction", "out")
      .gte("sent_at", dayAgo)
      .not("metadata->>latency_ms", "is", null)
      .limit(5000);

    const latencies: number[] = [];
    for (const r of latencyRows ?? []) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const raw = Number(meta.latency_ms);
      if (Number.isFinite(raw) && raw > 0) latencies.push(raw);
    }
    latencies.sort((a, b) => a - b);
    const pct = (p: number) =>
      latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

    // ── (4) Intent distribution 1 jam terakhir ─────────────────────────────
    const { data: recentIntents } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("metadata")
      .eq("direction", "out")
      .gte("sent_at", hourAgo)
      .not("metadata->>intent", "is", null)
      .limit(2000);

    const intentBuckets = new Map<string, number>();
    for (const r of recentIntents ?? []) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const intent = String(meta.intent ?? "(tanpa intent)");
      intentBuckets.set(intent, (intentBuckets.get(intent) ?? 0) + 1);
    }
    const intents = Array.from(intentBuckets.entries())
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // ── (5) Handoff tickets ────────────────────────────────────────────────
    const { count: openTickets } = await (supabaseAdmin as any)
      .from("handoff_tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    return {
      windowHours: 24,
      generatedAt: new Date(now).toISOString(),
      delivery: {
        total: outbound?.length ?? 0,
        rate: deliveryRate,
        ...deliveryCounts,
      },
      queue: {
        total: queueRows?.length ?? 0,
        pending,
        terminalFailures,
        zombieCount,
      },
      latency: {
        samples: latencies.length,
        p50Ms: pct(0.5),
        p95Ms: pct(0.95),
        p99Ms: pct(0.99),
      },
      intents,
      openHandoffTickets: openTickets ?? 0,
    };
  });
