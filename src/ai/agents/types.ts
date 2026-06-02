/**
 * Multi-agent system types.
 *
 * Each AgentDefinition is an autonomous unit with its own system prompt,
 * tool list, and responsibilities.  The multi-agent orchestrator loads the
 * correct agent, runs a dedicated LLM call for it, and never mixes agent
 * prompts together.
 */

import type { ToolDefinition, AiClientConfig } from "@/ai/types";
import type { PropertyRow, RoomTypeRow }        from "@/ai/context-builder";

// ─── Agent keys ───────────────────────────────────────────────────────────────

export type AgentKey =
  | "front-office"
  | "pricing"
  | "customer-care"
  | "finance"
  | "content"
  | "manager";

// ─── Intent categories ────────────────────────────────────────────────────────

export type IntentCategory =
  | "greeting"           // salam, halo, selamat pagi/siang/malam
  | "booking_inquiry"    // tanya kamar, cek ketersediaan, mau booking
  | "availability_check" // eksplisit: "ada kamar tidak", "kamar kosong?"
  | "pricing_inquiry"    // tanya harga, tarif, diskon, paket
  | "customer-care"       // minta handuk, bersih kamar, extra pillow
  | "maintenance"        // AC rusak, lampu mati, kran bocor
  | "payment"            // tanya cara bayar, transfer, invoice
  | "complaint"          // keluhan, kecewa, tidak puas
  | "general";           // pertanyaan umum, info hotel, lokasi

// ─── Context injected into every agent's prompt builder ──────────────────────

export interface AgentContext {
  property: PropertyRow & Record<string, unknown>;
  rooms:    RoomTypeRow[];
  sopText:  string;
  /** Brochure/image files stored in the Brosur tab — name + public URL */
  brosurFiles?: { name: string; url: string }[];
  today:    string;
  /** Summary of the previous chat session (idle > 5 min) */
  chatSummary?: string;
  /**
   * Tanggal menginap yang sudah disepakati di percakapan ini (dari slots).
   * Diinject ke system prompt agar LLM tidak meng-reset ke hari ini saat
   * tamu menulis pesan singkat tanpa menyebut ulang tanggal.
   */
  agreedDates?: { checkIn: string; checkOut: string };
  /** The WhatsApp number the guest is chatting from (raw, e.g. "628123..."). */
  chatPhone?: string;
  /**
   * True when the guest is mid-way through the deterministic booking data-entry
   * flow and has interrupted with an unrelated question. Agents should answer
   * the question briefly WITHOUT restarting the booking flow.
   */
  bookingInProgress?: boolean;
  /** The raw last user message — agents may use it for tone awareness */
  lastMessage?: string;
  /** The instructions configured in the AI Lab Dashboard for this agent */
  customInstructions?: string;
  /** The name of the manager assigned to this agent */
  managerName?: string;
  /**
   * Conversation register. "guest" (default) is the customer-facing
   * tone used when answering tamu via WhatsApp — sapa "Kak", empathetic,
   * full hospitality scripts. "managerial" overrides the tone for
   * internal Telegram channels where the agent is talking to the property
   * manager/staff: concise, peer-to-peer, no apologies, operational vocab.
   *
   * Set to "managerial" by Telegram entry points (per-agent bot router)
   * AND by the WhatsApp autoreply when the sender's number matches an
   * active property_managers row. Otherwise left unset so guest-facing
   * behavior is preserved.
   */
  mode?: "guest" | "managerial";
}

// ─── Agent definition interface ───────────────────────────────────────────────

export interface AgentDefinition {
  /** Unique identifier; used as routing target and analytics label */
  key:         AgentKey;
  /** Human-readable name shown in the admin inbox */
  name:        string;
  /** One-line description for logging / debug */
  description: string;
  /** Which intent categories this agent handles */
  handles:     IntentCategory[];
  /** OpenAI tool definitions available to THIS agent only */
  tools:       ToolDefinition[];
  /**
   * Builds the agent's system prompt from runtime context.
   * Pure function — no I/O.
   */
  buildSystemPrompt(ctx: AgentContext): string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface AgentRunResult {
  reply:     string | null;
  toolsUsed: string[];
  agentKey:  AgentKey;
  error?:    string;
}

/**
 * Explicit outcome of an orchestration run. The webhook uses this to decide
 * what to do, instead of inferring from a nullable reply:
 *   - "reply": a reply was produced — send it.
 *   - "noop":  intentionally stay silent — send nothing, do NOT retry.
 *              (Reserved: no producer wired yet. Add when a real silence case
 *              exists, e.g. mid-conversation human takeover.)
 *   - "error": the run failed — retryable by the webhook.
 */
export type OrchestrationStatus = "reply" | "noop" | "error";

export interface MultiAgentResult {
  status:             OrchestrationStatus;
  reply:              string | null;
  toolsUsed:          string[];
  agentKey:           AgentKey;
  intent:             IntentCategory;
  routingConfidence:  number;
  escalated:          boolean;
  error?:             string;
  /** Jumlah contoh training (RAG dari ai_conversation_logs) yang dipakai */
  trainingExamplesUsed?: number;
  /** ID contoh training yang dipakai — berguna untuk debug di UI */
  trainingExampleIds?:   string[];
  /** LLM retry events that occurred during this orchestration run */
  retries?: Array<{ attempt: number; reason: string; latency_ms: number }>;
}
