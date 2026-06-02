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
  /**
   * When set, this bot IS the agent — skip telegram_agent_channels
   * lookup and run the named agent for any group message. Used by the
   * per-agent /api/telegram/$agentKey webhook where each bot is
   * permanently bound to one role (Rania = front-office,
   * Santi = finance, etc.).
   */
  forcedAgentKey?: string;
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
  //     OR to a specific topic (forum thread) within it. The agent runs
  //     with isManager=true so it bypasses guest-routing.
  if (chatType === "group" || chatType === "supergroup" || chatType === "channel") {
    const threadId: string | null =
      msg.is_topic_message && msg.message_thread_id != null
        ? String(msg.message_thread_id)
        : null;

    // Resolve THIS bot's own username so we can detect mentions and ignore
    // /start commands aimed at sibling bots (Telegram delivers /start to ALL
    // bots in a group when privacy mode is off).
    const myUsername = await resolveBotUsername(botToken);

    // /start handling — bot identity-aware.
    if (text.startsWith("/start")) {
      // Telegram may suffix the bot username on commands in groups
      // (e.g. /start@rania_pomah_bot). Reject commands targeted at OTHER bots.
      const cmdMatch = text.match(/^\/start(?:@(\S+))?(?:\s+(.*))?$/i);
      const cmdTarget = cmdMatch?.[1]?.toLowerCase();
      const cmdArgs = (cmdMatch?.[2] ?? "").trim();
      if (cmdTarget && myUsername && cmdTarget !== myUsername.toLowerCase()) {
        // Targeted at a sibling bot — silent for this one.
        return;
      }

      // Per-agent bot? /start with no args auto-binds itself.
      if (args.forcedAgentKey && !cmdArgs) {
        await handleAgentChannelRegister({
          ...args,
          chatId,
          chatType,
          agentKey:  args.forcedAgentKey,
          groupTitle: msg.chat?.title,
          threadId,
        });
        return;
      }

      // Explicit `agent <key>` form (legacy single-bot path).
      const parts = cmdArgs.split(/\s+/);
      if (parts[0] === "agent" && parts[1]) {
        // Per-agent bot: only the matching bot registers. Others stay silent.
        if (args.forcedAgentKey && args.forcedAgentKey !== parts[1].toLowerCase()) {
          return;
        }
        await handleAgentChannelRegister({
          ...args,
          chatId,
          chatType,
          agentKey:  args.forcedAgentKey ?? parts[1],
          groupTitle: msg.chat?.title,
          threadId,
        });
        return;
      }

      // Per-agent bot prompt (without forcedAgentKey shouldn't really happen
      // here, but be safe).
      const help =
        args.forcedAgentKey
          ? `Ketik /start (tanpa argumen) untuk mengikat ${args.forcedAgentKey} ke ` +
            `${threadId ? "topic ini" : "grup ini"}.`
          : "Untuk mengikat tempat ini ke agent, ketik: /start agent <agent_key>.";
      await sendMessage(botToken, chatId, help, { message_thread_id: threadId ?? undefined } as any);
      return;
    }

    // Non-command messages in groups: ONLY respond when this bot is
    // explicitly addressed (mention, reply to bot's message, or direct
    // /command targeting it). Otherwise stay silent — six bots in one
    // group can otherwise turn every message into a six-way echo.
    if (!isMessageAddressedToBot(msg, myUsername)) {
      return;
    }

    await handleAgentChannelMessage({ ...args, chatId, message: msg, chatType, threadId });
    return;
  }

  // ── Private DM to a per-agent bot (e.g. an admin chats directly with
  //     @rania_pomah_bot). Same flow as group message — run the forced agent,
  //     BUT only for chat_ids that belong to a linked, active manager.
  //     Per-agent bots run with isManager=true (unlocks update_room_rate,
  //     get_bookings, etc.); without this gate, anyone who finds the bot's
  //     username could DM it and trigger privileged tools.
  if (args.forcedAgentKey) {
    // Allow /start <token> through so an unlinked manager can still
    // activate themselves on a per-agent bot.
    if (text.startsWith("/start")) {
      const token = text.slice("/start".length).trim();
      if (token) {
        await handleLinkingCommand({ ...args, chatId, token, fromName: msg.from?.first_name });
        return;
      }
      const m = await resolveManagerByChatId(chatId);
      await sendMessage(botToken, chatId,
        m
          ? `✅ Sudah terhubung sebagai ${m.name} (${m.role}).`
          : "Bot ini hanya untuk manajer/staf internal. Hubungi super admin untuk link aktivasi.");
      return;
    }

    const linkedManager = await resolveManagerByChatId(chatId);
    if (!linkedManager) {
      await sendMessage(botToken, chatId,
        "Bot ini hanya untuk manajer/staf internal. Hubungi super admin untuk link aktivasi.");
      return;
    }
    await handleAgentChannelMessage({ ...args, chatId, message: msg, chatType, threadId: null });
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
      // Telegram is internal: managerial register, never guest-facing.
      mode: "managerial",
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
  threadId:   string | null;
}): Promise<void> {
  const { botToken, chatId, chatType, agentKey, groupTitle, threadId } = args;
  const key = agentKey.toLowerCase();
  const replyOpts = { message_thread_id: threadId ?? undefined } as any;
  if (!ALLOWED_AGENT_KEYS.has(key)) {
    await sendMessage(botToken, chatId,
      `❌ Agent "${agentKey}" tidak dikenal. Pilihan: ${[...ALLOWED_AGENT_KEYS].join(", ")}.`,
      replyOpts);
    return;
  }
  // Composite key lookup: same chat + same thread (or both NULL) → overwrite.
  const { data: existing } = await (supabaseAdmin as any)
    .from("telegram_agent_channels")
    .select("id")
    .eq("chat_id", chatId)
    .is("message_thread_id", threadId)
    .maybeSingle();

  const payload = {
    chat_id:           chatId,
    agent_key:         key,
    chat_type:         chatType,
    label:             groupTitle ?? null,
    message_thread_id: threadId,
    is_active:         true,
  };

  const op = existing?.id
    ? (supabaseAdmin as any).from("telegram_agent_channels").update(payload).eq("id", existing.id)
    : (supabaseAdmin as any).from("telegram_agent_channels").insert(payload);
  const { error } = await op;
  if (error) {
    await sendMessage(botToken, chatId, `❌ Gagal register: ${error.message}`, replyOpts);
    return;
  }
  await sendMessage(botToken, chatId,
    `✅ ${threadId ? `Topic ini` : `Grup ini`} ter-bind ke agent "${key}". ` +
    `Notif yang relevan akan masuk ke ${threadId ? "topic" : "grup"} ini, dan pesan di sini akan dijawab oleh agent tersebut.`,
    replyOpts);
}

