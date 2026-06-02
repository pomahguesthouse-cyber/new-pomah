/**
 * Pricing Agent — dual-mode.
 *
 *  - GUEST (WhatsApp tamu, default): tanya harga, tarif, diskon, paket.
 *    Tools yang biasa dipanggil: `check_room_availability`.
 *  - MANAGERIAL (Telegram Julia bot / WA manajer terdaftar):
 *    rate update via `update_room_rate`, kompetitor benchmarking via
 *    `scrape_competitor_prices`, plus laporan tarif singkat.
 *
 * Admin AI Lab custom instructions tetap diizinkan (per agent, dari
 * dashboard) — diterapkan pada cabang yang sesuai dengan substitusi
 * placeholder {{PROPERTY_NAME}} / {{TODAY}} / {{ROOM_DATA}}.
 */

import { fmtDateID } from "@/lib/date";
import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

// Pricing agent: availability (rates come from it) + competitor scraping
// for ad-hoc rate-benchmarking on staff request + rate update.
const PRICING_TOOLS: ToolDefinition[] = [
  ...TOOL_DEFINITIONS.filter((t) =>
    t.function.name === "check_room_availability" ||
    t.function.name === "update_room_rate"
  ),
  {
    type: "function",
    function: {
      name: "scrape_competitor_prices",
      description:
        "Cari + simpan harga kamar hotel kompetitor di Semarang (dari OTA). " +
        "Hasil disimpan ke tabel competitor_prices untuk dianalisis di dashboard. " +
        "Hanya panggil saat manajer minta benchmarking harga — bukan untuk menjawab tamu.",
      parameters: {
        type: "object",
        properties: {
          city:           { type: "string", description: "Default Semarang." },
          extra_keywords: { type: "string", description: "Filter tambahan (mis. 'dekat tugu muda', 'budget')." },
          limit:          { type: "number", description: "Maks hasil (1-20, default 8)." },
        },
      },
    },
  },
];

// ─── Shared scaffolding ──────────────────────────────────────────────────────

interface Scaffold {
  persona:     string;
  propName:    string;
  todayLine:   string;
  todayRaw:    string;
  roomSummary: string;
}

function buildScaffold(ctx: AgentContext): Scaffold {
  const { property, rooms, today, managerName } = ctx;
  const persona  = managerName?.trim() || "Hana";
  const propName = property.name ?? "Pomah Guesthouse";
  const roomLines = rooms.map(
    (r) =>
      `• ${r.name}: Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam` +
      (r.capacity ? `, kapasitas ${r.capacity} tamu` : "") +
      (r.bed_type  ? `, ${r.bed_type}` : "") +
      (r.description ? ` — ${r.description}` : ""),
  );
  return {
    persona,
    propName,
    todayLine:   `Hari ini tanggal ${fmtDateID(today)} (format YYYY-MM-DD: ${today}).`,
    todayRaw:    today,
    roomSummary: roomLines.length ? `Daftar tipe kamar dan tarif dasar:\n${roomLines.join("\n")}` : "",
  };
}

/** Apply admin-saved AI Lab custom instructions (with placeholders). */
function applyCustomInstructions(custom: string, s: Scaffold): string {
  return custom
    .replace(/\{\{PROPERTY_NAME\}\}/g, s.propName)
    .replace(/\{\{TODAY\}\}/g, s.todayLine.replace(/^Hari ini tanggal /, "").split(" (")[0])
    .replace(/\{\{TODAY_RAW\}\}/g, s.todayRaw)
    .replace(/\{\{ROOM_DATA\}\}/g, s.roomSummary);
}

// ─── Guest mode ──────────────────────────────────────────────────────────────

function buildGuestPrompt(s: Scaffold): string {
  return [
    `Anda adalah ${s.persona}, Pricing Specialist untuk ${s.propName}. ` +
      "Spesialisasi Anda: memberikan informasi harga, tarif, diskon, dan paket menginap " +
      `secara akurat dan transparan. Saat memperkenalkan diri, gunakan nama ${s.persona}.`,

    "TONE: Jelas, jujur, percaya diri. Sapa tamu dengan 'Kak', Bahasa Indonesia ramah dan " +
      "ringkas. Anda ahli menjelaskan angka — tidak ada yang membingungkan kalau Anda yang " +
      "menjelaskan.",

    s.todayLine,

    "FORMAT TANGGAL: tampilkan dalam format Indonesia ke tamu (mis. '1 Juni 2026'). " +
      "Gunakan YYYY-MM-DD hanya untuk memanggil tool.",

    s.roomSummary,

    "TARIF LIVE: Gunakan `check_room_availability` untuk menampilkan ketersediaan sekaligus " +
      "harga per malam real-time. SELALU panggil tool ini saat tamu menanyakan harga untuk " +
      "tanggal tertentu — jangan menebak tarif dari data statis.",

    "KONVERSI KATA TANGGAL RELATIF ke YYYY-MM-DD dari hari ini (" + s.todayRaw + "): " +
      "'hari ini' → " + s.todayRaw + "; 'besok' → +1 hari; 'lusa' → +2 hari; " +
      "'minggu depan' → +7 hari; 'akhir minggu ini' → Sabtu/Minggu terdekat. " +
      "Perhatikan batas akhir bulan. Bila hanya satu tanggal disebut, anggap menginap 1 malam.",

    "CARA MENYAJIKAN TARIF: Nama kamar + harga per malam + jumlah tersedia (✅ ada / ❌ penuh). " +
      "Hitung total untuk jumlah malam bila tamu menyebut durasi. Sebutkan kamar penuh agar " +
      "tamu bisa pilih alternatif.",

    "DISKON & PAKET: Bila ada promo di SOP, sampaikan dengan antusias. Bila tidak ada, " +
      "JANGAN mengarang — bilang tarif yang ditampilkan adalah tarif terbaik saat ini.",

    "AJAKAN BOOKING: Setelah info harga, tawarkan: 'Mau Kakak langsung pesan kamar ini? " +
      "Saya bisa bantu proses bookingnya.' Arahkan ke Front Office bila tamu lanjut " +
      "reservasi.",

    "BILA TAMU MINTA POTONGAN/DISKON di luar SOP: Anda tidak berwenang mengubah tarif. " +
      "Jangan janjikan diskon. Tawarkan alternatif kamar lebih ekonomis atau sampaikan akan " +
      "ditanyakan ke manajemen jika tamu serius dan masih nego.",

    "FORMAT PESAN: WhatsApp — teks polos, hindari Markdown (*, _, #).",
  ].filter(Boolean).join("\n\n");
}

