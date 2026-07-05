import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateEmbedding } from "@/ai/embedding.service";
import { embedWaCorrectionExample } from "@/ai/training-rag.service";

async function getTrainingAiConfig() {
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("ai_api_key, ai_base_url, ai_model")
    .limit(1)
    .maybeSingle();
  const p = (prop ?? {}) as { ai_api_key?: string; ai_base_url?: string; ai_model?: string };
  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey || null;
  if (!apiKey) return null;
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";
  return { apiKey, baseUrl, model };
}

async function embedCorrectionAsync(correctionId: string): Promise<void> {
  try {
    const cfg = await getTrainingAiConfig();
    if (!cfg) return;
    const res = await embedWaCorrectionExample(supabaseAdmin, correctionId, cfg);
    if (!res.ok) console.warn("[wa-correction.embed] skipped:", res.reason);
  } catch (e) {
    console.warn("[wa-correction.embed] failed:", e);
  }
}

function transcriptToEmbeddingText(summary: string | null | undefined, transcript: unknown): string {
  const rows = Array.isArray(transcript) ? transcript : [];
  const lines = rows.slice(-60).map((m) => {
    const row = m as { direction?: string; body?: string };
    const who = row.direction === "in" ? "Tamu" : "Asisten";
    const body = String(row.body ?? "").trim();
    return body ? `${who}: ${body}` : "";
  }).filter(Boolean);
  return [
    summary?.trim() ? `Ringkasan percakapan: ${summary.trim()}` : "",
    "Transcript terkoreksi:",
    lines.join("\n"),
  ].filter(Boolean).join("\n").slice(0, 12000);
}

async function embedSessionAsync(sessionId: string, summary: string | null | undefined, transcript: unknown): Promise<void> {
  try {
    const cfg = await getTrainingAiConfig();
    if (!cfg) return;
    const text = transcriptToEmbeddingText(summary, transcript);
    if (!text.trim()) return;
    const embedding = await generateEmbedding(cfg, text);
    if (!embedding) return;
    const { error } = await supabaseAdmin
      .from("wa_correction_sessions")
      .update({
        embedding: embedding as unknown as string,
        embedding_updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (error) console.warn("[wa-correction-session.embed] update failed:", error.message);
  } catch (e) {
    console.warn("[wa-correction-session.embed] failed:", e);
  }
}

export const createWhatsappCorrectionFromMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      userMessageId: z.string().uuid(),
      wrongReplyMessageId: z.string().uuid(),
      idealReply: z.string().trim().min(1).max(8000),
      correctIntent: z.string().trim().max(120).nullable().optional(),
      correctAgent: z.string().trim().max(120).nullable().optional(),
      errorType: z.string().trim().max(120).nullable().optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      notes: z.string().trim().max(2000).nullable().optional(),
      status: z.enum(["draft", "approved", "archived"]).default("approved"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: id, error } = await supabaseAdmin.rpc("create_wa_correction_from_messages", {
      p_user_message_id: data.userMessageId,
      p_wrong_reply_message_id: data.wrongReplyMessageId,
      p_ideal_reply: data.idealReply,
      p_correct_intent: data.correctIntent ?? null,
      p_correct_agent: data.correctAgent ?? null,
      p_error_type: data.errorType ?? null,
      p_severity: data.severity,
      p_notes: data.notes ?? null,
      p_status: data.status,
    });
    if (error) throw error;
    if (id && data.status === "approved") await embedCorrectionAsync(id as string);
    return { ok: true, id: id as string };
  });

export const listWhatsappCorrections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.enum(["all", "draft", "approved", "archived"]).default("all"),
      limit: z.number().int().min(1).max(300).default(100),
    }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("wa_correction_dataset")
      .select("id, canonical_phone, thread_id, session_id, user_message_id, wrong_reply_message_id, user_message, bot_wrong_reply, ideal_reply, correct_intent, correct_agent, error_type, severity, status, notes, source, embedding_updated_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [] };
  });

