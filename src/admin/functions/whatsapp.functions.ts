import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

    // Look up guest context by phone (best-effort)
    let guest: any = null;
    let booking: any = null;
    if (thread?.phone) {
      const { data: g } = await context.supabase
        .from("guests")
        .select("*")
        .eq("phone", thread.phone)
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

    return { thread, messages: messages ?? [], guest, booking };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // 1. Get thread phone
    const { data: thread } = await context.supabase
      .from("whatsapp_threads")
      .select("phone")
      .eq("id", data.threadId)
      .single();
    if (!thread) throw new Error("Thread not found");

    // 2. Get Fonnte token
    const { data: prop } = await context.supabase
      .from("properties")
      .select("fonnte_token")
      .limit(1)
      .maybeSingle();

    // 3. Send via Fonnte if token is available
    if (prop?.fonnte_token) {
      try {
        const formData = new URLSearchParams();
        formData.append("target", thread.phone);
        formData.append("message", data.body);
        
        const res = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            Authorization: prop.fonnte_token,
          },
          body: formData,
        });
        
        if (!res.ok) {
          console.error("Fonnte API Error:", await res.text());
        }
      } catch (err) {
        console.error("Failed to send Fonnte message:", err);
      }
    }

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
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages }),
  });
  if (!res.ok) {
    console.error("AI gateway error", res.status, await res.text());
    return null;
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content?.trim() ?? null;
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
      .limit(40);
    const transcript = (messages ?? [])
      .map((m) => `${m.direction === "in" ? "Guest" : "Host"}: ${m.body}`)
      .join("\n");
    const summary = await callAI([
      {
        role: "system",
        content:
          "Summarize this hotel guest conversation in 3 short bullet points. Focus on: 1) what the guest needs, 2) what was promised by the host (if anything), 3) the next action for staff. Keep each bullet under 14 words. Use plain text bullets starting with '• '.",
      },
      { role: "user", content: transcript },
    ]);
    return { summary: summary ?? "No summary available." };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Delete conversation memory in the correct dependency order so foreign-key
    // constraints are not violated.
    // 1. AI conversation logs referencing this thread
    await context.supabase
      .from("ai_conversation_logs")
      .delete()
      .eq("thread_id", data.threadId);

    // 2. Individual messages
    await context.supabase
      .from("whatsapp_messages")
      .delete()
      .eq("thread_id", data.threadId);

    // 3. The thread itself
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

    // Single LLM call that returns a structured JSON with all metadata.
    const raw = await callAI([
      {
        role: "system",
        content:
          'Analisis percakapan tamu hotel ini dan balas HANYA dengan JSON (tanpa teks lain):\n' +
          '{\n' +
          '  "intent": "<salah satu: booking_inquiry|service_request|complaint|recommendation|feedback|other>",\n' +
          '  "intent_label": "<label singkat 2-5 kata Bahasa Indonesia mendeskripsikan kebutuhan tamu>",\n' +
          '  "agent": "<pilih agent yang PALING DOMINAN dalam percakapan ini:\n' +
          '    - Pricing Agent: jika percakapan utamanya membahas harga/tarif/biaya kamar (meski ada booking juga)\n' +
          '    - Front Office Agent: reservasi/check-in/check-out/pertanyaan umum\n' +
          '    - Housekeeping Agent: kebersihan/fasilitas/kesiapan kamar\n' +
          '    - Maintenance Agent: kerusakan/perbaikan peralatan\n' +
          '    - Finance Agent: pembayaran/tagihan/konfirmasi transfer\n' +
          '    - Manager Agent: laporan/manajemen/eskalasi>",\n' +
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
