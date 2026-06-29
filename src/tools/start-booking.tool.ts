/**
 * Tool: start_booking_details
 *
 * Hand-off point from the LLM front-office agent to the deterministic booking
 * state machine. The agent calls this once the guest has chosen a room type and
 * dates and wants to proceed. From here on, the state machine (per-phone
 * temporary memory in `wa_booking_states`) drives the name/email/phone steps
 * deterministically — including the name and chat-number confirmations.
 */

import { isDateString, todayWIB } from "@/lib/date";
import { updateBookingState, type BookingContext } from "@/ai/state-machine/booking-machine";
import type { RoomTypeRow } from "@/ai/context-builder";
import type { ToolContext, ToolHandler } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function resolveRoomType(input: string, rooms: RoomTypeRow[]): RoomTypeRow | undefined {
  if (!input) return null;
  const s = input.toLowerCase().trim().replace(/^(kamar|room|no\.?)\s+/i, "").replace(/\s+/g, " ");
  
  // 1. Strict exact/priority mapping
  if (s.includes("grand deluxe")) return rooms.find(r => r.name.toLowerCase() === "grand deluxe");
  if (s === "deluxe" || s.includes("kamar deluxe")) return rooms.find(r => r.name.toLowerCase() === "deluxe");
  if (s.includes("single")) return rooms.find(r => r.name.toLowerCase() === "single");
  if (s.includes("family suite") || s.includes("suite 100")) return rooms.find(r => r.name.toLowerCase() === "family suite 100");
  if (s.includes("family room") || s.includes("room 222")) return rooms.find(r => r.name.toLowerCase() === "family room 222");

  // 2. Fallback
  return rooms.find(r => r.name.toLowerCase() === s) ?? 
         rooms.find(r => {
           const n = r.name.toLowerCase();
           if (s === "deluxe" && n.includes("grand")) return false; // Prevent deluxe -> grand deluxe
           return n.includes(s) || s.includes(n);
         });
}

