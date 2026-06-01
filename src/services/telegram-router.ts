/**
 * Telegram update router.
 *
 * Sits behind the /api/telegram webhook. Responsibilities:
 *   1. Identify the sender (Telegram chat_id → property_manager row).
 *   2. Handle bot commands: /start <token> for first-time linking.
 *   3. For text from a linked manager → run Manager Agent and reply.
 *   4. For payment-proof images from a linked manager OR from a callback,
 *      dispatch to the appropriate handler.
 *   5. For callback_query (inline button taps) → invoke action.
 *
 * Authorization is strict: any update from an unknown chat_id gets a
 * polite "not linked" reply, never side-effects. The webhook secret
 * already verified the request actually came from Telegram.
 */

import { supabaseAdmin, supabasePublic } from "@/integrations/supabase/client.server";
import {
  sendMessage,
  answerCallbackQuery,
  getFileUrl,
} from "./telegram.service";
import { todayWIB } from "@/lib/date";

interface ManagerRow {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  telegram_chat_id: string | null;
}

interface HandlerArgs {
  update:     any;
  botToken:   string;
  propertyId: string;
}

export async function handleTelegramUpdate(args: HandlerArgs): Promise<void> {
  const { update, botToken } = args;

  // ── Callback queries (inline button taps) ────────────────────────────
  if (update.callback_query) {
    await handleCallback({ ...args, callback: update.callback_query });
    return;
  }

  // ── Messages ─────────────────────────────────────────────────────────
  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat?.id ?? "");
  if (!chatId) return;

  const chatType = String(msg.chat?.type ?? "private");
  const text: string = (msg.text ?? msg.caption ?? "").trim();

  // ── Group/supergroup messages → route to the agent bound to this chat
  //     (telegram_agent_channels). The agent runs with isManager=true so
  //     it bypasses guest-routing and gets full tool access.
  if (chatType === "group" || chatType === "supergroup" || chatType === "channel") {
    // Allow /start to seed channel registration (admin types
    // "/start agent <agent_key>" inside the group).
    if (text.startsWith("/start")) {
      const parts = text.split(/\s+/);
      if (parts[1] === "agent" && parts[2]) {
        await handleAgentChannelRegister({ ...args, chatId, chatType, agentKey: parts[2], groupTitle: msg.chat?.title });
        return;
      }
      await sendMessage(botToken, chatId,
        "Bot terdaftar di grup ini. Admin perlu mengikat grup ini ke agent tertentu via " +
        "Admin → Telegram, ATAU ketik: /start agent <agent_key> (mis. front-office, finance, content, manager, customer-care, pricing).");
      return;
    }
    await handleAgentChannelMessage({ ...args, chatId, message: msg, chatType });
    return;
  }

  // Private chat below — original DM flow with the Manager Agent.

  // ── /start <token> — first-time linking ──────────────────────────────
  if (text.startsWith("/start")) {
    const token = text.slice("/start".length).trim();
    if (token) {
      await handleLinkingCommand({ ...args, chatId, token, fromName: msg.from?.first_name });
      return;
    }
    // /start without token: status check
    const manager = await resolveManagerByChatId(chatId);
    if (manager) {
      await sendMessage(botToken, chatId,
        `✅ Sudah terhubung sebagai ${manager.name} (${manager.role}).`);
    } else {
      await sendMessage(botToken, chatId,
        "Bot ini hanya untuk manajer properti. Hubungi admin untuk mendapatkan link aktivasi.");
    }
    return;
  }

  // From here on, sender MUST be a linked manager.
  const manager = await resolveManagerByChatId(chatId);
  if (!manager) {
    await sendMessage(botToken, chatId,
      "Akun Telegram Anda belum terhubung ke sistem. Hubungi super admin untuk link aktivasi.");
    return;
  }

  // ── Photo / document attachment (likely a bukti transfer forwarded
  //    by a manager, or attached commentary). Fetch the file URL and
  //    pass it on as a payment-proof image to the Manager Agent so the
  //    agent can decide what to do (OCR, ask Finance, etc.).
  let attachmentUrl: string | null = null;
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    // Largest variant is last
    const file = msg.photo[msg.photo.length - 1];
    attachmentUrl = await getFileUrl(botToken, file.file_id);
  } else if (msg.document?.file_id) {
    attachmentUrl = await getFileUrl(botToken, msg.document.file_id);
  }

  // ── Text or attachment → Manager Agent ───────────────────────────────
  const userText = text || (attachmentUrl ? "[Manajer mengirim lampiran]" : "");
  if (!userText) return;

  try {
    await runManagerTurn({
      ...args,
      manager,
      chatId,
      userText,
      attachmentUrl,
    });
  } catch (e) {
    console.error("[TelegramRouter] runManagerTurn failed:", e);
    await sendMessage(botToken, chatId,
      "Maaf, terjadi kendala saat memproses pesan Anda. Coba lagi sebentar lagi.");
  }
}

