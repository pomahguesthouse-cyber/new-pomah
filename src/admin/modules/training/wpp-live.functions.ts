import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";
const TIMEOUT_MS = 18_000;

function first(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function rows(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["response", "data", "result", "chats", "messages", "items"]) {
      const v = (value as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function normalizePhone(raw: unknown) {
  const value = first(raw);
  if (!value) return null;
  let p = value.replace(/@(?:c|s)\.whatsapp\.net$/i, "").replace(/@c\.us$/i, "").replace(/@lid(?:\b.*)?$/i, "").replace(/@.*$/i, "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!p) return null;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

function isPublicPhone(phone: string | null) { return !!phone && /^62\d{8,14}$/.test(phone); }
function isLid(raw: unknown) { const value = first(raw); return !!value && /@lid(?:\b|[_@.-]|$)/i.test(value); }
function bearer(token: string) { return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`; }
function endpoint(path: string) { return `${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/${path.replace(/^\/+/, "")}`; }

async function getToken() {
  const { data } = await supabaseAdmin.from("properties").select("wpp_token").limit(1).maybeSingle();
  return ((data as { wpp_token?: string } | null)?.wpp_token || "").trim();
}

async function wpp(path: string, token: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(path), {
      method: init?.method ?? "GET",
      headers: { Authorization: bearer(token), Accept: "application/json", "Content-Type": "application/json" },
      body: init?.body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(text).slice(0, 220)}`);
    if (data && typeof data === "object" && String((data as Record<string, unknown>).status ?? "").toLowerCase() === "error") {
      throw new Error(String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).response ?? "WPPConnect error"));
    }
    return data;
  } finally { clearTimeout(timer); }
}

function chatIdOf(chat: any) { return first(chat.chatId, chat.chat_id, chat.remoteJid, chat.remote_jid, chat.jid, pick(chat, "id._serialized"), pick(chat, "id.user"), chat.id, pick(chat, "contact.id._serialized"), pick(chat, "contact.id.user"), chat.phone, chat.number); }
function nameOf(chat: any) { return first(chat.name, chat.formattedName, chat.formattedTitle, chat.pushname, chat.notifyName, chat.shortName, pick(chat, "contact.name"), pick(chat, "contact.pushname"), chat.phone, chat.number); }
function previewOf(chat: any) { const last = chat.lastMessage ?? chat.last_message ?? chat.lastMsg ?? (Array.isArray(chat.msgs) ? chat.msgs[chat.msgs.length - 1] : null); return first(chat.last_message_preview, chat.lastMessagePreview, chat.preview, last?.body, last?.caption, last?.text, last?.message); }
function timeOf(value: any) {
  const last = value?.lastMessage ?? value?.last_message ?? value?.lastMsg ?? (Array.isArray(value?.msgs) ? value.msgs[value.msgs.length - 1] : null);
  const raw = value?.t ?? value?.timestamp ?? value?.lastMessageAt ?? value?.last_message_at ?? value?.createdAt ?? value?.sent_at ?? last?.t ?? last?.timestamp ?? last?.createdAt;
  if (typeof raw === "number") return new Date((raw > 10000000000 ? raw : raw * 1000)).toISOString();
  if (typeof raw === "string" && raw.trim()) { if (/^\d+$/.test(raw.trim())) return timeOf({ t: Number(raw) }); const d = new Date(raw); if (!Number.isNaN(d.getTime())) return d.toISOString(); }
  return new Date().toISOString();
}
function identityCandidates(chat: any): string[] {
  const values = [chat.phone, chat.number, chat.formattedNumber, chat.formattedPhone, chat.waNumber, chat.user, chat.userid, chat.chatId, chat.chat_id, chat.remoteJid, chat.remote_jid, chat.jid, chat.id, chat.contact, pick(chat, "contact.phone"), pick(chat, "contact.number"), pick(chat, "contact.id._serialized"), pick(chat, "contact.id.user")];
  return Array.from(new Set(values.map((v) => first(v)).filter((v): v is string => !!v)));
}
async function resolveCanonical(...identities: unknown[]) {
  for (const identity of identities) { const phone = normalizePhone(identity); if (isPublicPhone(phone) && !isLid(identity)) return phone; }
  for (const identity of identities) { const raw = first(identity); if (!raw) continue; try { const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: raw }); const phone = normalizePhone(data); if (isPublicPhone(phone)) return phone; } catch {} }
  return null;
}
async function fetchChats(token: string, limit: number) {
  const errors: string[] = [];
  for (const path of ["all-chats", "list-chats", "chats", "get-all-chats"]) { try { return { chats: rows(await wpp(path, token)).slice(0, limit), usedPath: path }; } catch (e) { errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`); } }
  throw new Error(errors.join(" | "));
}
function messageIdOf(message: any, fallback: string) { return first(pick(message, "id._serialized"), pick(message, "id.id"), message._serialized, message.messageId, message.keyId, message.id, fallback)!; }
function bodyOf(message: any) { return first(message.body, message.caption, message.content, message.text, message.message) || `[Lampiran ${first(message.type, message.kind, message.mediaType) || "media"}]`; }
async function fetchMessages(token: string, chatId: string, limit: number) {
  const digits = normalizePhone(chatId);
  const ids = Array.from(new Set([chatId, digits, digits && isPublicPhone(digits) ? `${digits}@c.us` : null].filter(Boolean) as string[]));
  const tries: Array<() => Promise<unknown>> = [];
  for (const id of ids) { tries.push(() => wpp(`all-messages-in-chat/${encodeURIComponent(id)}`, token)); tries.push(() => wpp(`get-messages/${encodeURIComponent(id)}`, token)); }
  tries.push(() => wpp("all-messages-in-chat", token, { method: "POST", body: JSON.stringify({ phone: digits || chatId, chatId, isGroup: false, includeMe: true, limit }) }));
  tries.push(() => wpp("get-messages", token, { method: "POST", body: JSON.stringify({ phone: digits || chatId, chatId, limit }) }));
  const errors: string[] = [];
  for (const fn of tries) { try { return rows(await fn()).slice(-limit); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } }
  throw new Error(errors.join(" | "));
}

export const listWppLiveChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!WPP_BASE_URL || !WPP_SESSION) throw new Error("WPPConnect belum dikonfigurasi: set WPP_BASE_URL dan WPP_SESSION.");
    const token = await getToken();
    if (!token) throw new Error("properties.wpp_token kosong.");
    const { chats, usedPath } = await fetchChats(token, data.limit);
    const mapped = await Promise.all(chats.map(async (chat: any, idx: number) => {
      const externalChatId = chatIdOf(chat) || `unknown-${idx}`;
      const canonicalPhone = await resolveCanonical(externalChatId, ...identityCandidates(chat));
      const rawDigits = normalizePhone(externalChatId);
      const phone = canonicalPhone || rawDigits || externalChatId;
      return { id: `live:${encodeURIComponent(String(externalChatId))}`, phone, display_name: nameOf(chat), status: "open", unread_count: Number(chat.unreadCount ?? chat.unread_count ?? 0), ai_auto: true, last_message_preview: previewOf(chat)?.slice(0, 120) ?? null, last_message_at: timeOf(chat), chat_summary: null, chat_summary_json: null, canonical_phone: canonicalPhone, external_chat_id: String(externalChatId), lid_alias: isLid(externalChatId) ? normalizePhone(externalChatId) : null, identity_type: canonicalPhone ? "phone" : isLid(externalChatId) ? "lid" : "jid", sync_error: canonicalPhone ? null : "Live dari WPPConnect: nomor publik belum terpetakan", last_synced_at: new Date().toISOString(), source: "wppconnect_live", used_path: usedPath };
    }));
    return { rows: mapped, usedPath };
  });

export const listWppLiveMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ chatId: z.string().trim().min(1), limit: z.number().int().min(1).max(300).default(120) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!WPP_BASE_URL || !WPP_SESSION) throw new Error("WPPConnect belum dikonfigurasi: set WPP_BASE_URL dan WPP_SESSION.");
    const token = await getToken();
    if (!token) throw new Error("properties.wpp_token kosong.");
    const decodedChatId = decodeURIComponent(data.chatId.replace(/^live:/, ""));
    const messages = await fetchMessages(token, decodedChatId, data.limit);
    const mapped = messages.map((m: any, idx: number) => {
      const external = messageIdOf(m, `${decodedChatId}-${idx}`);
      const direction = m.fromMe === true || m.from_me === true || m.isFromMe === true ? "out" : "in";
      return { id: `live:${encodeURIComponent(String(external))}`, thread_id: `live:${encodeURIComponent(decodedChatId)}`, direction, body: bodyOf(m), sent_at: timeOf(m), metadata: { source: "wppconnect_live", external_message_id: external, external_chat_id: decodedChatId, raw_type: first(m.type, m.kind, m.mediaType) ?? null } };
    });
    return { rows: mapped, chatId: decodedChatId };
  });
