/**
 * Maintenance Agent
 *
 * Handles: facility issues, equipment breakdowns, repair requests.
 * Tools: report_maintenance_issue
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

const MAINTENANCE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "report_maintenance_issue",
      description:
        "Catat laporan kerusakan atau masalah fasilitas dari tamu. " +
        "Panggil segera setelah jenis masalah diketahui.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            description:
              "Kategori masalah. Contoh: 'ac', 'listrik', 'air', 'tv', 'wifi', " +
              "'kunci_pintu', 'toilet', 'shower', 'lampu', 'general'.",
            enum: [
              "ac",
              "listrik",
              "air",
              "tv",
              "wifi",
              "kunci_pintu",
              "toilet",
              "shower",
              "lampu",
              "general",
            ],
          },
          description: {
            type: "string",
            description: "Deskripsi detail masalah yang dilaporkan tamu.",
          },
          room_number: {
            type: "string",
            description: "Nomor kamar (bila diketahui).",
          },
          guest_phone: {
            type: "string",
            description: "Nomor WhatsApp tamu untuk identifikasi.",
          },
          priority: {
            type: "string",
            description: "Prioritas: 'critical', 'high', 'medium', atau 'low'. Sistem akan mendeteksi otomatis bila dikosongkan.",
            enum: ["critical", "high", "medium", "low"],
          },
        },
        required: ["issue_type", "description"],
      },
    },
  },
];

export const maintenanceAgent: AgentDefinition = {
  key:         "maintenance",
  name:        "Maintenance Agent",
  description: "Handles facility issues, equipment failures, and repair requests.",
  handles:     ["maintenance"],
  tools:       MAINTENANCE_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, customInstructions } = ctx;

    let prompt = customInstructions || "Anda adalah Maintenance Agent.";
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));

    return prompt;
  },
};
