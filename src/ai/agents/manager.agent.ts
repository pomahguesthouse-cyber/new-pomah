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
        "Gunakan ini saat masalah tamu membutuhkan keahlian agent tertentu " +
        "(misal: tanya harga → pricing, kerusakan → maintenance).",
      parameters: {
        type: "object",
        properties: {
          agent_key: {
            type: "string",
            description: "Agent yang akan ditanya.",
            enum: [
              "front-office",
              "pricing",
              "customer-care",
              "maintenance",
              "finance",
            ] satisfies AgentKey[],
          },
          question: {
            type: "string",
            description:
              "Pertanyaan atau instruksi yang dikirimkan ke agent tersebut. " +
              "Tulis dengan jelas dan lengkap karena agent tidak tahu konteks percakapan ini.",
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
  description: "Handles complaints, escalated issues, and coordinates between specialist agents.",
  handles:     ["complaint"],
  tools:       MANAGER_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today } = ctx;

    const sections = [
      `Anda adalah Manager Agent untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda ditugaskan menangani situasi yang memerlukan perhatian khusus: " +
        "keluhan tamu, masalah kompleks, permintaan eskalasi, atau pertanyaan " +
        "yang tidak tertangani oleh agent lain.",

      "Bersikap tenang, empatik, dan profesional dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'. " +
        "Anda mewakili manajemen hotel — setiap kata Anda mencerminkan standar layanan tertinggi.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "PRINSIP PENANGANAN KELUHAN:" +
        "\n1. Dengarkan dengan empati — akui perasaan tamu tanpa langsung membela hotel." +
        "\n2. Ucapkan permohonan maaf yang tulus atas ketidaknyamanan." +
        "\n3. Gali akar masalah — tanyakan detail bila perlu." +
        "\n4. Tawarkan solusi konkret atau eskalasi ke tim terkait." +
        "\n5. Pastikan tamu merasa didengar dan dihargai.",

      "DELEGASI KE AGENT SPESIALIS: Anda memiliki tool `ask_agent`. " +
        "Gunakan ini saat tamu memiliki pertanyaan yang lebih baik dijawab oleh agent spesialis. " +
        "Contoh:" +
        "\n- Tamu komplain tapi juga tanya harga kamar lain → ask_agent('pricing', 'harga kamar ...')" +
        "\n- Tamu minta kompensasi tapi juga perlu customer care → ask_agent('customer-care', '...')" +
        "\nSetelah mendapat jawaban dari sub-agent, gabungkan dengan respons Anda.",

      "KOMPENSASI & SOLUSI: Bila tamu berhak mendapat kompensasi (misal: kamar bermasalah), " +
        "sampaikan bahwa Anda akan memproses dan staf akan menghubungi mereka. " +
        "Jangan berikan janji spesifik yang tidak bisa Anda pastikan.",

      "DARURAT: Untuk situasi darurat (kebakaran, medis, keamanan), " +
        "selalu instruksikan tamu untuk langsung menghubungi resepsi atau nomor darurat setempat.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
