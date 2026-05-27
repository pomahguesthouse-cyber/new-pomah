/**
 * Reliable WhatsApp autoreply: debounce wait → AI → Fonnte send.
 * Runs inside waitUntil from the webhook (not HTTP self-fetch).
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
import { getWaitUntil } from "@/lib/cf-context";
import { resolveQueueTiming } from "@/services/queue.service";

const FALLBACK_MESSAGE =
  "Mohon maaf, sistem kami sedang sibuk. Tim kami akan segera membalas pesan Anda. 🙏";

const AI_TIMEOUT_MS = 22_000;
const POST_DEADLINE_GRACE_MS = 15_000;

interface SopCache {
  docs: any[];
  fetchedAt: number;
}
let globalSopCache: SopCache | null = null;
const SOP_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * A sendable brochure is a file uploaded via the Brosur tab into the dedicated
 * public `brosur` bucket. This deliberately excludes Media Library assets
 * (room photos, banners) which share doc_category='brosur' but live in the
 * `room-images` bucket and must NOT be sent as brochures.
 */
function isBrosurDoc(d: any) {
  const bucket = (d.storage_bucket as string | undefined)?.trim().toLowerCase() || "";
  return bucket === "brosur";
}

/** Detect if the guest is requesting brochure / images / photos. */
const BROCHURE_REQUEST_PATTERNS = [
  /\b(brosur|brochure|katalog|catalogue|catalog)(?:nya)?\b/i,
  /\b(gambar|foto|photo|picture|image)(?:nya)?\b.*\b(kamar|hotel|room|tipe|type|penginapan)(?:nya)?\b/i,
  /\b(kamar|room|tipe|type)(?:nya)?\b.*\b(gambar|foto|photo|picture|image)(?:nya)?\b/i,
  /\b(lihat|minta|kirim|kirimin|kasih|tunjuk(?:kan|in)?|ada|boleh|bisa)\b.*\b(gambar|foto|brosur|brochure)(?:nya)?\b/i,
  /\b(gambar|foto|brosur)(?:nya)?\b.*\b(lihat|minta|kirim|dong|ya|kak|nya)\b/i,
];

