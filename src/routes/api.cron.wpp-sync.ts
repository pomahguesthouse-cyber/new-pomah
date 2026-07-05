import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WPP_BASE_URL = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
const WPP_SESSION = process.env.WPP_SESSION ?? "";
const TIMEOUT_MS = 18000;

type SyncResult = { threadId: string; phone: string; imported: number; updated: number; skipped: number; total: number; error?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function getSecret(req: Request): string {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret") || auth.replace(/^Bearer\s+/i, "") || "";
}

function bearer(token: string) {
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function endpoint(path: string) {
  return `${WPP_BASE_URL}/api/${encodeURIComponent(WPP_SESSION)}/${path.replace(/^\/+/, "")}`;
}

function arr(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const k of ["response", "data", "result", "messages", "items"]) if (Array.isArray(value?.[k])) return value[k];
  return [];
}

function pick(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function first(...values: any[]) {
  for (const v of values) if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  return null;
}

function bodyOf(m: any) {
  return first(m.body, m.caption, m.content, m.text, m.message) || `[Lampiran ${first(m.type, m.kind, m.mediaType) || "media"}]`;
}

function messageId(m: any) {
  return first(pick(m, "id._serialized"), pick(m, "id.id"), m._serialized, m.messageId, m.keyId, m.id);
}

function ts(raw: any) {
  if (typeof raw === "number") return new Date((raw > 10000000000 ? raw : raw * 1000)).toISOString();
  if (typeof raw === "string" && raw.trim()) {
    if (/^\d+$/.test(raw.trim())) return ts(Number(raw));
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

async function wpp(path: string, token: string, init?: RequestInit) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(path), { method: init?.method ?? "GET", headers: { Authorization: bearer(token), Accept: "application/json", "Content-Type": "application/json" }, body: init?.body, signal: c.signal });
    const text = await res.text().catch(() => "");
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(text).slice(0, 200)}`);
    if (data && typeof data === "object" && String(data.status ?? "").toLowerCase() === "error") throw new Error(data.message || data.response || "WPPConnect error");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function wppMessages(phone: string, token: string, limit: number) {
  const chat = `${phone}@c.us`;
  const tries = [
    () => wpp(`all-messages-in-chat/${encodeURIComponent(phone)}`, token),
    () => wpp(`all-messages-in-chat/${encodeURIComponent(chat)}`, token),
    () => wpp("all-messages-in-chat", token, { method: "POST", body: JSON.stringify({ phone, chatId: chat, isGroup: false, includeMe: true, limit }) }),
    () => wpp(`get-messages/${encodeURIComponent(phone)}`, token),
    () => wpp(`get-messages/${encodeURIComponent(chat)}`, token),
    () => wpp("get-messages", token, { method: "POST", body: JSON.stringify({ phone, chatId: chat, limit }) }),
  ];
  const errors: string[] = [];
  for (const fn of tries) {
    try { return arr(await fn()).slice(-limit); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(errors.join(" | "));
}

async function getToken() {
  const { data } = await supabaseAdmin.from("properties").select("wpp_token").limit(1).maybeSingle();
  return ((data as { wpp_token?: string } | null)?.wpp_token || "").trim();
}

async function canonical(phone: string) {
  const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: phone });
  return String(data || phone).replace(/[^\d]/g, "");
}

async function syncThread(thread: any, token: string, limit: number): Promise<SyncResult> {
  const phone = await canonical(thread.phone);
  if (!/^62\d{8,14}$/.test(phone)) throw new Error(`Nomor tidak valid: ${thread.phone}`);
  const externalChatId = thread.external_chat_id || `${phone}@c.us`;
  const messages = await wppMessages(phone, token, limit);
  let imported = 0, updated = 0, skipped = 0;

  for (const m of messages) {
    const ext = messageId(m);
    const body = bodyOf(m).trim();
    if (!body) { skipped++; continue; }
    const direction = m.fromMe === true || m.from_me === true || m.isFromMe === true ? "out" : "in";
    const sentAt = ts(m.t ?? m.timestamp ?? m.datetime ?? m.time ?? m.createdAt ?? m.sent_at);
    const patch = { thread_id: thread.id, direction, body, wpp_id: ext, external_message_id: ext, external_chat_id: externalChatId, from_me: direction === "out", sent_at: sentAt, source: "wppconnect_sync", synced_at: new Date().toISOString(), sync_status: "synced", metadata: { source: "wppconnect_sync", external_message_id: ext, external_chat_id: externalChatId } };
    let existing: any = null;
    if (ext) {
      const { data } = await (supabaseAdmin as any).from("whatsapp_messages").select("id").or(`external_message_id.eq.${ext},wpp_id.eq.${ext}`).limit(1).maybeSingle();
      existing = data;
    }
    if (existing?.id) {
      const { error } = await (supabaseAdmin as any).from("whatsapp_messages").update(patch).eq("id", existing.id);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await (supabaseAdmin as any).from("whatsapp_messages").insert(patch);
      if (error) throw error;
      imported++;
    }
  }

  const last = messages[messages.length - 1];
  await (supabaseAdmin as any).from("whatsapp_threads").update({ phone, canonical_phone: phone, external_chat_id: externalChatId, last_message_preview: last ? bodyOf(last).slice(0, 120) : thread.last_message_preview, last_message_at: last ? ts(last.t ?? last.timestamp ?? last.datetime ?? last.time ?? last.createdAt ?? last.sent_at) : thread.last_message_at, last_synced_at: new Date().toISOString(), sync_status: "synced", sync_error: null }).eq("id", thread.id);
  return { threadId: thread.id, phone, imported, updated, skipped, total: messages.length };
}

async function run(req: Request) {
  const expected = process.env.WPP_SYNC_CRON_SECRET?.trim();
  if (!expected) return json({ ok: false, error: "Missing WPP_SYNC_CRON_SECRET" }, 500);
  if (getSecret(req) !== expected) return json({ ok: false, error: "Unauthorized" }, 401);
  if (!WPP_BASE_URL || !WPP_SESSION) return json({ ok: false, error: "Missing WPP_BASE_URL or WPP_SESSION" }, 500);

  const url = new URL(req.url);
  const limitThreads = Math.min(Number(url.searchParams.get("threads") || 10), 30);
  const limitMessages = Math.min(Number(url.searchParams.get("messages") || 80), 200);
  const token = await getToken();
  if (!token) return json({ ok: false, error: "properties.wpp_token kosong" }, 500);

  const { data: threads, error } = await (supabaseAdmin as any).from("whatsapp_threads").select("id, phone, external_chat_id, last_message_preview, last_message_at").order("last_message_at", { ascending: false, nullsFirst: false }).limit(limitThreads);
  if (error) return json({ ok: false, error: error.message }, 500);

  const started = new Date().toISOString();
  const results: SyncResult[] = [];
  for (const thread of threads ?? []) {
    try { results.push(await syncThread(thread, token, limitMessages)); }
    catch (e) { results.push({ threadId: thread.id, phone: thread.phone, imported: 0, updated: 0, skipped: 0, total: 0, error: e instanceof Error ? e.message : String(e) }); }
  }
  const okCount = results.filter((r) => !r.error).length;
  const imported = results.reduce((n, r) => n + r.imported, 0);
  const updated = results.reduce((n, r) => n + r.updated, 0);
  const skipped = results.reduce((n, r) => n + r.skipped, 0);

  await (supabaseAdmin as any).from("wa_wpp_sync_state").insert({ sync_type: "cron_recent_threads", status: okCount === results.length ? "success" : okCount ? "partial" : "failed", started_at: started, finished_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), imported_count: imported, updated_count: updated, skipped_count: skipped, metadata: { limitThreads, limitMessages, results } });
  return json({ ok: okCount > 0, checked: results.length, success: okCount, imported, updated, skipped, results });
}

export const Route = createFileRoute("/api/cron/wpp-sync")({ server: { handlers: { GET: run, POST: run } } });
