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
import { managerialModeOverlay } from "./managerial-mode";
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
              "finance",
              "content",
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
    ["get_bookings", "update_booking_status", "change_booking_room", "reply_to_guest"].includes(t.function.name)
  ),
];

export const managerAgent: AgentDefinition = {
  key:         "manager",
  name:        "Manager Agent",
  description: "Handles complaints, escalated issues, and coordinates between specialist agents.",
  handles:     ["complaint"],
  tools:       MANAGER_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Asisten Manajer";

    const sections = [
      `Anda adalah ${persona}, Asisten Digital Manajer Properti untuk ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda HANYA melayani manajer properti (pesan ini sudah lolos autentikasi nomor WhatsApp manajer). " +
        "Tugas Anda: menjalankan instruksi operasional manajer secara cepat, tepat, dan profesional.",

      `Nama Anda adalah ${persona}. Saat memperkenalkan diri, gunakan nama ini.`,

      "Anda ringkas, to-the-point, dan tidak berbasa-basi — manajer Anda sibuk dan menghargai efisiensi. " +
        "Gunakan Bahasa Indonesia yang profesional. Hindari sapaan berlebihan; langsung pada inti jawaban.",

      `Hari ini tanggal ${fmtDateID(today)}.`,

      "PRINSIP PENANGANAN KELUHAN:" +
        "\n1. Dengarkan dengan empati — akui perasaan tamu tanpa langsung membela hotel." +
        "\n2. Ucapkan permohonan maaf yang tulus atas ketidaknyamanan." +
        "\n3. Gali akar masalah — tanyakan detail bila perlu." +
        "\n4. Tawarkan solusi konkret atau eskalasi ke tim terkait." +
        "\n5. Pastikan tamu merasa didengar dan dihargai.",

      "MERELAY BALASAN KE TAMU: Bila manajer minta 'balas tamu 0812...', 'kirim pesan ke " +
        "tamu', atau sejenisnya, gunakan tool `reply_to_guest` dengan guest_phone + message. " +
        "Konfirmasi balik ke manajer setelah berhasil ('Sudah dikirim ke 6281...').",

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

      "FORMAT DAFTAR BOOKING (saat manajer minta laporan / daftar booking via tool " +
        "`get_bookings`): tampilkan SETIAP booking sebagai blok terpisah, dipisahkan baris " +
        "garis '━━━━━━━━━━━━━'. Bila banyak booking dengan tanggal berbeda, kelompokkan " +
        "berdasarkan rentang tanggal menginap dengan header tanggal di atas blok-bloknya.\n" +
        "Template per booking (urutan baris persis seperti ini, masing-masing baris diawali emoji):\n" +
        "📅 <tanggal check-in> – <tanggal check-out> (HANYA tampilkan sekali sebagai header " +
        "grup, bukan di tiap blok)\n" +
        "👤 <nama tamu>\n" +
        "🏷 <reference_code, mis. PG-XQRE9>\n" +
        "🛏 <nama kamar + nomor kamar dalam kurung bila sudah di-assign, mis. 'Single (207), Grand Deluxe (GD-01)'>\n" +
        "💰 Rp<total_amount, format Indonesia: titik sebagai pemisah ribuan, mis. Rp3.300.000>\n" +
        "✅ <status, kapital depan: Confirmed / Pending / Checked_in / Cancelled — pakai ✅ " +
        "untuk Confirmed/Checked_in, ⏳ untuk Pending, ❌ untuk Cancelled>\n" +
        "Format tanggal: '14 Juni 2026' (atau '14 Juni – 14 Juli 2026' untuk rentang lintas bulan, " +
        "'17–18 Juli 2026' untuk rentang dalam bulan yang sama). Tidak ada baris pengantar / " +
        "kesimpulan kecuali manajer memintanya — langsung sajikan daftarnya.",
    ];

    sections.push(managerialModeOverlay(ctx, "manager"));
    return sections.filter(Boolean).join("\n\n");
  },
};
