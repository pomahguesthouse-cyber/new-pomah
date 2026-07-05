import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";
const TIMEOUT_MS = 18000;

type AliasType = "phone" | "jid" | "lid" | "unknown";

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
  let p = value.replace(/@(?:c|s)\.whatsapp\.net$/i, "").replace(/@c\.us$/i, "").replace(/@lid(?:\b.*)?$/i, "").replace(/@.*$/i, "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!p) return null;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

function isPublicPhone(phone: string | null) {
  return !!phone && /^62\d{8,14}$/.test(phone);
}

function isLidIdentity(raw: unknown) {
  const value = first(raw);
  return !!value && /@lid(?:\b|[_@.-]|$)/i.test(value);
}

function isJidIdentity(raw: unknown) {
  const value = first(raw);
  return !!value && /@(c|s)\.whatsapp\.net$|@c\.us$/i.test(value);
}

function addCandidate(target: string[], value: unknown) {
  const direct = first(value);
  if (direct) target.push(direct);

  if (value && typeof value === "object") {
    for (const path of ["_serialized", "serialized", "user", "id", "server"]) {
      const nested = first(pick(value, path));
      if (nested) target.push(nested);
    }
  }
}

function identityCandidates(chat: any): string[] {
  const out: string[] = [];
  for (const value of [
    chat.phone,
    chat.number,
    chat.formattedNumber,
    chat.formattedPhone,
    chat.waNumber,
    chat.user,
    chat.userid,
    chat.userId,
    chat.phoneNumber,
    chat.chatId,
    chat.chat_id,
    chat.remoteJid,
    chat.remote_jid,
    chat.remoteId,
    chat.remote_id,
    chat.remote,
    chat.wid,
    chat.lid,
    chat.jid,
    chat.id,
    chat.contact,
    chat.sender,
    chat.lastMessage?.from,
    chat.lastMessage?.to,
    chat.lastMessage?.author,
    chat.lastMessage?.sender,
    chat.last_message?.from,
    chat.last_message?.to,
    chat.last_message?.author,
    chat.last_message?.sender,
  ]) {
    addCandidate(out, value);
  }

  for (const path of [
    "id._serialized",
    "id.user",
    "id.id",
    "contact.id._serialized",
    "contact.id.user",
    "contact.id.id",
    "contact.phone",
    "contact.number",
    "contact.phoneNumber",
    "contact.userId",
    "contact.formattedNumber",
    "contact.formattedPhone",
    "contact.waNumber",
    "contact.userid",
    "contact.user",
    "contact.wid",
    "contact.lid",
    "wid._serialized",
    "wid.user",
    "lid._serialized",
    "lid.user",
    "participant._serialized",
    "participant.user",
    "lastMessage.id.remote",
    "lastMessage.id._serialized",
    "lastMessage.from._serialized",
    "lastMessage.to._serialized",
    "last_message.id.remote",
    "last_message.id._serialized",
    "last_message.from._serialized",
    "last_message.to._serialized",
  ]) {
    addCandidate(out, pick(chat, path));
  }

  return Array.from(new Set(out.map((v) => String(v).trim()).filter(Boolean)));
}

function publicPhoneOf(chat: any) {
  for (const raw of identityCandidates(chat)) {
    if (isLidIdentity(raw)) continue;
    const phone = normalizePhone(raw);
    if (isPublicPhone(phone)) return phone;
  }
  return null;
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

function aliasTypeOf(raw: string): AliasType {
  const phone = normalizePhone(raw);
  if (isLidIdentity(raw)) return "lid";
  if (isJidIdentity(raw)) return "jid";
  if (isPublicPhone(phone)) return "phone";
  if (phone && /^\d{10,18}$/.test(phone)) return "lid";
  return "unknown";
}

function lidAliasesOf(chat: any) {
  return identityCandidates(chat)
    .filter((raw) => {
      const phone = normalizePhone(raw);
      return isLidIdentity(raw) || (!!phone && !isPublicPhone(phone) && /^\d{10,18}$/.test(phone));
    })
    .map((raw) => normalizePhone(raw) || raw);
}

async function getToken() {
  const { data } = await supabaseAdmin.from("properties").select("wpp_token").limit(1).maybeSingle();
  return ((data as { wpp_token?: string } | null)?.wpp_token || "").trim();
}

async function resolveCanonical(identity: string) {
  const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: identity });
  return normalizePhone(data) ?? normalizePhone(identity);
}

