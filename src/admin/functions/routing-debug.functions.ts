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
