/**
 * Agent router.
 *
 * Maps a ClassifiedIntent to a specific AgentKey, applying escalation logic:
 *   - "complaint" always routes to manager
 *   - confidence < ESCALATION_THRESHOLD routes to manager
 *   - overlapping intents (booking + pricing) favour the more specific agent
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
