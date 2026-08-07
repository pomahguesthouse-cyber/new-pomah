/**
 * Tool: check_room_availability
 *
 * Queries real-time room availability from the database AND resolves
 * the dynamic nightly rate via `daily-rate.service`. Returns a structured
 * JSON payload the LLM formats into a human-readable reply.
 *
 * Rate semantics (per night):
 *   • If `room_daily_rates` has a row for (room_type_id, date) → pakai.
 *   • Else → fallback ke `room_types.base_rate`.
 *
 * Stop-sell semantics:
 *   • Any night with `stop_sell=true` di rentang menginap → tipe kamar itu
 *     ditandai `tidak_tersedia: true` + alasan netral untuk tamu. Output
 *     juga menyertakan `stop_sell_dates` (machine-readable) agar Front
 *     Office Agent / state machine bisa menolak lanjut.
 *
 * Output JSON tetap **additive** — field lama (harga_per_malam, kamar_tersedia,
 * dst.) dipertahankan agar prompt agen yang sudah ada tetap bekerja.
 */

import { isDateString, nextDay, fmtDateID, todayWIB } from "@/lib/date";
import {
  getDailyRatesForRange,
  resolveRoomNightlyRates,
} from "@/services/pricing/daily-rate.service";
import type { ToolContext, ToolHandler } from "./types";

interface AvailabilityRow {
  room_type_id: string;
  total:        number;
  taken:        number;
  available:    number;
}

type CombinationRoomOption = {
  room_type_id: string;
  nama: string;
  jumlah_kamar_tersedia: number;
  kapasitas_tamu: number;
  kapasitas_extra_bed: number;
  tarif_extra_bed_per_malam: number;
  harga_per_malam: number;
};

type CombinationRoomPick = {
  room_type_id: string;
  nama: string;
  jumlah_kamar: number;
  kapasitas_standar: number;
  kapasitas_maksimal: number;
  harga_kamar_per_malam: number;
  extra_bed: number;
  tarif_extra_bed_per_malam: number;
  subtotal_per_malam: number;
};

