/**
 * Tool: unblock_room (managerial only)
 *
 * Kebalikan dari `block_room`: melepas stop_sell pada `room_daily_rates`
 * sehingga tipe kamar kembali dijual untuk rentang tanggal tersebut.
 * Sama seperti block, ia mendelegasikan ke `set_daily_room_rate` agar guard
 * manajer, resolusi nama tipe kamar, dan validasi tanggal tetap satu jalur.
 */

import type { ToolContext, ToolHandler } from "../types";
import { setDailyRoomRate } from "@/tools/pricing/set-daily-room-rate.tool";

export const unblockRoom: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> => {
  const { room_type, start_date, end_date, reason } = args as {
    room_type?: string;
    start_date?: string;
    end_date?: string;
    reason?: string;
  };

  const raw = await setDailyRoomRate(
    {
      room_type,
      from_date: start_date,
      to_date: end_date ?? start_date,
      stop_sell: false,
      note: reason ?? "Blokir dilepas oleh manajemen",
    },
    ctx
  );

  try {
    const parsed = JSON.parse(raw) as {
      ok?: boolean;
      room_type?: { name?: string };
      from_date?: string;
      to_date?: string;
      days?: number;
    };
    if (parsed.ok) {
      return JSON.stringify({
        ...parsed,
        blocked: false,
        reason: reason ?? null,
        message:
          `Blokir kamar ${parsed.room_type?.name ?? room_type} dilepas ` +
          `${parsed.from_date} s/d ${parsed.to_date} (${parsed.days} hari). ` +
          "Kamar kembali bisa dijual.",
      });
    }
  } catch {
    /* biarkan raw apa adanya */
  }
  return raw;
};
