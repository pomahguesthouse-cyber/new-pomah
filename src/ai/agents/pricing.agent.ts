/**
 * Pricing Agent
 *
 * Handles: pricing inquiries, rate questions, discounts, packages.
 * Tools: check_room_availability (to show live rate + availability together)
 */

import { fmtDateID } from "@/lib/date";
import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

// Pricing agent only needs the availability tool (rates come from it)
const PRICING_TOOLS: ToolDefinition[] = TOOL_DEFINITIONS.filter(
  (t) => t.function.name === "check_room_availability",
);

export const pricingAgent: AgentDefinition = {
  key:         "pricing",
  name:        "Pricing Agent",
  description: "Answers rate and pricing questions with live availability data.",
  handles:     ["pricing_inquiry"],
  tools:       PRICING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, rooms, today, customInstructions } = ctx;

    const roomLines = rooms.map(
      (r) =>
        `• ${r.name}: Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam` +
        (r.capacity ? `, kapasitas ${r.capacity} tamu` : "") +
        (r.bed_type  ? `, ${r.bed_type}` : "") +
        (r.description ? ` — ${r.description}` : ""),
    );

    let prompt = customInstructions || "Anda adalah Pricing Agent.";
    
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));
    prompt = prompt.replace(/\{\{TODAY_RAW\}\}/g, today);
    
    const roomDataText = roomLines.length
      ? `Daftar tipe kamar dan tarif dasar:\n${roomLines.join("\n")}`
      : "";
    prompt = prompt.replace(/\{\{ROOM_DATA\}\}/g, roomDataText);

    return prompt;
  },
};
