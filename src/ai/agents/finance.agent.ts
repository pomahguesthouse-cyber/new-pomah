/**
 * Finance Agent
 *
 * Handles: payment inquiries, booking payment status, transfer confirmation,
 *          invoice requests, refund queries.
 * Tools: get_payment_info
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

const FINANCE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_payment_info",
      description:
        "Ambil informasi pembayaran booking dan rekening tujuan transfer. " +
        "Gunakan saat tamu menanyakan cara bayar, status pembayaran, atau nomor rekening.",
      parameters: {
        type: "object",
        properties: {
          reference_code: {
            type: "string",
            description: "Kode booking (mis. PMH-XXXXXX). Opsional bila tidak diketahui.",
          },
          guest_phone: {
            type: "string",
            description: "Nomor HP/WhatsApp tamu untuk mencari booking terbaru.",
          },
        },
      },
    },
  },
];

export const financeAgent: AgentDefinition = {
  key:         "finance",
  name:        "Finance Agent",
  description: "Handles payment questions, booking invoice, and payment confirmation.",
  handles:     ["payment"],
  tools:       FINANCE_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, customInstructions } = ctx;

    const prop = property as Record<string, unknown>;
    const bankInfoText = [
      prop.payment_bank_name       ? `Bank: ${prop.payment_bank_name}`              : null,
      prop.payment_account_number  ? `No. Rekening: ${prop.payment_account_number}` : null,
      prop.payment_account_holder  ? `Atas Nama: ${prop.payment_account_holder}`    : null,
    ].filter(Boolean).join("\n");

    let prompt = customInstructions || "Anda adalah Finance Agent.";
    prompt = prompt.replace(/\{\{PROPERTY_NAME\}\}/g, property.name ?? "Pomah Guesthouse");
    prompt = prompt.replace(/\{\{TODAY\}\}/g, fmtDateID(today));

    const bankStr = bankInfoText
      ? `Rekening pembayaran hotel:\n${bankInfoText}\n\nGunakan info ini saat tamu menanyakan cara transfer.`
      : "";
    prompt = prompt.replace(/\{\{BANK_INFO\}\}/g, bankStr);

    return prompt;
  },
};
