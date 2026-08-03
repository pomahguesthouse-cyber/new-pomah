/**
 * Tool: block_room (managerial only)
 *
 * Sebelumnya tool ini insert ke `room_blocks` pakai kolom yang tidak ada
 * (`room_type`, `blocked_by`) sehingga selalu gagal, dan tabel itu pun tidak
 * dibaca oleh mesin ketersediaan. Sumber kebenaran ketersediaan adalah
 * `room_daily_rates.stop_sell` — jadi blokir sekarang di-delegasikan ke
 * `set_daily_room_rate` (stop_sell = true) yang sudah punya guard manajer,
 * resolusi nama tipe kamar, dan validasi tanggal.
 */

import type { ToolContext, ToolHandler } from "../types";
import { setDailyRoomRate } from "@/tools/pricing/set-daily-room-rate.tool";

export const blockRoom: ToolHandler = async (
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
      stop_sell: true,
      note: reason ?? "Diblokir oleh manajemen",
    },
    ctx
  );

  // Perkaya pesan sukses agar agen tidak menyebut "harga" saat memblokir.
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
        blocked: true,
        reason: reason ?? null,
        message:
          `Kamar ${parsed.room_type?.name ?? room_type} diblokir (stop sell) ` +
          `${parsed.from_date} s/d ${parsed.to_date} (${parsed.days} hari)` +
          (reason ? `. Alasan: ${reason}` : "") + ".",
      });
    }
  } catch {
    /* biarkan raw apa adanya */
  }
  return raw;
};
