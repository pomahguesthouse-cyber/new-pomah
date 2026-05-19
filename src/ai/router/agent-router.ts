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

const ROUTING_MAP: Record<IntentCategory, AgentKey> = {
  greeting:           "front-office",
  booking_inquiry:    "front-office",
  availability_check: "front-office",
  pricing_inquiry:    "pricing",
  housekeeping:       "housekeeping",
  maintenance:        "maintenance",
  payment:            "finance",
  complaint:          "manager",
  general:            "front-office",
};

const AGENT_NAMES: Record<AgentKey, string> = {
  "front-office": "Front Office Agent",
  pricing:        "Pricing Agent",
  housekeeping:   "Housekeeping Agent",
  maintenance:    "Maintenance Agent",
  finance:        "Finance Agent",
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
  // Complaints: always escalate
  if (intent.category === "complaint") {
    return {
      agentKey:   "manager",
      confidence: intent.confidence,
      reason:     "Complaint detected — routing to Manager Agent",
      escalated:  true,
    };
  }

  // Low confidence: escalate to manager
  if (intent.confidence < ESCALATION_THRESHOLD) {
    return {
      agentKey:   "manager",
      confidence: intent.confidence,
      reason:     `Low confidence (${intent.confidence.toFixed(2)}) — escalating to Manager`,
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