export const startBookingDetails: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  if (!ctx.phone) {
    return JSON.stringify({ ok: false, error: "Nomor kontak tamu tidak tersedia." });
  }

  const checkIn = isDateString(args.check_in) ? (args.check_in as string) : "";
  let checkOut = isDateString(args.check_out) ? (args.check_out as string) : "";
  const adults = Math.max(1, Math.min(8, Number(args.adults) || 1));
  const children = Math.max(0, Math.min(8, Number(args.children) || 0));
  const guestName = str(args.guest_name);

  if (!checkIn) {
    return JSON.stringify({ ok: false, error: "Tanggal check-in belum ditentukan." });
  }
  // Tolak tanggal lampau — kemungkinan tamu salah ketik tahun (mis. "25 Juni 2025").
  const today = todayWIB();
  if (checkIn < today) {
    return JSON.stringify({
      ok: false,
      error: `Tanggal check-in (${checkIn}) sudah lewat. Mohon konfirmasi tanggal yang benar (hari ini ${today} WIB).`,
    });
  }
  // Default to a single night if only one date is provided.
  if (!checkOut) {
    // Tidak ada checkOut sama sekali → default 1 malam
    const d = new Date(checkIn);
    d.setUTCDate(d.getUTCDate() + 1);
    checkOut = d.toISOString().slice(0, 10);
  } else if (checkOut < checkIn) {
    // checkOut sebelum checkIn → tidak valid → default 1 malam
    const d = new Date(checkIn);
    d.setUTCDate(d.getUTCDate() + 1);
    checkOut = d.toISOString().slice(0, 10);
  } else if (checkOut === checkIn) {
    // Same-day (dayuse) → izinkan, jangan ubah diam-diam
    // State machine akan menampilkan "0 malam / dayuse" di ringkasan
  }

  const context: BookingContext = {
    checkIn,
    checkOut,
    adults,
    children,
    // Nomor WA tamu sudah diketahui dari sesi — isi otomatis agar state machine
    // tidak memintanya lagi. Tamu booking via WhatsApp, tidak masuk akal
    // meminta nomor HP yang sudah kita punya.
    guestPhone: ctx.phone,
  };

  // Dynamic nightly rate passed by the LLM from check_room_availability result.
  // When provided, ALWAYS prefer this over base_rate so the review summary and
  // the invoice show the same number (the pricing engine's authoritative value).
  const dynamicRate =
    typeof args.price_per_night === "number" && args.price_per_night > 0 ? args.price_per_night : null;

  // Compute nights count for totalPrice calculation.
  function calcNights(ci: string, co: string): number {
    const d1 = new Date(ci);
    const d2 = new Date(co);
    const diff = Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
    // Dayuse (ci == co) → 0 malam; pricing dayuse butuh quote khusus.
    return diff > 0 ? diff : 0;
  }

  const roomsArg = args.rooms;
  let roomsDescription = "";

  if (Array.isArray(roomsArg) && roomsArg.length > 0) {
    const parsedRooms = [];
    for (const item of roomsArg) {
      const rName = str(item.room_type).toLowerCase();
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (!rName) continue;

      const cleanName = rName.replace(/^(kamar|room|no\.?)\s+/i, "").trim();
      let rt = resolveRoomType(rName, ctx.rooms);

      if (!rt) {
        // Fallback: Check if cleanName is a physical room number in the DB
        try {
          const { data: physicalRoom } = await (ctx.supabaseAdmin as any)
            .from("rooms")
            .select("room_type_id")
            .eq("number", cleanName.toUpperCase())
            .maybeSingle();

          if (physicalRoom?.room_type_id) {
            rt = ctx.rooms.find((r) => r.id === physicalRoom.room_type_id);
          }
        } catch (dbErr) {
          console.error(`[startBookingDetails] Failed to resolve physical room "${cleanName}":`, dbErr);
        }
      }

      if (!rt) {
        return JSON.stringify({
          ok: false,
          error: `Tipe kamar "${item.room_type}" tidak ditemukan.`,
        });
      }

      parsedRooms.push({
        roomTypeId: rt.id,
        roomTypeName: rt.name,
        quantity: qty,
        // Per-room price_per_night (from rooms array item) takes priority;
        // then top-level dynamic rate; then base_rate fallback.
        pricePerNight:
          (typeof item.price_per_night === "number" && item.price_per_night > 0 ? item.price_per_night : null) ??
          dynamicRate ??
          Number(rt.base_rate ?? 0),
      });
    }

    if (parsedRooms.length === 0) {
      return JSON.stringify({ ok: false, error: "Tipe kamar belum dipilih." });
    }

    context.rooms = parsedRooms;
    // Set fallback scalar variables from first room.
    context.roomId = parsedRooms[0].roomTypeId;
    context.roomName = parsedRooms.map((r) => `${r.quantity}x ${r.roomTypeName}`).join(", ");
    context.pricePerNight = parsedRooms[0].pricePerNight;
    roomsDescription = context.roomName;
    // Compute total: sum(rate × qty × nights) across all room items.
    const nights = calcNights(checkIn, checkOut);
    context.totalPrice = parsedRooms.reduce((sum, r) => sum + r.pricePerNight * r.quantity * nights, 0);
  } else {
    const roomTypeName = str(args.room_type).toLowerCase();
    if (!roomTypeName) {
      return JSON.stringify({ ok: false, error: "Tipe kamar belum dipilih." });
    }

    const cleanTypeName = roomTypeName.replace(/^(kamar|room|no\.?)\s+/i, "").trim();
    let rt = resolveRoomType(roomTypeName, ctx.rooms);

    if (!rt) {
      // Fallback: Check if cleanTypeName is a physical room number in the DB
      try {
        const { data: physicalRoom } = await (ctx.supabaseAdmin as any)
          .from("rooms")
          .select("room_type_id")
          .eq("number", cleanTypeName.toUpperCase())
          .maybeSingle();

        if (physicalRoom?.room_type_id) {
          rt = ctx.rooms.find((r) => r.id === physicalRoom.room_type_id);
        }
      } catch (dbErr) {
        console.error(`[startBookingDetails] Failed to resolve physical room "${cleanTypeName}":`, dbErr);
      }
    }

    if (!rt) {
      return JSON.stringify({
        ok: false,
        error: `Tipe kamar "${str(args.room_type)}" tidak ditemukan.`,
      });
    }

    context.roomId = rt.id;
    context.roomName = rt.name;
    // Use dynamic rate from availability result when provided; fall back to base_rate.
    context.pricePerNight = dynamicRate ?? Number(rt.base_rate ?? 0);
    context.rooms = [
      {
        roomTypeId: rt.id,
        roomTypeName: rt.name,
        quantity: 1,
        pricePerNight: context.pricePerNight,
      },
    ];
    // Persist total so summary and invoice are always consistent.
    const nights = calcNights(checkIn, checkOut);
    context.totalPrice = context.pricePerNight * nights;
    roomsDescription = rt.name;
  }

  ctx.lastDates = { checkIn, checkOut };

  // Masuk ke state COLLECTING_DATA (flexible slot-filling).
  // Semua data yang sudah tersedia (tanggal, kamar, nama jika ada) sudah
  // tersimpan di context. Pesan selanjutnya akan diekstrak oleh extractor
  // untuk mengisi slot yang masih kosong.
  let message: string;
  if (guestName.length >= 2) {
    context.guestName = guestName;
    // guestPhone sudah terisi dari ctx.phone — langsung ke konfirmasi.
    message = `Baik, data booking ${roomsDescription} sudah saya catat atas nama "${guestName}". Mohon konfirmasi untuk melanjutkan pemesanan.`;
  } else {
    message = `Baik Kak, untuk memproses pemesanan kamar ${roomsDescription}, mohon ketikkan nama lengkap Kakak (bisa langsung sekaligus dengan nomor HP, contoh: "atas nama: Budi, nomor: 08123456789"):`;
  }

  await updateBookingState(ctx.supabaseAdmin, ctx.phone, "COLLECTING_DATA", context);

  // The orchestrator's state machine will own every subsequent message. Tell the
  // agent to relay `message` to the guest verbatim for this transition turn.
  return JSON.stringify({ ok: true, relay_verbatim: true, message });
};
