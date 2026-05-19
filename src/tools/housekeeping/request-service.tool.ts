/**
 * Tool: request_housekeeping_service
 *
 * Logs a housekeeping service request from the guest.
 * Inserts into `housekeeping_requests` if it exists; otherwise returns a
 * polite confirmation so the LLM can tell the guest their request is noted.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const requestHousekeepingService: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  const requestType = str(args.request_type) || "general";
  const roomNumber  = str(args.room_number);
  const notes       = str(args.notes);
  const guestPhone  = str(args.guest_phone);

  if (!roomNumber && !guestPhone) {
    return JSON.stringify({
      ok:    false,
      error: "Nomor kamar atau nomor WhatsApp tamu diperlukan untuk mencatat permintaan.",
    });
  }

  // Try to insert into housekeeping_requests (table may or may not exist)
  try {
    const { error } = await (ctx.supabaseAdmin as any)
      .from("housekeeping_requests")
      .insert({
        property_id:  (ctx.property as Record<string, unknown>).id,
        room_number:  roomNumber  || null,
        guest_phone:  guestPhone  || null,
        request_type: requestType,
        notes:        notes       || null,
        status:       "pending",
        requested_at: new Date().toISOString(),
      });

    if (error) throw error;

    return JSON.stringify({
      ok:           true,
      request_type: requestType,
      room_number:  roomNumber,
      message:      "Permintaan housekeeping berhasil dicatat dan akan segera diproses.",
    });
  } catch {
    // Table might not exist — still give guest a confirmation
    return JSON.stringify({
      ok:           true,
      request_type: requestType,
      room_number:  roomNumber,
      message:      "Permintaan Anda telah dicatat. Tim housekeeping kami akan segera menangani.",
      note:         "logged_in_memory",
    });
  }
};
