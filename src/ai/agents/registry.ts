/**
 * Agent registry.
 *
 * Single source of truth for all available agents.
 * To add a new agent: create its file, import it here, add it to AGENTS.
 * The orchestrator and router never need to change.
 */

import { frontOfficeAgent } from "./front-office.agent";
import { pricingAgent      } from "./pricing.agent";
import { customerCareAgent } from "./customer-care.agent";
import { financeAgent      } from "./finance.agent";
import { contentAgent      } from "./content.agent";
import { managerAgent      } from "./manager.agent";
import type { AgentDefinition, AgentKey } from "./types";

// ─── Registry map ─────────────────────────────────────────────────────────────

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition> = {
  "front-office": frontOfficeAgent,
  pricing:        pricingAgent,
  "customer-care": customerCareAgent,
  finance:        financeAgent,
  content:        contentAgent,
  manager:        managerAgent,
};

/**
 * Look up an agent definition by key.
 * Falls back to Front Office Agent if key is unknown.
 */
export function getAgent(key: AgentKey): AgentDefinition {
  return AGENT_REGISTRY[key] ?? AGENT_REGISTRY["front-office"];
}
