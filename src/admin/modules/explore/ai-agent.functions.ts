import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import Parser from "rss-parser";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegrationSettings } from "../settings/settings.functions";
import { ExploreConfig } from "./explore.config";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export const syncExploreFromAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // 1. Get Gemini API Key
    const settings = await getIntegrationSettings();
    const apiKey = settings.gemini_api_key;
    if (!apiKey) {
      throw new Error("Gemini API Key belum diatur di menu Integrasi.");
    }

    // 2. Fetch RSS Feeds
    const parser = new Parser();
    let feedItems: any[] = [];
    try {
      const feed = await parser.parseURL("https://www.detik.com/jateng/rss");
      feedItems = feed.items.slice(0, 20); // Top 20 latest news
    } catch (e) {
      console.error("Gagal menarik RSS Feed:", e);
      throw new Error("Gagal menarik sumber berita (RSS).");
    }

    // Prepare text for AI
    const rssText = feedItems
      .map((i, idx) => `[${idx}] Title: ${i.title}\nLink: ${i.link}\nDate: ${i.pubDate}\nDesc: ${i.contentSnippet}\nImage: ${i.enclosure?.url || ""}`)
      .join("\n\n");

    // 3. Initialize Google Gemini
    const google = createGoogleGenerativeAI({
      apiKey,
    });
    const model = google("models/gemini-2.5-flash");

    // 4. Generate Object with AI
    const prompt = `
Anda adalah asisten AI untuk website hotel di Semarang.
Saya punya daftar 20 berita terbaru dari portal berita Jawa Tengah. 
Tugas Anda adalah:
1. Cari maksimal 3-5 berita positif yang berkaitan dengan pariwisata, gaya hidup, kuliner, event, atau perkembangan kota Semarang.
2. JANGAN masukkan berita kecelakaan, kriminalitas, politik, atau berita negatif lainnya.
3. Ubah formatnya menjadi array berita (news). Jika ada berita tentang event/acara spesifik yang akan datang, masukkan ke array events.
4. Gunakan bahasa Indonesia yang menarik.

Berikut daftar beritanya:
${rssText}
`;

    const { object } = await generateObject({
      model,
      schema: z.object({
        news: z.array(z.object({
          title: z.string(),
          date: z.string().describe("Tanggal rilis berita, format: DD MMM YYYY (misal: 25 Mei 2026)"),
          desc: z.string().describe("Ringkasan berita singkat 1-2 kalimat"),
          image: z.string().url().describe("URL gambar dari feed, harus URL valid"),
          label: z.string().describe("Label kategori, misal: BERITA LOKAL, PARIWISATA, dsb."),
        })),
        events: z.array(z.object({
          title: z.string(),
          date: z.string().describe("Tanggal pelaksanaan acara, format: DD MMM YYYY (misal: 25 Mei 2026)"),
          location: z.string().describe("Lokasi acara"),
          desc: z.string().describe("Deskripsi singkat acara"),
          image: z.string().url().describe("URL gambar acara (gunakan gambar berita jika ada)"),
          label: z.string().describe("Label kategori, misal: KONSER, PAMERAN, dsb."),
        })),
      }),
      prompt,
    });

    // 5. Update Database
    // First, fetch current config
    const { data: propData } = await db(context.supabase)
      .from("properties")
      .select("id, explore_config")
      .limit(1)
      .maybeSingle();

    if (!propData?.id) {
      throw new Error("Properti tidak ditemukan.");
    }

    const currentConfig = (propData.explore_config || {}) as ExploreConfig;
    
    // Auto-remove old events: parse date if possible, but for simplicity, 
    // the AI can just replace the old arrays, or we prepend/replace.
    // The user requested: "event yang sudah selesai dihapus dan diganti event yang baru secara otomatis"
    // Since parsing arbitrary DD MMM YYYY can be tricky, let's just completely replace the news and events 
    // with the latest ones from AI, ensuring it's always fresh!
    // Or we keep old events if they are still relevant. We can just pass the existing events to AI and ask it to filter.
    // But replacing is safer and matches "diganti event yang baru secara otomatis".
    
    const newConfig: ExploreConfig = {
      ...currentConfig,
      // Jika AI menemukan event baru, kita tambahkan/timpa. 
      // Untuk news, karena diupdate tiap 2 hari, kita bisa replace langsung dengan hasil AI terbaru.
      news: object.news.length > 0 ? object.news : (currentConfig.news || []),
      events: object.events.length > 0 ? object.events : (currentConfig.events || []),
    };

    const { error } = await db(context.supabase)
      .from("properties")
      .update({ explore_config: newConfig as any })
      .eq("id", propData.id);

    if (error) {
      throw error;
    }

    return { 
      success: true, 
      message: "Berhasil menarik berita dan event dari AI.",
      data: object 
    };
  });
