import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Sumber data live untuk halaman koreksi WhatsApp.
 * Membaca mirror Supabase (whatsapp_threads / whatsapp_messages) — tanpa
 * memanggil gateway secara langsung.
 */

function first(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalizePhone(raw: unknown) {
  const value = first(raw);
  if (!value) return null;
  let p = value
    .replace(/@(?:c|s)\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (!p) return null;
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

function isPublicPhone(phone: string | null) { return !!phone && /^62\d{8,14}$/.test(phone); }
function isLid(raw: unknown) { const value = first(raw); return !!value && /@lid(?:\b|[_@.-]|$)/i.test(value); }

async function resolveCanonical(...identities: unknown[]) {
  for (const identity of identities) {
    const phone = normalizePhone(identity);
    if (isPublicPhone(phone) && !isLid(identity)) return phone;
  }
  for (const identity of identities) {
    const raw = first(identity);
    if (!raw) continue;
    try {
      const { data } = await (supabaseAdmin as any).rpc("resolve_wa_canonical_phone", { p_identity: raw });
      const phone = normalizePhone(data);
      if (isPublicPhone(phone)) return phone;
    } catch {}
  }
  return null;
}

async function mirrorChats(limit: number) {
  const { data, error } = await (supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, phone, display_name, status, unread_count, ai_auto, last_message_preview, last_message_at, chat_summary, chat_summary_json, canonical_phone, external_chat_id, lid_alias, identity_type, sync_error, last_synced_at")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return Promise.all(((data ?? []) as any[]).map(async (t) => {
    const canonicalPhone = await resolveCanonical(t.canonical_phone, t.phone, t.external_chat_id, t.lid_alias);
    return {
      id: String(t.id),
      phone: canonicalPhone || t.canonical_phone || t.phone,
      display_name: t.display_name ?? null,
      status: t.status ?? "open",
      unread_count: t.unread_count ?? 0,
      ai_auto: t.ai_auto ?? true,
      last_message_preview: t.last_message_preview ?? null,
      last_message_at: t.last_message_at ?? null,
      chat_summary: t.chat_summary ?? null,
      chat_summary_json: t.chat_summary_json ?? null,
      canonical_phone: canonicalPhone || t.canonical_phone || null,
      external_chat_id: t.external_chat_id ?? t.phone,
      lid_alias: t.lid_alias ?? null,
      identity_type: canonicalPhone ? "phone" : t.identity_type ?? null,
      sync_error: t.sync_error ?? null,
      last_synced_at: t.last_synced_at ?? null,
      source: "supabase_mirror",
      used_path: "supabase_mirror",
    };
  }));
}

async function mirrorMessages(chatId: string, limit: number) {
  const normalized = normalizePhone(chatId);
  const canonical = await resolveCanonical(chatId, normalized);
  const candidates = Array.from(new Set([chatId, normalized, canonical].filter(Boolean) as string[]));
  const normalizedCandidates = candidates.map((c) => normalizePhone(c)).filter(Boolean) as string[];
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chatId);

  let thread: { id: string } | null = null;
  if (isUuid) {
    const direct = await (supabaseAdmin as any).from("whatsapp_threads").select("id").eq("id", chatId).maybeSingle();
    thread = direct.data ?? null;
  }

  if (!thread) {
    const { data } = await (supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id")
      .or([
        ...candidates.map((c) => `phone.eq.${c}`),
        ...candidates.map((c) => `canonical_phone.eq.${c}`),
        ...candidates.map((c) => `external_chat_id.eq.${c}`),
        ...candidates.map((c) => `lid_alias.eq.${c}`),
        ...normalizedCandidates.map((c) => `phone.eq.${c}`),
        ...normalizedCandidates.map((c) => `canonical_phone.eq.${c}`),
        ...normalizedCandidates.map((c) => `lid_alias.eq.${c}`),
      ].join(","))
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    thread = data ?? null;
  }

  if (!thread?.id) return [];
  const { data: messages } = await (supabaseAdmin as any)
    .from("whatsapp_messages")
    .select("id, thread_id, direction, body, sent_at, metadata")
    .eq("thread_id", thread.id)
    .order("sent_at", { ascending: false })
    .limit(limit);
  return ((messages ?? []) as any[])
    .reverse()
    .map((m) => ({
      id: String(m.id),
      thread_id: String(m.thread_id),
      direction: m.direction,
      body: m.body,
      sent_at: m.sent_at,
      metadata: { ...(m.metadata ?? {}), source: "supabase_mirror", external_chat_id: chatId },
    }));
}

export const listWaLiveChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const rows = await mirrorChats(data.limit);
    return { rows, usedPath: "supabase_mirror", source: "supabase_mirror" };
  });

export const listWaLiveMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ chatId: z.string().trim().min(1), limit: z.number().int().min(1).max(300).default(120) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const decodedChatId = decodeURIComponent(data.chatId.replace(/^live:/, ""));
    const rows = await mirrorMessages(decodedChatId, data.limit);
    if (rows.length === 0) {
      return { rows, chatId: decodedChatId, source: "supabase_mirror", warning: "Percakapan belum ada di mirror Supabase." };
    }
    return { rows, chatId: decodedChatId, source: "supabase_mirror" };
  });
