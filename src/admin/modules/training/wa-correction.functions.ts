import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedWaCorrectionExample, embedWaCorrectionSession } from "@/ai/training-rag.service";
import { loadTrainingAiConfig } from "@/services/training-ai-config";
import { embedInline, updateRowTolerant } from "@/services/training-embedding";

async function embedCorrectionInline(correctionId: string): Promise<void> {
  await embedInline(`correction:${correctionId}`, async (signal) => {
    const config = await loadTrainingAiConfig();
    if (!config) return false;
    const result = await embedWaCorrectionExample(supabaseAdmin, correctionId, config, { signal });
    if (!result.ok) console.warn("[wa-correction.embed] skipped:", result.reason);
    return result.ok;
  });
}

export async function embedSessionInline(sessionId: string): Promise<void> {
  await embedInline(`session:${sessionId}`, async (signal) => {
    const config = await loadTrainingAiConfig();
    if (!config) return false;
    const result = await embedWaCorrectionSession(supabaseAdmin, sessionId, config, { signal });
    if (!result.ok) console.warn("[wa-correction-session.embed] skipped:", result.reason);
    return result.ok;
  });
}

function normalizeWaIdentity(raw: unknown): string | null {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;
  value = value
    .replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (!value) return null;
  if (value.startsWith("620")) value = "62" + value.slice(3);
  else if (value.startsWith("0")) value = "62" + value.slice(1);
  else if (/^8\d{7,14}$/.test(value)) value = "62" + value;
  return value;
}

function isPublicWaPhone(value: unknown): boolean {
  const phone = normalizeWaIdentity(value);
  return !!phone && /^62\d{8,14}$/.test(phone);
}

async function resolvePublicWaPhone(...identities: unknown[]): Promise<string | null> {
  for (const identity of identities) {
    const normalized = normalizeWaIdentity(identity);
    if (normalized && isPublicWaPhone(normalized)) return normalized;
  }

  for (const identity of identities) {
    const raw = typeof identity === "string" ? identity.trim() : "";
    if (!raw) continue;
    try {
      const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: raw });
      const resolved = normalizeWaIdentity(data);
      if (resolved && isPublicWaPhone(resolved)) return resolved;
    } catch (e) {
      console.warn("[wa-correction] canonical phone resolve failed:", e);
    }
  }

  return null;
}

async function normalizeCorrectionThreadRows(rows: any[]) {
  const normalizedRows = await Promise.all(rows.map(async (row) => {
    const publicPhone = await resolvePublicWaPhone(
      row.canonical_phone,
      row.phone,
      row.external_chat_id,
      row.lid_alias,
    );
    if (!publicPhone || publicPhone === row.phone) return row;

    void (supabaseAdmin as any)
      .from("whatsapp_threads")
      .update({
        phone: publicPhone,
        canonical_phone: publicPhone,
        identity_type: "phone",
        sync_error: null,
      })
      .eq("id", row.id)
      .then(({ error }: { error?: { message?: string } | null }) => {
        if (error) console.warn("[wa-correction] thread phone cleanup failed:", error.message);
      });

    return {
      ...row,
      phone: publicPhone,
      canonical_phone: publicPhone,
      identity_type: "phone",
      sync_error: null,
    };
  }));

  const byPhone = new Map<string, any>();
  for (const row of normalizedRows) {
    const key = isPublicWaPhone(row.phone) ? normalizeWaIdentity(row.phone)! : `thread:${row.id}`;
    const current = byPhone.get(key);
    if (!current || new Date(row.last_message_at ?? 0).getTime() > new Date(current.last_message_at ?? 0).getTime()) {
      byPhone.set(key, row);
    }
  }
  return [...byPhone.values()];
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
    if (id && data.status === "approved") await embedCorrectionInline(id as string);
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
    const textChanged =
      data.userMessage !== undefined || data.botWrongReply !== undefined || data.idealReply !== undefined;
    const leavesApproved = data.status !== undefined && data.status !== "approved";
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
    if (textChanged || leavesApproved) {
      patch.embedding = null;
      patch.embedding_updated_at = null;
    }

    await updateRowTolerant(
      (next) => supabaseAdmin.from("wa_correction_dataset").update(next).eq("id", data.id),
      patch,
    );

    if (data.status === "approved" || (data.status === undefined && textChanged)) {
      await embedCorrectionInline(data.id);
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
      await embedCorrectionInline(row.id);
      const { data: saved } = await supabaseAdmin
        .from("wa_correction_dataset")
        .select("embedding")
        .eq("id", row.id)
        .maybeSingle();
      if ((saved as { embedding?: string | null } | null)?.embedding) ok++;
      else failed++;
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
      .select("id, phone, display_name, status, unread_count, ai_auto, last_message_preview, last_message_at, chat_summary, chat_summary_json, canonical_phone, external_chat_id, lid_alias, identity_type, sync_error, last_synced_at")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: await normalizeCorrectionThreadRows((rows ?? []) as any[]) };
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
      await embedSessionInline(id as string);
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
