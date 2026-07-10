import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ChatbotEvaluationRow {
  id: string;
  threadId: string | null;
  guest: string;
  phone: string | null;
  intent: string;
  agent: string;
  score: number;
  issue: string;
  suggestedFix: string;
  userMessage: string;
  currentResponse: string;
  sentAt: string | null;
  latencyMs: number | null;
}

const evalInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(20),
    windowDays: z.number().int().min(1).max(30).optional().default(7),
  });

function asMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function directionKind(value: unknown): "in" | "out" | "other" {
  const v = String(value ?? "").toLowerCase();
  if (v === "in" || v === "inbound") return "in";
  if (v === "out" || v === "outbound") return "out";
  return "other";
}

function hasBookingCta(text: string): boolean {
  return /\b(mau|ingin|dibantu|bantu|booking|pesan|reservasi)\b/i.test(text);
}

function scoreReply(args: {
  userMessage: string;
  response: string;
  intent: string;
  agent: string;
  latencyMs: number | null;
  isFallback: boolean;
}): { score: number; issue: string; suggestedFix: string } {
  const issues: string[] = [];
  const fixes: string[] = [];
  let score = 100;
  const response = args.response.trim();
  const intent = args.intent.toLowerCase();
  const combined = `${args.userMessage}\n${response}`;

  if (!response) {
    score -= 55;
    issues.push("Balasan kosong");
    fixes.push("Pastikan agent selalu menghasilkan jawaban singkat atau fallback ramah.");
  }
  if (args.isFallback || /maaf.*(?:sistem|sedang).*lambat|sedang\s+gangguan|coba\s+lagi/i.test(response)) {
    score -= 25;
    issues.push("Fallback terdeteksi");
    fixes.push("Cek retry audit, API model, dan konteks RAG untuk mengurangi fallback.");
  }
  if ((args.latencyMs ?? 0) > 15_000) {
    score -= 12;
    issues.push("Latency di atas 15 detik");
    fixes.push("Review smart delay, queue health, dan durasi LLM.");
  }
  if (/(booking|reservation|availability|kamar|harga|price|rate)/i.test(intent) && !hasBookingCta(response)) {
    score -= 12;
    issues.push("Tidak ada CTA booking");
    fixes.push("Tambahkan pertanyaan penutup seperti 'Mau saya bantu booking, Kak?'.");
  }
  if (/complaint|komplain|keluhan|urgent|issue/i.test(intent) && !/(maaf|mohon maaf|eskalasi|manager|admin)/i.test(response)) {
    score -= 14;
    issues.push("Keluhan belum diawali empati/escalation");
    fixes.push("Awali dengan permintaan maaf dan arahkan ke Manager Agent bila perlu.");
  }
  if (/tidak\s+menyediakan\s+brosur/i.test(combined)) {
    score -= 16;
    issues.push("Jawaban brosur kontradiktif");
    fixes.push("Jika PDF brosur terlampir, gunakan caption yang menyatakan brosur dikirim.");
  }
  if (!/\bkak\b/i.test(response) && response.length > 0) {
    score -= 6;
    issues.push("Tone hospitality kurang");
    fixes.push("Gunakan sapaan 'Kak' secara natural.");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issue: issues.join("; ") || "Baik",
    suggestedFix: fixes.join(" ") || "Pertahankan pola jawaban ini sebagai contoh baik.",
  };
}

export const evaluateRecentWhatsAppConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => evalInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: messages, error } = await (context.supabase as any)
      .from("whatsapp_messages")
      .select("id, thread_id, body, direction, sent_at, metadata, status")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(Math.min(data.limit * 12, 600));
    if (error) throw error;

    const rows = ((messages ?? []) as any[]).slice().reverse();
    const threadIds = Array.from(new Set(rows.map((r) => r.thread_id).filter(Boolean))) as string[];
    const threadMap = new Map<string, { phone: string | null; display_name: string | null }>();

    if (threadIds.length > 0) {
      const { data: threads } = await (context.supabase as any)
        .from("whatsapp_threads")
        .select("id, phone, display_name")
        .in("id", threadIds);
      for (const t of (threads ?? []) as any[]) {
        threadMap.set(String(t.id), {
          phone: t.phone ?? null,
          display_name: t.display_name ?? null,
        });
      }
    }

    const lastInboundByThread = new Map<string, any>();
    const evaluations: ChatbotEvaluationRow[] = [];

    for (const msg of rows) {
      const threadId = msg.thread_id ? String(msg.thread_id) : null;
      const dir = directionKind(msg.direction);
      const key = threadId ?? `phone:${msg.phone ?? "unknown"}`;

      if (dir === "in") {
        lastInboundByThread.set(key, msg);
        continue;
      }
      if (dir !== "out") continue;

      const inbound = lastInboundByThread.get(key);
      const meta = asMeta(msg.metadata);
      const intent = String(meta.intent ?? "(tanpa intent)");
      const agent = String(meta.agent_key ?? meta.agent ?? "(tanpa agent)");
      const latencyMs = Number(meta.latency_ms);
      const thread = threadId ? threadMap.get(threadId) : null;
      const scored = scoreReply({
        userMessage: String(inbound?.body ?? ""),
        response: String(msg.body ?? ""),
        intent,
        agent,
        latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
        isFallback: Boolean(meta.is_fallback),
      });

      evaluations.push({
        id: String(msg.id),
        threadId,
        guest: thread?.display_name || thread?.phone || "Guest",
        phone: thread?.phone ?? null,
        intent,
        agent,
        score: scored.score,
        issue: scored.issue,
        suggestedFix: scored.suggestedFix,
        userMessage: String(inbound?.body ?? ""),
        currentResponse: String(msg.body ?? ""),
        sentAt: msg.sent_at ?? null,
        latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      windowDays: data.windowDays,
      evaluations: evaluations.reverse().slice(0, data.limit),
    };
  });

const promoteInput = z.object({
  user_message: z.string().min(1),
  current_response: z.string().min(1),
  ideal_response: z.string().min(1),
  intent: z.string().nullable().optional(),
  agent_key: z.string().nullable().optional(),
});

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const promoteEvaluationToTrainingExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => promoteInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const id = genId("tr");
    const row = {
      id,
      stage: null,
      state_before: null,
      user_message: data.user_message,
      intent: data.intent ?? null,
      slot_updates: {
        source: "ai-lab-evaluation",
        agent_key: data.agent_key ?? null,
        current_response: data.current_response,
      },
      ideal_assistant_response: data.ideal_response,
      source_file: "ai-lab-evaluation",
      training_type: "evaluation-promoted",
      language: "id-ID",
      is_active: true,
    };

    const { error } = await (context.supabase as any)
      .from("chatbot_training_examples")
      .insert(row);
    if (error) {
      return { ok: false, id: null, draft: row, error: error.message };
    }
    return { ok: true, id, draft: row, error: null };
  });
