/**
 * Tool: send_room_tour
 *
 * Kirim link Virtual Tour 360° kamar ke chat WhatsApp tamu. Dipakai saat
 * tamu bertanya "detail kamar", "seperti apa kamarnya", minta "tour",
 * "tur 360", "virtual tour", atau ingin lihat kondisi kamar lebih jelas.
 *
 * Tool ini mencari walkthrough_tours yang sudah dipublish untuk room type
 * tertentu (atau seluruh room type yang punya tour bila room_type kosong)
 * lalu mengirim link https://<origin>/tour/<slug> ke nomor tamu.
 */

import type { ToolContext, ToolHandler } from "./types";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function resolveRoom(input: string, rooms: ToolContext["rooms"]) {
  const q = normalizeName(input);
  if (!q) return null;
  const exact = rooms.find((r) => normalizeName(r.name) === q);
  if (exact) return exact;
  const contains = [...rooms]
    .sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length)
    .find((r) => {
      const n = normalizeName(r.name);
      return n.length >= 3 && q.includes(n);
    });
  if (contains) return contains;
  const alias = rooms.filter((r) =>
    normalizeName(r.name).split(" ").filter(Boolean).includes(q),
  );
  return alias.length === 1 ? alias[0] : null;
}

function baseOrigin(ctx: ToolContext): string {
  const o = ctx.origin?.trim();
  if (o) return o.replace(/\/+$/, "");
  return "https://pomahguesthouse.com";
}

type TourRow = {
  slug: string | null;
  title: string | null;
  room_type_id: string;
  room_types: { name: string | null; slug: string | null } | null;
};

async function loadPublishedTours(
  ctx: ToolContext,
  roomTypeId?: string,
): Promise<TourRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (ctx.supabasePublic as any)
    .from("walkthrough_tours")
    .select("slug, title, room_type_id, room_types!inner(name, slug)")
    .eq("is_published", true);
  if (roomTypeId) q = q.eq("room_type_id", roomTypeId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as TourRow[];
}

export const sendRoomTour: ToolHandler = async (args, ctx): Promise<string> => {
  const roomTypeArg = typeof args.room_type === "string" ? args.room_type.trim() : "";
  const origin = baseOrigin(ctx);

  const targetRoom = roomTypeArg ? resolveRoom(roomTypeArg, ctx.rooms) : null;
  if (roomTypeArg && !targetRoom) {
    return JSON.stringify({ ok: false, error: `Tipe kamar '${roomTypeArg}' tidak dikenali.` });
  }

  const tours = await loadPublishedTours(ctx, targetRoom?.id);
  if (tours.length === 0) {
    return JSON.stringify({
      ok: false,
      error: targetRoom
        ? `Virtual tour untuk kamar '${targetRoom.name}' belum tersedia.`
        : "Belum ada virtual tour yang dipublish.",
      fallback_url: `${origin}/rooms`,
    });
  }

  // Bangun daftar link (slug tour → fallback slug room_type)
  const links = tours.map((t) => {
    const slug = (t.slug || t.room_types?.slug || "").trim();
    const name = t.room_types?.name ?? t.title ?? "Kamar";
    return {
      name,
      url: slug ? `${origin}/tour/${slug}` : `${origin}/rooms`,
    };
  });

  // Susun pesan WA
  const body =
    links.length === 1
      ? `Silakan Kak, ini Virtual Tour 360° kamar *${links[0].name}* — bisa dilihat langsung dari HP:\n${links[0].url} 🏠`
      : `Silakan Kak, ini Virtual Tour 360° kamar Pomah Guesthouse — tinggal klik dari HP:\n\n${links
          .map((l) => `• *${l.name}*\n${l.url}`)
          .join("\n\n")} 🏠`;

  // Simulator / kredensial tidak lengkap → balikan link saja, biar LLM tetap
  // bisa menampilkan ke user (di simulator, ke transcript).
  if (ctx.isSimulator) {
    return JSON.stringify({
      ok: true,
      simulated: true,
      note: "Simulator: link tour tidak benar-benar dikirim ke WhatsApp.",
      body,
      links,
    });
  }

  const phone = ctx.phone?.trim();
  const token = (ctx.property as { wpp_token?: string })?.wpp_token?.trim();
  if (!phone || !token) {
    return JSON.stringify({
      ok: false,
      error:
        "Tidak bisa mengirim tour sekarang (kredensial WhatsApp belum lengkap). " +
        "Bagikan link ini ke tamu secara manual.",
      body,
      links,
    });
  }

  try {
    const r = await sendWhatsAppMessage(token, phone, body);
    if (!r.ok) {
      return JSON.stringify({
        ok: false,
        error: "Gagal mengirim link tour ke WhatsApp.",
        body,
        links,
      });
    }
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      body,
      links,
    });
  }

  return JSON.stringify({
    ok: true,
    total_sent: links.length,
    links,
    note:
      "Link Virtual Tour 360° sudah terkirim ke chat tamu. Tutup dengan CTA singkat, " +
      "mis. tanyakan tanggal menginap atau tawarkan booking.",
  });
};
