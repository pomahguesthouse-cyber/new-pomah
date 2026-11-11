/**
 * Kirim ulang brosur PDF ke nomor tamu, hanya dari kanal manajer
 * setelah konfirmasi eksplisit. Tidak pernah mengirim ke nomor manajer
 * sendiri kecuali nomor tujuan berbeda dan sudah dikonfirmasi.
 */

import { normalizePhone } from "@/services/wa-autoreply/identity";
import { maskPhone, roleCanUseTool, unauthorizedToolMessage } from "@/services/manager-chat/rbac";
import type { ToolContext, ToolHandler } from "../types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const sendBrochureToGuest: ToolHandler = async (args, ctx): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({ ok: false, error: "Hanya staf terdaftar yang boleh mengirim brosur ke tamu." });
  }
  if (!roleCanUseTool(ctx.managerRole, "send_brochure_to_guest")) {
    return JSON.stringify({ ok: false, error: unauthorizedToolMessage(ctx.managerRole, "send_brochure_to_guest") });
  }

  const guestPhone = normalizePhone(str(args.guest_phone));
  if (!guestPhone || guestPhone.length < 8) {
    return JSON.stringify({ ok: false, error: "Nomor WhatsApp tamu wajib diisi." });
  }

  const managerPhone = ctx.phone ? normalizePhone(ctx.phone) : "";
  if (managerPhone && guestPhone === managerPhone) {
    return JSON.stringify({
      ok: false,
      error: "Nomor tujuan sama dengan nomor manajer. Sebutkan nomor tamu yang benar.",
    });
  }

  if (args.confirmed !== true) {
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "send_brochure_to_guest",
      target: { guest_phone_masked: maskPhone(guestPhone) },
      error: `Konfirmasi kirim brosur ke ${maskPhone(guestPhone)}. Balas YA atau KONFIRMASI, atau panggil ulang dengan confirmed=true.`,
    });
  }

  if (ctx.isSimulator) {
    return JSON.stringify({
      ok: true,
      simulated: true,
      guest_phone_masked: maskPhone(guestPhone),
      message: "Simulator: brosur tidak dikirim ke WhatsApp sungguhan.",
    });
  }

  try {
    const { loadPublicBrochure } = await import("@/services/wa-autoreply/brochure-loader");
    const file = await loadPublicBrochure();
    if (!file?.url) {
      return JSON.stringify({ ok: false, error: "File brosur tidak ditemukan." });
    }
    const { sendGuestWhatsApp } = await import("@/services/guest-whatsapp.service");
    const caption = "Brosur Pomah Guesthouse";
    const result = await sendGuestWhatsApp(guestPhone, caption, {
      fileUrl: file.url,
      filename: file.name || "brosur-pomah.pdf",
    });
    if (!result?.ok) {
      return JSON.stringify({
        ok: false,
        error: result?.error ?? "Gagal mengirim brosur ke tamu.",
      });
    }
    return JSON.stringify({
      ok: true,
      guest_phone_masked: maskPhone(guestPhone),
      message: `Brosur sudah dikirim ke ${maskPhone(guestPhone)}.`,
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
