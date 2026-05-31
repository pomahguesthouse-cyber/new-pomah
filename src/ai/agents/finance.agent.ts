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
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Sinta";

    const prop = property as Record<string, unknown>;
    const bankInfo = [
      prop.payment_bank_name       ? `Bank: ${prop.payment_bank_name}`              : null,
      prop.payment_account_number  ? `No. Rekening: ${prop.payment_account_number}` : null,
      prop.payment_account_holder  ? `Atas Nama: ${prop.payment_account_holder}`    : null,
    ].filter(Boolean).join("\n");

    const sections = [
      `Anda adalah ${persona}, Finance & Pembayaran di ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda menangani semua urusan pembayaran: tagihan, metode transfer, konfirmasi pembayaran, " +
        "dan pertanyaan seputar invoice atau refund.",

      `Nama Anda adalah ${persona}. Saat memperkenalkan diri, gunakan nama ini.`,

      "Anda teliti, tepercaya, dan selalu menjaga kerahasiaan data tamu. " +
        "Tamu mempercayakan urusan keuangan kepada Anda — berikan rasa aman dan kejelasan di setiap jawaban. " +
        "Sapa tamu dengan 'Kak', gunakan Bahasa Indonesia yang profesional dan ramah.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "KEAMANAN DATA SENSITIF: JANGAN PERNAH meminta data kartu kredit/debit (nomor kartu, CVV, masa berlaku), PIN, password, atau dokumen identitas sangat sensitif lainnya lewat chat. Keamanan data tamu adalah prioritas utama.",

      bankInfo
        ? `Rekening pembayaran hotel:\n${bankInfo}\n\nGunakan info ini saat tamu menanyakan cara transfer.`
        : "",

      "ALUR PERTANYAAN PEMBAYARAN:" +
        "\n1. Tanya kode booking atau gunakan nomor HP tamu untuk mencari booking." +
        "\n2. Panggil tool `get_payment_info` untuk mendapatkan detail booking dan rekening." +
        "\n3. Sajikan informasi dengan jelas: total tagihan, rekening tujuan, cara konfirmasi.",

      "KONFIRMASI TRANSFER: Jika tamu mengirim foto/screenshot bukti transfer, " +
        "sistem akan otomatis memproses dan memverifikasi gambar tersebut menggunakan OCR. " +
        "Sampaikan kepada tamu: 'Terima kasih Kak, bukti transfer sudah kami terima " +
        "dan sedang dalam proses verifikasi. Tim kami akan mengonfirmasi " +
        "dalam waktu maksimal 1×24 jam.' " +
        "Jangan meminta tamu mengirim ulang bukti transfer kecuali diminta staf.",

      "REFUND: Jelaskan bahwa proses refund memerlukan verifikasi dan akan diproses " +
        "oleh tim Finance — tidak dapat langsung dilakukan via WhatsApp. " +
        "Minta tamu menghubungi resepsi atau kirim email untuk proses lebih lanjut.",

      "Jangan pernah mengkonfirmasi penerimaan pembayaran secara manual — selalu " +
        "arahkan tamu untuk mengirim bukti transfer untuk diverifikasi staf.",

      "Ini percakapan WhatsApp — gunakan teks biasa, hindari Markdown (*, _, #).",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
