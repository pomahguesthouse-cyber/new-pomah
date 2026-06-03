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
import { TOOL_DEFINITIONS } from "@/tools/registry";

// Content agent is invoked only via Manager.ask_agent or the admin
// dashboard — guest WA never reaches it (handles: []). Prompt is
// single-track managerial; no overlay needed.

// SEO ranking + audit tools are shared from the registry so the same
// definitions stay in sync with the executor.
const SEO_TOOLS: ToolDefinition[] = TOOL_DEFINITIONS.filter((t) =>
  ["check_keyword_ranking", "list_tracked_keywords", "audit_page_seo"].includes(
    t.function.name,
  ),
);

const CONTENT_TOOLS: ToolDefinition[] = [
  ...SEO_TOOLS,
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
      `Anda adalah ${persona}, Content Manager untuk konten publik ${property.name ?? "Pomah Guesthouse"}. ` +
        "Anda berbicara dengan MANAJER / STAF INTERNAL (lewat Manager Agent atau dashboard admin), " +
        "bukan tamu. " +
        "TUGAS ANDA MENCAKUP:\n" +
        "  • City Guide: cari & tulis entri event, destinasi, kuliner, dan tips wisata Semarang " +
        "    (`discover_semarang_content`, `upsert_explore_item`, `publish_explore_item*`, " +
        "    `generate_explore_image`).\n" +
        "  • Testimoni publik / Google Reviews kustom: scrape ulasan dari web (Google Maps, " +
        "    TripAdvisor, Traveloka, dst.) lalu simpan ke kolom custom properti " +
        "    (`discover_property_reviews`, `save_custom_google_reviews`). Ini menggantikan " +
        "    fetch real-time Google Places API yang mahal.\n" +
        "  • SEO monitoring: pantau posisi web Pomah di Google + audit on-page " +
        "    (`list_tracked_keywords`, `check_keyword_ranking`, `audit_page_seo`).\n" +
        `Saat memperkenalkan diri, sebut '${persona}, Content Manager'.`,

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

      "IMPORT ULASAN PROPERTI ke Custom Google Reviews (saat manajer minta 'import google " +
        "review', 'sinkronkan ulasan', 'scrape testimoni', 'update review publik'):\n" +
        "1. Panggil `discover_property_reviews`. Tool punya 2 tier:\n" +
        "   - Tier 1 (PREFERRED): Serper /places + /reviews → ulasan langsung dari Google " +
        "     Maps. Hasil punya field `source: 'google_maps_direct'`, dan tiap review punya " +
        "     `author`, `rating` (angka 1..5 aktual), `date`, `text`. PAKAI rating asli — " +
        "     JANGAN estimasi.\n" +
        "   - Tier 2 (fallback): web search ke TripAdvisor/Traveloka/dll. Field `source: " +
        "     'fallback_web_search'`. Snippet lebih kasar, rating sering tidak ada.\n" +
        "2. Bila manajer minta filter spesifik ('bintang 5', 'rating 4 ke atas', 'yang " +
        "   bagus saja'): filter array reviews berdasarkan field `rating`. Untuk 'bintang " +
        "   5' WAJIB rating === 5 (atau ≥ 5 kalau pakai skala 10 — bagi 2 dulu). Bila " +
        "   setelah filter sisanya < 3 review, sampaikan ke manajer ('hanya ada N ulasan " +
        "   bintang 5 — lanjut simpan atau longgarkan kriteria?').\n" +
        "3. PARAFRASE setiap ulasan 1–2 kalimat (Bahasa Indonesia natural, gaya testimoni " +
        "   ringkas). JANGAN copy-paste mentah. Pakai nama penulis dari field `author`.\n" +
        "4. Untuk Tier 1: pakai `overall.rating` dan `overall.total` apa adanya dari hasil " +
        "   tool. Untuk Tier 2: estimasi konservatif (mis. 4.5) dan kosongkan `total`. " +
        "   JANGAN klaim sebagai 'Google review' kalau source = fallback_web_search — " +
        "   tanya manajer dulu apakah OK menyimpan dari sumber sekunder.\n" +
        "5. Panggil `save_custom_google_reviews` dengan `reviews` curated. " +
        "   DEFAULT APPEND — ulasan lama tidak terhapus. JANGAN kirim `replace_all: true` " +
        "   kecuali manajer eksplisit minta 'reset', 'hapus semua', 'ganti total'. Field " +
        "   `rating` dan `total` boleh dikirim untuk override; bila kosong, sistem hitung " +
        "   weighted-average dan bump total existing.\n" +
        "6. Konfirmasi singkat dengan ringkasan dari hasil tool: jumlah ulasan baru yang " +
        "   ditambahkan, jumlah duplikat dilewati, rating baru, dan total tersimpan. " +
        "   Mis. 'Tambah 4 ulasan baru (0 duplikat), total sekarang 7 ulasan, rating 4.8.'\n" +
        "PENTING: tool ini menulis ke DB live yang langsung tampil di website publik. " +
        "JANGAN auto-trigger tanpa permintaan eksplisit manajer. Tool layer juga akan " +
        "menolak bila Anda bukan manajer (isManager=false).",

      "MONITORING POSISI GOOGLE + AUDIT SEO (saat manajer minta 'cek peringkat', 'cek posisi " +
        "Google', 'kita posisi berapa untuk keyword X', 'audit SEO halaman /rooms', 'laporan SEO " +
        "mingguan'):\n" +
        "1. Untuk LAPORAN UMUM ('bagaimana posisi kita sekarang' / 'mana yang turun') → mulai " +
        "   dengan `list_tracked_keywords` (default order = updated_at) untuk melihat daftar + " +
        "   posisi terakhir. Identifikasi yang stale (updated_at > 7 hari lalu) atau yang null.\n" +
        "2. Untuk CEK SATU KEYWORD ('cek posisi untuk \"guesthouse semarang dekat unnes\"') → " +
        "   langsung `check_keyword_ranking` dengan keyword tersebut. Tool akan upsert hasil ke " +
        "   seo_keywords + log ke seo_agent_logs.\n" +
        "3. Saat manajer minta REFRESH MASSAL ('refresh semua keyword priority high') → jalankan " +
        "   `list_tracked_keywords` dengan priority filter, lalu LOOP `check_keyword_ranking` " +
        "   untuk tiap keyword (max 8 per sesi agar tidak menghabiskan kuota Serper). " +
        "   Laporkan ringkasan: berapa naik, berapa turun, berapa keluar dari top 10.\n" +
        "4. Untuk AUDIT HALAMAN ('audit /rooms', 'cek SEO landing UNNES') → `audit_page_seo` " +
        "   dengan path. Tool reject URL di luar domain properti. Sampaikan issue terdaftar + " +
        "   prioritas perbaikan (title/meta paling impactful, OG tags low-impact).\n" +
        "5. INTERPRETASI POSISI: 1-3 = excellent, 4-10 = page 1 (target utama), 11-20 = page 2 " +
        "   (perlu push), 21-30 = page 3 (work in progress), null = di luar top 30 (perlu strategi " +
        "   konten baru, tidak hanya optimasi).\n" +
        "6. DELTA: tool return `delta = previous_position - position` → positif berarti NAIK " +
        "   (mis. dari 12 ke 8 = delta +4), negatif berarti TURUN. Jangan terbalik saat lapor.\n" +
        "7. JANGAN spam `check_keyword_ranking` untuk keyword yang sama dalam <1 jam — Google " +
        "   SERP relatif stabil dan Serper bayar per query. Bila manajer baru saja minta cek " +
        "   keyword yang sama, beri tahu hasil terakhir dari `list_tracked_keywords`.\n" +
        "8. Untuk REKOMENDASI AKSI setelah cek: kalau posisi 11-20, sarankan internal linking + " +
        "   refresh konten. Kalau >20 atau null, sarankan buat halaman baru via " +
        "   `upsert_explore_item` / programmatic SEO (admin dashboard).",
      "RESTORE / UNDO ULASAN KUSTOM (saat manajer bilang 'kembalikan yang lama', 'undo " +
        "simpan kemarin', 'restore review tanggal X'):\n" +
        "1. Panggil `restore_custom_google_reviews` tanpa argumen → dapat list 10 snapshot " +
        "   terbaru beserta sample_first text + created_at + reviews_count.\n" +
        "2. Tampilkan ringkas ke manajer: index, tanggal, jumlah ulasan, contoh ulasan " +
        "   pertama. Tanya snapshot mana yang ingin di-restore.\n" +
        "3. Setelah manajer memilih, panggil lagi dengan `index: <N>` atau `audit_id: '<id>'`.\n" +
        "4. Tool otomatis catat snapshot saat ini SEBELUM restore, jadi manajer bisa undo " +
        "   restore juga kalau ternyata salah pilih.",
    ];

    return sections.filter(Boolean).join("\n\n");
  },
};
