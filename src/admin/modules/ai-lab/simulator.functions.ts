/**
 * Chatbot Simulator — admin-only server functions.
 *
 * Runs the SAME multi-agent orchestration pipeline used in production
 * (classifier → router → agent → tools → booking state machine) against a
 * sandbox/test phone number, so admins can exercise the WhatsApp bot from the
 * AI Lab without going through Fonnte.
 *
 * NOTE: this is end-to-end. The booking state machine writes to
 * `wa_booking_states` and `create_booking` creates real booking/guest records
 * (and may send a real invoice). Use a dedicated test phone number.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runMultiAgentOrchestration } from "@/ai/multi-agent-orchestrator";
import { getBookingState, updateBookingState } from "@/ai/state-machine/booking-machine";
import { embedTrainingExample } from "@/ai/training-rag.service";
import { todayWIB } from "@/lib/date";
import {
  findSessionStartIndex,
  pickAttachment,
  cleanReplyBody,
  isBrosurDoc,
} from "@/services/reply-postprocess";
import { runOcrAndMatch } from "@/services/payment-proof.service";

// ─── Shared environment builder ────────────────────────────────────────────────

interface OrchestrationEnv {
  property: any;
  rooms: any[];
  sopText: string;
  brosurFiles: { name: string; url: string }[];
  apiKey: string | null;
  baseUrl: string;
  model: string;
}

async function buildEnv(): Promise<OrchestrationEnv> {
  const { data: prop } = await (supabaseAdmin as any)
    .from("properties")
    .select("*")
    .limit(1)
    .maybeSingle();
  const p = (prop ?? {}) as any;

  const { data: rooms } = await (supabasePublic as any)
    .from("room_types")
    .select("id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate")
    .order("base_rate");

  // SOP + brosur (mirror production)
  let sopText = "";
  const brosurFiles: { name: string; url: string }[] = [];
  const { data: docs } = await (supabaseAdmin as any)
    .from("sop_documents")
    .select("name, content, source_url, file_path, doc_category, storage_bucket")
    .order("created_at", { ascending: true })
    .limit(40);
  const supaUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const parts: string[] = [];
  for (const d of docs ?? []) {
    if (isBrosurDoc(d)) {
      if (d.file_path) {
        const bucket = (d.storage_bucket as string | undefined)?.trim() || "sop-documents";
        brosurFiles.push({
          name: d.name,
          url: `${supaUrl}/storage/v1/object/public/${bucket}/${d.file_path}`,
        });
      }
      continue;
    }
    const content = d.content?.trim();
    const u = d.source_url?.trim();
    if (!content && !u) continue;
    const head = u ? `### ${d.name} (Tautan: ${u})` : `### ${d.name}`;
    parts.push(content ? `${head}\n${content}` : head);
  }
  sopText = parts.join("\n\n").slice(0, 8000);

  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey || null;
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

  return { property: p, rooms: rooms || [], sopText, brosurFiles, apiKey, baseUrl, model };
}

// ─── simulateChatTurn ───────────────────────────────────────────────────────────

const TurnInput = z.object({
  phone: z.string().min(5),
  transcript: z.array(z.object({ direction: z.enum(["in", "out"]), body: z.string() })).default([]),
  message: z.string().min(1),
  origin: z.string().optional(),
  /**
   * Optional payment-proof image. Either a data URL (data:image/...;base64,...)
   * or a public HTTPS URL the Vision LLM can fetch. When present the simulator
   * runs OCR + booking match before orchestration and injects the result so
   * `get_payment_proof_result` returns it synchronously.
   */
  imageDataUrl: z.string().optional(),
});

