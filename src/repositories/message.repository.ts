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
 * The RPC returns TABLE(message_id, is_duplicate) so callers can skip
 * re-enqueueing/re-notifying on a detected duplicate (see
 * 20260721080000_atomic_inbound_message_dedup.sql). Parsed defensively:
 * `data` is an array of rows for the table-returning function, but stays a
 * plain uuid string if this runs against a DB where that migration hasn't
 * been applied yet (code can deploy ahead of a manually-run SQL migration).
 */
function parseReceiveResult(data: unknown): { messageId: string | null; isDuplicate: boolean } {
  const row = Array.isArray(data) ? data[0] : data;
  if (row && typeof row === "object" && "message_id" in (row as object)) {
    const r = row as { message_id?: string | null; is_duplicate?: boolean };
    return { messageId: r.message_id ?? null, isDuplicate: !!r.is_duplicate };
  }
  return { messageId: (row as string | null) ?? null, isDuplicate: false };
}

/**
 * Persists an incoming WhatsApp message via the `receive_whatsapp_message`
 * RPC, which upserts the thread and inserts the message atomically —
 * including dedup (by wpp_id, or by recent identical body when no wpp_id is
 * available) under a transaction-scoped advisory lock keyed on the phone.
 * This closes the double-reply race that used to exist when the dedup check
 * and the insert were two separate round-trips from application code (see
 * 20260721080000_atomic_inbound_message_dedup.sql for the incident history).
 *
 * Returns the message UUID (new or pre-existing duplicate).
 */
export async function saveInboundMessage(
  client: AnyClient,
  params: { phone: string; name: string; body: string; wppId?: string | null; externalChatId?: string | null },
): Promise<SaveInboundResult> {
  const rpcParams = {
    p_phone: params.phone,
    p_name:  params.name,
    p_body:  params.body,
  };
  const externalChatId = params.externalChatId?.trim() || null;
  const withWppId =
    params.wppId && params.wppId.trim()
      ? { ...rpcParams, p_wpp_id: params.wppId.trim() }
      : null;
  const withExternalChatId =
    externalChatId
      ? { ...(withWppId ?? { ...rpcParams, p_wpp_id: null }), p_external_chat_id: externalChatId }
      : null;

  const { data, error } = withExternalChatId
    ? await (client as any).rpc("receive_whatsapp_message", withExternalChatId)
    : withWppId
      ? await (client as any).rpc("receive_whatsapp_message", withWppId)
      : await (client as any).rpc("receive_whatsapp_message", rpcParams);

  if (error && (withExternalChatId || withWppId) && ((error as any).code === "PGRST202" || String((error as any).message).includes("function"))) {
    console.warn("[MessageRepo] receive RPC variant unavailable, falling back:", (error as any).message);
    const fallbackParams = withExternalChatId && withWppId ? withWppId : rpcParams;
    const fallback = await (client as any).rpc("receive_whatsapp_message", fallbackParams);
    if (!fallback.error) {
      const { messageId, isDuplicate } = parseReceiveResult(fallback.data);
      return { messageId, duplicate: isDuplicate, error: null };
    }
    if (fallbackParams !== rpcParams && ((fallback.error as any).code === "PGRST202" || String((fallback.error as any).message).includes("function"))) {
      const legacy = await (client as any).rpc("receive_whatsapp_message", rpcParams);
      if (!legacy.error) {
        const { messageId, isDuplicate } = parseReceiveResult(legacy.data);
        return { messageId, duplicate: isDuplicate, error: null };
      }
      void reportRpcFailure(client, "receive_whatsapp_message", legacy.error, {
        phone: params.phone,
        wppId: params.wppId ?? null,
        externalChatId,
      });
      return {
        messageId: null,
        error:     new Error(`receive_whatsapp_message: ${(legacy.error as any).message}`),
      };
    }
    void reportRpcFailure(client, "receive_whatsapp_message", fallback.error, {
      phone: params.phone,
      wppId: params.wppId ?? null,
      externalChatId,
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

  const { messageId, isDuplicate } = parseReceiveResult(data);
  return { messageId, duplicate: isDuplicate, error: null };
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
