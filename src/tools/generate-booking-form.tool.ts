/**
 * Tool: generate_booking_form
 *
 * Membuat token form booking sekali pakai dan mengembalikan URL yang bisa
 * dikirim ke tamu via WhatsApp. Form ini memindahkan slot-filling (data
 * pemesan, jumlah extra bed, catatan) ke halaman web sehingga chatbot tidak
 * perlu menanyakan satu per satu di chat.
 *
 * Pemanggil (LLM front-office agent) WAJIB mengirim URL ini ke tamu sebagai
 * balasan chat berikutnya, beserta penjelasan singkat. Tool mengembalikan
 * `suggested_reply` siap pakai yang sudah memuat URL dan instruksinya.
 */

import { createBookingFormToken } from "@/services/booking-form.service";
import type { ToolContext, ToolHandler } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function resolveBaseUrl(ctx: ToolContext): string {
  const domain = (ctx.property as { public_domain?: string } | undefined)?.public_domain;
  const base = domain
    ? domain.startsWith("http") ? domain : `https://${domain}`
    : ctx.origin ?? "https://pomahguesthouse.com";
  return base.replace(/\/+$/, "");
}

export const generateBookingForm: ToolHandler = async (args, ctx) => {
  if (!ctx.phone) {
    return JSON.stringify({ ok: false, error: "Nomor kontak tamu tidak tersedia." });
  }

  // Feature flag per properti — admin dapat mematikan tanpa redeploy.
  const enabled = (ctx.property as { booking_form_enabled?: boolean })?.booking_form_enabled;
  if (!enabled) {
    return JSON.stringify({
      ok: false,
      error: "Fitur form booking belum diaktifkan untuk properti ini. Lanjutkan slot-filling via chat seperti biasa.",
    });
  }

  const roomTypeName = str(args.room_type) || str(args.room_type_name);
  const checkIn = str(args.check_in);
  const checkOut = str(args.check_out);
  const guestCount = Number(args.guest_count ?? args.adults);
  const roomsCount = Number(args.rooms ?? args.room_count);

  // Cari roomTypeId dari katalog bila nama kamar disebut, supaya form
  // pre-select kamar yang sudah disepakati di chat.
  let roomTypeId: string | null = null;
  let resolvedRoomName: string | null = null;
  if (roomTypeName) {
    const lower = roomTypeName.toLowerCase();
    const match =
      ctx.rooms.find((r) => r.name.toLowerCase() === lower) ??
      ctx.rooms.find((r) => r.name.toLowerCase().includes(lower) || lower.includes(r.name.toLowerCase()));
    if (match) {
      roomTypeId = match.id;
      resolvedRoomName = match.name;
    }
  }

  // Ambil thread_id agar pesan sintetis `[FORM_SUBMITTED:...]` (yang
  // di-enqueue saat tamu submit) dapat dikaitkan ke percakapan yang benar.
  let threadId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = ctx.supabaseAdmin as any;
    const { data } = await admin
      .from("whatsapp_threads")
      .select("id")
      .eq("phone", ctx.phone)
      .maybeSingle();
    threadId = (data?.id as string | undefined) ?? null;
  } catch {
    // Non-fatal — service akan fallback lookup-by-phone saat submit.
  }

  const propertyId = (ctx.property as { id?: string } | undefined)?.id ?? null;

  let token: string;
  let url: string;
  let expiresAt: string;
  try {
    const result = await createBookingFormToken({
      supabaseAdmin: ctx.supabaseAdmin,
      phone: ctx.phone,
      threadId,
      propertyId,
      prefill: {
        roomTypeId,
        roomTypeName: resolvedRoomName ?? (roomTypeName || null),
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        guestCount: Number.isFinite(guestCount) && guestCount > 0 ? guestCount : null,
        rooms: Number.isFinite(roomsCount) && roomsCount > 0 ? roomsCount : null,
      },
      baseUrl: resolveBaseUrl(ctx),
    });
    token = result.token;
    url = result.url;
    expiresAt = result.expiresAt;
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : "Gagal membuat form booking.",
    });
  }

  // Susun teks balasan dengan nada Pomah: hangat, ringkas, profesional,
  // sentence case. Sertakan ringkasan kamar/tanggal bila tersedia agar tamu
  // tahu form sudah pre-filled sesuai obrolan sebelumnya.
  const propertyName =
    (ctx.property as { name?: string } | undefined)?.name ?? "Pomah Guesthouse";

  const contextLines: string[] = [];
  if (resolvedRoomName) contextLines.push(`• Kamar: ${resolvedRoomName}`);
  if (checkIn && checkOut) contextLines.push(`• Tanggal: ${checkIn} → ${checkOut}`);
  else if (checkIn) contextLines.push(`• Check-in: ${checkIn}`);
  const contextBlock = contextLines.length ? `\n${contextLines.join("\n")}\n` : "";

  // Hitung sisa berlaku dalam menit untuk kalimat yang lebih natural.
  const ttlMinutes = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
  );

  const suggestedReply =
    `Halo Kak 🙏 Supaya prosesnya lebih cepat, silakan lengkapi data pemesanan di formulir singkat ${propertyName} berikut:` +
    `\n\n${url}\n` +
    contextBlock +
    `\nIsi nama, email (opsional), jumlah tamu, extra bed, dan catatan—form sudah saya siapkan sesuai obrolan kita. ` +
    `Tautan berlaku ${ttlMinutes} menit.\n\n` +
    `Begitu Kakak kirim, saya akan langsung balas ringkasan booking dan invoice di chat ini ya. Terima kasih! 🏡✨`;

  return JSON.stringify({
    ok: true,
    token,
    url,
    expires_at: expiresAt,
    ttl_minutes: ttlMinutes,
    suggested_reply: suggestedReply,
    instruction_to_agent:
      "Kirim teks `suggested_reply` ini VERBATIM sebagai balasan ke tamu (jangan ubah URL, jangan tambah basa-basi lain). " +
      "Setelah ini, JANGAN menanyakan nama/email/extra bed/catatan lagi di chat — tunggu webhook submit form.",
  });
};