function isBrochureRequest(text: string): boolean {
  return BROCHURE_REQUEST_PATTERNS.some((p) => p.test(text));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AutoreplyOutcome =
  | "ok"
  | "skipped_config"
  | "context_error"
  | "no_api_key"
  | "send_failed"
  | "already_done"
  | "not_claimed"
  | "fatal";

/** Wait until smart-delay window ends (polls DB when queue entry exists). */
export async function waitForDebounce(
  entryId: string | null,
  fallbackDelayMs: number,
  maxWaitMs: number,
): Promise<void> {
  if (!entryId) {
    await sleep(fallbackDelayMs);
    return;
  }

  const deadline = Date.now() + maxWaitMs + POST_DEADLINE_GRACE_MS;

  while (Date.now() < deadline) {
    const { data: row } = await (supabaseAdmin as any)
      .from("wa_conversation_queue")
      .select("process_after, max_wait_until, status")
      .eq("id", entryId)
      .maybeSingle();

    if (!row) return;
    if (row.status === "sent") return;
    if (!["pending", "waiting"].includes(row.status as string)) return;

    const now = Date.now();
    const processAfterMs = new Date(row.process_after as string).getTime();
    if (now >= processAfterMs) return;

    await sleep(Math.min(processAfterMs - now, 2000));
  }
}

/** Generate reply and send via Fonnte (no queue claim required). */
export async function executeAutoreplyForPhone(
  phone: string,
  origin: string,
): Promise<AutoreplyOutcome> {
  const { data: ctx, error: ctxErr } = await (supabaseAdmin as any).rpc(
    "get_autoreply_context",
    { p_phone: phone },
  );

  if (ctxErr || !ctx) {
    console.error(`[Autoreply] Context failed for ${phone}`);
    return "context_error";
  }

  const c = ctx as any;
  if (!c.auto_reply_enabled || !c.fonnte_token) {
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
        .select("name, content, source_url, file_path, doc_category, storage_bucket")
        .order("created_at", { ascending: true })
        .limit(40);
      globalSopCache = { docs: fetchedDocs ?? [], fetchedAt: Date.now() };
    }
    const parts: string[] = [];
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    for (const d of globalSopCache.docs) {
      if (isBrosurDoc(d)) {
        if (d.file_path) {
          const bucket = (d.storage_bucket as string | undefined)?.trim() || "sop-documents";
          brosurFiles.push({
            name: d.name,
            url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${d.file_path}`,
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
  if (!apiKey) return "no_api_key";

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
  const lastMessage =
    [...rollingMessages].reverse().find((m: { direction: string }) => m.direction === "in")
      ?.body ?? "";

  let reply: string | null = null;
  let orchResult: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(Math.min(1000 * attempt, 3000));
    const controller = new AbortController();
    const aiTimeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
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
      console.error(`[Autoreply] AI attempt ${attempt}:`, e);
    } finally {
      clearTimeout(aiTimeout);
    }
  }

  let finalReply = reply ?? FALLBACK_MESSAGE;
  const isFallback = !reply;
  let attachUrl: string | undefined;
  let attachName: string | undefined;

  // Proactively attach the PDF brochure when the guest asks for brosur/gambar/foto
  if (!isFallback && brosurFiles.length > 0 && isBrochureRequest(lastMessage)) {
    // Prefer a PDF brochure, but fall back to any brochure file (e.g. JPG/PNG).
    const brosur =
      brosurFiles.find((f) => /\.pdf(\?|$)/i.test(f.url)) ?? brosurFiles[0];
    if (brosur) {
      attachUrl = brosur.url;
      attachName = brosur.name;
      console.info(`[Autoreply] Brochure request detected — attaching ${brosur.name}`);
    }
  }

  // Fallback: if LLM mentioned a brosur file name in its reply, attach it
  if (!attachUrl && !isFallback && brosurFiles.length > 0) {
    for (const f of brosurFiles) {
      const baseName = f.name.replace(/\.[a-z0-9]+$/i, "");
      const lowered = finalReply.toLowerCase();
      if (
        lowered.includes(f.name.toLowerCase()) ||
        lowered.includes(baseName.toLowerCase())
      ) {
        attachUrl = f.url;
        attachName = f.name;
        break;
      }
    }
  }

  // If no brochure was attached, check if the LLM provided a PDF URL directly (e.g. invoice)
  if (!attachUrl) {
    const pdfMatch = finalReply.match(/(https?:\/\/[^\s]+?\.pdf)/i);
    if (pdfMatch) {
      attachUrl = pdfMatch[1];
      attachName = "Invoice.pdf";
      // Remove the raw URL from the text body to keep the message clean
      finalReply = finalReply.replace(pdfMatch[1], "").trim();
    }
  }

  // Strip any bare image URLs the model included so WhatsApp doesn't render a photo.
  finalReply = finalReply
    .replace(/https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // When the guest asked for a brochure, also append direct link(s) so they can
  // open it even if the file attachment can't be delivered. Done after the
  // image-URL strip above so the links survive.
  if (!isFallback && brosurFiles.length > 0 && isBrochureRequest(lastMessage)) {
    const links = brosurFiles.map((f) => `${f.name}:\n${f.url}`).join("\n\n");
    finalReply = `${finalReply}\n\n${links}`.trim();
  }

  let { ok: sent, error: sendErr } = await sendWhatsAppMessage(
    c.fonnte_token,
    phone,
    finalReply,
    attachUrl,
    attachName,
  );

  // If the attachment broke the send (e.g. unreachable file URL), retry
  // text-only so the guest still gets a reply instead of silence.
  if (!sent && attachUrl) {
    console.warn(`[Autoreply] Send with attachment failed (${sendErr}) — retrying text-only`);
    ({ ok: sent, error: sendErr } = await sendWhatsAppMessage(
      c.fonnte_token,
      phone,
      finalReply,
    ));
  }

  if (!sent) {
    console.error(`[Autoreply] Send failed ${phone}: ${sendErr}`);
    return "send_failed";
  }

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

  console.log(`[Autoreply] ✓ Sent to ${phone.slice(-6)}`);
  return "ok";
}

async function claimQueueEntry(
  entryId: string,
): Promise<{ claimed: boolean; workerId: string }> {
  const workerId = `worker_${Math.random().toString(36).substring(2, 15)}`;
  const { data: claimData, error } = await (supabaseAdmin as any).rpc("wa_queue_claim", {
    p_entry_id: entryId,
    p_worker_id: workerId,
  });
  if (error) console.error(`[Autoreply] claim error: ${error.message}`);
  return { claimed: !!claimData?.[0]?.claimed, workerId };
}

export interface ScheduleAutoreplyParams {
  phone: string;
  body: string;
  smartDelayConfig: unknown;
  queueEntryId: string | null;
}

/** Schedule debounce + autoreply after webhook returns 200. */
export function scheduleAutoreply(
  request: Request,
  params: ScheduleAutoreplyParams,
): void {
  const origin = new URL(request.url).origin;
  const { delayMs, maxWaitMs } = resolveQueueTiming(
    params.body,
    params.smartDelayConfig as Parameters<typeof resolveQueueTiming>[1],
  );

  const work = async () => {
    const logPhone = params.phone.slice(-6);
    try {
      if (params.queueEntryId) {
        const { data: row } = await (supabaseAdmin as any)
          .from("wa_conversation_queue")
          .select("status")
          .eq("id", params.queueEntryId)
          .maybeSingle();
        if (row?.status === "sent") {
          console.log(`[Autoreply] ${logPhone} queue already sent`);
          return;
        }
      }

      console.log(
        `[Autoreply] ${logPhone} debounce start delay=${delayMs}ms max=${maxWaitMs}ms entry=${params.queueEntryId?.slice(0, 8) ?? "none"}`,
      );

      await waitForDebounce(params.queueEntryId, delayMs, maxWaitMs);

      let workerId = `direct_${Date.now()}`;
      if (params.queueEntryId) {
        const claim = await claimQueueEntry(params.queueEntryId);
        if (!claim.claimed) {
          for (let i = 0; i < 40; i++) {
            const { data: row } = await (supabaseAdmin as any)
              .from("wa_conversation_queue")
              .select("status")
              .eq("id", params.queueEntryId)
              .maybeSingle();
            if (row?.status === "sent") {
              console.log(`[Autoreply] ${logPhone} already sent by peer worker`);
              return;
            }
            if (row?.status === "processing") {
              await sleep(500);
              continue;
            }
            break;
          }
          console.log(`[Autoreply] ${logPhone} not_claimed — skip send to avoid duplicate`);
          return;
        }
        workerId = claim.workerId;
      }

      const outcome = await executeAutoreplyForPhone(params.phone, origin);
      console.log(`[Autoreply] ${logPhone} outcome=${outcome}`);

      if (params.queueEntryId) {
        if (outcome === "ok") {
          await (supabaseAdmin as any).rpc("wa_queue_complete", {
            p_entry_id: params.queueEntryId,
            p_worker_id: workerId,
            p_reply: "sent",
          });
        } else {
          await (supabaseAdmin as any).rpc("wa_queue_fail", {
            p_entry_id: params.queueEntryId,
            p_worker_id: workerId,
            p_error: outcome,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error(`[Autoreply] ${logPhone} fatal:`, e);
    }
  };

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    waitUntil(work());
    console.log(`[Autoreply] ${params.phone.slice(-6)} scheduled via waitUntil`);
  } else {
    console.error(
      `[Autoreply] waitUntil MISSING — background reply may not run for ${params.phone.slice(-6)}`,
    );
    void work();
  }
}
