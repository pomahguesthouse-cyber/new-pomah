/**
 * Tool: send_room_photos
 *
 * Kirim foto kamar via WhatsApp (Evolution API) langsung ke tamu yang sedang
 * chat. Dipakai ketika tamu minta "foto", "gambar", atau "penampakan" kamar.
 *
 * Best-effort — kegagalan pengiriman satu foto tidak menghentikan sisanya.
 * Tool tidak berjalan di simulator (isSimulator=true) atau ketika phone/token
 * tidak tersedia; dalam kasus itu ia mengembalikan status yang jelas supaya
 * LLM bisa fallback ke pesan teks (mis. arahkan tamu ke website).
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

function pickImages(room: ToolContext["rooms"][number], max: number): string[] {
  const list: string[] = [];
  if (room.hero_image_url) list.push(String(room.hero_image_url));
  for (const u of room.images ?? []) {
    if (typeof u === "string" && u && !list.includes(u)) list.push(u);
  }
  return list.slice(0, Math.max(1, max));
}

export const sendRoomPhotos: ToolHandler = async (args, ctx): Promise<string> => {
  const roomTypeArg = typeof args.room_type === "string" ? args.room_type.trim() : "";
  const maxRaw = Number(args.max_photos ?? 3);
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(5, Math.floor(maxRaw)) : 3;

  const targets = roomTypeArg
    ? [resolveRoom(roomTypeArg, ctx.rooms)].filter(Boolean) as ToolContext["rooms"]
    : ctx.rooms;

  if (roomTypeArg && targets.length === 0) {
    return JSON.stringify({ ok: false, error: `Tipe kamar '${roomTypeArg}' tidak dikenali.` });
  }

  const phone = ctx.phone?.trim();
  const token = (ctx.property as { wpp_token?: string })?.wpp_token?.trim();

  if (ctx.isSimulator) {
    return JSON.stringify({
      ok: true,
      simulated: true,
      note: "Simulator: foto tidak benar-benar dikirim.",
      rooms: targets.map((r) => ({ name: r.name, photos: pickImages(r, max) })),
    });
  }
  if (!phone || !token) {
    return JSON.stringify({
      ok: false,
      error:
        "Tidak bisa mengirim foto sekarang (kredensial WhatsApp belum lengkap). " +
        "Arahkan tamu ke pomahguesthouse.com untuk galeri lengkap.",
    });
  }

  const results: Array<{ room: string; sent: number; failed: number }> = [];
  for (const room of targets) {
    const photos = pickImages(room, max);
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < photos.length; i++) {
      const caption = i === 0 ? `Foto kamar *${room.name}* 📸` : "";
      const filename = `${room.name.replace(/\s+/g, "_")}_${i + 1}.jpg`;
      try {
        const r = await sendWhatsAppMessage(token, phone, caption, photos[i], filename);
        if (r.ok) sent++;
        else {
          failed++;
          console.error("❌ sendMedia failed", room.name, r.status ?? "-", r.error);
        }
      } catch (e) {
        failed++;
        console.error("❌ sendMedia exception", room.name, e instanceof Error ? e.message : String(e));
      }
    }
    results.push({ room: room.name, sent, failed });
  }

  const totalSent = results.reduce((n, r) => n + r.sent, 0);
  return JSON.stringify({
    ok: totalSent > 0,
    total_sent: totalSent,
    results,
    note:
      totalSent > 0
        ? "BERHASIL: foto sudah terkirim ke chat tamu. JANGAN kirim permintaan maaf, " +
          "pesan 'kendala teknis', atau fallback ke website. Cukup tutup dengan CTA singkat, " +
          "mis. tanyakan tanggal menginap atau tawarkan booking."
        : "Semua percobaan kirim foto gagal; sampaikan kendala teknis singkat dan arahkan tamu ke pomahguesthouse.com.",
  });
};