async function handleAgentChannelMessage(args: HandlerArgs & {
  chatId:   string;
  message:  any;
  chatType: string;
  threadId: string | null;
}): Promise<void> {
  const { botToken, chatId, message, threadId } = args;
  const replyOpts = { message_thread_id: threadId ?? undefined } as any;

  // Lookup precedence:
  //   1. forcedAgentKey (per-agent bot — Rania/Julia/etc. webhook)
  //   2. exact (chat + thread) channel binding
  //   3. chat-wide channel binding
  let mapping: { agent_key: string; label: string | null } | null = null;
  if (args.forcedAgentKey) {
    mapping = { agent_key: args.forcedAgentKey, label: null };
  }
  if (!mapping && threadId != null) {
    const { data } = await (supabaseAdmin as any)
      .from("telegram_agent_channels")
      .select("agent_key, label")
      .eq("chat_id", chatId)
      .eq("message_thread_id", threadId)
      .eq("is_active", true)
      .maybeSingle();
    if (data) mapping = data as any;
  }
  if (!mapping) {
    const { data } = await (supabaseAdmin as any)
      .from("telegram_agent_channels")
      .select("agent_key, label")
      .eq("chat_id", chatId)
      .is("message_thread_id", null)
      .eq("is_active", true)
      .maybeSingle();
    if (data) mapping = data as any;
  }

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

  // Load prior conversation history for this (chat, thread, agent)
  // so the agent has memory across messages instead of treating each
  // ping as a cold start.
  const history = await loadAgentConversation(chatId, threadId, mapping.agent_key);

  // Run the bound agent directly via getAgent + runAgent helper.
  const { getAgent } = await import("@/ai/agents/registry");
  const { runAgentInGroupChannel } = await import("./telegram-agent-runner");
  const { reply, turn } = await runAgentInGroupChannel({
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
      // Telegram channel = internal communication.
      mode: "managerial",
    },
    toolCtx: {
      supabasePublic: supabasePublic as any,
      supabaseAdmin:  supabaseAdmin  as any,
      rooms:          rooms || [],
      property:       p,
      today:          todayWIB(),
      phone:          `tg-channel:${mapping.agent_key}:${chatId}`,
      // Per-agent Telegram bots only serve internal staff (managers / super
      // admin in dedicated groups), so privileged tools — e.g. update_room_rate
      // — are allowed to run here.
      isManager:      true,
    },
    llmConfig: { apiKey, baseUrl, model },
    history,
  });

  // Persist new messages only when the run actually produced an
  // assistant reply (turn is empty on ⚠️ errors).
  if (turn.length > 0) {
    await saveAgentConversation(chatId, threadId, mapping.agent_key, [...history, ...turn]);
  }

  // runAgentInGroupChannel now always returns a non-empty string
  // (either the agent reply or a ⚠️-prefixed diagnostic), so a bare
  // pass-through is enough.
  await sendMessage(botToken, chatId, reply, replyOpts);
}

