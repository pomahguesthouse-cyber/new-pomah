/**
 * TEMPORARY public test endpoint to verify booking state-machine audit fixes
 * (gap #1–#6 from incremental slot-filling audit).
 *
 * Protected by a shared secret header `x-sim-secret`. DELETE this file after
 * verification is complete — it bypasses normal auth.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import { runMultiAgentOrchestration } from "@/ai/multi-agent-orchestrator";
import { getBookingState, updateBookingState } from "@/ai/state-machine/booking-machine";
import { todayWIB } from "@/lib/date";
import { classifyIntent } from "@/ai/router/intent-classifier";

const SECRET = "audit-2026-step1-4-verify";

const Body = z.object({
  action: z.enum(["turn", "reset", "state", "classify"]),
  phone: z.string().min(5),
  message: z.string().optional(),
  transcript: z
    .array(z.object({ direction: z.enum(["in", "out"]), body: z.string() }))
    .optional(),
  lastTopic: z.string().optional(),
});

async function buildEnv() {
  const { data: prop } = await (supabaseAdmin as any)
    .from("properties").select("*").limit(1).maybeSingle();
  const p = (prop ?? {}) as any;
  const { data: rooms } = await (supabasePublic as any)
    .from("room_types")
    .select("id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate")
    .order("base_rate");
  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey || null;
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
    : (cfgModel || "gpt-4o-mini");
  return { property: p, rooms: rooms || [], apiKey, baseUrl, model };
}

export const Route = createFileRoute("/api/public/sim-audit-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-sim-secret") !== SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
        const json = await request.json();
        const data = Body.parse(json);

        if (data.action === "reset") {
          await updateBookingState(supabasePublic as any, data.phone, "IDLE", {});
          await (supabasePublic as any).rpc("update_conversation_topic", {
            p_phone: data.phone, p_last_topic: null, p_last_entity: null, p_slots: {},
          });
          return Response.json({ ok: true, reset: true });
        }

        if (data.action === "state") {
          const st = await getBookingState(supabasePublic as any, data.phone);
          const { data: row } = await (supabaseAdmin as any)
            .from("wa_booking_states")
            .select("state, slots, last_topic, last_entity, context, updated_at")
            .eq("phone", data.phone).maybeSingle();
          return Response.json({ ok: true, state: st.state, context: st.context, row });
        }

        if (data.action === "classify") {
          const cls = await classifyIntent({
            text: data.message ?? "",
            lastTopic: data.lastTopic,
            recentMessages: data.transcript ?? [],
          } as any);
          return Response.json({ ok: true, classification: cls });
        }

        // action === "turn"
        const env = await buildEnv();
        if (!env.apiKey) return Response.json({ ok: false, error: "no api key" });
        const transcript = [
          ...(data.transcript ?? []),
          { direction: "in" as const, body: data.message ?? "" },
        ];
        const t0 = Date.now();
        const orch = await runMultiAgentOrchestration({
          phone: data.phone,
          messages: transcript.slice(-20),
          agentCtx: {
            property: env.property, rooms: env.rooms,
            sopText: "", brosurFiles: [], today: todayWIB(),
            lastMessage: data.message ?? "", chatSummary: "",
          },
          toolCtx: {
            supabasePublic: supabasePublic as any,
            supabaseAdmin: supabaseAdmin as any,
            rooms: env.rooms, property: env.property, today: todayWIB(),
            isSimulator: true,
          },
          llmConfig: { apiKey: env.apiKey, baseUrl: env.baseUrl, model: env.model },
        });
        const after = await getBookingState(supabasePublic as any, data.phone);
        const { data: row } = await (supabaseAdmin as any)
          .from("wa_booking_states")
          .select("state, slots, last_topic, last_entity, context")
          .eq("phone", data.phone).maybeSingle();
        return Response.json({
          ok: true,
          elapsedMs: Date.now() - t0,
          reply: orch.reply,
          intent: orch.intent,
          routingConfidence: orch.routingConfidence,
          agentKey: orch.agentKey,
          toolsUsed: orch.toolsUsed,
          status: orch.status,
          error: orch.error ?? null,
          bookingState: after.state,
          bookingContext: after.context,
          row,
        });
      },
    },
  },
});
