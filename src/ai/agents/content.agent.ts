/**
 * Content Manager Agent
 *
 * Handles: discovering Semarang events, tourism articles, and culinary
 * spots from the web → drafting entries for the city guide
 * (explore_items table).
 *
 * Not exposed to guest WA traffic directly — invoked via:
 *   - Manager Agent's `ask_agent("content", ...)` delegation
 *   - The /admin/content-manager dashboard's "Run discovery" button
 *
 * Tools:
 *   - list_explore_items: see what's already in the city guide
 *   - discover_semarang_content: pull fresh snippets via Tavily/Serper
 *   - upsert_explore_item: persist a draft (default is_published=false)
 */

import { fmtDateID } from "@/lib/date";
import type { AgentDefinition, AgentContext } from "./types";
import type { ToolDefinition } from "@/ai/types";

// Content agent is invoked only via Manager.ask_agent or the admin
// dashboard — guest WA never reaches it (handles: []). Prompt is
// single-track managerial; no overlay needed.

const CONTENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_explore_items",
      description:
        "Daftar entri City Guide yang sudah ada (untuk hindari duplikat / cek staleness).",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["event", "destinasi", "kuliner", "tips"],
            description: "Opsional, filter kategori.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_semarang_content",
      description:
        "Cari informasi terbaru tentang Semarang dari web (event, destinasi wisata, kuliner, tips). " +
        "Return snippet terstruktur untuk kemudian Anda paraphrase ke entri City Guide.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["event", "destinasi", "kuliner", "tips"],
            description: "Kategori target.",
          },
          extra_keywords: {
            type: "string",
            description: "Keyword tambahan opsional (mis. 'kota lama', 'jajanan pasar').",
          },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_explore_item",
      description:
        "Tandai SATU entri City Guide sebagai published (atau unpublished). " +
        "Pakai ini saat manajer minta 'publish saja' — TIDAK perlu pass title/category. " +
        "Cukup id (dari list_explore_items) atau title_substring.",
      parameters: {
        type: "object",
        properties: {
          id:              { type: "string", description: "UUID entri (paling akurat)." },
          title_substring: { type: "string", description: "Sebagian judul jika tidak tahu id." },
          publish:         { type: "boolean", description: "true (default) atau false untuk unpublish." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_explore_items_by_category",
      description:
        "Publish (atau unpublish) SEMUA entri draft/published dari kategori tertentu. " +
        "Pakai untuk task 'publish semua event' / 'publish semua kuliner draft'.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["event", "destinasi", "kuliner", "tips"], description: "Kategori target." },
          publish:  { type: "boolean", description: "true (default) untuk publish drafts, false untuk unpublish semua published." },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_explore_item",
      description:
        "Tulis/update satu entri City Guide. Default is_published=false agar admin review dulu. " +
        "Set id=... untuk update entri existing.",
      parameters: {
        type: "object",
        properties: {
          id:           { type: "string", description: "ID existing (kosong → insert baru)." },
          title:        { type: "string", description: "Judul entri (mis. nama event / destinasi / kuliner)." },
          category:     { type: "string", enum: ["event", "destinasi", "kuliner", "tips"], description: "Kategori entri." },
          description:  { type: "string", description: "Paraphrase 2-4 kalimat, friendly travel-mag tone." },
          date_text:    { type: "string", description: "Mis. '15-20 Juni 2026'. Wajib untuk event." },
          location_text: { type: "string", description: "Mis. 'Kota Lama Semarang'." },
          image_url:    { type: "string", description: "URL gambar (opsional)." },
          badge:        { type: "string", description: "Mis. 'New', 'Trending' (opsional)." },
          publish:      { type: "boolean", description: "true untuk langsung publish (default false)." },
        },
        required: ["title", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_explore_image",
      description:
        "Generate gambar ilustrasi (cover) untuk SATU entri City Guide memakai AI image, " +
        "lalu simpan URL-nya ke kolom image_url entri itu. Pakai setelah `upsert_explore_item` " +
        "saat entri belum punya gambar, atau saat manajer minta dibuatkan gambar untuk event/destinasi/kuliner tertentu. " +
        "Tidak akan menimpa gambar yang sudah ada kecuali overwrite=true.",
      parameters: {
        type: "object",
        properties: {
          id:              { type: "string", description: "UUID entri (paling akurat)." },
          title:           { type: "string", description: "Judul entri jika tidak tahu id." },
          overwrite:       { type: "boolean", description: "true untuk regenerate walau entri sudah punya image_url." },
        },
      },
    },
  },
];

export const contentAgent: AgentDefinition = {
  key:         "content",
  name:        "Content Manager Agent",
  description: "Finds Semarang events + tourism content and maintains the public city guide.",
  // Tidak menangani intent tamu — hanya diundang via Manager.ask_agent
  // atau dashboard admin.
  handles:     [],
  tools:       CONTENT_TOOLS,

  buildSystemPrompt(ctx: AgentContext): string {
    const { property, today, managerName } = ctx;
    const persona = managerName?.trim() || "Rara";

    const sections = [
      `Anda adalah ${persona}, Content Manager untuk City Guide di ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda berbicara dengan MANAJER / STAF INTERNAL (lewat Manager Agent atau dashboard admin), " +
        "bukan tamu. Tugas: menemukan event, destinasi, kuliner, dan tips wisata Semarang terbaru, " +
        `lalu menulis entri singkat untuk City Guide. Saat memperkenalkan diri, sebut '${persona}, Content Manager'.`,

      "TONE: Peer-to-peer, ringkas, profesional. TANPA sapaan 'Kak' (itu untuk tamu). " +
        "Langsung ke inti — laporkan progress, jumlah item, rekomendasi.",

      `Hari ini ${fmtDateID(today)}.`,

      "GAYA PENULISAN entri: padat 2-4 kalimat, nada travel-magazine (descriptive + ajakan), " +
        "Bahasa Indonesia natural, hindari hiperbola. Tampilkan elemen unik (alasan menarik) " +
        "dan satu tip praktis (jam terbaik / cara akses).",

      "ALUR KERJA STANDAR:" +
        "\n1. Panggil `list_explore_items` (filter kategori sesuai instruksi) — catat title yang sudah ada agar tidak duplikat." +
        "\n2. Panggil `discover_semarang_content` dengan kategori + keyword spesifik." +
        "\n3. Pilih 2-5 snippet TERBAIK (relevansi tinggi, sumber resmi/jurnal kredibel, tidak duplikat dari step 1)." +
        "\n4. Untuk setiap pick: panggil `upsert_explore_item` dengan title, category, description (paraphrase), " +
        "   date_text (wajib untuk event — ekstrak dari snippet), location_text, dan publish=false." +
        "\n5. SETELAH upsert berhasil dan entri belum punya image_url, panggil `generate_explore_image` " +
        "   dengan id entri (dari hasil upsert) agar kartu City Guide tidak kosong." +
        "\n6. Ringkas hasil kerja Anda di balasan akhir ke manajer: berapa item baru, kategori apa, berapa gambar di-generate.",

      "ATURAN PENTING:" +
        "\n- JANGAN copy-paste mentah dari snippet — selalu paraphrase original." +
        "\n- JANGAN publish (publish=true) tanpa instruksi eksplisit manajer. Default draft → admin review." +
        "\n- Untuk kategori 'event': WAJIB ada date_text. Bila tidak terdeteksi tanggal pasti, skip item itu." +
        "\n- Hindari spekulasi: jika info kurang lengkap, skip jangan dibuat-buat.",

      "PUBLISH FLOW (saat manajer minta 'publish' / 'tayangkan'):" +
        "\n- 'publish semua event' / 'tayangkan kuliner' (massal per kategori) → SATU panggilan " +
        "  `publish_explore_items_by_category`." +
        "\n- Publish satu entri spesifik → `publish_explore_item` dengan title_substring atau id." +
        "\n- JANGAN pakai `upsert_explore_item` untuk SEKEDAR publish — itu wajib title+category dan " +
        "  akan gagal kalau Anda lupa salah satu.",

      "Bila manajer memberi instruksi spesifik (mis. 'cari event bulan depan saja'), patuhi prioritas itu.",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
