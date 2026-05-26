/**
 * Processes one wa_conversation_queue entry: wait → claim → AI → send WhatsApp.
 * Called directly from the webhook (reliable) and from /api/queue-worker (pg_net).
 */
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  saveOutboundMessage,
  updateThreadAutoReplyMeta,
} from "@/repositories/message.repository";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import {
  runMultiAgentOrchestration,
  deriveAgentLabelFromKey,
} from "@/ai/multi-agent-orchestrator";
import { todayWIB } from "@/lib/date";

const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

const AI_TIMEOUT_MS = 22_000;
/** Extra time after max_wait_until to claim (debounce must finish first). */
const POST_DEADLINE_GRACE_MS = 15_000;

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

export type WaQueueProcessOutcome =
  | "ok"
  | "gone"
  | "not_active"
  | "not_claimed"
  | "skipped_config"
  | "context_error"
  | "no_api_key"
  | "send_failed"
  | "claim_error"
  | "fatal";

export async function processWaQueueEntry(
  entryId: string,
  origin: string,
): Promise<WaQueueProcessOutcome> {
  try {
    const { data: queueRow, error: rowLoadErr } = await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("id, phone, status")
      .eq("id", entryId)
      .maybeSingle();

    if (rowLoadErr || !queueRow) {
      console.log(`[QueueProcessor] Entry ${entryId} not found`);
      return "gone";
    }

    const phone = queueRow.phone as string;
    const workerId = `worker_${Math.random().toString(36).substring(2, 15)}`;

    let claimedItem: { message_count: number; last_message_body: string } | null = null;

    while (true) {
      const { data: row, error: rowErr } = await (supabaseAdmin as any)
        .from("wa_conversation_queue")
        .select("process_after, max_wait_until, status")
        .eq("id", entryId)
        .maybeSingle();

      if (rowErr || !row) return "gone";

      if (!["pending", "waiting"].includes(row.status as string)) {
        console.log(`[QueueProcessor] Entry ${entryId} status=${row.status} — skip`);
        return "not_active";
      }

      const now = Date.now();
      const processAfterMs = new Date(row.process_after as string).getTime();
      const maxWaitMs = new Date(row.max_wait_until as string).getTime();

      const debounceDone = now >= processAfterMs;
      const pastHardDeadline = now > maxWaitMs + POST_DEADLINE_GRACE_MS;

      if (!debounceDone) {
        const capped = Math.min(processAfterMs - now, 2000);
        console.log(`[QueueProcessor] Debounce wait ${capped}ms for ${phone}`);
        await sleep(capped);
        continue;
      }

      const { data: claimData, error: claimErr } = await (supabaseAdmin as any).rpc(
        "wa_queue_claim",
        { p_entry_id: entryId, p_worker_id: workerId },
      );

      if (claimErr) {
        console.error(`[QueueProcessor] Claim error: ${claimErr.message}`);
        return "claim_error";
      }

      if (claimData?.[0]?.claimed) {
        claimedItem = claimData[0];
        break;
      }

      // Debounce window ended but claim lost race — retry until hard deadline.
      if (pastHardDeadline) {
        console.log(
          `[QueueProcessor] Item ${entryId} not claimed (debounce done, past deadline)`,
        );
        return "not_claimed";
      }

      await sleep(300);
    }

    console.log(
      `[QueueProcessor] Claimed ${entryId} for ${phone} (msgs: ${claimedItem.message_count})`,
    );

    const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
      "get_autoreply_context",
      { p_phone: phone },
    );

    if (ctxErr || !ctx) {
      console.error(`[QueueProcessor] Context load failed for ${phone}`);
      await (supabaseAdmin as any).rpc("wa_queue_fail", {
        p_entry_id: entryId,
        p_worker_id: workerId,
        p_error: "context_failed",
      });
      return "context_error";
    }

    const c = ctx as any;
    if (!c.auto_reply_enabled || !c.fonnte_token) {
      console.log(`[QueueProcessor] Auto reply disabled or token missing for ${phone}`);
      await (supabaseAdmin as any).rpc("wa_queue_complete", {
        p_entry_id: entryId,
        p_worker_id: workerId,
        p_reply: "skipped_config",
      });
      return "skipped_config";
    }

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

    const aiCfgRaw = p.ai_lab_config as any;
    const sopEnabled = aiCfgRaw?.tools?.["sop-knowledge"]?.enabled ?? true;
    let sopText = "";
    let brosurFiles: { name: string; url: string }[] = [];

    if (sopEnabled) {
      if (!globalSopCache || Date.now() - globalSopCache.fetchedAt > SOP_CACHE_TTL_MS) {
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

    const explicitKey = p.ai_api_key?.trim();
    const lovableKey = process.env.LOVABLE_API_KEY?.trim();
    const useLovable = !explicitKey && !!lovableKey;
    const apiKey = explicitKey || lovableKey;

    if (!apiKey) {
      await (supabaseAdmin as any).rpc("wa_queue_fail", {
        p_entry_id: entryId,
        p_worker_id: workerId,
        p_error: "no_api_key",
      });
      return "no_api_key";
    }

    const baseUrl = useLovable
      ? "https://ai.gateway.lovable.dev/v1"
      : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    const cfgModel = p.ai_model?.trim();
    const model = useLovable
      ? cfgModel?.includes("/")
        ? cfgModel
        : "google/gemini-2.5-flash"
      : cfgModel || "gpt-4o-mini";

    const rollingMessages = (c.messages ?? []).slice(-20);
    const lastMessage = claimedItem.last_message_body;

    let reply: string | null = null;
    let orchResult: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));
      const controller = new AbortController();
      const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      try {
        await (supabaseAdmin as any).rpc("wa_queue_heartbeat", {
          p_entry_id: entryId,
          p_worker_id: workerId,
        });

        orchResult = await runMultiAgentOrchestration({
          phone,
          messages: rollingMessages,
          agentCtx: {
            property: p,
            rooms: rooms || [],
            sopText,
            brosurFiles,
            today: todayWIB(),
            lastMessage,
          },
          toolCtx: {
            supabasePublic: supabasePublic as any,
            supabaseAdmin: supabaseAdmin as any,
            rooms: rooms || [],
            property: p,
            today: todayWIB(),
            origin,
          },
          llmConfig: { apiKey, baseUrl, model },
          signal: controller.signal,
        });

        if (orchResult?.reply) {
          reply = orchResult.reply;
          break;
        }
      } catch (e) {
        console.error(`[QueueProcessor] AI attempt ${attempt}:`, e);
      } finally {
        clearTimeout(aiTimeout);
      }
    }

    let finalReply = reply ?? FALLBACK_MESSAGE;
    const isFallback = !reply;
    let attachUrl: string | undefined;
    let attachName: string | undefined;

    const isImage = (s: string) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(s);

    if (!isFallback && brosurFiles.length > 0) {
      for (const f of brosurFiles) {
        const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
        const lowered = finalReply.toLowerCase();
        if (
          lowered.includes(f.name.toLowerCase()) ||
          lowered.includes(baseName.toLowerCase())
        ) {
          // Only attach non-image materials (e.g. PDF brochures). Photos are removed.
          if (isImage(f.name) || isImage(f.url)) continue;
          if (!finalReply.includes(f.url)) finalReply += `\n${f.url}`;
          if (!attachUrl) {
            attachUrl = f.url;
            attachName = f.name;
          }
        }
      }
    }

    // Strip any bare image URLs the model included so WhatsApp doesn't render a photo.
    finalReply = finalReply
      .replace(/https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
      c.fonnte_token,
      phone,
      finalReply,
      attachUrl,
      attachName,
    );

    if (!sent) {
      console.error(`[QueueProcessor] Send failed for ${phone}: ${sendErr}`);
      await (supabaseAdmin as any).rpc("wa_queue_fail", {
        p_entry_id: entryId,
        p_worker_id: workerId,
        p_error: `send_failed: ${sendErr}`,
      });
      return "send_failed";
    }

    await (supabaseAdmin as any).rpc("wa_queue_complete", {
      p_entry_id: entryId,
      p_worker_id: workerId,
      p_reply: finalReply,
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
    }).catch((e) => console.warn(e));

    console.log(`[QueueProcessor] ✓ Sent reply for ${phone} (entry: ${entryId})`);
    return "ok";
  } catch (err) {
    console.error("[QueueProcessor] Fatal error:", err);
    return "fatal";
  }
}
