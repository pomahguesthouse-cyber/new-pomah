import type { ToolContext, ToolHandler } from "../types";

export const blockRoom: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> => {
  const { room_type, start_date, end_date, reason } = args as {
    room_type: string;
    start_date: string;
    end_date: string;
    reason: string;
  };

  if (!ctx.supabaseAdmin) {
    return JSON.stringify({ error: "No DB connection available." });
  }

  const { error } = await ctx.supabaseAdmin
    .from("room_blocks")
    .insert({
      room_type,
      start_date,
      end_date,
      reason,
      blocked_by: ctx.phone || "Admin Agent",
    });

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify({
    ok: true,
    message: `Kamar ${room_type} berhasil diblokir dari ${start_date} sampai ${end_date} dengan alasan: ${reason}`,
  });
};
