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
  | "housekeeping"
  | "maintenance"
  | "finance"
  | "manager";

// ─── Intent categories ────────────────────────────────────────────────────────

export type IntentCategory =
  | "greeting"           // salam, halo, selamat pagi/siang/malam
  | "booking_inquiry"    // tanya kamar, cek ketersediaan, mau booking
  | "availability_check" // eksplisit: "ada kamar tidak", "kamar kosong?"
  | "pricing_inquiry"    // tanya harga, tarif, diskon, paket
  | "housekeeping"       // minta handuk, bersih kamar, extra pillow
  | "maintenance"        // AC rusak, lampu mati, kran bocor
  | "payment"            // tanya cara bayar, transfer, invoice
  | "complaint"          // keluhan, kecewa, tidak puas
  | "general";           // pertanyaan umum, info hotel, lokasi

// ─── Context injected into every agent's prompt builder ──────────────────────

export interface AgentContext {
  property: PropertyRow & Record<string, unknown>;
  rooms:    RoomTypeRow[];
  sopText:  string;
  today:    string;
  /** The raw last user message — agents may use it for tone awareness */
  lastMessage?: string;
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

export interface MultiAgentResult {
  reply:              string | null;
  toolsUsed:          string[];
  agentKey:           AgentKey;
  intent:             IntentCategory;
  routingConfidence:  number;
  escalated:          boolean;
  error?:             string;
}