export const updateWhatsappCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      userMessage: z.string().trim().min(1).max(4000).optional(),
      botWrongReply: z.string().trim().min(1).max(8000).optional(),
      idealReply: z.string().trim().min(1).max(8000).optional(),
      correctIntent: z.string().trim().max(120).nullable().optional(),
      correctAgent: z.string().trim().max(120).nullable().optional(),
      errorType: z.string().trim().max(120).nullable().optional(),
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      status: z.enum(["draft", "approved", "archived"]).optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const patch: Record<string, unknown> = {};
    if (data.userMessage !== undefined) patch.user_message = data.userMessage;
    if (data.botWrongReply !== undefined) patch.bot_wrong_reply = data.botWrongReply;
    if (data.idealReply !== undefined) patch.ideal_reply = data.idealReply;
    if (data.correctIntent !== undefined) patch.correct_intent = data.correctIntent;
    if (data.correctAgent !== undefined) patch.correct_agent = data.correctAgent;
    if (data.errorType !== undefined) patch.error_type = data.errorType;
    if (data.severity !== undefined) patch.severity = data.severity;
    if (data.status !== undefined) patch.status = data.status;
    if (data.notes !== undefined) patch.notes = data.notes;

    const { error } = await supabaseAdmin
      .from("wa_correction_dataset")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;

    if (data.status === "approved" || data.idealReply !== undefined || data.userMessage !== undefined || data.botWrongReply !== undefined) {
      await embedCorrectionAsync(data.id);
    }
    return { ok: true };
  });

export const deleteWhatsappCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("wa_correction_dataset")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const backfillWhatsappCorrectionEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ maxRows: z.number().int().min(1).max(200).default(50) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("wa_correction_dataset")
      .select("id")
      .eq("status", "approved")
      .is("embedding", null)
      .limit(data.maxRows);
    if (error) throw error;

    let ok = 0;
    let failed = 0;
    for (const row of rows ?? []) {
      try {
        await embedCorrectionAsync(row.id);
        ok++;
      } catch {
        failed++;
      }
    }
    return { processed: rows?.length ?? 0, ok, failed };
  });

export const listWhatsappCorrectionCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(100).default(40) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin.rpc("list_wa_correction_candidates", {
      p_limit: data.limit,
    });
    if (error) throw error;
    return { rows: rows ?? [] };
  });

export const listWhatsappCorrectionThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200).default(80) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("whatsapp_threads")
      .select("id, phone, display_name, status, unread_count, ai_auto, last_message_preview, last_message_at, chat_summary, chat_summary_json")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: rows ?? [] };
  });

export const listWhatsappCorrectionThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, thread_id, direction, body, sent_at, metadata, wpp_id")
      .eq("thread_id", data.threadId)
      .order("sent_at", { ascending: true });
    if (error) throw error;
    return { rows: rows ?? [] };
  });

const transcriptMessageSchema = z.object({
  id: z.string().uuid(),
  direction: z.string(),
  body: z.string().max(12000),
  originalBody: z.string().max(12000).nullable().optional(),
  edited: z.boolean().optional(),
  sent_at: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
});

export const createWhatsappCorrectionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    threadId: z.string().uuid(),
    title: z.string().trim().max(180).nullable().optional(),
    summary: z.string().trim().max(3000).nullable().optional(),
    correctedTranscript: z.array(transcriptMessageSchema).min(1).max(200),
    status: z.enum(["draft", "approved", "archived"]).default("approved"),
  }).parse(d))
  .handler(async ({ data }) => {
    const { data: id, error } = await supabaseAdmin.rpc("create_wa_correction_session_from_thread", {
      p_thread_id: data.threadId,
      p_title: data.title ?? null,
      p_conversation_summary: data.summary ?? null,
      p_corrected_transcript: data.correctedTranscript,
      p_status: data.status,
    });
    if (error) throw error;
    if (id && data.status === "approved") {
      await embedSessionAsync(id as string, data.summary, data.correctedTranscript);
    }
    return { ok: true, id: id as string };
  });

export const listWhatsappCorrectionSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("wa_correction_sessions")
      .select("id, thread_id, canonical_phone, title, conversation_summary, status, embedding_updated_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: rows ?? [] };
  });
