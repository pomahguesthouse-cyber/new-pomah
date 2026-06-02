/**
 * Tool: reply_to_guest (Manager Agent)
 *
 * Lets a manager (typically via the Telegram bot) send a custom WhatsApp
 * reply to a guest thread without leaving the chat. The message is sent
 * via Fonnte and logged into whatsapp_messages so it shows up in the
 * admin inbox with the rest of the conversation.
 *
 * Guardrails:
 *   - The Manager Agent only runs when isManager=true (already gated
 *     upstream), so this tool inherits that auth.
 *   - We refuse to send if the guest's phone has no existing thread —
 *     prevents accidental cold messages.
 *   - Returns the saved message id so the agent can confirm to the
 *     manager.
 */

import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  return p;
}

export const replyToGuest: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // Hard gate: tool only available in managerial channels. Defends against
  // a guest social-engineering an agent into "kirim pesan ke teman saya"
  // from a normal WA conversation. Mirrors the guard on update_room_rate.
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error:
        "Hanya manajer/super admin yang boleh mengirim pesan ke nomor WhatsApp tamu. " +
        "Tool ini hanya tersedia di kanal internal (Telegram bot Manager / Customer Care / " +
        "agent lain, atau nomor WhatsApp manajer terdaftar).",
    });
  }

  const phoneRaw = str(args.guest_phone);
  const message  = str(args.message);
  if (!phoneRaw || !message) {
    return JSON.stringify({ ok: false, error: "guest_phone dan message wajib diisi." });
  }
  const phone = normalizePhone(phoneRaw);

  // Look up the thread first — refuse cold messages.
  const { data: thread } = await (ctx.supabaseAdmin as any)
    .from("whatsapp_threads")
    .select("id, display_name")
    .eq("phone", phone)
    .maybeSingle();
  if (!thread?.id) {
    return JSON.stringify({
      ok: false,
      error: `Tidak ada thread WhatsApp untuk nomor ${phone}. Tamu harus inisiasi chat dulu.`,
    });
  }

  // Resolve Fonnte token.
  const { data: prop } = await (ctx.supabaseAdmin as any)
    .from("properties")
    .select("fonnte_token")
    .limit(1)
    .maybeSingle();
  const token = (prop?.fonnte_token as string | null) ?? null;
  if (!token) {
    return JSON.stringify({ ok: false, error: "Fonnte token belum dikonfigurasi." });
  }

  const sendRes = await sendWhatsAppMessage(token, phone, message);
  if (!sendRes.ok) {
    return JSON.stringify({ ok: false, error: `Gagal kirim WA: ${sendRes.error ?? "unknown"}` });
  }

  // Log to whatsapp_messages so it appears in the inbox transcript.
  const { data: inserted } = await (ctx.supabaseAdmin as any)
    .from("whatsapp_messages")
    .insert({
      thread_id: thread.id,
      direction: "out",
      body:      message,
      metadata:  { agent: "Manager Agent", via: "manager_relay", is_manual: true },
    })
    .select("id")
    .single();
  await (ctx.supabaseAdmin as any)
    .from("whatsapp_threads")
    .update({
      last_message_preview: message.slice(0, 100),
      last_message_at: new Date().toISOString(),
    })
    .eq("id", thread.id);

  return JSON.stringify({
    ok: true,
    thread_id: thread.id,
    message_id: inserted?.id ?? null,
    sent_to: phone,
    guest_name: thread.display_name ?? null,
  });
};