// ─── Conversation history per (chat, thread, agent) ─────────────────────────

// Keep the most recent N messages so the token budget stays bounded.
// Tool chains can produce 4-6 messages per user turn (assistant + tool
// pairs), so 40 ≈ last ~6-8 user turns of context.
const MAX_HISTORY_MESSAGES = 40;

async function loadAgentConversation(
  chatId:   string,
  threadId: string | null,
  agentKey: string,
): Promise<import("@/ai/types").AiMessage[]> {
  try {
    const q = (supabaseAdmin as any)
      .from("telegram_agent_conversations")
      .select("messages")
      .eq("chat_id", chatId)
      .eq("agent_key", agentKey);
    const { data } = await (threadId == null
      ? q.is("message_thread_id", null)
      : q.eq("message_thread_id", threadId)
    ).maybeSingle();
    const msgs = (data?.messages ?? []) as import("@/ai/types").AiMessage[];
    return Array.isArray(msgs) ? msgs : [];
  } catch (e) {
    console.warn("[TelegramRouter] loadAgentConversation failed:", e);
    return [];
  }
}

async function saveAgentConversation(
  chatId:   string,
  threadId: string | null,
  agentKey: string,
  messages: import("@/ai/types").AiMessage[],
): Promise<void> {
  // Trim to the cap, preserving the tail. If the trim would orphan a
  // `tool` message from its preceding assistant tool_calls, slide the
  // window forward until the first message is either user or
  // assistant-without-pending-tools.
  let trimmed = messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
    : messages;
  while (trimmed.length > 0 && trimmed[0].role === "tool") {
    trimmed = trimmed.slice(1);
  }
  // Drop a trailing assistant-with-tool_calls whose tool replies got
  // sliced off — otherwise the next LLM call sees an unresolved call.
  while (
    trimmed.length > 0 &&
    trimmed[trimmed.length - 1].role === "assistant" &&
    (trimmed[trimmed.length - 1].tool_calls?.length ?? 0) > 0
  ) {
    trimmed = trimmed.slice(0, -1);
  }

  try {
    const findQ = (supabaseAdmin as any)
      .from("telegram_agent_conversations")
      .select("id")
      .eq("chat_id", chatId)
      .eq("agent_key", agentKey);
    const { data: existing } = await (threadId == null
      ? findQ.is("message_thread_id", null)
      : findQ.eq("message_thread_id", threadId)
    ).maybeSingle();

    const payload = {
      chat_id:           chatId,
      message_thread_id: threadId,
      agent_key:         agentKey,
      messages:          trimmed,
      updated_at:        new Date().toISOString(),
    };
    const op = existing?.id
      ? (supabaseAdmin as any)
          .from("telegram_agent_conversations").update(payload).eq("id", existing.id)
      : (supabaseAdmin as any)
          .from("telegram_agent_conversations").insert(payload);
    const { error } = await op;
    if (error) console.warn("[TelegramRouter] saveAgentConversation error:", error.message);
  } catch (e) {
    console.warn("[TelegramRouter] saveAgentConversation failed:", e);
  }
}

