import { createClient } from "@supabase/supabase-js";
import Parser from "rss-parser";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import fs from "fs";
import path from "path";

// Parse .env manually
const envPath = path.resolve(".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching Gemini API key from database...");
  const { data: prop, error } = await supabase
    .from("properties")
    .select("explore_config")
    .limit(1)
    .single();

  if (error) {
    console.error("❌ Error fetching properties:", error.message);
    return;
  }

  const apiKey = prop.explore_config?.gemini_api_key;
  if (!apiKey) {
    console.error("❌ Gemini API key not found in database.");
    return;
  }
  console.log("✅ Gemini API Key found!");

  const parser = new Parser();
  let feedItems = [];

  console.log("\nFetching Detik Jateng RSS...");
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
    console.log(`- Retrieved ${items.length} items from Detik.`);
  } catch (e) {
    console.error("Failed to parse Detik:", e.message);
  }

  console.log("Fetching Antara Jateng RSS...");
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
    console.log(`- Retrieved ${items.length} items from Antara.`);
  } catch (e) {
    console.error("Failed to parse Antara:", e.message);
  }

  if (feedItems.length === 0) {
    console.error("❌ No feed items retrieved.");
    return;
  }

  const rssText = feedItems
    .map((i, idx) => `[${idx}] Source: ${i.source}\nTitle: ${i.title}\nLink: ${i.link}\nDate: ${i.pubDate || ""}\nDesc: ${i.contentSnippet || ""}`)
    .join("\n\n");

  console.log("\nInitializing Google Gemini AI...");
  const google = createGoogleGenerativeAI({ apiKey });
  const model = google("models/gemini-2.5-flash");

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
     * "Eksplorasi Sejarah Kota Lama" (Lokasi: Kota Lama Semarang, Tanggal: Setiap Akhir Pekan, Kategori: WISATA)
     * "Wisata Kuliner Malam Pasar Semawis" (Lokasi: Pecinan Semarang, Tanggal: Jumat - Minggu Malam, Kategori: KULINER)
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

  console.log("Generating object with Gemini...");
  try {
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

    console.log("\n✅ AI Generation successful!");
    console.log("\n=== AI News ===");
    console.log(JSON.stringify(object.news, null, 2));

    console.log("\n=== AI Events ===");
    console.log(JSON.stringify(object.events, null, 2));
  } catch (err) {
    console.error("❌ AI Generation failed:", err.message);
  }
}

main();
