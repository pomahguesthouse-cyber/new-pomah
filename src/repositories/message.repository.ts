/**
 * WhatsApp message repository.
 *
 * Thin data-access layer over the `whatsapp_messages` table and the
 * related RPCs.  All methods accept a Supabase client so callers control
 * which key (anon vs service-role) is used.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface SaveInboundResult {
  /** UUID of the newly created whatsapp_messages row */
  messageId: string | null;
  /** True when a durable Wpp ID already existed, so callers should not enqueue. */
  duplicate?: boolean;
  error:     Error   | null;
}

// ─── Inbound ──────────────────────────────────────────────────────────────────

/**
 * Persists an incoming WhatsApp message via the `receive_whatsapp_message`
 * RPC, which upserts the thread and inserts the message atomically.
 *
 * Returns the new message UUID.
 */
export async function saveInboundMessage(
  client: AnyClient,
  params: { phone: string; name: string; body: string; wppId?: string | null },
): Promise<SaveInboundResult> {
  const rpcParams = {
    p_phone: params.phone,
    p_name:  params.name,
    p_body:  params.body,
  };
  const withWppId =
    params.wppId && params.wppId.trim()
      ? { ...rpcParams, p_wpp_id: params.wppId.trim() }
      : null;

  if (withWppId) {
    const existing = await (client as any)
      .from("whatsapp_messages")
      .select("id")
      .eq("wpp_id", withWppId.p_wpp_id)
      .limit(1)
      .maybeSingle();

    if (!existing.error && existing.data?.id) {
      return { messageId: existing.data.id as string, duplicate: true, error: null };
    }
  } else {
    // Dedup durable TANPA wpp_id (webchat/simulator, atau provider yang
    // tidak mengirim ID): pesan identik dari nomor sama dalam 20 detik
    // dianggap duplikat. Insiden 4 Jul 2026: simulator menembak webhook 2×
    // berselisih 360ms → dedup in-memory kalah (isolate Worker berbeda) →
    // dua entry antrian → tamu menerima dua balasan AI untuk satu pesan.
    try {
      const { data: thread } = await (client as any)
        .from("whatsapp_threads")
        .select("id")
        .eq("phone", params.phone)
        .maybeSingle();
      if (thread?.id) {
        const cutoff = new Date(Date.now() - 20_000).toISOString();
        const { data: recent } = await (client as any)
          .from("whatsapp_messages")
          .select("id")
          .eq("thread_id", thread.id)
          .eq("direction", "in")
          .eq("body", params.body)
          .gte("created_at", cutoff)
          .limit(1)
          .maybeSingle();
        if (recent?.id) {
          return { messageId: recent.id as string, duplicate: true, error: null };
        }
      }
    } catch (e) {
      // Non-fatal — bila cek dedup gagal, lanjut simpan seperti biasa.
      console.warn("[MessageRepo] durable body-dedup check failed (continuing):", e);
    }
  }

  const { data, error } = withWppId
    ? await (client as any).rpc("receive_whatsapp_message", withWppId)
    : await (client as any).rpc("receive_whatsapp_message", rpcParams);

  if (error && withWppId && ((error as any).code === "PGRST202" || String((error as any).message).includes("function"))) {
    console.warn("[MessageRepo] 4-arg receive RPC unavailable, falling back to 3-arg:", (error as any).message);
    const fallback = await (client as any).rpc("receive_whatsapp_message", rpcParams);
    if (!fallback.error) {
      return { messageId: fallback.data as string | null, error: null };
    }
    void reportRpcFailure(client, "receive_whatsapp_message", fallback.error, {
      phone: params.phone,
      wppId: params.wppId ?? null,
    });
    return {
      messageId: null,
      error:     new Error(`receive_whatsapp_message: ${(fallback.error as any).message}`),
    };
  }

  if (error) {
    void reportRpcFailure(client, "receive_whatsapp_message", error, {
      phone: params.phone,
      wppId: params.wppId ?? null,
    });
    return {
      messageId: null,
      error:     new Error(`receive_whatsapp_message: ${(error as any).message}`),
    };
  }

  return { messageId: data as string | null, error: null };
}

