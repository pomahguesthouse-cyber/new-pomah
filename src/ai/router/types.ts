/**
 * Agent router types.
 *
 * Separating these into their own module keeps the classifier and router
 * free of circular dependencies.
 */

import type { AgentKey, IntentCategory } from "@/ai/agents/types";

// ─── Intent classification ────────────────────────────────────────────────────

export interface ClassifiedIntent {
  /** Primary intent bucket */
  category:   IntentCategory;
  /** 0–1; lower means the classifier is less certain */
  confidence: number;
  /** Matched keywords/patterns — useful for debugging / logging */
  matchedTerms: string[];
}

// ─── Routing decision ─────────────────────────────────────────────────────────

export interface RoutingDecision {
  agentKey:   AgentKey;
  confidence: number;
  /** Short reason for the routing choice — logged in dev */
  reason:     string;
  /** True when routed to manager due to complaint or low confidence */
  escalated:  boolean;
}
