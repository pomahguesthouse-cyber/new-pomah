/**
 * Admin server functions for the Telegram integration.
 *
 *  - generateTelegramLinkToken: create a one-time deep-link a manager can
 *    open in Telegram to bind their chat to their property_manager row.
 *  - unlinkTelegram: drop the binding (e.g. after losing access).
 *  - listTelegramStatus: per-manager linked/unlinked state for the UI.
 *  - setupTelegramWebhook: one-shot config call to point Telegram at our
 *    /api/telegram endpoint with a fresh secret.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMe, setWebhook, getWebhookInfo, deleteWebhook, sendMessage } from "@/services/telegram.service";

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  (globalThis.crypto ?? require("crypto").webcrypto).getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export const getTelegramWebhookDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("telegram_bot_token, telegram_bot_username, telegram_webhook_secret")
      .limit(1)
      .maybeSingle();
    if (!prop?.telegram_bot_token) {
      return { ok: false as const, error: "Bot token belum di-set di Settings." };
    }
    const me = await getMe(prop.telegram_bot_token);
    const wh = await getWebhookInfo(prop.telegram_bot_token);
    return {
      ok: true as const,
      bot_username: me.ok ? me.result?.username ?? null : null,
      bot_username_in_db: prop.telegram_bot_username ?? null,
      secret_set_in_db: !!prop.telegram_webhook_secret,
      me_error: me.ok ? null : me.error ?? "unknown",
      webhook: wh.ok ? wh.result : null,
      webhook_error: wh.ok ? null : wh.error ?? "unknown",
    };
  });

export const sendTelegramTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ managerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: m } = await (supabaseAdmin as any)
      .from("property_managers")
      .select("id, name, telegram_chat_id")
      .eq("id", data.managerId)
      .maybeSingle();
    if (!m?.telegram_chat_id) {
      throw new Error("Manager belum terhubung ke Telegram.");
    }
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("telegram_bot_token")
      .limit(1)
      .maybeSingle();
    if (!prop?.telegram_bot_token) throw new Error("Bot token belum di-set.");
    const res = await sendMessage(
      prop.telegram_bot_token,
      m.telegram_chat_id,
      `🧪 Test message dari sistem untuk ${m.name}. Bot berfungsi.`,
    );
    if (!res.ok) throw new Error(res.error ?? "send gagal");
    return { ok: true as const };
  });

/* ---------------- Agent channels (group bindings) ---------------- */

const AGENT_KEYS = ["front-office", "pricing", "customer-care", "finance", "content", "manager"] as const;

export const listAgentChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("telegram_agent_channels")
      .select("id, chat_id, agent_key, chat_type, label, message_thread_id, is_active, created_at")
      .order("agent_key");
    if (error) throw new Error(error.message);
    return { channels: data ?? [] };
  });

export const upsertAgentChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      chat_id:           z.string().min(1).max(40),
      agent_key:         z.enum(AGENT_KEYS),
      label:             z.string().max(120).optional(),
      message_thread_id: z.string().max(20).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const threadId = data.message_thread_id?.trim() || null;
    // Look up by (chat_id + thread_id) — composite unique key.
    const baseQuery = (supabaseAdmin as any)
      .from("telegram_agent_channels")
      .select("id")
      .eq("chat_id", data.chat_id);
    const { data: existing } = await (threadId
      ? baseQuery.eq("message_thread_id", threadId)
      : baseQuery.is("message_thread_id", null)
    ).maybeSingle();

    const payload = {
      chat_id:           data.chat_id,
      agent_key:         data.agent_key,
      label:             data.label ?? null,
      message_thread_id: threadId,
      is_active:         true,
    };
    const op = existing?.id
      ? (supabaseAdmin as any).from("telegram_agent_channels").update(payload).eq("id", existing.id)
      : (supabaseAdmin as any).from("telegram_agent_channels").insert(payload);
    const { error } = await op;
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteAgentChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("telegram_agent_channels")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const resetTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("telegram_bot_token")
      .limit(1)
      .maybeSingle();
    if (!prop?.telegram_bot_token) throw new Error("Bot token belum di-set.");
    const res = await deleteWebhook(prop.telegram_bot_token);
    if (!res.ok) throw new Error(res.error ?? "delete gagal");
    return { ok: true as const };
  });

// ─── List per-manager Telegram status ────────────────────────────────────────

export const listTelegramStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("telegram_bot_token, telegram_bot_username")
      .limit(1)
      .maybeSingle();
    const botUsername = (prop?.telegram_bot_username as string | null) ?? null;
    const botConfigured = !!prop?.telegram_bot_token;

    const { data: managers } = await (supabaseAdmin as any)
      .from("property_managers")
      .select("id, name, role, phone, telegram_chat_id, telegram_linked_at, telegram_link_token, telegram_token_expires_at, is_active")
      .order("name");

    return { botUsername, botConfigured, managers: managers ?? [] };
  });

// ─── Generate a one-time link token ──────────────────────────────────────────

export const generateTelegramLinkToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ managerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("telegram_bot_username")
      .limit(1)
      .maybeSingle();
    const username = (prop?.telegram_bot_username as string | null) ?? null;
    if (!username) {
      throw new Error("telegram_bot_username belum di-set di Properties. Isi via setupTelegramWebhook atau manual.");
    }

    const token = randomHex(16);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await (supabaseAdmin as any)
      .from("property_managers")
      .update({
        telegram_link_token: token,
        telegram_token_expires_at: expiresAt,
      })
      .eq("id", data.managerId);
    if (error) throw new Error(error.message);

    return {
      ok: true as const,
      token,
      deep_link: `https://t.me/${username}?start=${token}`,
      expires_at: expiresAt,
    };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ managerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("property_managers")
      .update({
        telegram_chat_id: null,
        telegram_linked_at: null,
        telegram_link_token: null,
        telegram_token_expires_at: null,
      })
      .eq("id", data.managerId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ─── One-shot webhook setup ──────────────────────────────────────────────────

export const setupTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const { data: prop } = await (supabaseAdmin as any)
      .from("properties")
      .select("id, telegram_bot_token")
      .limit(1)
      .maybeSingle();
    const token = prop?.telegram_bot_token as string | null;
    if (!token) throw new Error("telegram_bot_token belum di-set di Properties.");

    // Resolve bot username for the deep-link feature.
    const me = await getMe(token);
    const username = me.ok && me.result ? me.result.username : null;

    const secret = randomHex(24);
    const url = `${data.origin.replace(/\/+$/, "")}/api/telegram`;
    const res = await setWebhook(token, url, secret);
    if (!res.ok) throw new Error(`setWebhook gagal: ${res.error}`);

    await (supabaseAdmin as any)
      .from("properties")
      .update({
        telegram_webhook_secret: secret,
        telegram_bot_username:   username,
      })
      .eq("id", prop!.id);

    return { ok: true as const, webhook_url: url, bot_username: username };
  });