export const simulateChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TurnInput.parse(d))
  .handler(async ({ data }) => {
    const env = await buildEnv();
    if (!env.apiKey) {
      return { ok: false as const, error: "AI API key belum dikonfigurasi." };
    }

    // Mirror the production WA path: fetch the persisted chat summary so the
    // simulator runs with the same session-carryover context the real bot
    // would see for this phone number. Missing thread → empty summary.
    let chatSummary = "";
    try {
      const { data: thread } = await (supabaseAdmin as any)
        .from("whatsapp_threads")
        .select("chat_summary")
        .eq("phone", data.phone)
        .maybeSingle();
      chatSummary = thread?.chat_summary ?? "";
    } catch (e) {
      console.warn("[simulator] chat_summary fetch failed (non-fatal):", e);
    }

    // Session windowing: production trims history at a >15-min gap. The
    // simulator transcript has no sent_at, so this is a no-op here (returns
    // 0), but using the same helper keeps the code paths identical and lets
    // future "import from real thread" scenarios share the trim.
    const transcript = [...data.transcript, { direction: "in", body: data.message }];
    const sessionStart = findSessionStartIndex(transcript as Array<{ sent_at?: string }>);
    const messages = transcript.slice(sessionStart).slice(-20);
    const lastMessage = data.message;

    // Payment-proof OCR: if the admin attached an image, run Vision OCR +
    // booking match BEFORE orchestration and inject the result into the
    // tool context. The Finance Agent's get_payment_proof_result tool will
    // read it synchronously instead of waiting on the production webhook
    // pipeline (which doesn't exist in the simulator).
    let ocrResult: Awaited<ReturnType<typeof runOcrAndMatch>> | undefined;
    if (data.imageDataUrl) {
      try {
        ocrResult = await runOcrAndMatch(
          supabaseAdmin as any,
          data.imageDataUrl,
          data.phone,
        );
      } catch (e) {
        console.warn("[simulator] OCR failed:", e);
      }
    }

    const today = todayWIB();
    const t0 = Date.now();
    const orch = await runMultiAgentOrchestration({
      phone: data.phone,
      messages,
      agentCtx: {
        property: env.property,
        rooms: env.rooms,
        sopText: env.sopText,
        brosurFiles: env.brosurFiles,
        today,
        lastMessage,
        chatSummary,
      },
      toolCtx: {
        supabasePublic: supabasePublic as any,
        supabaseAdmin: supabaseAdmin as any,
        rooms: env.rooms,
        property: env.property,
        today,
        origin: data.origin,
        isSimulator: true,
        recentPaymentProofImageUrl: data.imageDataUrl,
        recentOcrResult: ocrResult
          ? {
              ocr:   ocrResult.ocr as unknown as Record<string, unknown>,
              match: ocrResult.match as unknown as Record<string, unknown>,
            }
          : undefined,
      },
      llmConfig: { apiKey: env.apiKey, baseUrl: env.baseUrl, model: env.model },
    });

    const elapsedMs = Date.now() - t0;
    const stateAfter = await getBookingState(supabasePublic as any, data.phone);

    // Mirror the post-processing the WA worker runs before sending: pick a
    // brochure / invoice attachment and strip raw URLs from the reply body.
    let displayReply = orch.reply;
    let attachment: { url?: string; name?: string } | undefined;
    if (orch.reply) {
      const picked = pickAttachment(lastMessage, orch.reply, env.brosurFiles);
      const pdfToStrip = picked.url && /\.pdf(\?|$)/i.test(picked.url) ? picked.url : undefined;
      displayReply = cleanReplyBody(orch.reply, pdfToStrip);
      if (picked.url) attachment = { url: picked.url, name: picked.name };
    }

    return {
      ok: true as const,
      reply: displayReply,
      attachment,
      ocrResult: ocrResult ?? null,
      status: orch.status,
      toolsUsed: orch.toolsUsed,
      agentKey: orch.agentKey,
      intent: orch.intent,
      routingConfidence: orch.routingConfidence,
      escalated: orch.escalated,
      error: orch.error ?? null,
      bookingState: stateAfter.state,
      bookingContext: stateAfter.context,
      elapsedMs,
      chatSummaryUsed: !!chatSummary,
      trainingExamplesUsed: orch.trainingExamplesUsed ?? 0,
      trainingExampleIds: orch.trainingExampleIds ?? [],
    };
  });

// ─── getSimBookingState ─────────────────────────────────────────────────────────

export const getSimBookingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ phone: z.string().min(5) }).parse(d))
  .handler(async ({ data }) => {
    const state = await getBookingState(supabasePublic as any, data.phone);
    return { state: state.state, context: state.context };
  });

// ─── resetSimulation ────────────────────────────────────────────────────────────

/** Reset the booking state machine for the test phone back to IDLE. */
export const resetSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ phone: z.string().min(5) }).parse(d))
  .handler(async ({ data, context }) => {
    await updateBookingState(supabasePublic as any, data.phone, "IDLE", {});
    return { ok: true };
  });

// ─── Helpers transcript ─────────────────────────────────────────────────────

const TranscriptMsgSchema = z.object({
  direction: z.enum(["in", "out"]),
  body: z.string().min(1).max(8000),
});
type TranscriptMsg = z.infer<typeof TranscriptMsgSchema>;

function firstUserMessage(transcript: TranscriptMsg[]): string {
  return transcript.find((m) => m.direction === "in")?.body ?? "";
}

