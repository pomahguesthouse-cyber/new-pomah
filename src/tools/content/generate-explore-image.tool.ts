/**
 * Tool: generate_explore_image
 *
 * Generate gambar ilustrasi untuk satu entri City Guide (explore_items)
 * memakai Lovable AI Gateway (model image), lalu upload ke bucket
 * "room-images" di folder "explore/" dan simpan public URL ke kolom
 * image_url entri tersebut.
 *
 * Dipakai oleh Content Manager Agent setelah `upsert_explore_item` jika
 * entri belum punya image_url, atau saat manajer minta "buatkan gambar
 * untuk event X".
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

const BUCKET = "room-images";
const FOLDER = "explore";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function buildPrompt(item: {
  title: string;
  category: string;
  description: string | null;
  location_text: string | null;
}): string {
  const parts: string[] = [];
  parts.push(
    `Editorial travel magazine photograph, cinematic, warm natural lighting, no text, no logo, no people facing camera.`,
  );
  parts.push(`Subjek utama: "${item.title}".`);
  if (item.category === "event") {
    parts.push(
      `Suasana acara/festival meriah di Semarang, Jawa Tengah, Indonesia.`,
    );
  } else if (item.category === "destinasi") {
    parts.push(`Destinasi wisata ikonik di Semarang, Jawa Tengah, Indonesia.`);
  } else if (item.category === "kuliner") {
    parts.push(
      `Sajian kuliner khas Semarang, plating estetik, food photography close-up.`,
    );
  } else {
    parts.push(`Suasana kota Semarang yang khas dan hangat.`);
  }
  if (item.location_text) parts.push(`Lokasi: ${item.location_text}.`);
  if (item.description) parts.push(`Konteks: ${item.description}`);
  parts.push(
    `Komposisi rule-of-thirds, depth-of-field, warna hangat & natural, cocok sebagai cover kartu travel guide. Rasio 3:2 landscape.`,
  );
  return parts.join(" ");
}

async function generateImageBase64(prompt: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY tidak tersedia di server.");

  const res = await fetch(
    "https://ai.gateway.lovable.dev/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
        // non-streaming JSON response for server-to-server use
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Respons gateway tidak memuat b64_json.");
  return b64;
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "event";
}

export const generateExploreImage: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh generate dan menyimpan gambar city guide.",
    });
  }

  const idArg = str(args.id);
  const titleArg = str(args.title);
  const overwrite = args.overwrite === true;

  // 1) Resolve target row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = ctx.supabaseAdmin as any;
  let row:
    | {
        id: string;
        title: string;
        category: string;
        description: string | null;
        location_text: string | null;
        image_url: string | null;
      }
    | null = null;

  try {
    if (idArg) {
      const { data, error } = await sb
        .from("explore_items")
        .select("id, title, category, description, location_text, image_url")
        .eq("id", idArg)
        .single();
      if (error) throw error;
      row = data;
    } else if (titleArg) {
      const { data, error } = await sb
        .from("explore_items")
        .select("id, title, category, description, location_text, image_url")
        .ilike("title", `%${titleArg}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      row = data;
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal cari entri: ${m}` });
  }

  if (!row) {
    return JSON.stringify({
      ok: false,
      error:
        "Entri tidak ditemukan. Pass id (dari list_explore_items) atau title yang persis.",
    });
  }

  if (row.image_url && !overwrite) {
    return JSON.stringify({
      ok: true,
      skipped: true,
      reason: "Entri sudah punya image_url. Pass overwrite=true untuk regenerasi.",
      item: { id: row.id, title: row.title, image_url: row.image_url },
    });
  }

  // 2) Generate image via Lovable AI Gateway
  let b64: string;
  try {
    b64 = await generateImageBase64(buildPrompt(row));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal generate gambar: ${m}` });
  }

  // 3) Upload to storage
  const bytes = b64ToBytes(b64);
  const path = `${FOLDER}/${slugify(row.title)}-${Date.now()}.png`;
  try {
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: "image/png",
        upsert: false,
      });
    if (upErr) throw upErr;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: `Gagal upload gambar: ${m}` });
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl: string = pub?.publicUrl ?? "";

  // 4) Persist to row
  try {
    const { error } = await sb
      .from("explore_items")
      .update({ image_url: publicUrl })
      .eq("id", row.id);
    if (error) throw error;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({
      ok: false,
      error: `Gambar terupload tapi gagal simpan ke entri: ${m}`,
      image_url: publicUrl,
    });
  }

  return JSON.stringify({
    ok: true,
    mode: row.image_url ? "regenerated" : "generated",
    item: { id: row.id, title: row.title, image_url: publicUrl },
  });
};
