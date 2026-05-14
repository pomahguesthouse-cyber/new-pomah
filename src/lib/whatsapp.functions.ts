import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("whatsapp_threads")
      .select("*")
      .order("last_message_at", { ascending: false });
    if (error) throw error;
    return { threads: data ?? [] };
  });

export const getThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: thread } = await context.supabase
      .from("whatsapp_threads")
      .select("*")
      .eq("id", data.id)
      .single();
    const { data: messages } = await context.supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("thread_id", data.id)
      .order("sent_at", { ascending: true });
    return { thread, messages: messages ?? [] };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("whatsapp_messages").insert({
      thread_id: data.threadId,
      direction: "out",
      body: data.body,
    });
    if (error) throw error;
    await context.supabase
      .from("whatsapp_threads")
      .update({
        last_message_preview: data.body.slice(0, 120),
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq("id", data.threadId);
    return { ok: true };
  });

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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { draft: "AI gateway is not configured." };

    const transcript = (messages ?? [])
      .map((m) => `${m.direction === "in" ? "Guest" : "Host"}: ${m.body}`)
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are the front-desk concierge at Pomah Guesthouse. Reply to the guest in the same language they used. Be warm, concise (2-4 sentences), and professional. Confirm details when possible. Never invent prices or availability — if unsure, offer to check.",
          },
          { role: "user", content: `Conversation so far:\n${transcript}\n\nDraft the next reply from the host.` },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("AI draft failed", res.status, text);
      return { draft: "Could not generate a draft right now." };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const draft = json.choices?.[0]?.message?.content?.trim() ?? "";
    const lastIn = [...(messages ?? [])].reverse().find((m) => m.direction === "in");
    await context.supabase.from("ai_conversation_logs").insert({
      thread_id: data.threadId,
      user_message: lastIn?.body ?? null,
      ai_response: draft,
    });
    return { draft };
  });
