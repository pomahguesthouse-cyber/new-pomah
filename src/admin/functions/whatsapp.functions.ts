import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  persistThreadSummary,
  seedMissingThreadSummary,
  summaryIsMissing,
  clearWhatsappThreadSummary,
} from "@/services/whatsapp-summary.service";
import {
  chatCompletionText,
  getLovableAiConfig,
  resolvePropertyAiConfig,
} from "@/services/ai-client.service";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { isMetaReengagementError } from "@/services/guest-whatsapp.service";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  WA_OUTBOUND_BUCKET,
  WA_SIGNED_URL_TTL_SECONDS,
  adminSendFailureMessage,
  fileNameForMime,
  parseAdminSendInput,
  selectOutboundMediaType,
  threadPreview,
} from "@/services/wa-outbound-attachment";
import { resolveHumanTakeoverMs } from "@/admin/modules/ai-lab/ai-lab.functions";

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("whatsapp_threads")
      .select("*")
      .order("pinned", { ascending: false })
      .order("last_message_at", { ascending: false });
    if (error) throw error;
    return { threads: data ?? [] };
  });

export const getThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: thread, error: threadError } = await context.supabase
      .from("whatsapp_threads")
      .select("*")
      .eq("id", data.id)
      .single();
    if (threadError) throw threadError;

    let currentThread = thread;
    if (summaryIsMissing(currentThread as any)) {
      const seedResult = await seedMissingThreadSummary(context.supabase as any, data.id);
      if (seedResult.updated) {
        const { data: refreshedThread } = await context.supabase
          .from("whatsapp_threads")
          .select("*")
          .eq("id", data.id)
          .single();
        currentThread = refreshedThread ?? currentThread;
      }
    }

    const { data: messages, error: messagesError } = await context.supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("thread_id", data.id)
      .order("sent_at", { ascending: true });
    if (messagesError) throw messagesError;
    const visibleMessages = await withOutboundMediaUrls(messages ?? []);

    // Look up guest context by phone (best-effort)
    let guest: any = null;
    let booking: any = null;
    if (currentThread?.phone) {
      const { data: g } = await context.supabase
        .from("guests")
        .select("*")
        .eq("phone", currentThread.phone)
        .maybeSingle();
      guest = g;
      if (g) {
        const { data: b } = await context.supabase
          .from("bookings")
          .select(
            "id, check_in, check_out, status, adults, children, total_amount, special_requests, room_type_id, room_id",
          )
          .eq("guest_id", g.id)
          .order("check_in", { ascending: false })
          .limit(1)
          .maybeSingle();
        booking = b;
      }
    }

    return { thread: currentThread, messages: visibleMessages, guest, booking };
  });

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

