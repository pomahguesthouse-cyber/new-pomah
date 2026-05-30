/**
 * AI Content Studio — generate article from web search + category.
 *
 * Flow:
 *   1. (Optional) call a web search provider (Tavily or Serper) to get
 *      fresh snippets about the topic. If no API key configured, skip
 *      web search and rely on the model's knowledge.
 *   2. Build a category-specific system prompt (artikel pariwisata /
 *      event / destinasi wisata).
 *   3. Send to the Lovable AI gateway (same model used by
 *      landing-page.functions.ts) and parse JSON output.
 *
 * Search providers tried in order:
 *   - TAVILY_API_KEY  → https://api.tavily.com/search
 *   - SERPER_API_KEY  → https://google.serper.dev/search
 *
 * If none set, the function still works but `web_sources` is empty and
 * the article is generated from the model's prior knowledge only.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ARTICLE_CATEGORIES = [
  { value: "pariwisata", label: "Artikel Pariwisata" },
  { value: "event", label: "Event" },
  { value: "destinasi", label: "Artikel Destinasi Wisata" },
] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number]["value"];

type SearchSnippet = { title: string; url: string; snippet: string };

const SEARCH_TIMEOUT_MS = 15_000;
const LLM_TIMEOUT_MS = 60_000;

async function loadKeysFromDb(
  client: SupabaseClient,
): Promise<{ tavily: string | null; serper: string | null }> {
  try {
    const { data, error } = await (client as any)
      .from("properties")
      .select("tavily_api_key, serper_api_key")
      .limit(1)
      .maybeSingle();
    if (error) return { tavily: null, serper: null };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      tavily: ((row.tavily_api_key as string | null) ?? null)?.trim() || null,
      serper: ((row.serper_api_key as string | null) ?? null)?.trim() || null,
    };
  } catch {
    return { tavily: null, serper: null };
  }
}

async function webSearch(
  query: string,
  dbKeys: { tavily: string | null; serper: string | null },
): Promise<{ snippets: SearchSnippet[]; provider: string | null }> {
  const tavilyKey = dbKeys.tavily || process.env.TAVILY_API_KEY?.trim() || null;
  const serperKey = dbKeys.serper || process.env.SERPER_API_KEY?.trim() || null;

  // 1. Tavily (LLM-optimised)
  if (tavilyKey) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: "basic",
          include_answer: false,
          max_results: 6,
        }),
      });
      clearTimeout(to);
      if (res.ok) {
        const j = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
        const snippets = (j.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 600) ?? "",
        }));
        return { snippets, provider: "tavily" };
      }
    } catch (e) {
      console.error("[article-gen] Tavily failed:", e);
    }
  }

  // 2. Serper (Google search proxy)
  if (serperKey) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": serperKey },
        signal: ctrl.signal,
        body: JSON.stringify({ q: query, num: 8, gl: "id", hl: "id" }),
      });
      clearTimeout(to);
      if (res.ok) {
        const j = (await res.json()) as {
          organic?: Array<{ title: string; link: string; snippet: string }>;
        };
        const snippets = (j.organic ?? []).slice(0, 6).map((r) => ({
          title: r.title,
          url: r.link,
          snippet: r.snippet?.slice(0, 600) ?? "",
        }));
        return { snippets, provider: "serper" };
      }
    } catch (e) {
      console.error("[article-gen] Serper failed:", e);
    }
  }

  return { snippets: [], provider: null };
}

function categoryPrompt(category: ArticleCategory): { focus: string; structureHint: string } {
  switch (category) {
    case "pariwisata":
      return {
        focus:
          "Artikel jurnalistik bergaya travel-magazine tentang pariwisata di sekitar Semarang & Jawa Tengah, " +
          "menonjolkan budaya, kuliner, dan pengalaman wisatawan. Audiens: calon wisatawan domestik.",
        structureHint:
          "Struktur HTML: 1 paragraf pembuka deskriptif, h2 sub-topik (3-4), bullet list rekomendasi, paragraf penutup ajakan menginap.",
      };
    case "event":
      return {
        focus:
          "Artikel peliputan event/acara di Semarang & sekitarnya (festival, wisuda, konferensi, konser, pasar malam). " +
          "Sebutkan tanggal/periode bila terdeteksi dari hasil pencarian. Audiens: peserta/wisatawan yang ingin hadir.",
        structureHint:
          "Struktur HTML: paragraf hook event, h2 'Tentang Acara', h2 'Jadwal & Lokasi', h2 'Tips Akomodasi & Transportasi', tutup dengan CTA menginap.",
      };
    case "destinasi":
      return {
        focus:
          "Artikel guide destinasi wisata spesifik (mis. Lawang Sewu, Sam Poo Kong, Curug Lawe, Kota Lama). " +
          "Detail: lokasi, jam buka, harga tiket, daya tarik utama, tips kunjungan. Audiens: wisatawan yang merencanakan trip.",
        structureHint:
          "Struktur HTML: pembuka, h2 'Lokasi & Akses', h2 'Daya Tarik', h2 'Tips Kunjungan', h2 'Akomodasi Dekat', bullet list fasilitas.",
      };
  }
}

export type GeneratedArticle = {
  title: string;
  meta_description: string;
  paragraphs: string[];
  tags: string[];
  category: ArticleCategory;
  // Event-specific structured fields (filled only when category=event)
  event_start_date: string | null; // YYYY-MM-DD
  event_end_date: string | null;   // YYYY-MM-DD
  event_location: string | null;   // venue / address
  image_url: string | null;        // header image
};

export type GeneratedEvent = {
  title: string;
  description: string;
  paragraphs: string[];
  tags: string[];
  event_start_date: string | null;
  event_end_date: string | null;
  /** Free-text date for recurring / fuzzy events ("Setiap Akhir Pekan"). */
  event_date_label: string | null;
  event_location: string | null;
  image_url: string | null;
};

