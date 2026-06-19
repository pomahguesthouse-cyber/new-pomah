import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Endpoint health check ringan: verifikasi koneksi Supabase, ekstensi pgvector,
// dan model embedding via Lovable AI Gateway. Dipakai webhook untuk pre-flight check
// sebelum memproses pesan. Tidak menulis data, tidak mengembalikan PII.

type CheckStatus = "ok" | "fail" | "skipped";

interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  detail?: string;
}

interface HealthResponse {
  ok: boolean;
  checkedAt: string;
  checks: {
    supabase: CheckResult;
    pgvector: CheckResult;
    embedding: CheckResult;
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

async function checkSupabase(): Promise<CheckResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { status: "fail", latencyMs: 0, detail: "missing SUPABASE env" };
  }
  try {
    const { ms } = await timed(async () => {
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Query sangat ringan ke tabel publik; hanya verifikasi konektivitas Data API.
      const { error } = await client
        .from("whatsapp_conversations")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) throw new Error(error.message);
    });
    return { status: "ok", latencyMs: ms };
  } catch (e) {
    return {
      status: "fail",
      latencyMs: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkPgvector(): Promise<CheckResult> {
  try {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { value, ms } = await timed(async () => {
      const { data, error } = await supabaseAdmin.rpc("has_pgvector_extension");
      if (error) throw new Error(error.message);
      return data as boolean | null;
    });
    if (value !== true) {
      return {
        status: "fail",
        latencyMs: ms,
        detail: "pgvector extension not installed",
      };
    }
    return { status: "ok", latencyMs: ms };
  } catch (e) {
    // Fallback: jika RPC belum ada, kembalikan skipped agar tidak memblokir webhook.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("has_pgvector_extension")) {
      return { status: "skipped", latencyMs: 0, detail: "RPC missing" };
    }
    return { status: "fail", latencyMs: 0, detail: msg };
  }
}

async function checkEmbedding(): Promise<CheckResult> {
  const apiKey = process.env.LOVABLE_API_KEY?.trim();
  if (!apiKey) {
    return { status: "fail", latencyMs: 0, detail: "missing LOVABLE_API_KEY" };
  }
  try {
    const { value, ms } = await timed(async () => {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/text-embedding-3-small",
          input: "health-check",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const dims = json.data?.[0]?.embedding?.length ?? 0;
      if (dims === 0) throw new Error("empty embedding vector");
      return dims;
    });
    return { status: "ok", latencyMs: ms, detail: `dims=${value}` };
  } catch (e) {
    return {
      status: "fail",
      latencyMs: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export const Route = createFileRoute("/api/public/health-check")({
  server: {
    handlers: {
      GET: async () => {
        const [supabase, pgvector, embedding] = await Promise.all([
          checkSupabase(),
          checkPgvector(),
          checkEmbedding(),
        ]);

        const ok =
          supabase.status === "ok" &&
          embedding.status === "ok" &&
          pgvector.status !== "fail";

        const body: HealthResponse = {
          ok,
          checkedAt: new Date().toISOString(),
          checks: { supabase, pgvector, embedding },
        };

        return new Response(JSON.stringify(body), {
          status: ok ? 200 : 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