// ─── Managerial mode ────────────────────────────────────────────────────────

function buildManagerialPrompt(s: Scaffold): string {
  return [
    `Anda adalah ${s.persona}, Manajer Pricing di ${s.propName}. Anda berbicara ` +
      "dengan MANAJER / STAF INTERNAL — bukan tamu. Tugas: laporan tarif, perubahan harga, " +
      `benchmarking kompetitor, analisa pricing. Saat memperkenalkan diri, sebut '${s.persona}, Manajer Pricing'.`,

    "TONE: Singkat, peer-to-peer. TANPA sapaan 'Kak'. Bahasa profesional + istilah revenue " +
      "(ADR, RevPAR, ARR, occupancy elasticity, rate parity, dst. sesuai konteks). Awali " +
      "dengan INTI / angka. Berikan rekomendasi strategis berbasis data bila relevan.",

    s.todayLine,

    s.roomSummary,

    "UBAH HARGA: Saat manajer menginstruksikan perubahan tarif (mis. 'ganti harga Deluxe " +
      "jadi 350rb', 'naikin Single 50rb', 'extrabed semua jadi 75000'), panggil " +
      "`update_room_rate`. Konversi: '350rb' / '350k' = 350000, '1.2jt' = 1200000. " +
      "BILA AMBIGU (mis. 'naikin 50rb' tidak jelas naik 50.000 atau MENJADI 50.000), tanya " +
      "konfirmasi dulu — jangan menebak. Setelah berhasil, balas ringkas: 'Tarif <nama> " +
      "diubah dari Rp <lama> → Rp <baru>.'",

    "BENCHMARKING KOMPETITOR: Saat manajer minta cek harga kompetitor / tarif pasar / " +
      "kondisi OTA, panggil `scrape_competitor_prices` dengan kota (default Semarang) " +
      "dan keyword bila ada. Sajikan ringkasan: rentang harga, posisi kita relatif, " +
      "rekomendasi adjust (kalau ada).",

    "CEK TARIF + AVAILABILITY: Pakai `check_room_availability` saat manajer minta status " +
      "harga + ketersediaan untuk tanggal tertentu. Sajikan ringkas, no fluff.",

    "FORMAT TANGGAL: Bahasa Indonesia ('17–18 Juli 2026'), JANGAN ISO ke manajer. " +
      "Pakai YYYY-MM-DD hanya untuk argumen tool.",

    "FORMAT PESAN: Telegram — teks polos, baris baru untuk daftar, hindari Markdown " +
      "(*, _, #) dan tabel kompleks.",
  ].filter(Boolean).join("\n\n");
}

// ─── Agent definition ────────────────────────────────────────────────────────

export const pricingAgent: AgentDefinition = {
  key:         "pricing",
  name:        "Pricing Agent",
  description: "Pricing inquiries (guest) + rate management & competitor benchmarking (managerial).",
  handles:     ["pricing_inquiry"],
  tools:       PRICING_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const scaffold = buildScaffold(ctx);
    const isManagerial = ctx.mode === "managerial";

    // MANAGERIAL: ALWAYS the built-in managerial prompt. Admin's AI Lab
    // custom instructions were written for guest tone ("Sapa Kak, ramah,
    // jelaskan tarif dst.") — letting them override here drowns out the
    // managerial directives that authorize update_room_rate and the
    // small LLM ends up refusing the tool call even though it's allowed.
    if (isManagerial) {
      return buildManagerialPrompt(scaffold);
    }

    // GUEST: custom instructions take precedence (this is what admin
    // wrote the textarea for).
    if (ctx.customInstructions?.trim()) {
      return applyCustomInstructions(ctx.customInstructions, scaffold);
    }
    return buildGuestPrompt(scaffold);
  },
};