/**
 * Discriminated union returned by generateArticleCore.
 * - mode='article' → single article (pariwisata / destinasi)
 * - mode='events'  → list of distinct events extracted from search
 */
export type GeneratedArticleCore =
  | {
      mode: "article";
      article: GeneratedArticle;
      events?: undefined;
      web_sources: Array<{ title: string; url: string }>;
      search_provider: string | null;
    }
  | {
      mode: "events";
      article?: undefined;
      events: GeneratedEvent[];
      web_sources: Array<{ title: string; url: string }>;
      search_provider: string | null;
    };

// Fallback images used when the AI cannot find one from search snippets.
const FALLBACK_IMAGES: Record<ArticleCategory, string> = {
  event:
    "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=1200",
  pariwisata:
    "https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=1200",
  destinasi:
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=1200",
};

/* ─── Small helpers ───────────────────────────────────────────────────────── */

const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null;
};

const httpUrl = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
};

async function callLLM(apiKey: string, systemMsg: string, userMsg: string): Promise<string> {
  const llmCtrl = new AbortController();
  const llmTo = setTimeout(() => llmCtrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: llmCtrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${txt}`);
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return (j.choices?.[0]?.message?.content?.trim() ?? "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  } finally {
    clearTimeout(llmTo);
  }
}

/* ─── Dispatcher ──────────────────────────────────────────────────────────── */

/**
 * Reusable core: runs web search + LLM.
 * - For category='event' it extracts a LIST of distinct events from the
 *   search results (mode='events').
 * - For pariwisata/destinasi it produces a single article (mode='article').
 */
export async function generateArticleCore(
  client: SupabaseClient,
  input: { topic: string; category: ArticleCategory; word_count_target?: number },
): Promise<GeneratedArticleCore> {
  const apiKey = process.env.LOVABLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LOVABLE_API_KEY belum di-set. Tambahkan di environment server agar fitur ini bisa memanggil AI.",
    );
  }

  const dbKeys = await loadKeysFromDb(client);
  const { snippets, provider } = await webSearch(input.topic, dbKeys);
  const searchContext =
    snippets.length > 0
      ? snippets
          .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\nRingkasan: ${s.snippet}`)
          .join("\n\n")
      : "(Tidak ada hasil pencarian web — jawab berdasarkan pengetahuan umum, sebutkan jika informasi mungkin perlu diverifikasi.)";

  if (input.category === "event") {
    const events = await runEventExtraction(apiKey, input.topic, searchContext);
    return {
      mode: "events",
      events,
      web_sources: snippets.map((s) => ({ title: s.title, url: s.url })),
      search_provider: provider,
    };
  }

  const article = await runArticleGeneration(apiKey, input, searchContext);
  return {
    mode: "article",
    article,
    web_sources: snippets.map((s) => ({ title: s.title, url: s.url })),
    search_provider: provider,
  };
}

/* ─── Article path (pariwisata / destinasi) ───────────────────────────────── */

