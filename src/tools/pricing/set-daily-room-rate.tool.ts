/**
 * Tool: set_daily_room_rate (managerial only)
 *
 * Upsert sparse override(s) ke `room_daily_rates` untuk satu tipe kamar.
 * Sebagian besar perintah manajer mengena di sini:
 *
 *   • "Set Deluxe 10 Juni jadi 350rb"                → rate
 *   • "Family 17–18 Agustus 600rb"                   → rate + range
 *   • "Single weekend ini extrabed 75rb"             → extrabed_rate + range
 *   • "Block Deluxe tanggal 17 Agustus"              → stop_sell=true
 *
 * Semantik upsert (one tool, smart defaults):
 *
 *   • from_date wajib. to_date opsional (default = from_date → single date).
 *   • Minimal SATU dari (rate, extrabed_rate, stop_sell, min_stay, note) harus
 *     diberikan. Tool menolak panggilan kosong agar LLM tidak "no-op upsert".
 *   • Field yang TIDAK diberikan = preserve (untuk row existing) atau snapshot
 *     default (untuk row baru). Snapshot default:
 *       rate          → room_types.base_rate
 *       extrabed_rate → null (artinya fallback ke room_types.extrabed_rate)
 *       stop_sell     → false
 *       min_stay      → 1
 *       note          → null
 *     Snapshot rate ini penting: ketika manajer block sebuah tanggal tanpa
 *     menyebut harga, tabel tetap punya nilai rate yang masuk akal (≠ 0).
 *
 * Sanity bounds rate / extrabed_rate: 0 … 50_000_000 (extrabed boleh 0).
 * Range maksimum 366 hari untuk mencegah kesalahan ketik yang upsert 10 tahun.
 *
 * Guard: ctx.isManager === true. Tanpa flag ini tamu bisa menggiring agen
 * untuk men-set tarif via prompt-injection.
 */

import { isDateString, nextDay, fmtDateID } from "@/lib/date";
import type { ToolContext, ToolHandler } from "@/tools/types";
import { resolveRoomType } from "./_resolve-room-type";

const MAX_RATE        = 50_000_000;
const MAX_RANGE_DAYS  = 366;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v
      .replace(/rp/i, "")
      .replace(/\s+/g, "")
      .replace(/[._,](?=\d{3}\b)/g, "")
      .replace(/rb$/i, "000")
      .replace(/(\d+)k$/i, "$1000")
      .replace(/jt$/i, "000000");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|ya|1)$/i.test(v))  return true;
    if (/^(false|no|tidak|0)$/i.test(v)) return false;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Number.isInteger(n) ? n : Math.floor(n);
}