/** Satu batch signed URL untuk baris yang menyimpan storage_path. */
async function withOutboundMediaUrls<T extends { metadata?: unknown }>(messages: T[]): Promise<T[]> {
  const paths = [
    ...new Set(
      messages
        .map((message) => metadataRecord(message.metadata)?.storage_path)
        .filter((path): path is string => typeof path === "string" && path.length > 0 && !path.includes("..")),
    ),
  ];
  if (paths.length === 0) return messages;

  const signed = new Map<string, string>();
  try {
    for (let i = 0; i < paths.length; i += 100) {
      const slice = paths.slice(i, i + 100);
      const { data, error } = await supabaseAdmin.storage
        .from(WA_OUTBOUND_BUCKET)
        .createSignedUrls(slice, WA_SIGNED_URL_TTL_SECONDS);
      if (error) {
        console.error("[Admin WhatsApp] createSignedUrls:", error.message);
        continue;
      }
      slice.forEach((requested, index) => {
        const row = data?.[index];
        const url = row?.signedUrl;
        if (!url || row?.error) return;
        signed.set(requested, url);
        if (row.path) signed.set(row.path, url);
      });
    }
  } catch (error) {
    console.error("[Admin WhatsApp] createSignedUrls failed:", error);
    return messages;
  }

  return messages.map((message) => {
    const meta = metadataRecord(message.metadata);
    const path = meta?.storage_path;
    const url = typeof path === "string" ? signed.get(path) : undefined;
    if (!url || !meta) return message;
    return { ...message, metadata: { ...meta, media_url: url } };
  });
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => parseAdminSendInput(d))
  .handler(async ({ data, context }) => {
    const { data: thread } = await context.supabase
      .from("whatsapp_threads")
      .select("phone")
      .eq("id", data.threadId)
      .single();
    if (!thread) throw new Error("Thread not found");

    const { data: prop } = await context.supabase
      .from("properties")
      .select("wpp_token")
      .limit(1)
      .maybeSingle();

    const caption = data.body;
    const fileName = data.attachment
      ? fileNameForMime(data.attachment.name, data.attachment.mime)
      : null;
    const mediaType = data.attachment
      ? selectOutboundMediaType({
          mime: data.attachment.mime,
          size: data.attachment.size,
          name: fileName ?? data.attachment.name,
        })
      : null;

    const metadataBase: Record<string, unknown> = {
      is_manual_admin: true,
      source: "admin_inbox",
    };
    if (data.attachment && fileName && mediaType) {
      metadataBase.media_type = mediaType;
      metadataBase.mime_type = data.attachment.mime;
      metadataBase.file_name = fileName;
      metadataBase.storage_path = data.attachment.path;
      metadataBase.size = data.attachment.size;
    }

    const insertOutbound = async (
      sendStatus: "sent" | "failed" | "local_only",
      wppId: string | null,
      errorText?: string,
    ) => {
      const { error } = await context.supabase.from("whatsapp_messages").insert({
        thread_id: data.threadId,
        direction: "out",
        body: caption,
        wpp_id: wppId,
        metadata: {
          ...metadataBase,
          send_status: sendStatus,
          ...(errorText ? { error: errorText.slice(0, 500) } : {}),
        },
      } as any);
      if (error) throw error;
    };

    if (prop?.wpp_token) {
      let fileUrl: string | undefined;
      if (data.attachment) {
        const signed = await supabaseAdmin.storage
          .from(WA_OUTBOUND_BUCKET)
          .createSignedUrl(data.attachment.path, WA_SIGNED_URL_TTL_SECONDS);
        const signedUrl = signed.data?.signedUrl;
        if (signed.error || !signedUrl) {
          const message = "Gagal membuat tautan lampiran. Coba unggah ulang.";
          console.error("[Admin WhatsApp] signed url:", signed.error?.message);
          await insertOutbound("failed", null, message);
          return { ok: false as const, error: message };
        }
        fileUrl = signedUrl;
      }

      const sendResult = await sendWhatsAppMessage(
        prop.wpp_token,
        thread.phone,
        caption,
        fileUrl,
        fileName ?? undefined,
        mediaType ? { mediaType, mimetype: data.attachment?.mime } : undefined,
      );
      if (!sendResult.ok) {
        const message = adminSendFailureMessage(
          isMetaReengagementError(sendResult),
          sendResult.error,
        );
        console.error("[Admin WhatsApp] WhatsApp gateway send failed:", sendResult.error);
        await insertOutbound("failed", null, message);
        return { ok: false as const, error: message };
      }

      const messageId = sendResult.messageId;
      const wppId = typeof messageId === "string" && messageId.trim() ? messageId.trim() : null;
      await insertOutbound("sent", wppId);
    } else {
      await insertOutbound("local_only", null);
    }

    const pauseMs = await resolveHumanTakeoverMs(context.supabase);
    await context.supabase
      .from("whatsapp_threads")
      .update({
        last_message_preview: threadPreview(caption, fileName),
        last_message_at: new Date().toISOString(),
        unread_count: 0,
        ai_paused_until: pauseMs > 0 ? new Date(Date.now() + pauseMs).toISOString() : null,
      } as any)
      .eq("id", data.threadId);
    return { ok: true as const };
  });

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("whatsapp_threads")
      .update({ unread_count: 0 })
      .eq("id", data.threadId);
    return { ok: true };
  });

export const togglePinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), pinned: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("whatsapp_threads")
      .update({ pinned: data.pinned })
      .eq("id", data.threadId);
    return { ok: true };
  });

export const setStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), status: z.enum(["open", "closed"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("whatsapp_threads")
      .update({ status: data.status })
      .eq("id", data.threadId);
    return { ok: true };
  });

export const setAiMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), aiAuto: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("whatsapp_threads")
      .update({ ai_auto: data.aiAuto })
      .eq("id", data.threadId);
    if (error) throw error;
    return { ok: true };
  });

export const simulateInbound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("whatsapp_messages").insert({
      thread_id: data.threadId,
      direction: "in",
      body: data.body,
    });
    await context.supabase
      .from("whatsapp_threads")
      .update({
        last_message_preview: data.body.slice(0, 120),
        last_message_at: new Date().toISOString(),
        unread_count: 1,
      })
      .eq("id", data.threadId);
    return { ok: true };
  });

async function callAI(messages: Array<{ role: string; content: string }>) {
  const config = getLovableAiConfig();
  if (!config) return null;
  return chatCompletionText(config, messages, { temperature: 0.2 });
}

