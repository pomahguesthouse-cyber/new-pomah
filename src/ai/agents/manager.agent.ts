/**
 * Manager Agent
 *
 * Handles: complaints, escalated issues, complex requests requiring cross-agent
 *          coordination, and situations where the router has low confidence.
 *
 * Special tool: `ask_agent` — the Manager can delegate specific questions to
 * any other agent.  The multi-agent orchestrator intercepts this tool call,
 * runs the specified sub-agent, and returns its response as the tool result.
 * This creates true multi-agent collaboration without mixing prompts.
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext, AgentKey } from "./types";
import type { ToolDefinition } from "@/ai/types";
import { TOOL_DEFINITIONS } from "@/tools/registry";

/** Delegation tool — intercepted by the multi-agent orchestrator */
export const ASK_AGENT_TOOL_NAME = "ask_agent" as const;

export const MANAGER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: ASK_AGENT_TOOL_NAME,
      description:
        "Delegasikan pertanyaan spesifik ke agent spesialis lain dan dapatkan responsnya. " +
        "Gunakan ini jika manajer menanyakan hal yang menjadi ranah agent lain (contoh: harga -> pricing).",
      parameters: {
        type: "object",
        properties: {
          agent_key: {
            type: "string",
            description: "Agent yang akan ditanya.",
            enum: [
              "front-office",
              "pricing",
              "housekeeping",
              "maintenance",
              "finance",
            ] satisfies AgentKey[],
          },
          question: {
            type: "string",
            description: "Pertanyaan atau instruksi yang dikirimkan ke agent tersebut.",
          },
        },
        required: ["agent_key", "question"],
      },
    },
  },
  ...TOOL_DEFINITIONS.filter((t) => 
    ["get_bookings", "update_booking_status", "change_booking_room"].includes(t.function.name)
  ),
];

export const managerAgent: AgentDefinition = {
  key:         "manager",
  name:        "Manager Agent",
  description: "Personal assistant for the property manager. Handles operational commands and data retrieval.",
  handles:     ["general"],
  tools:       MANAGER_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, customInstructions } = ctx;

    let prompt = customInstructions || "Anda adalah Manager Agent.";
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));

    return prompt;
  },
};
