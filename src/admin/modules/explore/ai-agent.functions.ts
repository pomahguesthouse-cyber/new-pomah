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
    const { data: propData } = await db(context.supabase)
      .from("properties")
      .select("id, explore_config")
      .limit(1)
      .maybeSingle();

    if (!propData?.id) {
      throw new Error("Properti tidak ditemukan.");
    }
    const currentConfig = (propData.explore_config || {}) as ExploreConfig;

    const apiKey = currentConfig.gemini_api_key;
    if (!apiKey) {
      throw new Error("Gemini API Key belum diatur. Silakan atur di bagian atas halaman Jelajahi Semarang.");
    }
    const parser = new Parser();
    let feedItems: any[] = [];
    
    // Fetch from Detik Jateng
    try {
      const feedDetik = await parser.parseURL("https://www.detik.com/jateng/rss");
      const items = feedDetik.items.slice(0, 15).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        contentSnippet: item.contentSnippet,
        source: "Detik"
      }));
      feedItems.push(...items);
    } catch (e) {
      console.error("Gagal menarik RSS Feed Detik:", e);
    }

    // Fetch from Antara Jateng
    try {
      const feedAntara = await parser.parseURL("https://jateng.antaranews.com/rss/terkini.xml");
      const items = feedAntara.items.slice(0, 15).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        contentSnippet: item.contentSnippet,
        source: "Antara"
      }));
      feedItems.push(...items);
    } catch (e) {
      console.error("Gagal menarik RSS Feed Antara:", e);
    }

    if (feedItems.length === 0) {
      throw new Error("Gagal menarik sumber berita (RSS).");
    }

    // Prepare text for AI
    const rssText = feedItems
      .map((i, idx) => `[${idx}] Source: ${i.source}\nTitle: ${i.title}\nLink: ${i.link}\nDate: ${i.pubDate || ""}\nDesc: ${i.contentSnippet || ""}`)
      .join("\n\n");

    // 3. Initialize Google Gemini
    const google = createGoogleGenerativeAI({
      apiKey,
    });
    const model = google("models/gemini-2.5-flash");

    // 4. Generate Object with AI
    const prompt = `
Anda adalah asisten AI khusus pariwisata untuk website hotel "Pomah Guesthouse" di Semarang.
Saya memiliki daftar ${feedItems.length} berita terbaru dari portal berita Jawa Tengah.

Tugas Anda adalah memproses berita-berita tersebut untuk mengisi dua bagian website kami:

1. BERITA TERBARU (news) — Wajib mengembalikan 2-4 berita:
   - Cari berita positif/menarik seputar Kota Semarang (pariwisata, kuliner, event, perkembangan kota, infrastruktur, atau gaya hidup).
   - JANGAN masukkan berita negatif (kriminalitas, politik praktis, kecelakaan, bencana, dll.).
   - Jika tidak ada berita khusus Semarang, Anda boleh mengambil berita positif dari daerah sekitarnya di Jawa Tengah (seperti Solo, Magelang, Karimunjawa) yang relevan bagi turis.

2. ACARA MENDATANG (events) — Wajib mengembalikan minimal 3 events:
   - Cari berita yang mengumumkan acara, konser, festival, perayaan keagamaan (seperti kirab Waisak thudong, festival lampion, pameran seni, pertunjukan tradisonal) yang akan atau sedang berlangsung di Semarang atau Jawa Tengah.
   - PENTING: Jika tidak ada berita tentang event spesifik di Semarang pada daftar berita, Anda WAJIB memformulasikan rekomendasi kegiatan/event berkala atau aktivitas wisata menarik di Semarang berdasarkan berita kuliner/wisata yang ada, atau landmark populer (seperti Lawang Sewu, Kota Lama, Sam Poo Kong, Pasar Semawis). Contoh:
     * "Eksplorasi Sejarah Kota Lama" (Lokasi: Kawasan Kota Lama, Semarang, Tanggal: Setiap Akhir Pekan, Kategori: WISATA SEJARAH)
     * "Wisata Kuliner Malam Pasar Semawis" (Lokasi: Pecinan Semarang (Jalan Gang Warung), Tanggal: Jumat - Minggu Malam, Kategori: KULINER)
     * "Kirab Budaya Thudong Waisak" (Lokasi: Candi Borobudur / Magelang, Tanggal: Bulan Waisak ini, Kategori: BUDAYA)
   - Jadikan rekomendasi aktivitas ini sebagai item di array "events" agar bagian event website kami tidak kosong. Setiap event harus memiliki detail lokasi, deskripsi singkat, kategori label (misal: WISATA, KULINER, PAMERAN, BUDAYA), dan perkiraan tanggal pelaksanaan yang realistis.

3. GAMBAR & MEDIA:
   - Semua gambar ("image") berita atau event harus menggunakan URL gambar yang valid.
   - Jika berita tidak memiliki URL gambar yang valid atau tidak terdefinisi di RSS, Anda WAJIB menggunakan URL gambar pemandangan/landmark Semarang yang indah dari Unsplash berikut sebagai fallback (pilihlah yang paling cocok dengan konten):
     * Landmark Kota/Wisata: https://images.unsplash.com/photo-1571731956622-7a72726b909c?auto=format&fit=crop&w=800&q=80
     * Kuliner: https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=800&q=80
     * Suasana Kota Lama/Heritage: https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&w=800&q=80
     * Event/Konser/Budaya: https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80
   - JANGAN mengarang URL gambar fiktif atau menggunakan domain yang tidak valid.

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
          url: z.string().url().describe("URL asli berita dari feed RSS"),
          image: z.string().url().describe("URL gambar dari feed, harus URL valid"),
          label: z.string().describe("Label kategori, misal: BERITA LOKAL, PARIWISATA, dsb."),
        })),
        events: z.array(z.object({
          title: z.string(),
          date: z.string().describe("Tanggal pelaksanaan acara, format: DD/MM/YYYY atau 'Setiap Akhir Pekan' atau 'Tiap Hari'"),
          location: z.string().describe("Lokasi acara"),
          desc: z.string().describe("Deskripsi singkat acara"),
          image: z.string().url().describe("URL gambar acara (gunakan gambar berita atau unsplash fallback)"),
          label: z.string().describe("Label kategori, misal: KONSER, PAMERAN, WISATA dsb."),
        })),
      }),
      prompt,
    });

    // 5. Update Database
    
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
