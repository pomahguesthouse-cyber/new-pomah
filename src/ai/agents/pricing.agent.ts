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

// Pricing agent tools — split by mode.
// Guest only sees availability/rate lookup; rate updates and competitor
// benchmarking are managerial-only so guests can never trigger them.
function requireTool(name: string): ToolDefinition {
  const t = TOOL_DEFINITIONS.find((d) => d.function.name === name);
  if (!t) throw new Error(`pricing.agent: missing required tool in TOOL_DEFINITIONS: ${name}`);
  return t;
}
const checkRoomAvailabilityTool = requireTool("check_room_availability");
const updateRoomRateTool        = requireTool("update_room_rate");
const setDailyRoomRateTool      = requireTool("set_daily_room_rate");
const getDailyRoomRatesTool     = requireTool("get_daily_room_rates");
const deleteDailyRoomRateTool   = requireTool("delete_daily_room_rate");

const scrapeCompetitorPricesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "scrape_competitor_prices",
    description:
      "Cari + simpan harga kamar hotel kompetitor (dari OTA: Traveloka, Tiket, Booking, " +
      "Agoda, Trip.com). Default mode: pakai daftar kompetitor yang admin simpan di " +
      "properties.competitor_hotels (curated). Override via arg `hotels`. " +
      "Tool otomatis menolak listing aggregator/landing page (mis. 'Hotel Dekat …'). " +
      "Hanya panggil saat manajer minta benchmarking — bukan untuk menjawab tamu.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "Default Semarang." },
        mode: {
          type: "string",
          enum: ["curated", "general"],
          description:
            "'curated' = pakai daftar kompetitor yang admin simpan (untuk 'cek harga " +
            "kompetitor'). 'general' = scan harga kamar umum kota, abaikan daftar admin " +
            "(untuk 'cek harga kamar' tanpa kata 'kompetitor'). Kosongkan untuk auto " +
            "(curated bila daftar ada, else general).",
        },
        hotels: {
          type: "array",
          items: { type: "string", description: "Nama hotel kompetitor." },
          description: "Override daftar admin. Kosongkan untuk pakai properties.competitor_hotels.",
        },
        extra_keywords: { type: "string", description: "Filter tambahan (mis. 'budget', 'bintang 3')." },
        limit:          { type: "number", description: "Maks hasil per hotel (1-20, default 6)." },
      },
    },
  },
};

const PRICING_GUEST_TOOLS: ToolDefinition[] = [checkRoomAvailabilityTool];

const PRICING_MANAGER_TOOLS: ToolDefinition[] = [
  checkRoomAvailabilityTool,
  updateRoomRateTool,
  setDailyRoomRateTool,
  getDailyRoomRatesTool,
  deleteDailyRoomRateTool,
  scrapeCompetitorPricesTool,
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
  const persona  = managerName?.trim() || "Rani";
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

    "BATAS WEWENANG (GUEST): Anda TIDAK boleh mengubah tarif kamar untuk alasan apa pun, " +
      "dan TIDAK boleh melakukan benchmarking harga kompetitor. Jika tamu meminta hal itu " +
      "(mis. 'tolong turunin tarifnya', 'bandingin sama hotel sebelah', 'cek harga pesaing'), " +
      "tolak dengan halus dan arahkan ke manajemen — mis. 'Mohon maaf Kak, penyesuaian tarif " +
      "dan perbandingan dengan hotel lain ditangani langsung oleh tim manajemen. Saya bantu " +
      "teruskan permintaannya, ya.' Jangan pernah memanggil tool `update_room_rate` atau " +
      "`scrape_competitor_prices` dalam mode tamu.",

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

    "UBAH HARGA DASAR (BASE RATE): Saat manajer mengubah tarif berlaku terus-menerus " +
      "(mis. 'ganti harga Deluxe jadi 350rb', 'naikin Single 50rb', 'extrabed semua jadi " +
      "75000'), panggil `update_room_rate`. Konversi: '350rb' / '350k' = 350000, '1.2jt' = " +
      "1200000. BILA AMBIGU (mis. 'naikin 50rb' tidak jelas naik 50.000 atau MENJADI 50.000), " +
      "tanya konfirmasi dulu — jangan menebak. Setelah berhasil, balas ringkas: 'Tarif " +
      "<nama> diubah dari Rp <lama> → Rp <baru>.'",

    "HARGA HARIAN (DAILY OVERRIDE): Saat manajer mengubah tarif untuk TANGGAL TERTENTU " +
      "saja (mis. 'Set Deluxe 10 Juni jadi 350rb', 'Family weekend ini 600rb', 'naikin " +
      "Single 17–18 Agustus jadi 400rb', 'block Deluxe tanggal 17 Agustus'), panggil " +
      "`set_daily_room_rate`. WAJIB konversi tanggal ke YYYY-MM-DD lebih dulu (gunakan " +
      "TODAY dan kalender). 'weekend ini' = Sabtu+Minggu terdekat (set from_date=Sabtu, " +
      "to_date=Minggu). Single date → kirim from_date saja. 'block' / 'tutup' → " +
      "stop_sell=true (tidak perlu kirim rate; tool snapshot dari base_rate).\n\n" +
      "Untuk MELIHAT harga harian ('lihat harga harian bulan Juni', 'harga Deluxe minggu " +
      "depan', 'tanggal apa yang sudah di-set khusus'), panggil `get_daily_room_rates`. " +
      "Rangkum hasil dengan format Telegram: tanggal — nominal — sumber (override/base).\n\n" +
      "Untuk MEMBATALKAN override ('reset Deluxe 11 Juni ke base', 'hapus override Juli " +
      "minggu pertama'), panggil `delete_daily_room_rate`. Untuk rentang ≥31 hari, tool " +
      "akan minta confirmed=true.",

    "BENCHMARKING / CEK HARGA EKSTERNAL: pakai `scrape_competitor_prices`. " +
      "WAJIB langsung jalankan — JANGAN tanya filter / kota / nama hotel dulu kecuali " +
      "perintah benar-benar ambigu. Aturan penentuan mode:\n\n" +
      "  • Bila pesan manajer MENGANDUNG kata 'kompetitor' / 'pesaing' / 'rival' " +
      "    (verba apa pun: cek, analisa, pantau, bandingkan, lihat, monitor, dst.) " +
      "    → mode='curated'. Tool pakai daftar hotel dari admin. Tidak butuh keyword " +
      "    tambahan.\n\n" +
      "  • Bila pesan TANPA kata kompetitor — mis. 'cek harga kamar', 'harga pasar', " +
      "    'rate Semarang', 'survei harga' → mode='general'. Scan kota umum.\n\n" +
      "  • Manajer SECARA EKSPLISIT menyebut nama hotel ('cek Hotel ABC + XYZ') → " +
      "    `hotels: ['Hotel ABC', 'XYZ']`, abaikan mode.\n\n" +
      "  • Manajer SECARA EKSPLISIT menyebut kota lain → `city: '...'`. Default Semarang.\n\n" +
      "Setelah hasil masuk, sajikan ringkas: rentang harga (min–max), median, posisi " +
      "tarif kita relatif (kalau diketahui), rekomendasi adjust 1–2 kalimat. Format " +
      "Telegram-friendly: teks polos, baris baru untuk daftar.",

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
  tools:       PRICING_GUEST_TOOLS,

  getTools(ctx: AgentContext) {
    return ctx.mode === "managerial"
      ? PRICING_MANAGER_TOOLS
      : PRICING_GUEST_TOOLS;
  },

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