async function upsertAliases(canonicalPhone: string, aliases: string[], chat: any, rawId: string, externalChatId: string) {
  const uniqueAliases = Array.from(new Set(aliases.map((a) => normalizePhone(a) || a).filter(Boolean)));
  for (const alias of uniqueAliases) {
    if (!alias || alias === canonicalPhone) continue;
    await (supabaseAdmin as any).rpc("upsert_wa_identity_alias", {
      p_canonical_phone: canonicalPhone,
      p_alias_value: alias,
      p_alias_type: aliasTypeOf(alias),
      p_role: "guest",
      p_display_name: nameOf(chat) || null,
      p_source: "wppconnect_chat_list_sync",
      p_metadata: {
        raw_id: rawId,
        external_chat_id: externalChatId,
        note: "Alias LID/JID dipetakan dari daftar chat WPPConnect",
      },
    });
  }
}

async function mergeCanonicalThread(canonicalPhone: string | null) {
  if (!isPublicPhone(canonicalPhone)) return;
  try {
    await (supabaseAdmin as any).rpc("merge_wa_threads_to_canonical_phone", { p_canonical_phone: canonicalPhone });
  } catch (e) {
    console.warn("[wpp-chat-list-sync] merge canonical thread skipped:", e);
  }
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

  const resolvedFromAlias = await resolveCanonical(rawId);
  const publicPhone = publicPhoneOf(chat) || (isPublicPhone(resolvedFromAlias) ? resolvedFromAlias : null);
  const rawDigits = normalizePhone(rawId);
  const identityType: AliasType = publicPhone ? "phone" : aliasTypeOf(rawId);
  const externalChatId = String(rawId).includes("@")
    ? String(rawId)
    : identityType === "lid" && rawDigits
      ? `${rawDigits}@lid`
      : publicPhone
        ? `${publicPhone}@c.us`
        : `${rawDigits || rawId}@lid`;

  if (publicPhone) {
    await upsertAliases(publicPhone, [rawId, ...lidAliasesOf(chat), ...identityCandidates(chat)], chat, String(rawId), externalChatId);
  }

  const phone = publicPhone || rawDigits || String(rawId);
  const patch = {
    phone,
    display_name: nameOf(chat) || phone,
    external_chat_id: externalChatId,
    canonical_phone: publicPhone,
    identity_type: identityType,
    lid_alias: lidAliasesOf(chat)[0] ?? (identityType === "lid" ? rawDigits : null),
    last_message_preview: previewOf(chat)?.slice(0, 120) ?? null,
    last_message_at: timeOf(chat),
    last_synced_at: new Date().toISOString(),
    sync_status: "chat_list_synced",
    sync_error: publicPhone ? null : `Identity belum terpetakan ke nomor publik: ${rawId}`,
  };

  const { data: byExternal } = await (supabaseAdmin as any).from("whatsapp_threads").select("id").eq("external_chat_id", externalChatId).maybeSingle();
  const existing = byExternal?.id
    ? byExternal
    : (await (supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id")
      .or(publicPhone ? `phone.eq.${publicPhone},canonical_phone.eq.${publicPhone}` : `phone.eq.${phone}`)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()).data;

  if (existing?.id) {
    const { error } = await (supabaseAdmin as any).from("whatsapp_threads").update(patch).eq("id", existing.id);
    if (error) throw error;
    await mergeCanonicalThread(publicPhone);
    return "updated" as const;
  }
  const { error } = await (supabaseAdmin as any).from("whatsapp_threads").insert({ ...patch, unread_count: 0, status: "open" });
  if (error) throw error;
  await mergeCanonicalThread(publicPhone);
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
