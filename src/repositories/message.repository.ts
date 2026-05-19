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
  params: { phone: string; name: string; body: string },
): Promise<SaveInboundResult> {
  const { data, error } = await (client as any).rpc("receive_whatsapp_message", {
    p_phone: params.phone,
    p_name:  params.name,
    p_body:  params.body,
  });

  if (error) {
    return {
      messageId: null,
      error:     new Error(`receive_whatsapp_message: ${(error as any).message}`),
    };
  }

  return { messageId: data as string | null, error: null };
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
): Promise<void> {
  const { error } = await (client as any).rpc("save_outbound_whatsapp", {
    p_thread_id: params.threadId,
    p_body:      params.body,
    p_metadata:  params.metadata ?? null,
  });
  if (error) {
    console.error("[MessageRepo] saveOutbound error:", error);
  }
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
  }
}
