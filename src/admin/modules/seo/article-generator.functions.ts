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

export const generateArticleFromWebSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        topic: z.string().min(3).max(300),
        category: z.enum(["pariwisata", "event", "destinasi"]),
        word_count_target: z.number().int().min(200).max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "LOVABLE_API_KEY belum di-set. Tambahkan di environment server agar fitur ini bisa memanggil AI.",
      );
    }

    // 1. Web search (best-effort) — load keys from DB first, env as fallback
    const dbKeys = await loadKeysFromDb(context.supabase as unknown as SupabaseClient);
    const { snippets, provider } = await webSearch(data.topic, dbKeys);
    const searchContext =
      snippets.length > 0
        ? snippets
            .map(
              (s, i) =>
                `[${i + 1}] ${s.title}\nURL: ${s.url}\nRingkasan: ${s.snippet}`,
            )
            .join("\n\n")
        : "(Tidak ada hasil pencarian web — jawab berdasarkan pengetahuan umum, sebutkan jika informasi mungkin perlu diverifikasi.)";

    const { focus, structureHint } = categoryPrompt(data.category);
    const wordTarget = data.word_count_target ?? 600;

    const systemMsg =
      "Anda adalah penulis konten SEO untuk Pomah Guesthouse, sebuah guesthouse di Gunungpati, Semarang. " +
      "Tulis dalam Bahasa Indonesia yang baik, informatif, dan ramah pembaca. " +
      "WAJIB respon JSON valid tanpa fence markdown.";

    const userMsg =
      `Tulis artikel SEO tentang: "${data.topic}"\n\n` +
      `Kategori: ${data.category}\n` +
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
      `  "paragraphs": [\"paragraf 1\", \"paragraf 2\", ...],  // 4-8 item, boleh berisi tag <h2>, <ul>, <li>, <strong>\n` +
      `  "tags": [\"tag1\", \"tag2\", \"tag3\"]                  // 3-6 keyword relevan\n` +
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

    let parsed: { title?: string; meta_description?: string; paragraphs?: string[]; tags?: string[] };
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
      article: {
        title: (parsed.title ?? data.topic).toString().slice(0, 200),
        meta_description: (parsed.meta_description ?? "").toString().slice(0, 200),
        paragraphs,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)).slice(0, 8) : [],
        category: data.category,
      },
      web_sources: snippets.map((s) => ({ title: s.title, url: s.url })),
      search_provider: provider,
    };
  });
