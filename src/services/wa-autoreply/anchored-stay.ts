/**
 * Jangkarkan "chek-in nya tanggal 11 cek-out nya tgl 12" ke bulan stay di
 * slot, simpan sebagai checkout TERKONFIRMASI (checkoutAssumed=false), dan
 * perjelas pesan untuk jalur berikutnya (kasus Sofiah 8 Nov 2026).
 */
import { fmtDateID } from "@/lib/date";
import { resolveLabeledDaysAgainstKnownStay } from "@/lib/id-date";

export async function applyAnchoredStayFromSlots(params: {
  db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }> };
  phone: string;
  message: string;
  slots: Record<string, unknown>;
  today: string;
}): Promise<{ message: string; slots: Record<string, unknown> } | null> {
  const known = typeof params.slots.checkIn === "string" && params.slots.checkIn >= params.today ? params.slots.checkIn : null;
  const anchored = resolveLabeledDaysAgainstKnownStay(params.message, known);
  if (!anchored || anchored.checkIn < params.today) return null;
  const patch = { checkIn: anchored.checkIn, checkOut: anchored.checkOut, checkoutAssumed: false };
  const { error } = await params.db.rpc("update_conversation_topic", {
    p_phone: params.phone, p_last_topic: "availability", p_last_entity: null, p_slots: patch,
  });
  if (error) console.warn("[Autoreply] persist anchored stay failed:", error.message);
  return {
    message: `${params.message} (check-in ${fmtDateID(anchored.checkIn)}, check-out ${fmtDateID(anchored.checkOut)})`,
    slots: { ...params.slots, ...patch },
  };
}
