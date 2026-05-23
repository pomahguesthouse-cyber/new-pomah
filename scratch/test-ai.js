import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import Parser from "rss-parser";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const parser = new Parser();
  const feed = await parser.parseURL("https://www.detik.com/jateng/rss");
  const feedItems = feed.items.slice(0, 20);
  console.log("Found", feedItems.length, "items in RSS");

  const rssText = feedItems
    .map((i, idx) => `[${idx}] Title: ${i.title}\nLink: ${i.link}\nDate: ${i.pubDate}\nDesc: ${i.contentSnippet}\nImage: ${i.enclosure?.url || ""}`)
    .join("\n\n");

  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = google("models/gemini-2.5-flash");

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
        date: z.string(),
        desc: z.string(),
        image: z.string().url(),
        label: z.string(),
      })),
      events: z.array(z.object({
        title: z.string(),
        date: z.string(),
        location: z.string(),
        desc: z.string(),
        image: z.string().url(),
        label: z.string(),
      })),
    }),
    prompt,
  });

  console.log("AI Result:", JSON.stringify(object, null, 2));
}

run().catch(console.error);
