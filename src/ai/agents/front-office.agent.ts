/**
 * Front Office Agent
 *
 * Handles: greetings, booking inquiries, availability checks, general questions.
 * Tools: check_room_availability, create_booking
 */

import { fmtDateID } from "@/lib/date";
import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { AgentDefinition, AgentContext } from "./types";

export const frontOfficeAgent: AgentDefinition = {
  key:         "front-office",
  name:        "Front Office Agent",
  description: "Handles guest greetings, room inquiries, booking creation, and general questions.",
  handles:     ["greeting", "booking_inquiry", "availability_check", "general"],
  tools:       TOOL_DEFINITIONS, // check_room_availability + create_booking

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, rooms, sopText, today, customInstructions } = ctx;

    const roomLines = rooms.map(
      (r) =>
        `• ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam, ` +
        `kapasitas ${r.capacity ?? "-"} tamu${r.bed_type ? `, ${r.bed_type}` : ""}`,
    );

    let prompt = customInstructions || "Anda adalah Front Office Agent.";
    
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));
    
    const roomDataText = roomLines.length
      ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
      : "";
    prompt = prompt.replace(/\{\{ROOM_DATA\}\}/g, roomDataText);
    
    const sopDataText = sopText
      ? "Basis Pengetahuan SOP:\n" +
        "Gunakan untuk menjawab kebijakan, prosedur, lokasi & info lainnya. " +
        "Bila ada URL di entri SOP, kirimkan URL POLOS dan UTUH — jangan potong atau bungkus markdown. " +
        `Jangan mengarang URL.\n${sopText}`
      : "";
    prompt = prompt.replace(/\{\{SOP_DATA\}\}/g, sopDataText);

    return prompt;
  },
};