export const draftAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: messages } = await context.supabase
      .from("whatsapp_messages")
      .select("direction, body")
      .eq("thread_id", data.threadId)
      .order("sent_at", { ascending: true })
      .limit(20);

    const transcript = (messages ?? [])
      .map((m) => `${m.direction === "in" ? "Guest" : "Host"}: ${m.body}`)
      .join("\n");

    const draft = await callAI([
      {
        role: "system",
        content:
          "You are the front-desk concierge at Pomah Guesthouse. Reply to the guest in the same language they used. Be warm, concise (2-4 sentences), and professional. Confirm details when possible. Never invent prices or availability — if unsure, offer to check.",
      },
      {
        role: "user",
        content: `Conversation so far:\n${transcript}\n\nDraft the next reply from the host.`,
      },
    ]);

    const final = draft ?? "Could not generate a draft right now.";
    const lastIn = [...(messages ?? [])].reverse().find((m) => m.direction === "in");
    await context.supabase.from("ai_conversation_logs").insert({
      thread_id: data.threadId,
      user_message: lastIn?.body ?? null,
      ai_response: final,
    });
    return { draft: final };
  });

export const summarizeThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: messages } = await context.supabase
      .from("whatsapp_messages")
      .select("direction, body")
      .eq("thread_id", data.threadId)
      .order("sent_at", { ascending: true })
      .limit(45);
    const transcript = (messages ?? [])
      .map((m) => `${m.direction === "in" ? "Guest" : "Host"}: ${m.body}`)
      .join("\n");

    const summary = await callAI([
      {
        role: "system",
        content:
          "Buat ringkasan (resume) singkat, padat, dan jelas dari riwayat obrolan hotel berikut dalam Bahasa Indonesia (maksimal 2-3 kalimat). " +
          "Fokus pada detail penting seperti nama tamu (jika disebut), tipe kamar yang ditanyakan/dipesan, keluhan, atau status terakhir (misal: sukses booking, batal, atau pending). " +
          "Langsung berikan hasil ringkasannya secara polos tanpa kata pengantar atau tanda kutip.",
      },
      { role: "user", content: transcript },
    ]);
    const finalSummary = summary ?? "Belum ada ringkasan obrolan.";

    let summaryJson: Record<string, string | number | boolean | null> | null = null;
    try {
      const jsonRaw = await callAI([
        {
          role: "system",
          content:
            'Analisis percakapan hotel berikut dan balas HANYA dengan JSON (tanpa markdown, tanpa teks lain):\n' +
            '{\n' +
            '  "short_summary": "<ringkasan 1-2 kalimat dalam Bahasa Indonesia>",\n' +
            '  "guest_name": "<nama tamu jika diketahui, atau null>",\n' +
            '  "last_topic": "<topik terakhir yang dibahas>",\n' +
            '  "room_type": "<tipe kamar yang ditanyakan/dipesan, atau null>",\n' +
            '  "check_in": "<tanggal check-in jika diketahui, format YYYY-MM-DD, atau null>",\n' +
            '  "check_out": "<tanggal check-out jika diketahui, format YYYY-MM-DD, atau null>",\n' +
            '  "guest_count": "<jumlah tamu jika diketahui, atau null>",\n' +
            '  "booking_status": "<confirmed|pending|cancelled|inquiry|null>",\n' +
            '  "payment_status": "<paid|partial|unpaid|null>",\n' +
            '  "complaint_active": <true jika ada keluhan aktif, false jika tidak>,\n' +
            '  "needs_human": <true jika butuh eskalasi manusia, false jika tidak>,\n' +
            '  "unresolved_question": "<pertanyaan tamu yang belum terjawab, atau null>"\n' +
            '}',
        },
        { role: "user", content: transcript },
      ]);
      if (jsonRaw) {
        const match = jsonRaw.match(/\{[\s\S]*\}/);
        if (match) {
          summaryJson = { ...JSON.parse(match[0]), source: "llm" };
        }
      }
    } catch {
      // JSON parse failed — summaryJson stays null, fallback to plain text
    }

    const now = new Date().toISOString();
    await context.supabase
      .from("whatsapp_threads")
      .update({
        chat_summary: finalSummary,
        chat_summary_json: summaryJson,
        chat_summary_updated_at: now,
        chat_summary_version: Date.now() % 2147483647,
      } as any)
      .eq("id", data.threadId);

    return { summary: finalSummary, summaryJson };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("ai_conversation_logs")
      .delete()
      .eq("thread_id", data.threadId);
    await context.supabase
      .from("whatsapp_messages")
      .delete()
      .eq("thread_id", data.threadId);
    const { error } = await context.supabase
      .from("whatsapp_threads")
      .delete()
      .eq("id", data.threadId);
    if (error) throw error;
    return { ok: true };
  });