async function runArticleGeneration(
  apiKey: string,
  input: { topic: string; category: ArticleCategory; word_count_target?: number },
  searchContext: string,
): Promise<GeneratedArticle> {
  const { focus, structureHint } = categoryPrompt(input.category);
  const wordTarget = input.word_count_target ?? 600;

  const systemMsg =
    "Anda adalah penulis konten SEO untuk Pomah Guesthouse, sebuah guesthouse di Gunungpati, Semarang. " +
    "Tulis dalam Bahasa Indonesia yang baik, informatif, dan ramah pembaca. " +
    "WAJIB respon JSON valid tanpa fence markdown.";

  const userMsg =
    `Tulis artikel SEO tentang: "${input.topic}"\n\n` +
    `Kategori: ${input.category}\n` +
    `Fokus konten: ${focus}\n\n` +
    `Panduan struktur: ${structureHint}\n` +
    `Target panjang: ~${wordTarget} kata.\n\n` +
    `Konteks dari pencarian web:\n${searchContext}\n\n` +
    `Selipkan halus rujukan ke Pomah Guesthouse sebagai pilihan akomodasi di Semarang (TIDAK boleh berlebihan). ` +
    `Gunakan informasi dari hasil pencarian sebagai dasar fakta — jangan mengarang nama tempat/tanggal yang tidak ada.\n\n` +
    `Kembalikan HANYA JSON dengan field:\n` +
    `{\n` +
    `  "title": "judul artikel, max 80 char, mengandung topik utama",\n` +
    `  "meta_description": "120-160 char, menarik untuk di-klik dari hasil Google",\n` +
    `  "paragraphs": ["paragraf 1", "paragraf 2", ...],\n` +
    `  "tags": ["tag1", "tag2", "tag3"],\n` +
    `  "image_url": "URL gambar relevan dari hasil pencarian atau null"\n` +
    `}`;

  const cleaned = await callLLM(apiKey, systemMsg, userMsg);
  let parsed: {
    title?: string;
    meta_description?: string;
    paragraphs?: string[];
    tags?: string[];
    image_url?: string | null;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI mengembalikan format yang bukan JSON valid. Coba lagi.");
  }

  const paragraphs = Array.isArray(parsed.paragraphs)
    ? parsed.paragraphs.map((p) => String(p)).filter((p) => p.trim().length > 0).slice(0, 12)
    : [];
  if (paragraphs.length === 0) {
    throw new Error("AI tidak menghasilkan paragraf. Coba topik yang lebih spesifik.");
  }

  return {
    title: (parsed.title ?? input.topic).toString().slice(0, 200),
    meta_description: (parsed.meta_description ?? "").toString().slice(0, 200),
    paragraphs,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)).slice(0, 8) : [],
    category: input.category,
    event_start_date: null,
    event_end_date: null,
    event_location: null,
    image_url: httpUrl(parsed.image_url) ?? FALLBACK_IMAGES[input.category],
  };
}

/* ─── Event-batch path (extracts N distinct events from search) ───────────── */

