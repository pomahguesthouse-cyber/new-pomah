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
  /** The WhatsApp number the guest is chatting from (raw, e.g. "628123..."). */
  phone?:         string;
  /**
   * Stable per-inbound-message key (phone + message id). Used by write tools
   * (create_booking) to stay idempotent across webhook retries of the same
   * message, preventing duplicate bookings.
   */
  idempotencyKey?: string;
  /**
   * Pre-computed OCR/match result for a payment proof attached to the current
   * turn. Used by the simulator to bypass DB writes; the production webhook
   * stores the same shape in whatsapp_messages.metadata.ocr_result so the
   * `get_payment_proof_result` tool can fall back to a DB read when this
   * field is absent.
   */
  recentOcrResult?: {
    ocr:   Record<string, unknown>;
    match: Record<string, unknown>;
  };
  /**
   * Raw image URL/data URL of the payment-proof attached this turn. Used by
   * `cc_payment_proof_to_admin` so it can include the image in the super-admin
   * notification without re-querying the DB (sim has no message row).
   */
  recentPaymentProofImageUrl?: string;
  /**
   * True when running inside the AI Lab simulator. Lets tools with real-world
   * side effects (sending WA messages to admins, etc.) safely no-op so admins
   * can exercise the agent flow without spamming production recipients.
   */
  isSimulator?: boolean;
  /**
   * Mutable scratchpad — tools (mis. `check_room_availability`, `start_booking_details`)
   * mengisi tanggal menginap yang terakhir mereka pakai/sepakati. Orchestrator
   * memersistkan ini ke slots agar turn berikutnya tetap memakai tanggal
   * yang sama meski tamu tidak mengulang menyebut.
   */
  lastDates?: { checkIn: string; checkOut: string };
}

/** A tool handler: receives raw args (from LLM JSON), returns JSON string. */
export type ToolHandler = (
  args:    Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;
