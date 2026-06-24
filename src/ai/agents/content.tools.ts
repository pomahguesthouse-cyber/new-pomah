/**
 * Content Manager Agent — tool definitions.
 *
 * Split out of `content.agent.ts` so the agent file stays focused on
 * the agent definition itself and so future PRs can grow / regroup
 * tools without churning the prompt.
 *
 * Grouping:
 *   • SEO_TOOLS         — pulled from TOOL_DEFINITIONS so executor + agent
 *                          stay in lock-step
 *   • CITY_GUIDE_TOOLS  — discovery, listing, drafting, publishing
 *   • REVIEW_TOOLS      — custom Google Reviews scrape / save / restore
 *   • MEDIA_TOOLS       — AI-generated cover images for City Guide entries
 *
 * `CONTENT_TOOLS` is the concatenation that gets exposed on the agent
 * (`agent.tools`). The order matches the old hand-written list inside
 * `content.agent.ts` so the LLM sees the exact same surface — this is a
 * pure refactor.
 *
 * `pickTools(names)` is a helper for callers that want a SUBSET of the
 * agent's tools (e.g. a future managerial vs guest split, or per-flow
 * disabling). Filters out unknown names silently.
 */

import { TOOL_DEFINITIONS } from "@/tools/registry";
import type { ToolDefinition } from "@/ai/types";

// ─── SEO (shared with executor via TOOL_DEFINITIONS) ─────────────────────────

const SEO_TOOL_NAMES = [
  "check_keyword_ranking",
  "list_tracked_keywords",
  "audit_page_seo",
] as const;

export const SEO_TOOLS: ToolDefinition[] = TOOL_DEFINITIONS.filter((t) =>
  (SEO_TOOL_NAMES as readonly string[]).includes(t.function.name),
);

// ─── City Guide (explore_items) ──────────────────────────────────────────────

export const CITY_GUIDE_TOOLS: ToolDefinition[] = [
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
  // Handler enforces ctx.isManager === true; publishing affects the public site.
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
  // Handler enforces ctx.isManager === true; bulk publish affects public visibility.
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
  // Handler enforces ctx.isManager === true; this mutates city-guide content.
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
];

// ─── Reviews (custom_google_* on properties) ─────────────────────────────────

export const REVIEW_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "discover_property_reviews",
      description:
        "Cari snippet ulasan publik tentang properti ini dari web (Google Maps profile, " +
        "TripAdvisor, Traveloka, Tiket, Agoda, Booking) memakai Tavily/Serper. TIDAK memakai " +
        "Google Places API. Pakai sebagai langkah pertama saat manajer minta 'import ulasan' / " +
        "'sinkronkan google review' / 'update testimoni publik'. Lalu parafrase + simpan " +
        "via `save_custom_google_reviews`.",
      parameters: {
        type: "object",
        properties: {
          extra_keywords: { type: "string", description: "Filter tambahan (opsional, mis. 'bagus pelayanan')." },
          limit:          { type: "number", description: "Maks snippet (3–20, default 10)." },
        },
      },
    },
  },
  // Handler enforces ctx.isManager === true; this writes homepage review data.
  {
    type: "function",
    function: {
      name: "save_custom_google_reviews",
      description:
        "Tambahkan rating + daftar ulasan yang sudah Anda kurasi ke kolom custom_google_* " +
        "di tabel properties. DEFAULT: APPEND — ulasan baru digabungkan dengan ulasan yang " +
        "sudah tersimpan (dedupe otomatis, cap 30 entry, FIFO drop yang paling lama bila " +
        "melebihi). Rating overall dihitung weighted-average bila Anda tidak mengirim " +
        "`rating` baru. Pakai `replace_all: true` HANYA bila manajer eksplisit minta reset " +
        "(mis. 'hapus semua testimoni lama, ganti baru'). Setelah ini halaman publik " +
        "menampilkan data kustom — Google Places API tidak di-hit.",
      parameters: {
        type: "object",
        properties: {
          rating: {
            type: "number",
            description:
              "Rating rata-rata 0..5 baru (opsional). Bila kosong di mode append, " +
              "rating dihitung weighted-average antara existing dan batch ini.",
          },
          total: {
            type: "number",
            description:
              "Total ulasan publik (opsional). Mode append: bila kosong, existing total " +
              "dinaikkan sebanyak jumlah ulasan baru yang benar-benar masuk (skip dupe).",
          },
          reviews: {
            type: "array",
            description: "1–12 ulasan curated. Tiap item: {author, text, rating 1..5}.",
            items: { type: "object", description: "Satu ulasan kurasi." },
          },
          replace_all: {
            type: "boolean",
            description:
              "Default false (append). Set true HANYA bila manajer eksplisit minta " +
              "menghapus ulasan lama dan replace dengan batch ini.",
          },
        },
        required: ["reviews"],
      },
    },
  },
  // Handler enforces ctx.isManager === true; restore rewrites public review data.
  {
    type: "function",
    function: {
      name: "restore_custom_google_reviews",
      description:
        "Daftar / restore snapshot ulasan kustom dari audit log. Tanpa argumen → " +
        "list 10 snapshot terakhir. Dengan `audit_id` atau `index` (1-based dari list) → " +
        "kembalikan kolom custom_google_* ke nilai sebelum-tulis snapshot terpilih. " +
        "Pakai saat manajer bilang 'kembalikan ulasan lama', 'undo simpan tadi', " +
        "'restore review yang kemarin'.",
      parameters: {
        type: "object",
        properties: {
          audit_id: { type: "string", description: "UUID snapshot dari list mode (paling akurat)." },
          index:    { type: "number", description: "1-based index dari list mode (1 = paling baru)." },
        },
      },
    },
  },
];

// ─── Media (AI image generation for City Guide cards) ────────────────────────

export const MEDIA_TOOLS: ToolDefinition[] = [
  // Handler enforces ctx.isManager === true; generation is paid and writes image_url.
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

// ─── Aggregate ───────────────────────────────────────────────────────────────

/**
 * Full tool surface exposed by the Content Manager agent. Order MUST match
 * the pre-refactor `content.agent.ts` definition so the LLM-visible function
 * sequence is byte-identical.
 */
export const CONTENT_TOOLS: ToolDefinition[] = [
  ...SEO_TOOLS,
  ...CITY_GUIDE_TOOLS,
  ...REVIEW_TOOLS,
  ...MEDIA_TOOLS,
];

/**
 * Return a subset of CONTENT_TOOLS by function name. Unknown names are
 * silently dropped — callers that need strict validation should check the
 * length of the result against their input.
 */
export function pickTools(names: readonly string[]): ToolDefinition[] {
  const wanted = new Set(names);
  return CONTENT_TOOLS.filter((t) => wanted.has(t.function.name));
}