async function runEventExtraction(
  apiKey: string,
  topic: string,
  searchContext: string,
): Promise<GeneratedEvent[]> {
  const today = new Date().toISOString().slice(0, 10);

  const systemMsg =
    "Anda adalah agen ekstraksi data event SEO untuk Pomah Guesthouse Semarang. " +
    "Tugas Anda menemukan SEMUA event/acara berbeda yang relevan dari hasil pencarian, " +
    "kemudian membuat 1 entri terpisah untuk SETIAP event. " +
    "JANGAN menggabungkan beberapa event menjadi satu artikel. " +
    "Bahasa Indonesia. WAJIB respon JSON valid tanpa fence markdown.";

  const userMsg =
    `Pencarian: "${topic}"\n\n` +
    `Konteks hasil pencarian web (gunakan SEBAGAI SUMBER FAKTA — jangan mengarang):\n${searchContext}\n\n` +
    `INSTRUKSI:\n` +
    `1. Identifikasi semua event/acara BERBEDA yang muncul (mis. "Festival Kuliner Semarang", "Festival Kota Lama", "Wayang Kulit Pasar Semawis", dll).\n` +
    `2. Untuk SETIAP event, buat satu entri lengkap dengan judul, tanggal, lokasi, deskripsi, dan image_url (jika ada di hasil pencarian).\n` +
    `3. Jangan duplikasi. Jangan menggabungkan banyak event ke 1 entri.\n` +
    `4. Maks 8 event per response. Prioritaskan event mendatang (setelah ${today}).\n` +
    `5. Jika tanggal tidak pasti, isi null — JANGAN mengarang.\n` +
    `6. Selipkan halus rujukan akomodasi Pomah Guesthouse di description bila wajar (tidak wajib di setiap event).\n` +
    `7. WAJIB isi "event_date_label" untuk SETIAP event — gunakan tanggal yang singkat dan mudah dibaca dalam bahasa Indonesia, mis. "31 Mei 2026", "29–31 Mei 2026", "Tiap Hari", "Setiap Akhir Pekan", "Sepanjang Oktober 2026", "Setiap Jumat Malam". Field ini SELALU ada teksnya, BUKAN null. Pakai info ini untuk tampilan slider walaupun event berulang / fuzzy.\n\n` +
    `Kembalikan HANYA JSON:\n` +
    `{\n` +
    `  "events": [\n` +
    `    {\n` +
    `      "title":            "Judul SPESIFIK event tunggal, mis. 'Festival Kuliner Semarang 2026'",\n` +
    `      "description":      "Ringkasan 1-2 kalimat untuk slider (maks 200 char)",\n` +
    `      "paragraphs":       ["paragraf 1 deskriptif", "paragraf 2 jadwal", "paragraf 3 tips"],\n` +
    `      "tags":             ["tag1", "tag2"],\n` +
    `      "event_start_date": "YYYY-MM-DD atau null",\n` +
    `      "event_end_date":   "YYYY-MM-DD atau null (= start jika 1 hari)",\n` +
    `      "event_date_label": "Label tanggal singkat & enak dibaca, WAJIB tidak null",\n` +
    `      "event_location":   "Nama venue + alamat",\n` +
    `      "image_url":        "https://... atau null"\n` +
    `    }\n` +
    `  ]\n` +
    `}`;

  const cleaned = await callLLM(apiKey, systemMsg, userMsg);
  let parsed: { events?: any[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI mengembalikan format yang bukan JSON valid. Coba lagi.");
  }
  if (!Array.isArray(parsed.events)) {
    throw new Error("AI tidak mengembalikan array 'events'. Coba pencarian yang lebih spesifik.");
  }

  const formatIso = (iso: string): string =>
    new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const events: GeneratedEvent[] = [];
  for (const raw of parsed.events.slice(0, 8)) {
    const title = String(raw?.title ?? "").trim();
    if (!title) continue;
    const paragraphs = Array.isArray(raw?.paragraphs)
      ? raw.paragraphs.map((p: unknown) => String(p)).filter((p: string) => p.trim().length > 0).slice(0, 8)
      : [];
    const description = String(raw?.description ?? "").slice(0, 250);
    const start = isoDate(raw?.event_start_date);
    const end = isoDate(raw?.event_end_date) ?? start;
    const loc = raw?.event_location ? String(raw.event_location).slice(0, 300) : null;
    const img = httpUrl(raw?.image_url) ?? FALLBACK_IMAGES.event;
    const tags = Array.isArray(raw?.tags) ? raw.tags.map((t: unknown) => String(t)).slice(0, 6) : [];

    // Build event_date_label with strict fallback so the field is NEVER empty.
    let dateLabel: string | null = raw?.event_date_label
      ? String(raw.event_date_label).slice(0, 100).trim() || null
      : null;
    if (!dateLabel) {
      if (start && end && start !== end) dateLabel = `${formatIso(start)} – ${formatIso(end)}`;
      else if (start) dateLabel = formatIso(start);
      else if (end) dateLabel = formatIso(end);
      else dateLabel = "Tanggal menyusul";
    }

    // Default body: if AI omitted paragraphs, derive at least one from description
    const finalParagraphs =
      paragraphs.length > 0 ? paragraphs : description ? [description] : ["Detail event akan diperbarui."];
    events.push({
      title: title.slice(0, 200),
      description,
      paragraphs: finalParagraphs,
      tags,
      event_start_date: start,
      event_end_date: end,
      event_date_label: dateLabel,
      event_location: loc,
      image_url: img,
    });
  }

  if (events.length === 0) {
    throw new Error("Tidak ada event yang berhasil diekstrak dari hasil pencarian.");
  }

  return events;
}

export const generateArticleFromWebSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        topic: z.string().min(3).max(300),
        category: z.enum(["pariwisata", "event", "destinasi"]),
        word_count_target: z.number().int().min(200).max(2000).optional(),
        persist: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const client = context.supabase as unknown as SupabaseClient;
    const result = await generateArticleCore(client, data);

    // Persist to seo_generated_articles (one row per article, N rows per event batch)
    if (data.persist !== false) {
      try {
        if (result.mode === "events") {
          const rows = result.events.map((e) => ({
            category: "event" as const,
            title: e.title,
            topic: data.topic,
            meta_description: e.description,
            paragraphs: e.paragraphs,
            tags: e.tags,
            sources: result.web_sources,
            event_start_date: e.event_start_date,
            event_end_date: e.event_end_date,
            event_date_label: e.event_date_label,
            event_location: e.event_location,
            image_url: e.image_url,
            status: "active",
          }));
          if (rows.length > 0) {
            await (client as any).from("seo_generated_articles").insert(rows);
          }
        } else {
          await (client as any).from("seo_generated_articles").insert({
            category: result.article.category,
            title: result.article.title,
            topic: data.topic,
            meta_description: result.article.meta_description,
            paragraphs: result.article.paragraphs,
            tags: result.article.tags,
            sources: result.web_sources,
            event_start_date: result.article.event_start_date,
            event_end_date: result.article.event_end_date,
            event_location: result.article.event_location,
            image_url: result.article.image_url,
            status: "active",
          });
        }
      } catch (e) {
        console.warn("[article-gen] persist failed (migration belum jalan?):", e);
      }
    }
    return result;
  });
