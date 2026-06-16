/**
 * Webchat admin server functions — list, detail, reply, handoff.
 * Pakai requireSupabaseAuth; supabaseAdmin di-import lazy di handler.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listWebchatThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { threads: data ?? [] };
  });

export const getWebchatThreadDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: thread } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    const { data: messages } = await (supabaseAdmin as any)
      .from("webchat_messages")
      .select("*")
      .eq("thread_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);

    let booking: any = null;
    if (thread?.booking_id) {
      const { data: b } = await (supabaseAdmin as any)
        .from("bookings")
        .select("id, reference_code, status, payment_status, check_in, check_out, total_amount, guests(full_name, phone), booking_rooms(room_types(name))")
        .eq("id", thread.booking_id)
        .maybeSingle();
      booking = b ?? null;
    }

    return { thread, messages: messages ?? [], booking };
  });

export const sendWebchatAdminReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    threadId: z.string().uuid(),
    body:     z.string().trim().min(1).max(4000),
    senderName: z.string().trim().max(80).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await (supabaseAdmin as any).from("webchat_messages").insert({
      thread_id:   data.threadId,
      sender_type: "admin",
      sender_name: data.senderName ?? "Admin Pomah",
      body:        data.body,
    });
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update({ last_message_at: now, status: "waiting_admin" })
      .eq("id", data.threadId);
    return { ok: true };
  });

export const setWebchatHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    threadId: z.string().uuid(),
    mode:     z.enum(["ai", "human", "paused"]),
    minutes:  z.number().int().min(5).max(720).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { handoff_status: data.mode };
    if (data.mode === "human") {
      const mins = data.minutes ?? 60;
      patch.handoff_until = new Date(Date.now() + mins * 60_000).toISOString();
      patch.status = "waiting_admin";
    } else if (data.mode === "ai") {
      patch.handoff_until = null;
      patch.status = "ai_active";
    } else {
      patch.handoff_until = null;
    }
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update(patch)
      .eq("id", data.threadId);
    return { ok: true };
  });

export const closeWebchatThreadAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update({ status: "closed", handoff_status: "ai", handoff_until: null })
      .eq("id", data.threadId);
    return { ok: true };
  });
