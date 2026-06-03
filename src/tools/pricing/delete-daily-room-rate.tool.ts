/**
 * Tool: delete_daily_room_rate (managerial only)
 *
 * Hapus override (mengembalikan tanggal ke base_rate). Manajer biasanya
 * bilang "reset Deluxe tanggal 11 Juni" / "hapus override Juli minggu
 * pertama".
 *
 *  • room_type wajib.
 *  • from_date wajib. to_date opsional (default = from_date → single date).
 *  • Tidak ada konfirmasi karena hasilnya reversible (manajer tinggal panggil
 *    set_daily_room_rate lagi). Range >= 31 hari minta confirmation.
 *
 * Guard: ctx.isManager === true.
 */

import { isDateString, nextDay, fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "@/tools/types";
import { resolveRoomType } from "./_resolve-room-type";

const MAX_RANGE_DAYS         = 366;
const CONFIRM_THRESHOLD_DAYS = 31;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export const deleteDailyRoomRate: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Tool ini hanya tersedia untuk manajer/super admin.",
    });
  }

  const roomNeedle = str(args.room_type);
  const fromDate   = str(args.from_date);
  const toDateRaw  = str(args.to_date);
  const confirmed  = args.confirmed === true;

  if (!roomNeedle) {
    return JSON.stringify({ ok: false, error: "Sebutkan `room_type`." });
  }
  if (!fromDate || !isDateString(fromDate)) {
    return JSON.stringify({ ok: false, error: "Sebutkan `from_date` (YYYY-MM-DD)." });
  }
  const toDate = toDateRaw && isDateString(toDateRaw) ? toDateRaw : fromDate;
  if (toDate < fromDate) {
    return JSON.stringify({
      ok: false,
      error: `to_date (${toDate}) tidak boleh sebelum from_date (${fromDate}).`,
    });
  }

  let days = 0; { let d = fromDate; while (d <= toDate) { days++; d = nextDay(d); } }
  if (days > MAX_RANGE_DAYS) {
    return JSON.stringify({
      ok: false,
      error: `Rentang ${days} hari melebihi batas ${MAX_RANGE_DAYS} hari.`,
    });
  }

  const resolved = resolveRoomType(roomNeedle, ctx.rooms);
  if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
  const room = resolved.room;

  if (days >= CONFIRM_THRESHOLD_DAYS && !confirmed) {
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "delete_daily_room_rate",
      target: {
        room_type: room.name,
        from_date: fromDate,
        to_date:   toDate,
        days,
      },
      error:
        `Akan menghapus override ${days} hari untuk ${room.name} ` +
        `(${fmtDateID(fromDate)} – ${fmtDateID(toDate)}). ` +
        `Jika sudah benar, panggil ulang dengan confirmed=true.`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = ctx.supabaseAdmin as any;
  const { data, error } = await supabase
    .from("room_daily_rates")
    .delete()
    .eq("room_type_id", room.id)
    .gte("date", fromDate)
    .lte("date", toDate)
    .select("date");
  if (error) {
    return JSON.stringify({ ok: false, error: `Gagal hapus override: ${error.message}` });
  }

  const deleted: string[] = ((data ?? []) as { date: string }[]).map((r) => r.date);
  const isSingle = fromDate === toDate;
  return JSON.stringify({
    ok: true,
    room_type:     { id: room.id, name: room.name },
    from_date:     fromDate,
    to_date:       toDate,
    deleted_count: deleted.length,
    deleted_dates: deleted,
    message:
      `${deleted.length} override dihapus untuk ${room.name}` +
      (isSingle ? ` (${fmtDateID(fromDate)})` : ` (${fmtDateID(fromDate)} – ${fmtDateID(toDate)})`) +
      `. Tanggal-tanggal ini sekarang kembali ke base_rate.`,
  });
};
