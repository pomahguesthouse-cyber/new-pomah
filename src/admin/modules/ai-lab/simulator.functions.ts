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
import { todayWIB } from "@/lib/date";

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
    .select("id, name, base_rate, capacity, bed_type, description, amenities")
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
    const cat = (d.doc_category as string | undefined)?.toLowerCase() || "";
    if (cat === "brosur" || cat === "brochure") {
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
});

export const simulateChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TurnInput.parse(d))
  .handler(async ({ data }) => {
    const env = await buildEnv();
    if (!env.apiKey) {
      return { ok: false as const, error: "AI API key belum dikonfigurasi." };
    }

    const messages = [...data.transcript.slice(-19), { direction: "in", body: data.message }];

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
      },
      toolCtx: {
        supabasePublic: supabasePublic as any,
        supabaseAdmin: supabaseAdmin as any,
        rooms: env.rooms,
        property: env.property,
        today,
        origin: data.origin,
      },
      llmConfig: { apiKey: env.apiKey, baseUrl: env.baseUrl, model: env.model },
    });

    const elapsedMs = Date.now() - t0;
    const stateAfter = await getBookingState(supabasePublic as any, data.phone);

    return {
      ok: true as const,
      reply: orch.reply,
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

export const saveSimulationAsTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        pairs: z.array(
          z.object({
            userMessage: z.string().min(1).max(4000),
            aiResponse: z.string().min(1).max(8000),
            wasEdited: z.boolean(),
            originalResponse: z.string().nullable().optional(),
          })
        ),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const rows = data.pairs.map((p) => ({
      user_message: p.userMessage,
      ai_response: p.aiResponse,
      rating: "good" as const,
      used: true,
      source: "simulator",
      correction: p.wasEdited ? p.originalResponse : null,
    }));

    if (rows.length === 0) {
      return { ok: true, savedCount: 0 };
    }

    const { error } = await context.supabase.from("ai_conversation_logs").insert(rows);
    if (error) throw error;

    return { ok: true, savedCount: rows.length };
  });
