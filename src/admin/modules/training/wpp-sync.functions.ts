import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";
const SYNC_TIMEOUT_MS = 18000;

function bearer(token: string): string {
  const t = String(token ?? "").trim();
  return /^bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

function endpoint(path: string): string {
  return `${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/${path.replace(/^\/+/, "")}`;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["response", "data", "result", "messages", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as any[];
    }
  }
  return [];
}

function pick(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function normalizePhone(raw: unknown): string | null {
  const value = firstString(raw);
  if (!value) return null;
  let p = value
    .replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "")
    .replace(/[^\d]/g, "");
  if (!p) return null;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

function looksPublic(phone: string | null): boolean {
  return !!phone && /^62\d{8,14}$/.test(phone);
}

function parseTimestamp(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return new Date((raw > 10000000000 ? raw : raw * 1000)).toISOString();
  if (typeof raw === "string" && raw.trim()) {
    if (/^\d+$/.test(raw.trim())) return parseTimestamp(Number(raw.trim()));
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function messageIdOf(m: any): string | null {
  return firstString(pick(m, "id._serialized"), pick(m, "id.id"), m._serialized, m.messageId, m.keyId, m.id);
}

function bodyOf(m: any): string {
  return firstString(m.body, m.caption, m.content, m.text, m.message) || `[Lampiran ${firstString(m.type, m.kind, m.mediaType) || "media"}]`;
}

function directionOf(m: any): "in" | "out" {
  return m.fromMe === true || m.from_me === true || m.isFromMe === true ? "out" : "in";
}

async function getWppToken(): Promise<string | null> {
  const { data } = await supabaseAdmin.from("properties").select("wpp_token").limit(1).maybeSingle();
  return ((data as { wpp_token?: string } | null)?.wpp_token || "").trim() || null;
}

async function callWpp(path: string, token: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(path), {
      method: init?.method ?? "GET",
      headers: { Authorization: bearer(token), Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: init?.body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof json === "string" ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
    if (json && typeof json === "object" && String(json.status ?? "").toLowerCase() === "error") throw new Error(json.message || json.response || "WPPConnect error");
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function callFirst(paths: Array<{ path: string; method?: "GET" | "POST"; body?: Record<string, unknown> }>, token: string) {
  const errors: string[] = [];
  for (const p of paths) {
    try {
      const data = await callWpp(p.path, token, p.method === "POST" ? { method: "POST", body: JSON.stringify(p.body ?? {}) } : undefined);
      return { data, usedPath: `${p.method ?? "GET"} ${p.path}` };
    } catch (e) {
      errors.push(`${p.method ?? "GET"} ${p.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function resolveCanonical(identity: string | null): Promise<string | null> {
  if (!identity) return null;
  const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: identity });
  return normalizePhone(data) ?? normalizePhone(identity);
}

async function fetchThreadMessages(token: string, phone: string, limit: number) {
  const chat = `${phone}@c.us`;
  const { data, usedPath } = await callFirst([
    { path: `all-messages-in-chat/${encodeURIComponent(phone)}` },
    { path: `all-messages-in-chat/${encodeURIComponent(chat)}` },
    { path: "all-messages-in-chat", method: "POST", body: { phone, chatId: chat, isGroup: false, includeMe: true, includeNotifications: false, limit } },
    { path: `get-messages/${encodeURIComponent(phone)}` },
    { path: `get-messages/${encodeURIComponent(chat)}` },
    { path: "get-messages", method: "POST", body: { phone, chatId: chat, limit } },
  ], token);
  return { messages: asArray(data).slice(-limit), usedPath };
}

async function upsertMessage(threadId: string, msg: any, externalChatId: string | null) {
  const externalId = messageIdOf(msg);
  const body = bodyOf(msg).trim();
  if (!body) return "skipped" as const;
  const sentAt = parseTimestamp(msg.t ?? msg.timestamp ?? msg.datetime ?? msg.time ?? msg.createdAt ?? msg.sent_at);
  const direction = directionOf(msg);
  const patch: Record<string, unknown> = {
    thread_id: threadId,
    direction,
    body,
    wpp_id: externalId,
    external_message_id: externalId,
    external_chat_id: externalChatId,
    from_me: direction === "out",
    sent_at: sentAt,
    source: "wppconnect_sync",
    synced_at: new Date().toISOString(),
    sync_status: "synced",
    metadata: { source: "wppconnect_sync", external_message_id: externalId, external_chat_id: externalChatId, from_me: direction === "out" },
  };

  if (externalId) {
    const { data: existing } = await (supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("id")
      .or(`external_message_id.eq.${externalId},wpp_id.eq.${externalId}`)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await (supabaseAdmin as any).from("whatsapp_messages").update(patch).eq("id", existing.id);
      if (error) throw error;
      return "updated" as const;
    }
  }

  const { error } = await (supabaseAdmin as any).from("whatsapp_messages").insert(patch);
  if (error) throw error;
  return "inserted" as const;
}

export const syncWhatsappThreadFromWppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(80) }).parse(d))
  .handler(async ({ data }) => {
    if (!WPP_BASE_URL || !WPP_SESSION) throw new Error("WPPConnect belum dikonfigurasi: set WPP_BASE_URL dan WPP_SESSION.");
    const token = await getWppToken();
    if (!token) throw new Error("properties.wpp_token kosong.");

    const { data: thread, error: threadErr } = await (supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id, phone, display_name, external_chat_id")
      .eq("id", data.threadId)
      .maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) throw new Error("Percakapan tidak ditemukan.");

    const canonical = await resolveCanonical(thread.phone);
    if (!canonical || !looksPublic(canonical)) throw new Error(`Nomor belum valid untuk sync: ${thread.phone}`);
    const externalChatId = thread.external_chat_id || `${canonical}@c.us`;
    const { messages, usedPath } = await fetchThreadMessages(token, canonical, data.limit);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    for (const msg of messages) {
      const result = await upsertMessage(thread.id, msg, externalChatId);
      if (result === "inserted") imported++;
      else if (result === "updated") updated++;
      else skipped++;
    }

    const last = messages[messages.length - 1];
    const lastBody = last ? bodyOf(last) : null;
    const lastAt = last ? parseTimestamp(last.t ?? last.timestamp ?? last.datetime ?? last.time ?? last.createdAt ?? last.sent_at) : new Date().toISOString();
    await (supabaseAdmin as any).from("whatsapp_threads").update({
      phone: canonical,
      canonical_phone: canonical,
      external_chat_id: externalChatId,
      last_message_preview: lastBody ? lastBody.slice(0, 120) : thread.last_message_preview,
      last_message_at: lastAt,
      last_synced_at: new Date().toISOString(),
      sync_status: "synced",
      sync_error: null,
    }).eq("id", thread.id);

    await (supabaseAdmin as any).from("wa_wpp_sync_state").insert({
      sync_type: "thread",
      thread_id: thread.id,
      phone: canonical,
      external_chat_id: externalChatId,
      status: "success",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      imported_count: imported,
      updated_count: updated,
      skipped_count: skipped,
      metadata: { usedPath, message_count: messages.length },
    });

    return { ok: true, threadId: thread.id, phone: canonical, imported, updated, skipped, total: messages.length, usedPath };
  });

export const listWppSyncRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("wa_wpp_sync_state")
      .select("id, sync_type, thread_id, phone, external_chat_id, status, last_synced_at, imported_count, updated_count, skipped_count, error_message, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: rows ?? [] };
  });