function joinedBotResponses(transcript: TranscriptMsg[]): string {
  return transcript
    .filter((m) => m.direction === "out")
    .map((m) => m.body)
    .join("\n\n");
}

// ─── saveSimulationAsTraining (mode percakapan utuh) ────────────────────────

export const saveSimulationAsTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        title: z.string().trim().min(1).max(120),
        transcript: z.array(TranscriptMsgSchema).min(2),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userMsg = firstUserMessage(data.transcript);
    const aiResp = joinedBotResponses(data.transcript);
    if (!userMsg || !aiResp) {
      throw new Error("Transcript harus berisi minimal 1 pesan tamu dan 1 balasan bot");
    }

    const { data: inserted, error } = await context.supabase
      .from("ai_conversation_logs")
      .insert({
        title: data.title,
        transcript: data.transcript,
        user_message: userMsg,
        ai_response: aiResp,
        rating: "good" as const,
        used: true,
        source: "simulator",
      })
      .select("id")
      .single();
    if (error) throw error;

    try {
      const env = await buildEnv();
      if (env.apiKey && inserted?.id) {
        await embedTrainingExample(supabaseAdmin, inserted.id, {
          apiKey: env.apiKey,
          baseUrl: env.baseUrl,
          model: env.model,
        });
      }
    } catch (e) {
      console.warn("[saveSimulationAsTraining] embedding gagal:", e);
    }

    return { ok: true, id: inserted?.id ?? null };
  });

/** List training examples saved from the simulator, newest first. */
export const listSimulatorTraining = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_conversation_logs")
      .select("id, title, transcript, user_message, ai_response, correction, created_at")
      .eq("source", "simulator")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { logs: data ?? [] };
  });

/** Delete a single saved training example. */
export const deleteSimulatorTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_conversation_logs")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Update title + transcript training, lalu re-embed. */
export const updateSimulatorTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(120),
        transcript: z.array(TranscriptMsgSchema).min(2),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userMsg = firstUserMessage(data.transcript);
    const aiResp = joinedBotResponses(data.transcript);
    if (!userMsg || !aiResp) {
      throw new Error("Transcript harus berisi minimal 1 pesan tamu dan 1 balasan bot");
    }

    const { error } = await context.supabase
      .from("ai_conversation_logs")
      .update({
        title: data.title,
        transcript: data.transcript,
        user_message: userMsg,
        ai_response: aiResp,
        rating: "good",
        used: true,
      })
      .eq("id", data.id);
    if (error) throw error;

    try {
      const env = await buildEnv();
      if (env.apiKey) {
        await embedTrainingExample(supabaseAdmin, data.id, {
          apiKey: env.apiKey,
          baseUrl: env.baseUrl,
          model: env.model,
        });
      }
    } catch (e) {
      console.warn("[updateSimulatorTraining] re-embed gagal:", e);
    }
    return { ok: true };
  });

/** Export all simulator training examples (full rows for JSON/CSV download). */
export const exportSimulatorTraining = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_conversation_logs")
      .select(
        "id, title, transcript, user_message, ai_response, correction, rating, used, created_at",
      )
      .eq("source", "simulator")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { rows: data ?? [] };
  });

// ─── suggestTrainingTitle ───────────────────────────────────────────────────

/** Sarankan judul singkat (Bahasa Indonesia, ≤60 char) untuk transcript. */
export const suggestTrainingTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ transcript: z.array(TranscriptMsgSchema).min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const fallback = (firstUserMessage(data.transcript) || "Percakapan training")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

    try {
      const env = await buildEnv();
      if (!env.apiKey) return { title: fallback };

      const conv = data.transcript
        .slice(0, 12)
        .map((m) => `${m.direction === "in" ? "Tamu" : "Bot"}: ${m.body.slice(0, 300)}`)
        .join("\n");

      const res = await fetch(`${env.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.apiKey}`,
        },
        body: JSON.stringify({
          model: env.model,
          messages: [
            {
              role: "system",
              content:
                "Beri judul singkat (maksimum 60 karakter) dalam Bahasa Indonesia yang merangkum topik percakapan berikut. Hanya kembalikan teks judul, tanpa tanda kutip, tanpa awalan.",
            },
            { role: "user", content: conv },
          ],
          temperature: 0.3,
          max_tokens: 40,
        }),
      });
      if (!res.ok) return { title: fallback };
      const json: any = await res.json();
      const raw: string = json?.choices?.[0]?.message?.content ?? "";
      const cleaned = raw.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 80);
      return { title: cleaned || fallback };
    } catch (e) {
      console.warn("[suggestTrainingTitle] gagal:", e);
      return { title: fallback };
    }
  });