// ─── Manager-Agent turn ─────────────────────────────────────────────────────

async function runManagerTurn(args: HandlerArgs & {
  manager:       ManagerRow;
  chatId:        string;
  userText:      string;
  attachmentUrl: string | null;
}): Promise<void> {
  const { botToken, chatId, manager, userText, attachmentUrl } = args;

  // Load property + rooms + API config (mirror wa-autoreply minimally).
  const { data: prop } = await (supabaseAdmin as any)
    .from("properties").select("*").limit(1).maybeSingle();
  const p = (prop ?? {}) as any;
  const { data: rooms } = await (supabasePublic as any)
    .from("room_types")
    .select("id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate")
    .order("base_rate");

  const explicitKey = p.ai_api_key?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const apiKey      = explicitKey || lovableKey;
  if (!apiKey) {
    await sendMessage(botToken, chatId, "AI belum dikonfigurasi.");
    return;
  }
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

  // Lazy import to keep webhook cold-start light.
  const { runMultiAgentOrchestration } = await import("@/ai/multi-agent-orchestrator");

  // Optionally pre-run OCR for an attached image so the agent's
  // get_payment_proof_result tool can serve it synchronously.
  let recentOcrResult: any;
  if (attachmentUrl) {
    try {
      const { runOcrAndMatch } = await import("@/services/payment-proof.service");
      recentOcrResult = await runOcrAndMatch(supabaseAdmin as any, attachmentUrl, manager.phone ?? "");
    } catch (e) {
      console.warn("[TelegramRouter] OCR failed:", e);
    }
  }

  const result = await runMultiAgentOrchestration({
    phone:     `tg:${manager.id}`,           // synthetic key so booking state is isolated
    isManager: true,                          // routes straight to Manager Agent
    messages:  [{ direction: "in", body: userText }],
    agentCtx: {
      property:    p,
      rooms:       rooms || [],
      sopText:     "",
      brosurFiles: [],
      today:       todayWIB(),
      managerName: manager.name,
    },
    toolCtx: {
      supabasePublic: supabasePublic as any,
      supabaseAdmin:  supabaseAdmin  as any,
      rooms:          rooms || [],
      property:       p,
      today:          todayWIB(),
      phone:          manager.phone ?? "",
      recentPaymentProofImageUrl: attachmentUrl ?? undefined,
      recentOcrResult: recentOcrResult
        ? { ocr: recentOcrResult.ocr, match: recentOcrResult.match }
        : undefined,
    },
    llmConfig: { apiKey, baseUrl, model },
  });

  const reply = result.reply?.trim() ||
    `Maaf, tidak ada balasan (${result.error ?? result.status}).`;
  await sendMessage(botToken, chatId, reply);
}

// ─── Linking ────────────────────────────────────────────────────────────────

async function handleLinkingCommand(args: HandlerArgs & {
  chatId:   string;
  token:    string;
  fromName: string | undefined;
}): Promise<void> {
  const { botToken, chatId, token } = args;

  const { data: m } = await (supabaseAdmin as any)
    .from("property_managers")
    .select("id, name, role, telegram_token_expires_at")
    .eq("telegram_link_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (!m) {
    await sendMessage(botToken, chatId, "❌ Token tidak valid atau sudah dipakai.");
    return;
  }
  if (m.telegram_token_expires_at && new Date(m.telegram_token_expires_at) < new Date()) {
    await sendMessage(botToken, chatId, "❌ Token sudah kedaluwarsa. Minta link baru ke admin.");
    return;
  }

  const { error: updErr } = await (supabaseAdmin as any)
    .from("property_managers")
    .update({
      telegram_chat_id:      chatId,
      telegram_link_token:   null,
      telegram_token_expires_at: null,
      telegram_linked_at:    new Date().toISOString(),
    })
    .eq("id", m.id);

  if (updErr) {
    await sendMessage(botToken, chatId, `❌ Gagal menyimpan link: ${updErr.message}`);
    return;
  }

  await sendMessage(botToken, chatId,
    `✅ Terhubung sebagai ${m.name} (${m.role}).\n\n` +
    `Mulai sekarang Anda akan menerima notifikasi booking, bukti transfer, ` +
    `dan komplain di sini. Anda juga bisa langsung bertanya — tanya occupancy, ` +
    `minta status booking, atau balas pesan tamu lewat saya.`);
}

// ─── Agent group channel handling ───────────────────────────────────────────

const ALLOWED_AGENT_KEYS = new Set([
  "front-office", "pricing", "customer-care", "finance", "content", "manager",
]);

