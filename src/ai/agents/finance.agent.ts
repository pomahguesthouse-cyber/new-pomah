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
    const { property, today } = ctx;

    const prop = property as Record<string, unknown>;
    const bankInfo = [
    const { property, today, customInstructions } = ctx;

    const prop = property as Record<string, unknown>;
    const bankInfoText = [
      prop.payment_bank_name       ? `Bank: ${prop.payment_bank_name}`              : null,
      prop.payment_account_number  ? `No. Rekening: ${prop.payment_account_number}` : null,
      prop.payment_account_holder  ? `Atas Nama: ${prop.payment_account_holder}`    : null,
    ].filter(Boolean).join("\n");

    const sections = [
      `Anda adalah Finance Agent untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Spesialisasi Anda: informasi pembayaran, konfirmasi transfer, invoice, dan pertanyaan " +
        "terkait tagihan.",

      "Jawab ramah, jelas dan tepercaya dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      bankInfo
        ? `Rekening pembayaran hotel:\n${bankInfo}\n\nGunakan info ini saat tamu menanyakan cara transfer.`
        : "",

      "ALUR PERTANYAAN PEMBAYARAN:" +
        "\n1. Tanya kode booking atau gunakan nomor HP tamu untuk mencari booking." +
        "\n2. Panggil tool `get_payment_info` untuk mendapatkan detail booking dan rekening." +
        "\n3. Sajikan informasi dengan jelas: total tagihan, rekening tujuan, cara konfirmasi.",

      "KONFIRMASI TRANSFER: Jika tamu sudah transfer dan ingin konfirmasi, " +
        "minta mereka mengirimkan foto/screenshot bukti transfer. " +
        "Sampaikan bahwa tim akan memverifikasi dalam 1×24 jam.",

      "REFUND: Jelaskan bahwa proses refund memerlukan verifikasi dan akan diproses " +
        "oleh tim Finance — tidak dapat langsung dilakukan via WhatsApp. " +
        "Minta tamu menghubungi resepsi atau kirim email untuk proses lebih lanjut.",

      "Jangan pernah mengkonfirmasi penerimaan pembayaran secara manual — selalu " +
        "arahkan tamu untuk mengirim bukti transfer untuk diverifikasi staf.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
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
