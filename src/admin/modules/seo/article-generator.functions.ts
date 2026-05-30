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

export type GeneratedArticleCore = {
  article: {
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

/**
 * Reusable core: runs web search + LLM and returns a structured article.
 * Used by both the manual UI handler and the cron worker.
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

  const { focus, structureHint } = categoryPrompt(input.category);
  const wordTarget = input.word_count_target ?? 600;
  const today = new Date().toISOString().slice(0, 10);

  const systemMsg =
    "Anda adalah penulis konten SEO untuk Pomah Guesthouse, sebuah guesthouse di Gunungpati, Semarang. " +
    "Tulis dalam Bahasa Indonesia yang baik, informatif, dan ramah pembaca. " +
    "WAJIB respon JSON valid tanpa fence markdown.";

  const eventFields =
    input.category === "event"
      ? `  "event_start_date": "YYYY-MM-DD atau null — tanggal MULAI event. Hari ini ${today}",\n` +
        `  "event_end_date":   "YYYY-MM-DD atau null — tanggal TERAKHIR/PENUTUPAN event. Sama dengan start_date jika 1 hari",\n` +
        `  "event_location":   "nama venue + alamat singkat, mis. 'Lawang Sewu, Jl. Pemuda, Semarang'",\n` +
        `  "image_url":        "URL gambar event jika muncul di hasil pencarian (https://...). null jika tidak ada",\n`
      : "";

  const eventTaskHint =
    input.category === "event"
      ? `\n\nKHUSUS EVENT: Ekstrak data terstruktur (tanggal mulai, tanggal selesai, lokasi venue, dan URL gambar) dari hasil pencarian. Paragraphs cukup ringkas — fokus pada deskripsi acara, tidak perlu daftar tips menginap panjang. Jika tidak yakin tanggal/lokasi, isi null daripada mengarang.\n`
      : "";

  const userMsg =
    `Tulis artikel SEO tentang: "${input.topic}"\n\n` +
    `Kategori: ${input.category}\n` +
    `Fokus konten: ${focus}\n\n` +
    `Panduan struktur: ${structureHint}${eventTaskHint}\n` +
    `Target panjang: ~${wordTarget} kata.\n\n` +
    `Konteks dari pencarian web:\n${searchContext}\n\n` +
    `Selipkan halus rujukan ke Pomah Guesthouse sebagai pilihan akomodasi di Semarang (TIDAK boleh berlebihan). ` +
    `Gunakan informasi dari hasil pencarian sebagai dasar fakta — jangan mengarang nama tempat/tanggal yang tidak ada.\n\n` +
    `Kembalikan HANYA JSON dengan field:\n` +
    `{\n` +
    `  "title": "judul artikel, max 80 char, mengandung topik utama",\n` +
    `  "meta_description": "120-160 char, menarik untuk di-klik dari hasil Google",\n` +
    `  "paragraphs": ["paragraf 1", "paragraf 2", ...],  // 4-8 item, boleh berisi tag <h2>, <ul>, <li>, <strong>\n` +
    `  "tags": ["tag1", "tag2", "tag3"],                  // 3-6 keyword relevan\n` +
    eventFields +
    `}`;

  const llmCtrl = new AbortController();
  const llmTo = setTimeout(() => llmCtrl.abort(), LLM_TIMEOUT_MS);
  let raw = "";
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
    raw = j.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(llmTo);
  }

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: {
    title?: string;
    meta_description?: string;
    paragraphs?: string[];
    tags?: string[];
    event_start_date?: string | null;
    event_end_date?: string | null;
    event_location?: string | null;
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

  let eventStart: string | null = null;
  let eventEnd: string | null = null;
  let eventLoc: string | null = null;
  let imageUrl: string | null = null;
  if (input.category === "event") {
    eventStart = isoDate(parsed.event_start_date);
    eventEnd = isoDate(parsed.event_end_date) ?? eventStart;
    eventLoc = parsed.event_location ? String(parsed.event_location).slice(0, 300) : null;
    imageUrl = httpUrl(parsed.image_url) ?? FALLBACK_IMAGES.event;
  } else {
    imageUrl = httpUrl(parsed.image_url) ?? FALLBACK_IMAGES[input.category];
  }

  return {
    article: {
      title: (parsed.title ?? input.topic).toString().slice(0, 200),
      meta_description: (parsed.meta_description ?? "").toString().slice(0, 200),
      paragraphs,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)).slice(0, 8) : [],
      category: input.category,
      event_start_date: eventStart,
      event_end_date: eventEnd,
      event_location: eventLoc,
      image_url: imageUrl,
    },
    web_sources: snippets.map((s) => ({ title: s.title, url: s.url })),
    search_provider: provider,
  };
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

    // Optionally persist to seo_generated_articles
    if (data.persist !== false) {
      try {
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
      } catch (e) {
        console.warn("[article-gen] persist failed (migration belum jalan?):", e);
      }
    }
    return result;
  });