async function handleAgentChannelRegister(args: HandlerArgs & {
  chatId:     string;
  chatType:   string;
  agentKey:   string;
  groupTitle: string | undefined;
}): Promise<void> {
  const { botToken, chatId, chatType, agentKey, groupTitle } = args;
  const key = agentKey.toLowerCase();
  if (!ALLOWED_AGENT_KEYS.has(key)) {
    await sendMessage(botToken, chatId,
      `❌ Agent "${agentKey}" tidak dikenal. Pilihan: ${[...ALLOWED_AGENT_KEYS].join(", ")}.`);
    return;
  }
  const { error } = await (supabaseAdmin as any)
    .from("telegram_agent_channels")
    .upsert({
      chat_id:   chatId,
      agent_key: key,
      chat_type: chatType,
      label:     groupTitle ?? null,
      is_active: true,
    }, { onConflict: "chat_id" });
  if (error) {
    await sendMessage(botToken, chatId, `❌ Gagal register: ${error.message}`);
    return;
  }
  await sendMessage(botToken, chatId,
    `✅ Grup ini ter-bind ke agent "${key}". Semua notif untuk agent ini akan masuk ke sini, ` +
    `dan pesan di grup ini akan dijawab langsung oleh agent tersebut.`);
}

async function handleAgentChannelMessage(args: HandlerArgs & {
  chatId:   string;
  message:  any;
  chatType: string;
}): Promise<void> {
  const { botToken, chatId, message } = args;

  // Lookup mapping.
  const { data: mapping } = await (supabaseAdmin as any)
    .from("telegram_agent_channels")
    .select("agent_key, label")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!mapping?.agent_key) {
    // Bot is silent in unregistered groups so it doesn't spam.
    return;
  }

  const text: string = (message.text ?? message.caption ?? "").trim();
  if (!text) return;

  // Build a minimal context and run the specific agent (not Manager).
  const { data: prop } = await (supabaseAdmin as any)
    .from("properties").select("*").limit(1).maybeSingle();
  const p = (prop ?? {}) as any;
  const { data: rooms } = await (supabasePublic as any)
    .from("room_types")
    .select("id, name, base_rate, capacity, bed_type, floor_info, description, amenities, extrabed_capacity, extrabed_rate")
    .order("base_rate");

  const explicitKey = p.ai_api_key?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const apiKey      = explicitKey || lovableKey;
  if (!apiKey) {
    await sendMessage(botToken, chatId, "AI belum dikonfigurasi.");
    return;
  }
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

  // Load the agent's persona name from AI Lab config.
  const aiLabConfig = (p.ai_lab_config ?? {}) as any;
  const managerName: string | undefined = aiLabConfig?.agents?.[mapping.agent_key]?.managerName;
  const customInstructions: string | undefined = aiLabConfig?.agents?.[mapping.agent_key]?.instructions;

  // Run the bound agent directly via getAgent + runAgent helper.
  const { getAgent } = await import("@/ai/agents/registry");
  const { runAgentInGroupChannel } = await import("./telegram-agent-runner");
  const reply = await runAgentInGroupChannel({
    agentDef: getAgent(mapping.agent_key as any),
    messageText: text,
    agentCtx: {
      property:    p,
      rooms:       rooms || [],
      sopText:     "",
      brosurFiles: [],
      today:       todayWIB(),
      managerName,
      customInstructions,
    },
    toolCtx: {
      supabasePublic: supabasePublic as any,
      supabaseAdmin:  supabaseAdmin  as any,
      rooms:          rooms || [],
      property:       p,
      today:          todayWIB(),
      phone:          `tg-channel:${mapping.agent_key}:${chatId}`,
    },
    llmConfig: { apiKey, baseUrl, model },
  });

  await sendMessage(botToken, chatId, reply || "(agent tidak menghasilkan balasan)");
}

async function resolveManagerByChatId(chatId: string): Promise<ManagerRow | null> {
  const { data } = await (supabaseAdmin as any)
    .from("property_managers")
    .select("id, name, role, phone, telegram_chat_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as ManagerRow | null) ?? null;
}

// ─── Callback queries (inline buttons) ──────────────────────────────────────

async function handleCallback(args: HandlerArgs & { callback: any }): Promise<void> {
  const { botToken, callback } = args;
  const chatId = String(callback.message?.chat?.id ?? "");
  const dataStr: string = callback.data ?? "";

  const manager = chatId ? await resolveManagerByChatId(chatId) : null;
  if (!manager) {
    await answerCallbackQuery(botToken, callback.id, "Tidak terotorisasi.", true);
    return;
  }

  // Format: action:arg1:arg2... — keep tight, 64-byte limit.
  const [action, ...rest] = dataStr.split(":");
  try {
    const { dispatchCallback } = await import("./telegram-callbacks");
    await dispatchCallback({
      action,
      args: rest,
      callback,
      manager,
      botToken,
      chatId,
    });
  } catch (e) {
    console.error("[TelegramRouter] callback dispatch failed:", e);
    await answerCallbackQuery(botToken, callback.id, "Terjadi kendala.", true);
  }
}