export const classifyIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: messages } = await context.supabase
      .from("whatsapp_messages")
      .select("direction, body")
      .eq("thread_id", data.threadId)
      .order("sent_at", { ascending: true })
      .limit(20);
    const transcript = (messages ?? [])
      .map((m) => `${m.direction === "in" ? "Guest" : "Host"}: ${m.body}`)
      .join("\n");

    const raw = await callAI([
      {
        role: "system",
        content:
          'Analisis percakapan tamu hotel ini dan balas HANYA dengan JSON (tanpa teks lain):\n' +
          '{\n' +
          '  "intent": "<salah satu: booking_inquiry|service_request|complaint|recommendation|feedback|other>",\n' +
          '  "intent_label": "<label singkat 2-5 kata Bahasa Indonesia mendeskripsikan kebutuhan tamu>",\n' +
          '  "agent": "<pilih agent yang PALING DOMINAN dalam percakapan ini: Pricing Agent, Front Office Agent, Customer Care Agent, Maintenance Agent, Finance Agent, atau Manager Agent>",\n' +
          '  "confidence": <angka 0.0 sampai 1.0>\n' +
          '}',
      },
      { role: "user", content: transcript },
    ]);

    const allowed = [
      "booking_inquiry",
      "service_request",
      "complaint",
      "recommendation",
      "feedback",
      "other",
    ];

    let intent = "other";
    let intentLabel = "";
    let agent = "Front Office Agent";
    let confidence = 0.7;

    try {
      const match = raw?.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as {
          intent?: string;
          intent_label?: string;
          agent?: string;
          confidence?: number;
        };
        intent = allowed.find((a) => a === parsed.intent) ?? "other";
        intentLabel = String(parsed.intent_label ?? "").slice(0, 80);
        agent = String(parsed.agent ?? "Front Office Agent").slice(0, 60);
        confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7));
      } else {
        intent = allowed.find((a) => raw?.toLowerCase().includes(a)) ?? "other";
      }
    } catch {
      intent = allowed.find((a) => raw?.toLowerCase().includes(a)) ?? "other";
    }

    const aiAnalysis = {
      intent_label: intentLabel || intent.replace(/_/g, " "),
      confidence,
      agent,
      tools_used: [] as string[],
      analyzed_at: new Date().toISOString(),
    };

    await context.supabase
      .from("whatsapp_threads")
      .update({ intent, ai_analysis: aiAnalysis } as never)
      .eq("id", data.threadId);

    return { intent, ai_analysis: aiAnalysis };
  });

export const setTrainingExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), value: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("whatsapp_threads")
      .update({ is_training_example: data.value } as never)
      .eq("id", data.threadId);
    return { ok: true };
  });

export const toggleOverrideAutoReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), value: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("whatsapp_threads")
      .update({ override_auto_reply: data.value } as never)
      .eq("id", data.threadId);
    return { ok: true };
  });

export const updateChatSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), summary: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await persistThreadSummary(context.supabase as any, data.threadId, {
      source: "manual",
      short_summary: data.summary,
      guest_name: null,
      last_topic: "general",
      room_type: null,
      check_in: null,
      check_out: null,
      guest_count: null,
      booking_status: null,
      payment_status: null,
      complaint_active: false,
      unresolved_question: null,
      needs_human: false,
      handoff_reason: null,
    });
    return { ok: true };
  });

export const regenerateStructuredSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await resolvePropertyAiConfig(supabaseAdmin as any, {
      lovableFallbackModel: "google/gemini-2.5-flash",
    });
    if (!config) throw new Error("AI API key tidak tersedia.");

    const { regenerateThreadSummary } = await import("@/services/wa-autoreply.service");
    const result = await regenerateThreadSummary(supabaseAdmin, data.threadId, config);
    if (!result.ok) throw new Error(result.error ?? "Gagal regenerate summary.");
    return { ok: true, summary: result.summary };
  });

export const clearChatSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await clearWhatsappThreadSummary(context.supabase as any, data.threadId);
    return { ok: true };
  });

// ─── Conversation Monitor Functions ──────────────────────────────────────────

export const getConversationAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("conversation_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return { alerts: data ?? [] };
  });

export const dismissConversationAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      alertId: z.string().uuid(),
      status: z.enum(["handled", "dismissed"]),
      notes: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { resolveAlert } = await import("@/services/conversation-monitor.service");
    const result = await resolveAlert(
      context.supabase as any,
      data.alertId,
      "admin",
      data.notes,
    );
    if (!result.ok) throw new Error(result.error ?? "Failed to resolve alert");
    return { ok: true };
  });

export const triggerManualAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      threadId: z.string().uuid(),
      note: z.string().min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: thread } = await context.supabase
      .from("whatsapp_threads")
      .select("phone, display_name")
      .eq("id", data.threadId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");

    const { triggerManualAlert: doTrigger } = await import("@/services/conversation-monitor.service");
    const result = await doTrigger(context.supabase as any, {
      threadId: data.threadId,
      phone: (thread as any).phone,
      guestName: (thread as any).display_name ?? null,
      note: data.note,
    });
    if (!result.ok) throw new Error(result.error ?? "Failed to trigger alert");
    return { ok: true, alertId: result.alertId };
  });