type RoomCombinationRecommendation = {
  label: string;
  alasan: string;
  total_kamar: number;
  total_kapasitas_standar: number;
  total_kapasitas_maksimal: number;
  total_extra_bed: number;
  total_per_malam: number;
  kamar: CombinationRoomPick[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRpc = (
  name: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error?: { message?: string } | null }>;

const ID_MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2, pebruari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

/**
 * Best-effort coerce a date input from the LLM into YYYY-MM-DD.
 * Handles:
 *  - already-correct "YYYY-MM-DD"
 *  - "8 juni 2026", "08 Jun 2026", "8/6/2026", "8-6-2026", "2026/06/08"
 * Returns null if it can't make sense of the value.
 */
function coerceDate(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const s: string = v.trim().toLowerCase();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  if (/\b(malam ini|nanti malam|hari ini|today)\b/i.test(s)) return today;
  if (/\b(besok|tomorrow)\b/i.test(s)) return nextDay(today);
  if (/\blusa\b/i.test(s)) return nextDay(nextDay(today));

  // YYYY/MM/DD
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "8 juni 2026" / "8 jun"
  m = s.match(/^(\d{1,2})\s+([a-z]+)\s*(\d{2,4})?$/);
  if (m) {
    const [, d, monthName, yRaw] = m;
    const mo = ID_MONTHS[monthName];
    if (mo) {
      const year = yRaw
        ? (yRaw.length === 2 ? `20${yRaw}` : yRaw)
        : today.slice(0, 4);
      return `${year}-${String(mo).padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return null;
}

function allocateExtraBeds(
  picks: Array<{ option: CombinationRoomOption; quantity: number }>,
  needed: number,
): { extraBedsById: Map<string, number>; extraBedTotal: number; ok: boolean } {
  const extraBedsById = new Map<string, number>();
  let remaining = needed;
  let extraBedTotal = 0;
  const candidates = picks
    .filter((pick) => pick.quantity > 0 && pick.option.kapasitas_extra_bed > 0)
    .sort((a, b) => a.option.tarif_extra_bed_per_malam - b.option.tarif_extra_bed_per_malam);

  for (const pick of candidates) {
    if (remaining <= 0) break;
    const maxForType = pick.quantity * pick.option.kapasitas_extra_bed;
    const count = Math.min(remaining, maxForType);
    if (count <= 0) continue;
    extraBedsById.set(pick.option.room_type_id, count);
    extraBedTotal += count * pick.option.tarif_extra_bed_per_malam;
    remaining -= count;
  }

  return { extraBedsById, extraBedTotal, ok: remaining <= 0 };
}

function buildRoomCombinationRecommendations(
  options: CombinationRoomOption[],
  guestCount: number,
): RoomCombinationRecommendation[] {
  if (guestCount <= 0 || options.length === 0) return [];

  const counts = new Array(options.length).fill(0);
  const candidates: RoomCombinationRecommendation[] = [];

  const visit = (index: number) => {
    if (index === options.length) {
      const selected = options
        .map((option, i) => ({ option, quantity: counts[i] }))
        .filter((pick) => pick.quantity > 0);
      if (selected.length === 0) return;

      const totalKamar = selected.reduce((sum, pick) => sum + pick.quantity, 0);
      const totalKapasitasStandar = selected.reduce(
        (sum, pick) => sum + pick.quantity * pick.option.kapasitas_tamu,
        0,
      );
      const totalKapasitasMaksimal = selected.reduce(
        (sum, pick) =>
          sum + pick.quantity * (pick.option.kapasitas_tamu + pick.option.kapasitas_extra_bed),
        0,
      );
      if (totalKapasitasMaksimal < guestCount) return;

      const extraBedNeeded = Math.max(0, guestCount - totalKapasitasStandar);
      const allocation = allocateExtraBeds(selected, extraBedNeeded);
      if (!allocation.ok) return;

      const kamar = selected.map((pick) => {
        const extraBed = allocation.extraBedsById.get(pick.option.room_type_id) ?? 0;
        const hargaKamar = pick.quantity * pick.option.harga_per_malam;
        const hargaExtraBed = extraBed * pick.option.tarif_extra_bed_per_malam;
        return {
          room_type_id: pick.option.room_type_id,
          nama: pick.option.nama,
          jumlah_kamar: pick.quantity,
          kapasitas_standar: pick.quantity * pick.option.kapasitas_tamu,
          kapasitas_maksimal:
            pick.quantity * (pick.option.kapasitas_tamu + pick.option.kapasitas_extra_bed),
          harga_kamar_per_malam: hargaKamar,
          extra_bed: extraBed,
          tarif_extra_bed_per_malam: pick.option.tarif_extra_bed_per_malam,
          subtotal_per_malam: hargaKamar + hargaExtraBed,
        };
      });
      const roomTotal = kamar.reduce((sum, pick) => sum + pick.harga_kamar_per_malam, 0);
      const totalPerMalam = roomTotal + allocation.extraBedTotal;

      candidates.push({
        label: "",
        alasan: "",
        total_kamar: totalKamar,
        total_kapasitas_standar: totalKapasitasStandar,
        total_kapasitas_maksimal: totalKapasitasMaksimal,
        total_extra_bed: extraBedNeeded,
        total_per_malam: totalPerMalam,
        kamar,
      });
      return;
    }

    const option = options[index];
    for (let quantity = 0; quantity <= option.jumlah_kamar_tersedia; quantity += 1) {
      counts[index] = quantity;
      visit(index + 1);
    }
    counts[index] = 0;
  };

  visit(0);

  const sorted = candidates.sort((a, b) => {
    if (a.total_per_malam !== b.total_per_malam) return a.total_per_malam - b.total_per_malam;
    if (a.total_kamar !== b.total_kamar) return a.total_kamar - b.total_kamar;
    if (a.total_extra_bed !== b.total_extra_bed) return a.total_extra_bed - b.total_extra_bed;
    return a.total_kapasitas_maksimal - b.total_kapasitas_maksimal;
  });

  const unique: RoomCombinationRecommendation[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    const key = item.kamar
      .map((room) => `${room.room_type_id}:${room.jumlah_kamar}:${room.extra_bed}`)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...item,
      label: unique.length === 0 ? "Rekomendasi hemat" : "Alternatif",
      alasan:
        unique.length === 0
          ? "Total harga per malam paling hemat dari stok yang tersedia."
          : "Alternatif bila Kakak ingin mengurangi penggunaan extra bed atau memilih susunan kamar lain.",
    });
    if (unique.length >= 2) break;
  }

  return unique;
}

export const checkRoomAvailability: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  // Fallback ke tanggal WIB (bukan UTC) supaya tool & prompt front-office
  // selalu sepakat soal "hari ini" — mencegah selisih 1 hari di sekitar tengah malam.
  const today = (ctx as { today?: string }).today ?? todayWIB();
  const coercedIn  = coerceDate(args.check_in, today);
  const coercedOut = coerceDate(args.check_out, today);

  if (!coercedIn) {
    // Tamu belum menyebut tanggal — jangan tandai sebagai error (LLM bisa
    // salah tafsir jadi "sistem gangguan"). Beri pesan siap-kirim ke tamu.
    return JSON.stringify({
      ok: true,
      need_dates: true,
      reply_to_guest:
        "Boleh tahu untuk tanggal berapa Kakak rencana menginap, dan sampai tanggal berapa ya? 📅",
      instruction_to_agent:
        "Tanggal belum diketahui. Kirim `reply_to_guest` VERBATIM ke tamu. " +
        "JANGAN bilang sistem error/gangguan. Setelah tamu menjawab tanggal, panggil ulang tool ini.",
    });
  }

  const checkIn  = coercedIn;
  let   checkOut = coercedOut ?? nextDay(checkIn);
  if (checkOut <= checkIn) checkOut = nextDay(checkIn);


  // Catat tanggal yang dipakai supaya orchestrator bisa menyimpannya ke slots
  // — turn berikutnya tidak akan kehilangan konteks tanggal.
  ctx.lastDates = { checkIn, checkOut };

  // RPC return shape pre-dates strict types; cast once at the boundary.
  // IMPORTANT: do NOT destructure `.rpc` from the supabase client — the method
  // relies on `this` (it reaches into `this.rest`). Calling it unbound throws
  // "Cannot read properties of undefined (reading 'rest')", which the LLM
  // then surfaces to guests as a "kendala teknis" apology.
  const client = ctx.supabasePublic as unknown as { rpc: AnyRpc };
  const { data: rows, error: availErr } = await client.rpc("room_type_availability_detail", {
    p_check_in:  checkIn,
    p_check_out: checkOut,
  });

  // JANGAN pernah melanjutkan dengan data ketersediaan yang gagal diambil.
  // Audit 7 Agu 2026 (B1): `error` dulu diabaikan, sehingga saat RPC gagal
  // semua tipe kamar kehilangan angka ketersediaan dan formatter menyimpulkan
  // "kamar kami sudah penuh" — tamu ditolak untuk tanggal yang sebenarnya
  // kosong, tanpa log dan tanpa alert.
  if (availErr) {
    console.error(
      `[availability.tool] room_type_availability_detail gagal (${checkIn}..${checkOut}):`,
      availErr,
    );
    return JSON.stringify({
      ok: false,
      availability_unknown: true,
      error: `Gagal mengecek ketersediaan kamar: ${(availErr as { message?: string })?.message ?? availErr}`,
      reply_to_guest:
        "Mohon maaf Kak, sistem ketersediaan kami sedang tersendat sebentar. " +
        "Boleh saya cek ulang dalam beberapa saat? 🙏",
      instruction_to_agent:
        "Pengecekan ketersediaan GAGAL secara teknis — status kamar TIDAK diketahui. " +
        "JANGAN menyimpulkan kamar penuh atau tersedia. Kirim `reply_to_guest` apa adanya.",
    });
  }

  const byId = new Map<string, AvailabilityRow>(
    ((rows ?? []) as AvailabilityRow[]).map((r) => [r.room_type_id, r]),
  );

  // Resolve dynamic nightly rates for ALL room types in one round-trip.
  const roomTypeIds = ctx.rooms.map((r) => r.id);
  const overridesByRoom = await getDailyRatesForRange(
    ctx.supabasePublic,
    roomTypeIds,
    checkIn,
    checkOut,
  );

  const nights = (() => {
    // Cheap nights count without a second pass through listNights.
    let n = 0;
    let cur = checkIn;
    while (cur < checkOut) { n++; cur = nextDay(cur); }
    return n;
  })();

  const adults = Math.max(0, Math.min(20, Math.floor(Number(args.adults) || 0)));
  const children = Math.max(0, Math.min(20, Math.floor(Number(args.children) || 0)));
  const guestCount = adults + children;

  const kamarBase = ctx.rooms.map((r) => {
    const d       = byId.get(r.id);
    const resolved = resolveRoomNightlyRates(
      r,
      checkIn,
      checkOut,
      overridesByRoom.get(r.id),
    );

    const blockedByStopSell = resolved.has_stop_sell;
    const baseAvailable     = d ? d.available : null;
    const availableEffective = blockedByStopSell ? 0 : baseAvailable;
    const kapasitasDefault = Math.max(1, Number(r.capacity ?? 1) || 1);
    const kapasitasExtraBed = Math.max(0, Number(r.extrabed_capacity ?? 0) || 0);
    const kapasitasMaksimal = kapasitasDefault + kapasitasExtraBed;
    const extraBedDibutuhkan = guestCount > kapasitasDefault
      ? Math.max(0, guestCount - kapasitasDefault)
      : 0;
    const melewatiKapasitas = guestCount > 0 && guestCount > kapasitasMaksimal;
    const memenuhiKapasitasJumlahTamu = guestCount > 0
      ? !melewatiKapasitas && (availableEffective ?? 0) > 0
      : undefined;

    // Breakdown only when rates differ per night — keeps payloads compact
    // for the common "all base rate" case.
    const uniqueRates = new Set(resolved.nightly.map((n) => n.rate));
    const nightlyBreakdown = uniqueRates.size > 1
      ? resolved.nightly.map((n) => ({
          tanggal: n.date,
          harga:   n.rate,
          sumber:  n.source,
        }))
      : undefined;

    return {
      room_type_id:    r.id,
      nama:            r.name,
      // Per-malam harga: nightly_rate (rate untuk malam pertama). Field
      // lama `harga_per_malam` dipertahankan untuk backward compatibility
      // — sekarang merefleksikan rate aktual malam pertama, bukan base_rate
      // statis. Ini lebih tepat untuk kebutuhan tamu menanyakan harga.
      harga_per_malam: resolved.nightly[0]?.rate ?? Number(r.base_rate ?? 0),
      nightly_rate:    resolved.nightly[0]?.rate ?? Number(r.base_rate ?? 0),
      total_rate:      resolved.total,
      malam:           nights,
      nightly_breakdown: nightlyBreakdown,
      kamar_tersedia:  availableEffective,
      total_kamar:     d ? d.total : null,
      kapasitas_tamu:  kapasitasDefault,
      kapasitas_extra_bed: kapasitasExtraBed,
      tarif_extra_bed_per_malam: Number(r.extrabed_rate ?? 0) || 0,
      kapasitas_maksimal_dengan_extra_bed: kapasitasMaksimal,
      memenuhi_kapasitas_jumlah_tamu: memenuhiKapasitasJumlahTamu,
      // Field lama tetap dipakai oleh formatter/agent. Setelah ada jumlah tamu,
      // nilainya akan dioverride menjadi tipe yang paling pas, bukan semua tipe
      // yang sekadar muat. Ini membuat bot menyarankan Single untuk 1 tamu,
      // Deluxe/Grand Deluxe untuk 2–3 tamu, dan Family untuk rombongan.
      cocok_untuk_jumlah_tamu: memenuhiKapasitasJumlahTamu,
      extra_bed_dibutuhkan: guestCount > 0 ? extraBedDibutuhkan : undefined,
      melewati_kapasitas: guestCount > 0 ? melewatiKapasitas : undefined,
      tidak_tersedia:  blockedByStopSell || (baseAvailable !== null && baseAvailable <= 0),
      stop_sell_dates: blockedByStopSell ? resolved.stop_sell_dates : undefined,
      alasan: blockedByStopSell
        ? `Kamar ini tidak dijual untuk tanggal ${resolved.stop_sell_dates.map(fmtDateID).join(", ")}.`
        : (d ? undefined : "jumlah kamar belum diatur di sistem"),
      catatan: d ? undefined : "jumlah kamar belum diatur di sistem",
    };
  });

  const roomsThatFitGuestCount = guestCount > 0
    ? kamarBase.filter((r) => r.memenuhi_kapasitas_jumlah_tamu === true)
    : [];

  const bestCapacity = roomsThatFitGuestCount.length > 0
    ? Math.min(...roomsThatFitGuestCount.map((r) => Number(r.kapasitas_maksimal_dengan_extra_bed) || Number.MAX_SAFE_INTEGER))
    : null;

  const recommendedIds = new Set(
    bestCapacity === null
      ? []
      : roomsThatFitGuestCount
          .filter((r) => Number(r.kapasitas_maksimal_dengan_extra_bed) === bestCapacity)
          .map((r) => String(r.room_type_id)),
  );

  const kamar = kamarBase.map((r) => ({
    ...r,
    cocok_untuk_jumlah_tamu: guestCount > 0
      ? recommendedIds.has(String(r.room_type_id))
      : undefined,
    disarankan_untuk_jumlah_tamu: guestCount > 0
      ? recommendedIds.has(String(r.room_type_id))
      : undefined,
  }));

  const rekomendasiTipeKamar = guestCount > 0 && recommendedIds.size > 0
    ? kamar
        .filter((r) => recommendedIds.has(String(r.room_type_id)))
        .map((r) => ({
          room_type_id: r.room_type_id,
          nama: r.nama,
          alasan: `Kapasitas paling pas untuk ${guestCount} tamu dari kamar yang masih tersedia.`,
          kamar_tersedia: r.kamar_tersedia,
          harga_per_malam: r.harga_per_malam,
          kapasitas_maksimal_dengan_extra_bed: r.kapasitas_maksimal_dengan_extra_bed,
          extra_bed_dibutuhkan: r.extra_bed_dibutuhkan,
        }))
    : undefined;

  // Guard agregat: LLM tidak boleh menyimpulkan masih ada opsi lain jika
  // seluruh inventori sudah habis atau kapasitas gabungannya tetap tidak cukup.
  const inventoriTersedia = kamar
    .filter((r) => Number(r.kamar_tersedia ?? 0) > 0 && r.tidak_tersedia !== true)
    .map((r) => {
      const jumlahKamar = Math.max(0, Math.floor(Number(r.kamar_tersedia ?? 0)));
      const kapasitasPerKamar = Math.max(
        1,
        Math.floor(Number(r.kapasitas_maksimal_dengan_extra_bed ?? r.kapasitas_tamu ?? 1)),
      );
      const kapasitasStandarPerKamar = Math.max(
        1,
        Math.floor(Number(r.kapasitas_tamu ?? 1)),
      );
      const kapasitasExtraBedPerKamar = Math.max(
        0,
        Math.floor(Number(r.kapasitas_extra_bed ?? 0)),
      );
      return {
        room_type_id: r.room_type_id,
        nama: r.nama,
        jumlah_kamar: jumlahKamar,
        // Alias lama tetap merepresentasikan kapasitas maksimum agar guard
        // lintas-kamar tetap backward compatible.
        kapasitas_per_kamar: kapasitasPerKamar,
        kapasitas_standar_per_kamar: kapasitasStandarPerKamar,
        kapasitas_extra_bed_per_kamar: kapasitasExtraBedPerKamar,
        kapasitas_maksimal_per_kamar: kapasitasPerKamar,
        kapasitas_standar_total: jumlahKamar * kapasitasStandarPerKamar,
        kapasitas_total: jumlahKamar * kapasitasPerKamar,
        tarif_extra_bed_per_malam: Number(r.tarif_extra_bed_per_malam ?? 0),
        harga_per_malam: r.harga_per_malam,
      };
    });

  const kombinasiKamar = buildRoomCombinationRecommendations(
    kamar
      .filter((r) => Number(r.kamar_tersedia ?? 0) > 0 && r.tidak_tersedia !== true)
      .map((r) => ({
        room_type_id: String(r.room_type_id),
        nama: String(r.nama),
        jumlah_kamar_tersedia: Math.max(0, Math.floor(Number(r.kamar_tersedia ?? 0))),
        kapasitas_tamu: Math.max(1, Math.floor(Number(r.kapasitas_tamu ?? 1))),
        kapasitas_extra_bed: Math.max(0, Math.floor(Number(r.kapasitas_extra_bed ?? 0))),
        tarif_extra_bed_per_malam: Math.max(0, Number(r.tarif_extra_bed_per_malam ?? 0)),
        harga_per_malam: Math.max(0, Number(r.harga_per_malam ?? 0)),
      })),
    guestCount,
  );

  const totalKamarTersedia = inventoriTersedia.reduce(
    (sum, r) => sum + r.jumlah_kamar,
    0,
  );
  const totalKapasitasTersedia = inventoriTersedia.reduce(
    (sum, r) => sum + r.kapasitas_total,
    0,
  );

  const availabilityStatus = totalKamarTersedia === 0
    ? "sold_out"
    : guestCount > 0 && totalKapasitasTersedia < guestCount
      ? "insufficient_capacity"
      : "available";

  const periode = `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`;
  const terminalAvailabilityResult = availabilityStatus !== "available";

  let replyToGuest: string | undefined;
  let instructionToAgent: string | undefined;

  if (availabilityStatus === "sold_out") {
    replyToGuest =
      `Maaf Kak, untuk tanggal ${periode} seluruh kamar kami sudah penuh. ` +
      "Terima kasih sudah menghubungi Pomah Guesthouse 🙏";
    instructionToAgent =
      "HASIL FINAL SOLD_OUT. Kirim `reply_to_guest` VERBATIM. " +
      "JANGAN menawarkan tipe kamar lain, opsi kamar lain, tanggal lain, waitlist, atau pertanyaan lanjutan. " +
      "Tanggal alternatif hanya boleh dicek jika tamu memintanya secara eksplisit pada pesan berikutnya.";
  } else if (availabilityStatus === "insufficient_capacity") {
    const daftar = inventoriTersedia
      .map((r) => {
        const extraBedText = r.kapasitas_extra_bed_per_kamar > 0
          ? `, maksimal ${r.kapasitas_maksimal_per_kamar} tamu dengan ${r.kapasitas_extra_bed_per_kamar} extra bed/kamar`
          : `, maksimal ${r.kapasitas_maksimal_per_kamar} tamu/kamar`;
        return (
          `• ${r.nama}: ${r.jumlah_kamar} kamar — ` +
          `${r.kapasitas_standar_per_kamar} tamu standar/kamar${extraBedText}`
        );
      })
      .join("\n");
    replyToGuest =
      `Maaf Kak, untuk tanggal ${periode} kamar yang tersedia belum cukup untuk menampung ${guestCount} orang.\n` +
      `Stok saat ini hanya dapat menampung maksimal ${totalKapasitasTersedia} orang, termasuk extra bed.\n\n` +
      `Rinciannya:\n${daftar}\n\n` +
      "Saran saya, cek tanggal alternatif agar tersedia kamar Family atau jumlah kamar yang lebih banyak. " +
      "Kalau tanggalnya fleksibel, kirim 1–2 pilihan tanggal dan saya cek langsung.";
    instructionToAgent =
      "HASIL FINAL INSUFFICIENT_CAPACITY UNTUK TANGGAL SAAT INI. Seluruh inventori dan kapasitas gabungan sudah dihitung. " +
      "Kirim `reply_to_guest` VERBATIM. Jangan menawarkan tipe, kombinasi, atau extra bed yang tidak ada di hasil tool. " +
      "Balasan ini boleh mengajak tamu mengirim tanggal alternatif, tetapi JANGAN mengarang tanggal yang tersedia. " +
      "Jika tamu mengirim tanggal baru pada turn berikutnya, panggil ulang check_room_availability.";
  }

  return JSON.stringify({
    check_in:  checkIn,
    check_out: checkOut,
    nights,
    jumlah_tamu: guestCount > 0 ? { dewasa: adults, anak: children, total: guestCount } : undefined,
    tanggal:   fmtDateID(checkIn),
    periode,
    availability_status: availabilityStatus,
    terminal_availability_result: terminalAvailabilityResult,
    dapat_menampung_jumlah_tamu: guestCount > 0
      ? availabilityStatus === "available"
      : undefined,
    total_kamar_tersedia: totalKamarTersedia,
    total_kapasitas_tersedia: totalKapasitasTersedia,
    inventori_tersedia: inventoriTersedia,
    should_offer_other_room_types: terminalAvailabilityResult ? false : undefined,
    should_offer_alternative_dates:
      availabilityStatus === "insufficient_capacity"
        ? true
        : terminalAvailabilityResult
          ? false
          : undefined,
    relay_verbatim: replyToGuest ? true : undefined,
    reply_to_guest: replyToGuest,
    instruction_to_agent: instructionToAgent,
    rekomendasi_tipe_kamar: rekomendasiTipeKamar,
    rekomendasi_kombinasi_kamar: kombinasiKamar.length > 0 ? kombinasiKamar : undefined,
    aturan_rekomendasi_kombinasi_kamar:
      guestCount > 0 && kombinasiKamar.length > 0
        ? "Jika tidak ada satu tipe kamar yang cukup, gunakan rekomendasi_kombinasi_kamar ini. Jangan membuat kombinasi sendiri. Tampilkan maksimal 2 opsi, awali dari label Rekomendasi hemat, dan jangan pakai Markdown."
        : undefined,
    aturan_rekomendasi_tipe_kamar: guestCount > 0
      ? "cocok_untuk_jumlah_tamu=true berarti tipe kamar paling pas untuk jumlah tamu. Gunakan availability_status dan total_kapasitas_tersedia untuk keputusan final lintas beberapa kamar."
      : undefined,
    kamar,
  });
};
