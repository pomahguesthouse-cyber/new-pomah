/**
 * Tool: update_room_rate
 *
 * Lets the super admin / manager change room pricing from a Telegram
 * chat by speaking to the Pricing Agent ("ganti harga Deluxe jadi
 * 350rb", "naikin extrabed semua jadi 100rb"). Updates
 * `room_types.base_rate` and optionally `room_types.extrabed_rate`.
 *
 * GUARDS (the price desk is mission-critical, so this tool refuses to
 * run unless ALL of the following are true):
 *
 *  1. `ctx.isManager === true` — the caller is identified as an
 *     internal user (Telegram per-agent bot path or WhatsApp manager
 *     number). Without this flag we are talking to a guest, who must
 *     NEVER be able to reprice a room by social-engineering the agent.
 *
 *  2. The target room is resolved via case-insensitive name match
 *     against `ctx.rooms`. Ambiguous matches (>1) and no-match are
 *     both rejected with the candidate list so the agent can ask the
 *     manager to disambiguate.
 *
 *  3. Sanity bounds: 10_000 ≤ new_rate ≤ 50_000_000 IDR. A fat-finger
 *     "350" (instead of 350000) gets caught instead of accidentally
 *     wrecking the live rate.
 *
 *  4. Requires explicit confirmation before applying the price change.
 *
 * Returns the OLD and NEW rate in the JSON result so the agent can
 * confirm the change back to the manager ("Tarif Deluxe diubah dari
 * Rp 300.000 → Rp 350.000.").
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

const MIN_RATE = 10_000;          // catches fat-finger "300" meaning 300000
const MAX_RATE = 50_000_000;      // sanity ceiling

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // accept "350000", "350.000", "350,000", "350rb", "Rp 350.000"
    const cleaned = v
      .replace(/rp/i, "")
      .replace(/\s+/g, "")
      .replace(/[._,](?=\d{3}\b)/g, "")          // thousand separators
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

export const updateRoomRate: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // ── 1. Authorisation ──────────────────────────────────────────────
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error:
        "Hanya manajer/super admin yang boleh mengubah tarif. Tool ini " +
        "hanya tersedia di kanal internal (Telegram bot Hana/Julia atau " +
        "nomor WhatsApp manajer terdaftar).",
    });
  }

  // ── 2. Parse arguments ────────────────────────────────────────────
  const roomNameOrId = str(args.room_type);
  const baseRate     = args.base_rate     != null ? num(args.base_rate)     : null;
  const extrabedRate = args.extrabed_rate != null ? num(args.extrabed_rate) : null;
  const confirmed    = args.confirmed === true;

  if (!roomNameOrId) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan tipe kamar yang harganya mau diubah (mis. 'Deluxe').",
    });
  }
  if (baseRate == null && extrabedRate == null) {
    return JSON.stringify({
      ok: false,
      error: "Sebutkan tarif baru. Minimal salah satu dari base_rate / extrabed_rate.",
    });
  }
  for (const [label, v] of [["base_rate", baseRate], ["extrabed_rate", extrabedRate]] as const) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < MIN_RATE || v > MAX_RATE) {
      return JSON.stringify({
        ok: false,
        error:
          `Nilai ${label} (${v}) di luar batas wajar (Rp ${MIN_RATE.toLocaleString("id-ID")} – ` +
          `Rp ${MAX_RATE.toLocaleString("id-ID")}). Pastikan sudah dalam satuan rupiah utuh, ` +
          `bukan ribuan singkatan.`,
      });
    }
  }

  // ── 3. Resolve room type ──────────────────────────────────────────
  const needle = roomNameOrId.toLowerCase().trim();
  const isUuid = /^[0-9a-f-]{32,}$/i.test(roomNameOrId);

  // Match precedence (so "Deluxe" doesn't ambiguously match "Grand Deluxe"):
  //   1. UUID exact match.
  //   2. Case-insensitive exact name match.
  //   3. Word-boundary match — needle is a standalone word in the room name
  //      (handles "single", "deluxe" without grabbing "grand deluxe").
  //   4. Substring fallback (multi-hit → disambiguation error).
  let candidates: Array<typeof ctx.rooms[number]>;
  if (isUuid) {
    candidates = ctx.rooms.filter((r) => (r as any).id === roomNameOrId);
  } else {
    const exact = ctx.rooms.filter((r) => r.name.toLowerCase().trim() === needle);
    if (exact.length === 1) {
      candidates = exact;
    } else {
      const wordRe = new RegExp(
        `(?:^|\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\s|$)`,
        "i",
      );
      const wordHits = ctx.rooms.filter((r) => wordRe.test(r.name));
      candidates = wordHits.length > 0
        ? wordHits
        : ctx.rooms.filter((r) => r.name.toLowerCase().includes(needle));
    }
  }

  if (candidates.length === 0) {
    return JSON.stringify({
      ok: false,
      error:
        `Tipe kamar "${roomNameOrId}" tidak ditemukan. Pilihan tersedia: ` +
        ctx.rooms.map((r) => r.name).join(", ") + ".",
    });
  }
  if (candidates.length > 1) {
    return JSON.stringify({
      ok: false,
      error:
        `Tipe "${roomNameOrId}" cocok ke beberapa kamar: ` +
        candidates.map((r) => r.name).join(", ") +
        ". Sebutkan nama yang lebih spesifik.",
    });
  }

  const target = candidates[0] as any;
  const oldBase     = Number(target.base_rate     ?? 0);
  const oldExtrabed = Number(target.extrabed_rate ?? 0);

  if (!confirmed) {
    return JSON.stringify({
      ok: false,
      needs_confirmation: true,
      action: "update_room_rate",
      target: {
        room_type: target.name,
        before: { base_rate: oldBase, extrabed_rate: oldExtrabed },
        after: {
          base_rate: baseRate ?? oldBase,
          extrabed_rate: extrabedRate ?? oldExtrabed,
        },
      },
      error:
        `Konfirmasi ubah tarif ${target.name}` +
        (baseRate != null ? ` base ${oldBase.toLocaleString("id-ID")} → ${baseRate.toLocaleString("id-ID")}` : "") +
        (extrabedRate != null ? ` extrabed ${oldExtrabed.toLocaleString("id-ID")} → ${extrabedRate.toLocaleString("id-ID")}` : "") +
        `. Jika sudah benar, panggil ulang tool dengan confirmed=true.`,
    });
  }

  // ── 4. Apply update ───────────────────────────────────────────────
  const patch: Record<string, unknown> = {};
  if (baseRate     != null) patch.base_rate     = baseRate;
  if (extrabedRate != null) patch.extrabed_rate = extrabedRate;

  try {
    const { data, error } = await (ctx.supabaseAdmin as any)
      .from("room_types")
      .update(patch)
      .eq("id", target.id)
      .select("id, name, base_rate, extrabed_rate")
      .single();
    if (error) throw error;

    return JSON.stringify({
      ok: true,
      room_type: { id: data.id, name: data.name },
      before:    { base_rate: oldBase,     extrabed_rate: oldExtrabed },
      after:     { base_rate: Number(data.base_rate ?? 0), extrabed_rate: Number(data.extrabed_rate ?? 0) },
      message:
        `Tarif ${data.name} diperbarui` +
        (baseRate     != null ? ` — base ${oldBase.toLocaleString("id-ID")} → ${baseRate.toLocaleString("id-ID")}` : "") +
        (extrabedRate != null ? `, extrabed ${oldExtrabed.toLocaleString("id-ID")} → ${extrabedRate.toLocaleString("id-ID")}` : "") +
        ".",
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
