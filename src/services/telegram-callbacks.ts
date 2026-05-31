/**
 * Telegram callback_query dispatcher.
 *
 * Routes inline-keyboard button presses into concrete actions. Callback
 * data must fit in 64 bytes (Telegram limit), so we use compact colon
 * delimited prefixes:
 *
 *   mark_paid:PMH-XXXXXX     → mark booking as paid + notify the chat
 *   reject_proof:PMH-XXXXXX  → leave payment_status as unpaid, log it
 *   noop                     → swallow the tap (placeholder buttons)
 *
 * Auth is already enforced by the caller (telegram-router resolves the
 * manager before dispatching). We just need to perform the action and
 * close the callback with a toast.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
} from "./telegram.service";

interface DispatchArgs {
  action:   string;
  args:     string[];
  callback: any;
  manager:  { id: string; name: string; role: string };
  botToken: string;
  chatId:   string;
}

export async function dispatchCallback(d: DispatchArgs): Promise<void> {
  switch (d.action) {
    case "mark_paid":
      return markPaid(d);
    case "reject_proof":
      return rejectProof(d);
    case "noop":
      await answerCallbackQuery(d.botToken, d.callback.id);
      return;
    default:
      await answerCallbackQuery(d.botToken, d.callback.id, "Aksi tidak dikenal.", true);
  }
}

async function markPaid(d: DispatchArgs): Promise<void> {
  const refCode = d.args[0] ?? "";
  if (!refCode) {
    await answerCallbackQuery(d.botToken, d.callback.id, "Kode booking kosong.", true);
    return;
  }

  const { data: booking } = await (supabaseAdmin as any)
    .from("bookings")
    .select("id, reference_code")
    .ilike("reference_code", refCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!booking) {
    await answerCallbackQuery(d.botToken, d.callback.id, `Booking ${refCode} tidak ditemukan.`, true);
    return;
  }

  const nowIso = new Date().toISOString();
  await (supabaseAdmin as any)
    .from("bookings")
    .update({ payment_status: "paid" })
    .eq("id", booking.id);
  await (supabaseAdmin as any)
    .from("invoices")
    .update({ payment_status_snapshot: "paid", regenerated_at: nowIso })
    .eq("booking_id", booking.id);

  await answerCallbackQuery(d.botToken, d.callback.id, "✅ Ditandai LUNAS");
  const oldText = d.callback.message?.caption ?? d.callback.message?.text ?? "";
  if (d.callback.message?.message_id) {
    await editMessageText(
      d.botToken,
      d.chatId,
      d.callback.message.message_id,
      `${oldText}\n\n— ✅ Ditandai LUNAS oleh ${d.manager.name}`,
    );
  } else {
    await sendMessage(d.botToken, d.chatId, `✅ Booking ${refCode} ditandai LUNAS oleh ${d.manager.name}.`);
  }
}

async function rejectProof(d: DispatchArgs): Promise<void> {
  const refCode = d.args[0] ?? "(unknown)";
  await answerCallbackQuery(d.botToken, d.callback.id, "Ditolak — status tetap unpaid.");
  if (d.callback.message?.message_id) {
    const oldText = d.callback.message?.caption ?? d.callback.message?.text ?? "";
    await editMessageText(
      d.botToken,
      d.chatId,
      d.callback.message.message_id,
      `${oldText}\n\n— ❌ Bukti ditolak oleh ${d.manager.name}. Status tetap UNPAID.`,
    );
  } else {
    await sendMessage(d.botToken, d.chatId,
      `❌ Bukti transfer untuk ${refCode} ditolak oleh ${d.manager.name}. Status tetap UNPAID.`);
  }
}