// ─── Bot identity + mention gating ─────────────────────────────────────────

// Cache the bot username per token so the group-message check (which runs on
// EVERY message in a multi-bot group) doesn't hit Telegram repeatedly.
const cachedBotUsername = new Map<string, { name: string | null; at: number }>();
const BOT_USERNAME_TTL_MS = 60 * 60 * 1000;

async function resolveBotUsername(token: string): Promise<string | null> {
  const cached = cachedBotUsername.get(token);
  if (cached && Date.now() - cached.at < BOT_USERNAME_TTL_MS) return cached.name;
  try {
    const { getMe } = await import("./telegram.service");
    const r = await getMe(token);
    const name = r.ok && r.result?.username ? r.result.username : null;
    cachedBotUsername.set(token, { name, at: Date.now() });
    return name;
  } catch {
    cachedBotUsername.set(token, { name: null, at: Date.now() });
    return null;
  }
}

/**
 * Decide whether THIS bot should respond to a group message.
 * Returns true when ANY of these hold:
 *   - The message text mentions @bot_username
 *   - The message is a reply to one of the bot's own messages
 *   - There's a text_mention entity targeting this bot's user id
 *
 * Returns false for regular chatter — keeps the room quiet when six bots
 * coexist.
 */
function isMessageAddressedToBot(msg: any, myUsername: string | null): boolean {
  if (!myUsername) return false;
  const text: string = (msg.text ?? msg.caption ?? "");
  const lowerText = text.toLowerCase();
  const lowerUser = myUsername.toLowerCase();
  if (lowerText.includes(`@${lowerUser}`)) return true;

  // Pemanggilan dengan nickname — buang sufiks "_pomah_bot" / "_bot" dari
  // username bot untuk mendapatkan nama panggilan persona (mis.
  // "rania_pomah_bot" → "rania"). Bot merespon bila pesan diawali nickname
  // diikuti pemisah ("," ":" "." spasi) atau berupa nickname saja. Tetap
  // mencegah echo 6-arah karena hanya nickname yang cocok yang menjawab.
  const nickname = lowerUser.replace(/_?(pomah_)?bot$/i, "").replace(/[_-]+$/g, "");
  if (nickname.length >= 3) {
    const trimmed = lowerText.trim();
    const pattern = new RegExp(`^${nickname}(?:[\\s,.:!?]|$)`);
    if (pattern.test(trimmed)) return true;
  }

  // reply_to_message → kalau pesan tersebut dikirim oleh bot ini
  const replied = msg.reply_to_message;
  if (replied?.from?.username && String(replied.from.username).toLowerCase() === lowerUser) {
    return true;
  }

  // text_mention entity (mention tanpa @username, dipakai bila admin
  // tap nama bot di daftar member)
  const entities = msg.entities ?? msg.caption_entities ?? [];
  for (const ent of entities) {
    if (ent.type === "text_mention" && ent.user?.username
        && String(ent.user.username).toLowerCase() === lowerUser) {
      return true;
    }
  }
  return false;
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
