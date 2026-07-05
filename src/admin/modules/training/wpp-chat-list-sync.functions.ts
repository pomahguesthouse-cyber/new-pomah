import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";
const TIMEOUT_MS = 18000;

function first(...values: unknown[]) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pick(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function rows(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const key of ["response", "data", "result", "chats", "items"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function normalizePhone(raw: unknown) {
  const value = first(raw);
  if (!value) return null;
  let p = value.replace(/@.*$/i, "").replace(/[^\d]/g, "");
  if (!p) return null;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

function isPublicPhone(phone: string | null) {
  return !!phone && /^62\d{8,14}$/.test(phone);
}

function chatIdOf(chat: any) {
  return first(
    chat.chatId,
    chat.chat_id,
    chat.remoteJid,
    chat.remote_jid,
    chat.jid,
    pick(chat, "id._serialized"),
    pick(chat, "id.user"),
    chat.id,
    pick(chat, "contact.id._serialized"),
    pick(chat, "contact.id.user"),
    chat.phone,
    chat.number,
  );
}

function nameOf(chat: any) {
  return first(chat.name, chat.formattedName, chat.formattedTitle, chat.pushname, chat.notifyName, chat.shortName, pick(chat, "contact.name"), pick(chat, "contact.pushname"), chat.phone, chat.number);
}

function previewOf(chat: any) {
  const last = chat.lastMessage ?? chat.last_message ?? chat.lastMsg ?? (Array.isArray(chat.msgs) ? chat.msgs[chat.msgs.length - 1] : null);
  return first(chat.last_message_preview, chat.lastMessagePreview, chat.preview, last?.body, last?.caption, last?.text, last?.message);
}

function timeOf(chat: any) {
  const last = chat.lastMessage ?? chat.last_message ?? chat.lastMsg ?? (Array.isArray(chat.msgs) ? chat.msgs[chat.msgs.length - 1] : null);
  const raw = chat.t ?? chat.timestamp ?? chat.lastMessageAt ?? chat.last_message_at ?? last?.t ?? last?.timestamp ?? last?.createdAt;
  if (typeof raw === "number") return new Date((raw > 10000000000 ? raw : raw * 1000)).toISOString();
  if (typeof raw === "string" && raw.trim()) {
    if (/^\d+$/.test(raw.trim())) return timeOf({ t: Number(raw) });
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

async function getToken() {
  const { data } = await supabaseAdmin.from("properties").select("wpp_token").limit(1).maybeSingle();
  return ((data as { wpp_token?: string } | null)?.wpp_token || "").trim();
}

async function resolveCanonical(identity: string) {
  const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: identity });
  return normalizePhone(data) ?? normalizePhone(identity);
}

async function callWpp(path: string, token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/${path}`, {
      headers: { Authorization: /^bearer\s+/i.test(token) ? token : `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(text).slice(0, 180)}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchChats(token: string, limit: number) {
  const errors: string[] = [];
  for (const path of ["all-chats", "list-chats", "chats", "get-all-chats"]) {
    try {
      return { chats: rows(await callWpp(path, token)).slice(0, limit), usedPath: path };
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function upsertChat(chat: any) {
  const rawId = chatIdOf(chat);
  if (!rawId) return "skipped" as const;
  const canonical = await resolveCanonical(rawId);
  const publicPhone = isPublicPhone(canonical) ? canonical : null;
  const rawDigits = rawId.replace(/[^\d]/g, "");
  const externalChatId = rawId.includes("@") ? rawId : publicPhone ? `${publicPhone}@c.us` : `${rawDigits || rawId}@lid`;
  const phone = publicPhone || rawDigits || rawId;
  const patch = {
    phone,
    display_name: nameOf(chat) || phone,
    external_chat_id: externalChatId,
    canonical_phone: publicPhone,
    identity_type: publicPhone ? "phone" : rawId.includes("@lid") || /^\d{12,18}$/.test(rawDigits) ? "lid" : "jid",
    last_message_preview: previewOf(chat)?.slice(0, 120) ?? null,
    last_message_at: timeOf(chat),
    last_synced_at: new Date().toISOString(),
    sync_status: "chat_list_synced",
    sync_error: publicPhone ? null : `Identity belum terpetakan ke nomor publik: ${rawId}`,
  };

  const { data: byExternal } = await (supabaseAdmin as any).from("whatsapp_threads").select("id").eq("external_chat_id", externalChatId).maybeSingle();
  const existing = byExternal?.id ? byExternal : (await (supabaseAdmin as any).from("whatsapp_threads").select("id").eq("phone", phone).order("last_message_at", { ascending: false }).limit(1).maybeSingle()).data;
  if (existing?.id) {
    const { error } = await (supabaseAdmin as any).from("whatsapp_threads").update(patch).eq("id", existing.id);
    if (error) throw error;
    return "updated" as const;
  }
  const { error } = await (supabaseAdmin as any).from("whatsapp_threads").insert({ ...patch, unread_count: 0, status: "open" });
  if (error) throw error;
  return "inserted" as const;
}

export const syncWhatsappChatListFromWppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!WPP_BASE_URL || !WPP_SESSION) throw new Error("WPPConnect belum dikonfigurasi: set WPP_BASE_URL dan WPP_SESSION.");
    const token = await getToken();
    if (!token) throw new Error("properties.wpp_token kosong.");
    const startedAt = new Date().toISOString();
    const { chats, usedPath } = await fetchChats(token, data.limit);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const chat of chats) {
      try {
        const r = await upsertChat(chat);
        if (r === "inserted") inserted++;
        else if (r === "updated") updated++;
        else skipped++;
      } catch (e) {
        skipped++;
        errors.push(`${chatIdOf(chat) || "unknown"}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await (supabaseAdmin as any).from("wa_wpp_sync_state").insert({
      sync_type: "chat_list",
      status: errors.length ? (inserted || updated ? "partial" : "failed") : "success",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      imported_count: inserted,
      updated_count: updated,
      skipped_count: skipped,
      metadata: { usedPath, chat_count: chats.length, errors: errors.slice(0, 20) },
    });
    return { ok: true, total: chats.length, inserted, updated, skipped, usedPath, errors: errors.slice(0, 10) };
  });
