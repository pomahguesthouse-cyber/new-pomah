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
import { getMe, setWebhook } from "@/services/telegram.service";

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  (globalThis.crypto ?? require("crypto").webcrypto).getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
