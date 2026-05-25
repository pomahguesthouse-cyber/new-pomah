import { createFileRoute }                   from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin }      from "@/integrations/supabase/client.server";

// ── Data access ────────────────────────────────────────────────────────────────
import {
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
}                                             from "@/repositories/message.repository";
import { sendWhatsAppMessage }                from "@/services/whatsapp.service";

// ── Multi-Agent AI pipeline ────────────────────────────────────────────────────
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
}                                             from "@/ai/multi-agent-orchestrator";
import { todayWIB }                           from "@/lib/date";

const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

const AI_TIMEOUT_MS = 22_000;

// ── Cache ──────────────────────────────────────────────────────────────────────
interface SopCache {
  docs: any[];
  fetchedAt: number;
}
let globalSopCache: SopCache | null = null;
const SOP_CACHE_TTL_MS = 10 * 60 * 1000;

function isBrosurDoc(d: any) {
  const cat = (d.doc_category as string | undefined)?.toLowerCase() || "";
  return cat === "brosur" || cat === "brochure";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hashString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
};

export const Route = createFileRoute("/api/queue-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
      try {
        const payload = await request.json().catch(() => null);
        if (!payload || !payload.record) {
          return new Response("Invalid payload", { status: 400 });
        }

        const entry = payload.record;
        const entryId = entry.id;
        const phone = entry.phone;
        const maxWaitUntil = entry.max_wait_until
          ? new Date(entry.max_wait_until).getTime()
          : Date.now() + 25_000;

        const workerId = `worker_${Math.random().toString(36).substring(2, 15)}`;

        // 1–2. Wait for smart-delay window, then claim (retry while debounce extends process_after)
        let claimedItem: {
          message_count: number;
          last_message_body: string;
        } | null = null;

        while (Date.now() < maxWaitUntil) {
          const { data: row, error: rowErr } = await (supabaseAdmin as any)
            .from("wa_conversation_queue")
            .select("process_after, status")
            .eq("id", entryId)
            .maybeSingle();

          if (rowErr || !row) {
            console.log(`[QueueWorker] Entry ${entryId} gone`);
            return new Response("Gone", { status: 200 });
          }

          if (!["pending", "waiting"].includes(row.status as string)) {
            console.log(`[QueueWorker] Entry ${entryId} status=${row.status} — skip`);
            return new Response("Not Active", { status: 200 });
          }

          const processAfterMs = new Date(row.process_after as string).getTime();
          const waitMs = processAfterMs - Date.now();
          if (waitMs > 0) {
            const capped = Math.min(waitMs, maxWaitUntil - Date.now());
            console.log(`[QueueWorker] Waiting ${capped}ms for ${phone}`);
            await sleep(capped);
          }

          const { data: claimData, error: claimErr } = await (supabaseAdmin as any).rpc(
            "wa_queue_claim",
            { p_entry_id: entryId, p_worker_id: workerId },
          );

          if (claimErr) {
            console.error(`[QueueWorker] Claim error: ${claimErr.message}`);
            return new Response("Claim Error", { status: 500 });
          }

          if (claimData?.[0]?.claimed) {
            claimedItem = claimData[0];
            break;
          }

          await sleep(300);
        }

        if (!claimedItem) {
          console.log(`[QueueWorker] Item ${entryId} not claimed before max_wait_until`);
          return new Response("Not Claimed", { status: 200 });
        }
        console.log(`[QueueWorker] Claimed ${entryId} for ${phone} (msgs: ${claimedItem.message_count})`);

        // 3. Load Autoreply Context
        const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
          "get_autoreply_context",
          { p_phone: phone }
        );

        if (ctxErr || !ctx) {
          console.error(`[QueueWorker] Context load failed for ${phone}`);
          await (supabaseAdmin as any).rpc("wa_queue_fail", {
            p_entry_id: entryId, p_worker_id: workerId, p_error: "context_failed"
          });
          return new Response("Context Error", { status: 500 });
        }

        const c = ctx as any;
        if (!c.auto_reply_enabled || !c.fonnte_token) {
          console.log(`[QueueWorker] Auto reply disabled or token missing for ${phone}`);
          await (supabaseAdmin as any).rpc("wa_queue_complete", {
            p_entry_id: entryId, p_worker_id: workerId, p_reply: "skipped_config"
          });
          return new Response("OK", { status: 200 });
        }

        // 4. Load Property & Room settings
        const { data: prop } = await (supabaseAdmin as any).from("properties").select("*").limit(1).maybeSingle();
        const p = (prop ?? {}) as any;
        const { data: rooms } = await (supabasePublic as any).from("room_types")
          .select("id, name, base_rate, capacity, bed_type, description, amenities").order("base_rate");

        // 5. Load SOP cache
        const aiCfgRaw = p.ai_lab_config as any;
        const sopEnabled = aiCfgRaw?.tools?.["sop-knowledge"]?.enabled ?? true;
        let sopText = "";
        let brosurFiles: { name: string; url: string }[] = [];

        if (sopEnabled) {
          if (!globalSopCache || (Date.now() - globalSopCache.fetchedAt > SOP_CACHE_TTL_MS)) {
            const { data: fetchedDocs } = await (supabaseAdmin as any)
              .from("sop_documents")
              .select("name, content, source_url, file_path, doc_category")
              .order("created_at", { ascending: true })
              .limit(40);
            globalSopCache = { docs: fetchedDocs ?? [], fetchedAt: Date.now() };
          }
          const parts: string[] = [];
          const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
          for (const d of globalSopCache.docs) {
            if (isBrosurDoc(d)) {
              if (d.file_path) {
                brosurFiles.push({
                  name: d.name,
                  url: `${supabaseUrl}/storage/v1/object/public/sop-documents/${d.file_path}`,
                });
              }
              continue;
            }
            const content = d.content?.trim();
            const url = d.source_url?.trim();
            if (!content && !url) continue;
            const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
            parts.push(content ? `${head}\n${content}` : head);
          }
          sopText = parts.join("\n\n").slice(0, 8000);
        }

        // 6. AI Credentials
        const explicitKey = p.ai_api_key?.trim();
        const lovableKey = process.env.LOVABLE_API_KEY?.trim();
        const useLovable = !explicitKey && !!lovableKey;
        const apiKey = explicitKey || lovableKey;

        if (!apiKey) {
          await (supabaseAdmin as any).rpc("wa_queue_fail", {
            p_entry_id: entryId, p_worker_id: workerId, p_error: "no_api_key"
          });
          return new Response("No API Key", { status: 200 });
        }

        const baseUrl = useLovable
          ? "https://ai.gateway.lovable.dev/v1"
          : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
        const cfgModel = p.ai_model?.trim();
        const model = useLovable
          ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
          : cfgModel || "gpt-4o-mini";

        // 7. Context window
        const rollingMessages = (c.messages ?? []).slice(-20);
        const lastMessage = claimedItem.last_message_body;
        const origin = new URL(request.url).origin;

        // 8. Run AI
        let reply: string | null = null;
        let lastAiError = "";
        let orchResult: any = null;
        const MAX_AI_RETRIES = 3;

        for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
          if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));
          const controller = new AbortController();
          const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

          try {
            // Send heartbeat so queue doesn't zombie us while AI is running
            await (supabaseAdmin as any).rpc("wa_queue_heartbeat", {
              p_entry_id: entryId, p_worker_id: workerId
            });

            orchResult = await runMultiAgentOrchestration({
              phone,
              messages: rollingMessages,
              agentCtx: {
                property: p, rooms: rooms || [], sopText, brosurFiles,
                today: todayWIB(), lastMessage
              },
              toolCtx: {
                supabasePublic: supabasePublic as any,
                supabaseAdmin: supabaseAdmin as any,
                rooms: rooms || [], property: p, today: todayWIB(), origin
              },
              llmConfig: { apiKey, baseUrl, model },
              signal: controller.signal,
            });

            if (orchResult?.reply) {
              reply = orchResult.reply;
              break;
            }
            lastAiError = orchResult?.error ?? "empty_reply";
          } catch (e: any) {
            lastAiError = e.message || String(e);
          } finally {
            clearTimeout(aiTimeout);
          }
        }

        // 9. Reply formulation
        let finalReply = reply ?? FALLBACK_MESSAGE;
        const isFallback = !reply;
        let attachUrl: string | undefined;
        let attachName: string | undefined;

        if (!isFallback && brosurFiles.length > 0) {
          for (const f of brosurFiles) {
            const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
            const lowered = finalReply.toLowerCase();
            if (lowered.includes(f.name.toLowerCase()) || lowered.includes(baseName.toLowerCase())) {
              if (!finalReply.includes(f.url)) finalReply += `\n${f.url}`;
              if (!attachUrl) { attachUrl = f.url; attachName = f.name; }
            }
          }
        }

        // 10. Send via WhatsApp
        const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
          c.fonnte_token, phone, finalReply, attachUrl, attachName
        );

        if (!sent) {
          console.error(`[QueueWorker] Send failed for ${phone}: ${sendErr}`);
          await (supabaseAdmin as any).rpc("wa_queue_fail", {
            p_entry_id: entryId, p_worker_id: workerId, p_error: `send_failed: ${sendErr}`
          });
          return new Response("Send Failed", { status: 500 });
        }

        // 11. Complete & Persist
        await (supabaseAdmin as any).rpc("wa_queue_complete", {
          p_entry_id: entryId, p_worker_id: workerId, p_reply: finalReply
        });

        const agentKey = orchResult?.agentKey ?? "front-office";
        await saveOutboundMessage(supabaseAdmin, {
          threadId: c.thread_id,
          body: finalReply,
          metadata: {
            agent: deriveAgentLabelFromKey(agentKey),
            tools_used: orchResult?.toolsUsed ?? [],
            agent_key: agentKey,
            intent: orchResult?.intent,
            routing_confidence: orchResult?.routingConfidence,
            escalated: orchResult?.escalated,
            is_fallback: isFallback,
          } as any,
        });

        void updateThreadAutoReplyMeta(supabaseAdmin, {
          threadId: c.thread_id,
          toolsUsed: orchResult?.toolsUsed ?? [],
        }).catch(e => console.warn(e));

        console.log(`[QueueWorker] ✓ Sent reply for ${phone} (entry: ${entryId})`);
        return new Response("OK", { status: 200 });

      } catch (err) {
        console.error("[QueueWorker] Fatal error:", err);
        return new Response("Fatal Error", { status: 500 });
      }
      },
    },
  },
});