export const setDailyRoomRate: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // ── 1. Authorisation ──────────────────────────────────────────────
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error:
        "Hanya manajer/super admin yang boleh men-set harga harian. Tool ini " +
        "hanya tersedia di kanal internal (Telegram bot Hana/Julia atau " +
        "nomor WhatsApp manajer terdaftar).",
    });
  }

  // ── 2. Parse arguments ────────────────────────────────────────────
  const roomNameOrId = str(args.room_type);
  const fromDate     = str(args.from_date);
  const toDateRaw    = str(args.to_date);
  const rate         = args.rate          != null ? num(args.rate)          : null;
  const extrabedRate = args.extrabed_rate != null ? num(args.extrabed_rate) : null;
  const stopSell     = args.stop_sell     != null ? bool(args.stop_sell)    : null;
  const minStay      = args.min_stay      != null ? int(args.min_stay)      : null;
  const note         = args.note          != null ? str(args.note)          : null;

  if (!roomNameOrId) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan `room_type` (mis. 'Deluxe').",
    });
  }
  if (!fromDate || !isDateString(fromDate)) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan `from_date` (YYYY-MM-DD).",
    });
  }
  const toDate = toDateRaw && isDateString(toDateRaw) ? toDateRaw : fromDate;
  if (toDate < fromDate) {
    return JSON.stringify({
      ok: false,
      error: `to_date (${toDate}) tidak boleh sebelum from_date (${fromDate}).`,
    });
  }

  // At least one mutable field must be present, otherwise the tool would be
  // a no-op upsert that creates blank rows on the LLM's whim.
  if (rate == null && extrabedRate == null && stopSell == null && minStay == null && !note) {
    return JSON.stringify({
      ok: false,
      error:
        "Tidak ada perubahan. Beri minimal satu dari: rate, extrabed_rate, " +
        "stop_sell, min_stay, note.",
    });
  }

  // Range sanity (prevents fat-finger upserts over years).
  const days = (() => {
    let d = fromDate, n = 0;
    while (d <= toDate) { n++; d = nextDay(d); }
    return n;
  })();
  if (days > MAX_RANGE_DAYS) {
    return JSON.stringify({
      ok: false,
      error: `Rentang ${days} hari melebihi batas ${MAX_RANGE_DAYS} hari.`,
    });
  }

  // Rate sanity.
  for (const [label, v] of [["rate", rate], ["extrabed_rate", extrabedRate]] as const) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0 || v > MAX_RATE) {
      return JSON.stringify({
        ok: false,
        error:
          `Nilai ${label} (${v}) di luar batas wajar (0 – ` +
          `Rp ${MAX_RATE.toLocaleString("id-ID")}).`,
      });
    }
  }
  if (minStay != null && (!Number.isInteger(minStay) || minStay < 1 || minStay > 30)) {
    return JSON.stringify({
      ok: false,
      error: `min_stay (${minStay}) tidak valid. Gunakan integer 1–30.`,
    });
  }

  // ── 3. Resolve room type ──────────────────────────────────────────
  const resolved = resolveRoomType(roomNameOrId, ctx.rooms);
  if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
  const room        = resolved.room;
  const baseRateNow = Number(room.base_rate ?? 0);

  // ── 4. Read existing rows in range so we can preserve fields the
  //       manager did NOT touch (upsert with smart defaults).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = ctx.supabaseAdmin as any;
  const { data: existing, error: readErr } = await supabase
    .from("room_daily_rates")
    .select("date, rate, extrabed_rate, min_stay, stop_sell, note")
    .eq("room_type_id", room.id)
    .gte("date", fromDate)
    .lte("date", toDate);
  if (readErr) {
    return JSON.stringify({ ok: false, error: `Gagal baca override existing: ${readErr.message}` });
  }
  const existingByDate = new Map<string, {
    rate: number; extrabed_rate: number | null; min_stay: number; stop_sell: boolean; note: string | null;
  }>((existing ?? []).map((r: {
    date: string; rate: number; extrabed_rate: number | null; min_stay: number; stop_sell: boolean; note: string | null;
  }) => [r.date, r]));

  // Build upsert payload.
  type Row = {
    room_type_id: string;
    date:         string;
    rate:         number;
    extrabed_rate: number | null;
    min_stay:     number;
    stop_sell:    boolean;
    note:         string | null;
  };
  const rows: Row[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    const prev = existingByDate.get(cur);
    rows.push({
      room_type_id: room.id,
      date:         cur,
      rate:         rate         != null ? rate
                  : prev != null ? prev.rate
                  : baseRateNow,
      extrabed_rate: extrabedRate != null ? extrabedRate
                   : prev != null ? prev.extrabed_rate
                   : null,
      min_stay:     minStay      != null ? minStay
                  : prev != null ? prev.min_stay
                  : 1,
      stop_sell:    stopSell     != null ? stopSell
                  : prev != null ? prev.stop_sell
                  : false,
      note:         note         != null ? note
                  : prev != null ? prev.note
                  : null,
    });
    cur = nextDay(cur);
  }

  // ── 5. Upsert in one transaction (PostgREST handles conflict via
  //       onConflict on the (room_type_id, date) unique constraint).
  const { error: writeErr } = await supabase
    .from("room_daily_rates")
    .upsert(rows, { onConflict: "room_type_id,date" });
  if (writeErr) {
    return JSON.stringify({ ok: false, error: `Gagal simpan override: ${writeErr.message}` });
  }

  // ── 6. Summary ────────────────────────────────────────────────────
  const isSingle = fromDate === toDate;
  return JSON.stringify({
    ok: true,
    room_type:    { id: room.id, name: room.name },
    from_date:    fromDate,
    to_date:      toDate,
    days:         rows.length,
    applied: {
      rate:          rate,
      extrabed_rate: extrabedRate,
      stop_sell:     stopSell,
      min_stay:      minStay,
      note:          note,
    },
    message:
      `${rows.length} tanggal di-upsert untuk ${room.name}` +
      (isSingle ? ` (${fmtDateID(fromDate)})` : ` (${fmtDateID(fromDate)} – ${fmtDateID(toDate)})`) +
      ".",
  });
};
