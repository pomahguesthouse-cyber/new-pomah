/**
 * Tool: start_booking_details
 *
 * Hand-off point from the LLM front-office agent to the deterministic booking
 * state machine. The agent calls this once the guest has chosen a room type and
 * dates and wants to proceed. From here on, the state machine (per-phone
 * temporary memory in `wa_booking_states`) drives the name/email/phone steps
 * deterministically — including the name and chat-number confirmations.
 */

import { isDateString } from "@/lib/date";
import {
  updateBookingState,
  type BookingContext,
  type BookingState,
} from "@/ai/state-machine/booking-machine";
import type { ToolContext, ToolHandler } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const startBookingDetails: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  if (!ctx.phone) {
    return JSON.stringify({ ok: false, error: "Nomor kontak tamu tidak tersedia." });
  }

  const roomTypeName = str(args.room_type).toLowerCase();
  const checkIn = isDateString(args.check_in) ? (args.check_in as string) : "";
  let checkOut = isDateString(args.check_out) ? (args.check_out as string) : "";
  const adults = Math.max(1, Math.min(8, Number(args.adults) || 1));
  const children = Math.max(0, Math.min(8, Number(args.children) || 0));
  const guestName = str(args.guest_name);

  if (!roomTypeName) {
    return JSON.stringify({ ok: false, error: "Tipe kamar belum dipilih." });
  }
  if (!checkIn) {
    return JSON.stringify({ ok: false, error: "Tanggal check-in belum ditentukan." });
  }
  // Default to a single night if only one date is provided.
  if (!checkOut || checkOut <= checkIn) {
    const d = new Date(checkIn);
    d.setUTCDate(d.getUTCDate() + 1);
    checkOut = d.toISOString().slice(0, 10);
  }

  const rt =
    ctx.rooms.find((r) => r.name.toLowerCase() === roomTypeName) ??
    ctx.rooms.find((r) => {
      const n = r.name.toLowerCase();
      return n.includes(roomTypeName) || roomTypeName.includes(n);
    });

  if (!rt) {
    return JSON.stringify({
      ok: false,
      error: `Tipe kamar "${str(args.room_type)}" tidak ditemukan.`,
    });
  }

  const context: BookingContext = {
    checkIn,
    checkOut,
    roomId: rt.id,
    roomName: rt.name,
    pricePerNight: Number(rt.base_rate ?? 0),
    adults,
    children,
  };

  let state: BookingState;
  let message: string;

  if (guestName.length >= 2) {
    context.guestName = guestName;
    state = "CONFIRMING_NAME";
    message =
      `Baik, untuk pemesanan kamar ${rt.name} apakah Kakak ingin memakai nama "${guestName}", ` +
      `atau menggunakan nama lain? Balas "Ya" untuk memakai nama ini, atau ketik langsung nama lain yang Kakak inginkan.`;
  } else {
    state = "AWAITING_NAME";
    message = `Baik Kak, untuk memproses pemesanan kamar ${rt.name}, mohon ketikkan nama lengkap Kakak:`;
  }

  await updateBookingState(ctx.supabasePublic, ctx.phone, state, context);

  // The orchestrator's state machine will own every subsequent message. Tell the
  // agent to relay `message` to the guest verbatim for this transition turn.
  return JSON.stringify({ ok: true, relay_verbatim: true, message });
};
