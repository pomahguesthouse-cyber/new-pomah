/**
 * /api/fonnte — WhatsApp Webhook Endpoint (v5 — Production Reliable, Safe Direct Reply)
 *
 * Implements high-reliability features:
 *   1. Accept incoming Fonnte webhook payload.
 *   2. Handle/log incoming and outgoing messages.
 *   3. Enqueue inbound messages to `wa_conversation_queue` to process asynchronously.
 *   4. Return 200 OK under 1 second.
 */

import { createFileRoute }                   from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin }      from "@/integrations/supabase/client.server";

// ── Webhook layer ──────────────────────────────────────────────────────────────
import { verifyFonnteToken }                  from "@/webhook/verifier";
import { parseFonnteBody }                    from "@/webhook/parser";
import { isDuplicate, buildDedupKey }         from "@/webhook/deduplicator";
import { classifyMessageIntent }              from "@/webhook/intent-classifier";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveInboundMessage,
  saveMessageMetadata,
  saveOutboundMessage,
}                                             from "@/repositories/message.repository";
import { sendWhatsAppMessage }                from "@/services/whatsapp.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
}                                             from "@/ai/multi-agent-orchestrator";
import { todayWIB }                           from "@/lib/date";
import { scheduleAutoreply }                  from "@/services/wa-autoreply.service";

// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      // ══════════════════════════════════════════════════════════════════════
      //  POST — primary webhook receiver
      // ══════════════════════════════════════════════════════════════════════
      POST: async ({ request }) => {
        const newWorkerId = () => `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workerId = newWorkerId();

        // ── 1. Token verification ─────────────────────────────────────────
        if (!verifyFonnteToken(request)) {
          console.warn("[Webhook] token mismatch — processing anyway");
        }

        // ── 2. Parse body ─────────────────────────────────────────────────
        const event = await parseFonnteBody(request);
        if (!event) {
          return new Response("OK", { status: 200 });
        }

        const { sender, message, name, fonnteId, isOutgoing, customerPhone, rawBody } = event;
        const logCtx = `phone=${customerPhone.slice(-6)} worker=${workerId}`;
        console.log("[Webhook]", { sender, customerPhone, isOutgoing, msg: message.slice(0, 60), rawBodyKeys: Object.keys(rawBody) });

        // ── 3. Handle outgoing (Fonnte webhooks our own sends + native phone sends) ──
        if (isOutgoing) {
          try {
            const { data: thread } = await (supabaseAdmin as any)
              .from("whatsapp_threads")
              .select("id")
              .eq("phone", customerPhone)
              .maybeSingle();

            let threadId = thread?.id;

            if (!threadId) {
              const { data: newThread } = await (supabaseAdmin as any)
                .from("whatsapp_threads")
                .insert({ phone: customerPhone, display_name: name || customerPhone, status: "open", unread_count: 0 })
                .select("id")
                .single();
              threadId = newThread?.id;
            }

            if (threadId) {
              const twoMinsAgo = new Date(Date.now() - 2 * 60000).toISOString();
              const { data: existingMsg } = await (supabaseAdmin as any)
                .from("whatsapp_messages")
                .select("id")
                .eq("thread_id", threadId)
                .eq("direction", "out")
                .eq("body", message)
                .gte("sent_at", twoMinsAgo)
                .maybeSingle();

              if (!existingMsg) {
                console.log(`[Webhook] Saving native outbound human message | ${logCtx}`);
                await (supabaseAdmin as any).rpc("save_outbound_whatsapp", {
                  p_thread_id: threadId,
                  p_body: message,
                  p_metadata: { is_native_human: true },
                });
              } else {
                console.log(`[Webhook] Ignored outgoing echo (already in DB) | ${logCtx}`);
              }
            }
          } catch (err) {
            console.error(`[Webhook] Error handling native outgoing message: ${err} | ${logCtx}`);
          }
          return new Response("OK", { status: 200 });
        }

        // ── 4. In-memory dedup (fast, before any DB call) ─────────────────
        const dedupKey = buildDedupKey(fonnteId, sender, message);
        if (isDuplicate(dedupKey)) {
          console.log(`[Webhook] duplicate | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 5. Save inbound message ───────────────────────────────────────
        const { messageId, error: saveErr } = await saveInboundMessage(
          supabaseAdmin,
          { phone: customerPhone, name, body: message },
        );
        if (saveErr || !messageId) {
          console.error(`[Webhook] saveInbound failed: ${saveErr?.message ?? "no messageId"} | ${logCtx}`);
          return new Response("Error", { status: 500 });
        }

        // Intent badge (fire-and-forget — non-critical)
        void saveMessageMetadata(supabaseAdmin, {
          messageId,
          metadata: { intent_label: classifyMessageIntent(message) },
        }).catch((e) => console.warn("[Webhook] intent badge error:", e));

        // ── 6. Load thread/context to see if auto reply is enabled/configured ──
        const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
          "get_autoreply_context",
          { p_phone: customerPhone },
        );

        if (ctxErr || !ctx) {
          console.error(`[Webhook] context RPC error: ${ctxErr?.message ?? "no context"} | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        const c = ctx as {
          thread_id:           string;
          auto_reply_enabled:  boolean;
          fonnte_token:        string;
          smart_delay_config?: Record<string, unknown> | null;
        };

        if (!c.auto_reply_enabled) {
          console.log(`[Webhook] auto_reply_enabled=false — skipping | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }
        if (!c.fonnte_token) {
          console.error(`[Webhook] fonnte_token not configured | ${logCtx}`);
          return new Response("OK", { status: 200 });
        }

        // ── 7. Return 200 immediately, run AI in waitUntil ─────────────────────────
        // Processing synchronously kept the request alive past Fonnte's webhook
        // timeout on slow (tool-using) turns: Fonnte disconnected, Cloudflare
        // cancelled the request mid-send, and the reply was lost. Returning 200
        // first keeps Fonnte happy; `waitUntil` keeps the worker alive until the
        // WhatsApp message is actually sent, regardless of reply latency.
        console.log(`[Webhook] Scheduling AI via waitUntil | ${logCtx}`);

        try {
          const { executeAutoreplyForPhone } = await import("@/services/wa-autoreply.service");
          const { getWaitUntil } = await import("@/lib/cf-context");
          const origin = new URL(request.url).origin;

          const work = async () => {
            try {
              const outcome = await executeAutoreplyForPhone(customerPhone, origin);
              console.log(`[Webhook] AI outcome: ${outcome} | ${logCtx}`);
            } catch (e) {
              console.error(`[Webhook] AI work error: ${e} | ${logCtx}`);
            }
          };

          const waitUntil = getWaitUntil();
          if (waitUntil) waitUntil(work());
          else void work();
        } catch (e) {
          console.error(`[Webhook] fatal AI error: ${e} | ${logCtx}`);
        }

        return new Response("OK", { status: 200 });
      },

      // ══════════════════════════════════════════════════════════════════════
      //  GET — debug, verification, and queue inspection
      // ══════════════════════════════════════════════════════════════════════
      GET: async ({ request }) => {
        const url = new URL(request.url);

        // Fonnte webhook verification handshake
        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyFonnteToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        // Token protection validation for debug parameters
        const tokenParam   = url.searchParams.get("token");
        const authHeader   = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
        const webhookToken = process.env.FONNTE_WEBHOOK_TOKEN;
        const isAuthorized = webhookToken && (tokenParam === webhookToken || authHeader === webhookToken);

        if (url.searchParams.get("debug") === "1" || url.searchParams.get("test_reply") === "1") {
          if (!isAuthorized) {
            console.warn("[Webhook debug] Unauthorized access attempt blocked");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // ── ?debug=1 ─────────────────────────────────────────────────────────
        if (url.searchParams.get("debug") === "1") {
          const debugPhone = url.searchParams.get("phone") ?? "debug_test_000";
          const { getWaitUntil } = await import("@/lib/cf-context");
          const report: Record<string, unknown> = {
            env_token_set:           !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set:    !!process.env.SUPABASE_URL,
            env_supabase_key_set:    !!process.env.SUPABASE_PUBLISHABLE_KEY,
            env_lovable_api_key_set: !!process.env.LOVABLE_API_KEY,
            debug_phone: debugPhone,
            wait_until_present: !!getWaitUntil(),
            headers: Object.fromEntries(request.headers.entries()),
          };

          if (debugPhone === "debug_test_000") {
            const { error } = await saveInboundMessage(supabasePublic, {
              phone: "debug_test_000",
              name:  "Debug Test",
              body:  "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_receive_ok    = !error;
            report.rpc_receive_error = error ? error.message : null;
          }

          try {
            const { data: ctx, error } = await (supabaseAdmin as any).rpc(
              "get_autoreply_context",
              { p_phone: debugPhone },
            );
            report.rpc_autoreply_ok    = !error;
            report.rpc_autoreply_error = error ? (error as any).message : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set   = !!(c.fonnte_token as string)?.length;
              report.message_count      = Array.isArray(c.messages) ? c.messages.length : 0;

              const threadId = c.thread_id as string | undefined;
              if (threadId) {
                const { data: qTest, error: qTestErr } = await (supabaseAdmin as any).rpc(
                  "wa_queue_upsert",
                  {
                    p_phone:       debugPhone,
                    p_thread_id:   threadId,
                    p_message_id:  null,
                    p_body:        "[DEBUG] queue upsert probe",
                    p_delay_ms:    3000,
                    p_max_wait_ms: 25000,
                  },
                );
                report.queue_upsert_ok    = !qTestErr;
                report.queue_upsert_error = qTestErr ? (qTestErr as { message?: string }).message : null;
                if (qTest?.[0]) {
                  report.queue_upsert_entry_id = (qTest[0] as { entry_id?: string }).entry_id;
                }
              }
            }
          } catch (e) { report.rpc_autoreply_error = String(e); }

          const key = process.env.LOVABLE_API_KEY;
          if (key) {
            try {
              const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model:      "google/gemini-2.5-flash",
                  max_tokens: 5,
                  messages:   [{ role: "user", content: "ping" }],
                }),
              });
              report.llm_reachable = r.ok;
              report.llm_status    = r.status;
              if (!r.ok) report.llm_error = await r.text();
            } catch (e) {
              report.llm_reachable = false;
              report.llm_error     = String(e);
            }
          } else {
            report.llm_reachable = false;
            report.llm_error     = "LOVABLE_API_KEY not set";
          }

          // Query the queue items
          try {
            const { data: queueItems, error: qErr } = await (supabaseAdmin as any)
              .from("wa_conversation_queue")
              .select("id, phone, status, message_count, attempt, lock_expires_at, process_after, created_at, completed_at, last_error")
              .order("created_at", { ascending: false })
              .limit(10);
            if (qErr) report.queue_error = qErr.message;
            else report.queue_items = queueItems;
          } catch (e) {
            report.queue_error = String(e);
          }

          // Query the last messages
          try {
            const { data: lastMsgs, error: mErr } = await (supabaseAdmin as any)
              .from("whatsapp_messages")
              .select("id, direction, body, sent_at")
              .order("sent_at", { ascending: false })
              .limit(10);
            if (mErr) report.last_messages_error = mErr.message;
            else report.last_messages = lastMsgs;
          } catch (e) {
            report.last_messages_error = String(e);
          }

          return new Response(JSON.stringify(report, null, 2), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }

        // ── ?test_reply=1&phone=628xxx ────────────────────────────────────────
        if (url.searchParams.get("test_reply") === "1") {
          const testPhone = url.searchParams.get("phone");
          if (!testPhone) {
            return new Response(JSON.stringify({ error: "phone param required" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }

          const result: Record<string, unknown> = { phone: testPhone };
          try {
            const { data: ctx, error: ctxErr } = await (supabasePublic as any).rpc(
              "get_autoreply_context", { p_phone: testPhone },
            );
            if (ctxErr || !ctx) {
              result.error  = "get_autoreply_context failed";
              result.detail = (ctxErr as any)?.message ?? "null ctx";
            } else {
              const c = ctx as {
                thread_id:          string;
                auto_reply_enabled: boolean;
                fonnte_token:       string;
                messages:           Array<{ direction: string; body: string }>;
              };
              result.auto_reply_enabled = c.auto_reply_enabled;
              result.message_count      = c.messages?.length ?? 0;
              result.last_messages      = (c.messages ?? []).slice(-3).map((m) => ({
                direction: m.direction, body: m.body?.slice(0, 60),
              }));

              if (!c.auto_reply_enabled) {
                result.skipped = "auto_reply_enabled is false";
              } else {
                const { data: prop } = await (supabaseAdmin as any)
                  .from("properties").select("*").limit(1).maybeSingle();
                const p    = (prop ?? {}) as Record<string, unknown>;
                const { data: rooms } = await (supabasePublic as any)
                  .from("room_types")
                  .select("id, name, base_rate, capacity, bed_type, description, amenities")
                  .order("base_rate");

                const explicitKey = (p.ai_api_key as string | undefined)?.trim();
                const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
                const useLovable  = !explicitKey && !!lovableKey;
                const apiKey      = explicitKey || lovableKey;

                if (!apiKey) {
                  result.error = "No AI key configured";
                } else {
                  const baseUrl = useLovable
                    ? "https://ai.gateway.lovable.dev/v1"
                    : ((p.ai_base_url as string) || "https://api.openai.com/v1").replace(/\/+$/, "");
                  const cfgModel = (p.ai_model as string | undefined)?.trim();
                  const model    = useLovable
                    ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
                    : cfgModel || "gpt-4o-mini";
                  const today    = todayWIB();
                  const roomList = (rooms ?? []) as any[];

                  const rollingMessages = (c.messages ?? []).slice(-20);

                  // Optionally mirror production by loading SOP text + brosur files.
                  let sopText = "";
                  let brosurFiles: { name: string; url: string }[] = [];
                  if (url.searchParams.get("sop") === "1") {
                    const { data: docs } = await (supabaseAdmin as any)
                      .from("sop_documents")
                      .select("name, content, source_url, file_path, doc_category, storage_bucket")
                      .order("created_at", { ascending: true })
                      .limit(40);
                    const supaUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
                    const parts: string[] = [];
                    for (const d of (docs ?? [])) {
                      const cat = (d.doc_category as string | undefined)?.toLowerCase() || "";
                      if (cat === "brosur" || cat === "brochure") {
                        if (d.file_path) {
                          const bucket = (d.storage_bucket as string | undefined)?.trim() || "sop-documents";
                          brosurFiles.push({ name: d.name, url: `${supaUrl}/storage/v1/object/public/${bucket}/${d.file_path}` });
                        }
                        continue;
                      }
                      const content = d.content?.trim(); const u = d.source_url?.trim();
                      if (!content && !u) continue;
                      const head = u ? `### ${d.name} (Tautan: ${u})` : `### ${d.name}`;
                      parts.push(content ? `${head}\n${content}` : head);
                    }
                    sopText = parts.join("\n\n").slice(0, 8000);
                    result.sop_len = sopText.length;
                    result.brosur_count = brosurFiles.length;
                  }

                  const t0 = Date.now();
                  const orchResult = await runMultiAgentOrchestration({
                    phone:     testPhone,
                    messages:  rollingMessages,
                    agentCtx: {
                      property: p as any,
                      rooms:    roomList,
                      sopText,
                      brosurFiles,
                      today,
                    } as any,
                    toolCtx: {
                      supabasePublic: supabasePublic as any,
                      supabaseAdmin:  supabaseAdmin  as any,
                      rooms:          roomList,
                      property:       p as any,
                      today,
                      origin:         url.origin,
                    },
                    llmConfig: { apiKey, baseUrl, model },
                  });

                  result.elapsed_ms         = Date.now() - t0;
                  result.status             = orchResult.status;
                  result.reply              = orchResult.reply;
                  result.tools_used         = orchResult.toolsUsed;
                  result.agent_key          = orchResult.agentKey;
                  result.intent             = orchResult.intent;
                  result.routing_confidence = orchResult.routingConfidence;
                  result.escalated          = orchResult.escalated;
                  result.reply_ok           = !!orchResult.reply;
                  if (orchResult.error) result.error = orchResult.error;

                  if (
                    url.searchParams.get("send") === "1" &&
                    orchResult.reply &&
                    c.fonnte_token
                  ) {
                    const { ok, error: sendErr } = await sendWhatsAppMessage(
                      c.fonnte_token,
                      testPhone,
                      orchResult.reply,
                    );
                    result.sent       = ok;
                    result.send_error = sendErr;
                    if (ok && c.thread_id) {
                      await saveOutboundMessage(supabaseAdmin, {
                        threadId: c.thread_id,
                        body:     orchResult.reply,
                        metadata: { agent: "test_reply", is_test: true } as any,
                      });
                    }
                  }
                }
              }
            }
          } catch (e) { result.error = String(e); }

          return new Response(JSON.stringify(result, null, 2), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Webhook is active (v5 — production safe)", { status: 200 });
      },
    },
  },
});
