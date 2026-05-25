/**
 * Tool layer types.
 *
 * A "tool" is a function the LLM can call during orchestration.
 * Each tool receives a `ToolContext` (Supabase clients, pre-fetched data)
 * and raw JSON arguments from the LLM, and returns a JSON string result.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomTypeRow, PropertyRow } from "@/ai/context-builder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

/** Runtime context injected into every tool handler. */
export interface ToolContext {
  /** Supabase client with anon key — for read-only RPC calls */
  supabasePublic: AnyClient;
  /** Supabase client with service-role key — for inserts (guests, bookings) */
  supabaseAdmin:  AnyClient;
  /** Room types, already fetched to avoid redundant queries */
  rooms:          RoomTypeRow[];
  /** Property data (name, payment details, etc.) */
  property:       PropertyRow & Record<string, unknown>;
  /** Today's date in YYYY-MM-DD (UTC+7) */
  today:          string;
  /** App base URL (e.g. https://pomahguesthouse.com) */
  origin?:        string;
  /**
   * Stable per-inbound-message key (phone + message id). Used by write tools
   * (create_booking) to stay idempotent across webhook retries of the same
   * message, preventing duplicate bookings.
   */
  idempotencyKey?: string;
}

/** A tool handler: receives raw args (from LLM JSON), returns JSON string. */
export type ToolHandler = (
  args:    Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;