/** Helper internal: laporkan kegagalan RPC ke super_admin tanpa memblokir. */
async function reportRpcFailure(
  client: AnyClient,
  rpcName: string,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const { notifyRpcFailure } = await import("@/services/manager-notifier.service");
    const message = (error as any)?.message ?? String(error);
    await notifyRpcFailure(client, { rpcName, errorMessage: message, context });
  } catch (_) {
    // notifikasi tidak boleh mengganggu alur utama
  }
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

/**
 * Persists an outgoing AI reply via `save_outbound_whatsapp` RPC.
 * Metadata (agent name, tools used) is stored as jsonb and surfaced in the
 * admin inbox.
 */
export async function saveOutboundMessage(
  client: AnyClient,
  params: {
    threadId: string;
    body:     string;
    metadata?: {
      agent?:      string;
      tools_used?: string[];
    };
  },
): Promise<string | null> {
  // Try 3-arg RPC first (returns the new message uuid)
  const rpcRes = await (client as any).rpc("save_outbound_whatsapp", {
    p_thread_id: params.threadId,
    p_body:      params.body,
    p_metadata:  params.metadata ?? null,
  });

  if (!rpcRes.error) {
    return (rpcRes.data as string) ?? null;
  }

  console.warn("[MessageRepo] 3-arg RPC failed, trying 2-arg...", rpcRes.error.message);

  // Try 2-arg RPC fallback (if DB hasn't been migrated)
  const fallback = await (client as any).rpc("save_outbound_whatsapp", {
    p_thread_id: params.threadId,
    p_body:      params.body,
  });

  if (!fallback.error) {
    return (fallback.data as string) ?? null;
  }

  console.warn("[MessageRepo] 2-arg RPC failed, trying direct insert...", fallback.error.message);
  void reportRpcFailure(client, "save_outbound_whatsapp", fallback.error, {
    threadId: params.threadId,
  });

  // Last resort: direct insert + update
  const insertRes = await (client as any)
    .from("whatsapp_messages")
    .insert({
      thread_id: params.threadId,
      direction: "out",
      body:      params.body,
      metadata:  params.metadata ?? null,
    })
    .select("id")
    .single();

  if (insertRes.error) {
    console.error("[MessageRepo] Direct insert failed:", insertRes.error);
    return null;
  }

  await (client as any)
    .from("whatsapp_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.threadId);

  return (insertRes.data as { id: string } | null)?.id ?? null;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

/**
 * Attaches a metadata blob (e.g. intent_label) to an existing message row.
 * Fire-and-forget safe — non-critical.
 */
export async function saveMessageMetadata(
  client: AnyClient,
  params: { messageId: string; metadata: Record<string, unknown> },
): Promise<void> {
  const { error } = await (client as any).rpc("save_message_metadata", {
    p_message_id: params.messageId,
    p_metadata:   params.metadata,
  });
  if (error) {
    console.error("[MessageRepo] saveMetadata error:", error);
    void reportRpcFailure(client, "save_message_metadata", error, {
      messageId: params.messageId,
    });
  }
}

// ─── Thread meta ──────────────────────────────────────────────────────────────

/**
 * Updates the thread's auto-reply analytics fields (agent used, tools invoked).
 */
export async function updateThreadAutoReplyMeta(
  client: AnyClient,
  params: { threadId: string; toolsUsed: string[] },
): Promise<void> {
  const { error } = await (client as any).rpc("update_thread_autoreply_meta", {
    p_thread_id:  params.threadId,
    p_tools_used: params.toolsUsed,
  });
  if (error) {
    console.error("[MessageRepo] updateThreadMeta error:", error);
    void reportRpcFailure(client, "update_thread_autoreply_meta", error, {
      threadId: params.threadId,
    });
  }
}
