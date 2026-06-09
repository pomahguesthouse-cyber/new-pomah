/**
 * Tool: update_booking_slots
 *
 * Lightweight slot-writer for the Front Office Agent. Use it when the guest
 * mentions ONE piece of booking info at a time ("Deluxe", "2 orang",
 * "20 Juni") and the agent does NOT yet have all parameters to call
 * `start_booking_details`.
 *
 * Writes partial booking data to `wa_booking_states.slots` so the next turn
 * — and the next agent prompt — sees the accumulated context without
 * re-deriving it from chat history.
 *
 * Keys written under slots: partialRoomType, partialAdults, partialChildren,
 * checkIn, checkOut.
 */

import { isDateString } from "@/lib/date";
import type { ToolContext, ToolHandler } from "./types";

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export const updateBookingSlots: ToolHandler = async (args, ctx: ToolContext) => {
  if (!ctx.phone) {
    return JSON.stringify({ ok: false, error: "phone tidak tersedia" });
  }

  const partialRoomType = str(args.room_type);
  const partialAdults   = num(args.adults);
  const partialChildren = num(args.children);
  const checkIn  = isDateString(args.check_in)  ? (args.check_in  as string) : undefined;
  const checkOut = isDateString(args.check_out) ? (args.check_out as string) : undefined;

  if (!partialRoomType && partialAdults === undefined && partialChildren === undefined && !checkIn && !checkOut) {
    return JSON.stringify({ ok: false, error: "Tidak ada slot baru untuk disimpan." });
  }

  // Read current slots (best-effort) so we merge rather than overwrite.
  let current: Record<string, unknown> = {};
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (ctx.supabaseAdmin as any).rpc("get_active_booking_state", {
      p_phone: ctx.phone,
    });
    if (data?.slots && typeof data.slots === "object") {
      current = data.slots as Record<string, unknown>;
    }
  } catch {
    /* ignore — start fresh */
  }

  const merged: Record<string, unknown> = { ...current };
  if (partialRoomType) merged.partialRoomType = partialRoomType;
  if (partialAdults   !== undefined) merged.partialAdults   = partialAdults;
  if (partialChildren !== undefined) merged.partialChildren = partialChildren;
  if (checkIn)  merged.checkIn  = checkIn;
  if (checkOut) merged.checkOut = checkOut;

  // Keep dates in toolCtx scratchpad so the orchestrator's slot persistence
  // sees them and the next turn keeps the agreed dates.
  if (checkIn && checkOut) ctx.lastDates = { checkIn, checkOut };

  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (ctx.supabaseAdmin as any).rpc("update_conversation_topic", {
      p_phone:       ctx.phone,
      p_last_topic:  "booking",
      p_last_entity: partialRoomType ? { kind: "room", label: partialRoomType } : null,
      p_slots:       merged,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: msg });
  }

  return JSON.stringify({ ok: true, slots: merged });
};
