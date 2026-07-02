import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Statistik pemanggilan agent + intent berdasarkan metadata pesan WhatsApp
 * yang sudah terkirim dalam 30 hari terakhir. Dipakai halaman debug
 * `/admin/routing-debug` untuk memverifikasi apakah aturan routing di
 * `agent-router.ts` benar-benar terpakai di produksi.
 */
export const getAgentRoutingStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Ambil metadata pesan bot 30 hari terakhir. Karena jsonb aggregation
    // tidak semuanya bisa lewat PostgREST, kita hitung di JS — batas 5000
    // baris cukup untuk dashboard debug.
    const { data, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("metadata, sent_at")
      .gte("sent_at", since)
      .not("metadata->>agent_key", "is", null)
      .limit(5000);

    if (error) {
      throw new Error(`Gagal memuat statistik: ${error.message}`);
    }

    type Row = { intent: string; agent_key: string; count: number };
    const buckets = new Map<string, Row>();

    for (const r of data ?? []) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const intent = String(meta.intent ?? "(tanpa intent)");
      const agentKey = String(meta.agent_key ?? "(tanpa agent)");
      const key = `${intent}::${agentKey}`;
      const prev = buckets.get(key);
      if (prev) prev.count += 1;
      else buckets.set(key, { intent, agent_key: agentKey, count: 1 });
    }

    const rows = Array.from(buckets.values()).sort((a, b) => b.count - a.count);

    return {
      totalMessages: data?.length ?? 0,
      windowDays: 30,
      rows,
    };
  });

/**
 * Riwayat pemanggilan terakhir untuk satu intent tertentu. Untuk setiap pesan
 * bot yang cocok, kita ambil juga pesan inbound terakhir di thread yang sama
 * sebagai perkiraan "request payload" — pesan bot itu sendiri adalah "response".
 */
export const getIntentCallHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { intent: string; limit?: number }) => ({
    intent: String(input.intent),
    limit: Math.min(Math.max(Number(input.limit ?? 20), 1), 50),
  }))
  .handler(async ({ data }) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    type OutboundRow = {
      id: string;
      thread_id: string | null;
      body: string | null;
      sent_at: string | null;
      metadata: Record<string, unknown> | null;
    };
    type ThreadRow = { id: string; phone: string | null; display_name: string | null };

    const { data: outboundRaw, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, thread_id, body, sent_at, metadata")
      .eq("direction", "outbound")
      .eq("metadata->>intent", data.intent)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(data.limit);

    if (error) throw new Error(`Gagal memuat riwayat: ${error.message}`);
    const outbound = (outboundRaw ?? []) as unknown as OutboundRow[];

    const threadIds = Array.from(new Set(outbound.map((m) => m.thread_id).filter(Boolean) as string[]));

    // Ambil info thread (phone/display_name) untuk konteks.
    const threadsResult = threadIds.length
      ? await supabaseAdmin
          .from("whatsapp_threads")
          .select("id, phone, display_name")
          .in("id", threadIds)
      : { data: [] as ThreadRow[] };
    const threads = (threadsResult.data ?? []) as unknown as ThreadRow[];
    const threadById = new Map<string, ThreadRow>(threads.map((t) => [t.id, t]));

    // Untuk setiap outbound, cari pesan inbound terakhir sebelum sent_at.
    const items = await Promise.all(
      outbound.map(async (msg) => {
        const { data: inbound } = await supabaseAdmin
          .from("whatsapp_messages")
          .select("body, sent_at")
          .eq("thread_id", msg.thread_id ?? "")
          .eq("direction", "inbound")
          .lt("sent_at", msg.sent_at ?? new Date().toISOString())
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const meta = (msg.metadata ?? {}) as Record<string, unknown>;
        const thread = threadById.get(msg.thread_id ?? "");
        return {
          id: msg.id,
          sentAt: msg.sent_at,
          phone: thread?.phone ?? null,
          displayName: thread?.display_name ?? null,
          agentKey: String(meta.agent_key ?? ""),
          agent: String(meta.agent ?? ""),
          toolsUsed: Array.isArray(meta.tools_used) ? (meta.tools_used as string[]) : [],
          latencyMs: typeof meta.latency_ms === "number" ? (meta.latency_ms as number) : null,
          aiLatencyMs: typeof meta.ai_latency_ms === "number" ? (meta.ai_latency_ms as number) : null,
          routingConfidence:
            typeof meta.routing_confidence === "number" ? (meta.routing_confidence as number) : null,
          fastPath: Boolean(meta.fast_path),
          isFallback: Boolean(meta.is_fallback),
          request: inbound?.body ?? null,
          requestAt: inbound?.sent_at ?? null,
          response: msg.body ?? "",
        };
      }),
    );

    return { intent: data.intent, items };
  });
