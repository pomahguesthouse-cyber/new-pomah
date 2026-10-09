/**
 * Agent router.
 *
 * Maps a ClassifiedIntent to a specific AgentKey, applying escalation logic:
 *   - "complaint" routes to front-office (flagged escalated; human staff
 *     dinotifikasi terpisah via guest_complaints)
 *   - confidence < ESCALATION_THRESHOLD falls back to front-office
 *   - overlapping intents (booking + pricing) favour the more specific agent.
 */

import type { IntentCategory, AgentKey } from "@/ai/agents/types";
import type { ClassifiedIntent, RoutingDecision } from "./types";

// ─── Config ───────────────────────────────────────────────────────────────────

/** Below this confidence, escalate to manager regardless of category */
const ESCALATION_THRESHOLD = 0.35;

// ─── Routing table ────────────────────────────────────────────────────────────

export const ROUTING_MAP: Record<IntentCategory, AgentKey> = {
  greeting:           "front-office",
  booking_inquiry:    "front-office",
  availability_check: "front-office",
  pricing_inquiry:    "pricing",
  "customer-care":    "customer-care",
  // Maintenance intent is real (AC mati, kran bocor) but is now handled by
  // Customer Care — the Maintenance Agent has been merged into it.
  maintenance:        "customer-care",
  payment:            "finance",
  complaint:          "front-office",
  // ── New intents ──────────────────────────────────────────────────────────
  booking_start:                "front-office",
  guest_count_input:            "front-office",
  payment_policy_question:      "finance",
  bank_account_request:         "finance",
  invoice_request:              "finance",
  room_detail_question:         "front-office",
  // Media (foto/brosur/video/tour) HANYA bisa dikirim Front Office — dialah
  // satu-satunya agent yang memegang `send_room_photos` & `send_room_tour`.
  media_request:                "front-office",
  checkin_policy_question:      "front-office",
  early_arrival_guest_question: "front-office",
  // ── Admin intents ────────────────────────────────────────────────────────
  list_bookings:                "manager",
  booking_detail:               "manager",
  payment_update:               "finance",
  room_block:                   "manager",
  send_to_manager:              "manager",
  general:            "front-office",
};

export const AGENT_NAMES: Record<AgentKey, string> = {
  "front-office": "Front Office Agent",
  pricing:        "Pricing Agent",
  "customer-care": "Customer Care Agent",
  finance:        "Finance Agent",
  content:        "Content Manager Agent",
  manager:        "Manager Agent",
};

/**
 * Intent yang ditulis pipeline (bukan enum IntentCategory) beserta agentnya.
 * Dipakai routing-debug supaya tidak muncul sebagai "tak terpetakan".
 * `deterministic_*` ditangkap lewat awalan, daftar di bawah adalah yang dikenal.
 */
export const PIPELINE_INTENT_AGENTS: ReadonlyArray<{
  intent: string;
  label: string;
  agent: AgentKey;
}> = [
  { intent: "deterministic_availability", label: "Deterministic availability", agent: "front-office" },
  { intent: "deterministic_availability_full", label: "Deterministic availability (penuh)", agent: "front-office" },
  { intent: "deterministic_availability_focus", label: "Deterministic availability (fokus kamar)", agent: "front-office" },
  { intent: "deterministic_availability_focus_full", label: "Deterministic availability (fokus penuh)", agent: "front-office" },
  { intent: "deterministic_availability_need_dates", label: "Deterministic availability (butuh tanggal)", agent: "front-office" },
  { intent: "deterministic_availability_unknown", label: "Deterministic availability (belum jelas)", agent: "front-office" },
  { intent: "deterministic_availability_over_capacity", label: "Deterministic availability (kelebihan kapasitas)", agent: "front-office" },
  { intent: "deterministic_availability_guest_count", label: "Deterministic availability (jumlah tamu)", agent: "front-office" },
  { intent: "deterministic_availability_multi_room_combination", label: "Deterministic availability (kombinasi kamar)", agent: "front-office" },
  { intent: "deterministic_tonight_availability_full", label: "Deterministic malam ini (penuh)", agent: "front-office" },
  { intent: "deterministic_tonight_availability_unknown", label: "Deterministic malam ini (belum jelas)", agent: "front-office" },
  { intent: "deterministic_tonight_price", label: "Deterministic harga malam ini", agent: "front-office" },
  { intent: "policy_question", label: "Policy question (jam check-in/out)", agent: "front-office" },
  { intent: "invoice_send", label: "Invoice send (sistem)", agent: "finance" },
];

export function pipelineIntentAgent(
  intent: string,
): { intent: string; label: string; agent: AgentKey } | null {
  const known = PIPELINE_INTENT_AGENTS.find((row) => row.intent === intent);
  if (known) return known;
  if (intent.startsWith("deterministic_")) {
    return { intent, label: "Deterministic fast-path", agent: "front-office" };
  }
  return null;
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Produce a routing decision from a classified intent.
 *
 * Escalation cases:
 *  1. Intent is "complaint" → always manager
 *  2. Confidence below threshold → manager (graceful catch-all)
 */
export function routeToAgent(intent: ClassifiedIntent): RoutingDecision {
  // Complaints: send to front office (they can apologize and inform human staff)
  if (intent.category === "complaint") {
    return {
      agentKey:   "front-office",
      confidence: intent.confidence,
      reason:     "Complaint detected — routing to Front Office",
      escalated:  true,
    };
  }

  // Low confidence: fallback to front office
  if (intent.confidence < ESCALATION_THRESHOLD) {
    return {
      agentKey:   "front-office",
      confidence: intent.confidence,
      reason:     `Low confidence (${intent.confidence.toFixed(2)}) — fallback to Front Office`,
      escalated:  true,
    };
  }

  const agentKey = ROUTING_MAP[intent.category];

  return {
    agentKey,
    confidence: intent.confidence,
    reason:     `Intent "${intent.category}" → ${AGENT_NAMES[agentKey]}`,
    escalated:  false,
  };
}
