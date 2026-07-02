import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { mergeAiLabConfig, AGENT_KEYS } from "@/admin/modules/ai-lab/ai-lab.functions";
import { retrieveRelevantSopContext } from "@/ai/rag.service";
import {
  getDailyRatesForRange,
  resolveRoomNightlyRates,
} from "@/services/pricing/daily-rate.service";

/**
 * Resolve dynamic per-night rate AND extrabed rate for ONE room type
 * over a stay.
 *
 * Used by every booking-creation path here (single, cart, webchat) so
 * new bookings honour `room_daily_rates` overrides + stop_sell.
 *
 * Returns averages so the legacy invariants:
 *   booking_rooms.nightly_rate × nights = room subtotal
 *   extrabed_rate × nights × count       = extrabed subtotal
 * continue to hold without any schema change.
 */
async function resolveBookingNightlyRate(
  roomType: { id: string; base_rate: number | null; extrabed_rate?: number | null },
  checkIn:  string,
  checkOut: string,
): Promise<{ avgRate: number; avgExtraBedRate: number; stopSellDates: string[] }> {
  const overridesByRoom = await getDailyRatesForRange(
    supabasePublic,
    [roomType.id],
    checkIn,
    checkOut,
  );
  const resolved = resolveRoomNightlyRates(
    {
      id:         roomType.id,
      name:       "",
      base_rate:  Number(roomType.base_rate ?? 0),
      capacity:   null,
      bed_type:   null,
      description: null,
      extrabed_rate: roomType.extrabed_rate == null ? null : Number(roomType.extrabed_rate),
    },
    checkIn,
    checkOut,
    overridesByRoom.get(roomType.id),
  );
  const avg = resolved.nights > 0
    ? resolved.total / resolved.nights
    : Number(roomType.base_rate ?? 0);
  const ebrTotal = resolved.nightly.reduce((acc, n) => acc + n.extrabed_rate, 0);
  const avgExtraBed = resolved.nights > 0
    ? ebrTotal / resolved.nights
    : Number(roomType.extrabed_rate ?? 0);
  return {
    avgRate:         avg,
    avgExtraBedRate: avgExtraBed,
    stopSellDates:   resolved.stop_sell_dates,
  };
}

/** Untyped client view — `images` column isn't in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
/** Format an ISO date (YYYY-MM-DD) as Indonesian text, e.g. "19 Mei 2026". */
function fmtDateID(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

/**
 * Auto room allotment — pick the first physical room of a room type that
 * has no active (pending/confirmed/checked-in) booking overlapping the
 * date range. Returns null when no room is free, so the caller leaves the
 * booking unassigned for staff to handle.
 */
async function pickAvailableRoom(
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
): Promise<string | null> {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");
  const roomRows = (rooms ?? []) as Record<string, unknown>[];
  if (roomRows.length === 0) return null;

  const { data: activeBookings } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  const activeIds = (activeBookings ?? []).map((b: any) => (b as Record<string, unknown>).id as string);
  if (activeIds.length === 0) return roomRows[0].id as string;

  const { data: occ } = await supabaseAdmin
    .from("booking_rooms")
    .select("room_id")
    .not("room_id", "is", null)
    .in("booking_id", activeIds);
  const taken = new Set((occ ?? []).map((r: any) => (r as Record<string, unknown>).room_id));
  const free = roomRows.find((r) => !taken.has(r.id));
  return free ? (free.id as string) : null;
}

/**
 * Like pickAvailableRoom but returns `n` room ids — one per requested
 * room. Slots beyond the free-room count are filled with null (left for
 * staff to assign).
 */
async function pickAvailableRooms(
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  n: number,
): Promise<(string | null)[]> {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");
  const roomRows = (rooms ?? []) as Record<string, unknown>[];

  const { data: activeBookings } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  const activeIds = (activeBookings ?? []).map((b: any) => (b as Record<string, unknown>).id as string);

  let taken = new Set<unknown>();
  if (activeIds.length) {
    const { data: occ } = await supabaseAdmin
      .from("booking_rooms")
      .select("room_id")
      .not("room_id", "is", null)
      .in("booking_id", activeIds);
    taken = new Set((occ ?? []).map((r: any) => (r as Record<string, unknown>).room_id));
  }
  const free = roomRows.filter((r) => !taken.has(r.id)).map((r) => r.id as string);
  return Array.from({ length: n }, (_, i) => free[i] ?? null);
}

export type PublicProperty = {
  id?: string;
  name?: string;
  tagline?: string | null;
  description?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  hero_image_url?: string | null;
  logo_url?: string | null;
  invoice_logo_url?: string | null;
  favicon_url?: string | null;
  public_domain?: string | null;
  google_analytics_id?: string | null;
  google_tag_manager_id?: string | null;
  google_search_console?: string | null;
  google_place_id?: string | null;
  hotel_policy?: string | null;
  homepage_config?: Json;
  explore_config?: Json;
  currency?: string | null;
  timezone?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  facebook_url?: string | null;
};

export const getPublicSiteData = createServerFn({ method: "GET" }).handler(async () => {
  const [{ data: propertyData }, { data: roomTypesRaw }] = await Promise.all([
    supabasePublic.rpc("get_public_property" as never),
    supabasePublic
      .from("room_types")
      .select(
        "id, name, slug, description, base_rate, extrabed_rate, extrabed_capacity, capacity, bed_type, floor_info, size_sqm, amenities, hero_image_url, images, rooms(id)",
      )
      .order("base_rate"),
  ]);

  const property = (propertyData ?? null) as PublicProperty | null;

  const roomTypes = (roomTypesRaw ?? []).map((rt: any) => ({
    ...rt,
    rooms: undefined,
    total_physical_rooms: Array.isArray(rt.rooms) ? rt.rooms.length : 0,
  }));

  return { property, roomTypes };
});

/**
 * Resolve a single uploaded media asset by its display name to a public URL.
 * Used by the homepage to render the "red-circle-animation.svg" lasso from
 * the media library instead of a bundled /public copy.
 *
 * Optional `folder` narrows the lookup to a specific media-library folder
 * (e.g. "icon") so the same filename in a different folder is ignored.
 * Matched case-insensitively against media_folders.name.
 */
export const getMediaAssetByName = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(255),
        folder: z.string().min(1).max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // 1. Resolve folder IDs that match the requested folder name. Use a
    //    LIKE-with-wildcards so "icon" matches "Icon", "ICON", "Icons", etc.
    let folderIds: string[] = [];
    if (data.folder) {
      const { data: folderRows } = await supabasePublic
        .from("media_folders")
        .select("id, name")
        .ilike("name", `%${data.folder}%`);
      folderIds = (folderRows ?? []).map((r: any) => r.id as string);
    }

    // 2. Look up the file. Try exact name first; if that fails, fall back
    //    to a stem-only match so capitalisation / extra spaces don't matter.
    //    If a folder filter is requested but no matching folder exists OR
    //    the file isn't found inside, drop the folder filter as a last
    //    resort so the asset still loads (matches the user's intent of
    //    "use the file" without breaking on a folder typo).
    const tryFetch = async (nameMatch: string, useFolder: boolean) => {
      let q = supabasePublic
        .from("sop_documents")
        .select("file_path, storage_bucket, name, folder_id")
        .ilike("name", nameMatch)
        .order("created_at", { ascending: false })
        .limit(1);
      if (useFolder && folderIds.length > 0) q = q.in("folder_id", folderIds);
      const { data: r } = await q.maybeSingle();
      return r ?? null;
    };

    let row =
      (await tryFetch(data.name, true)) ||
      (await tryFetch(`%${data.name.replace(/\.[^.]+$/, "")}%`, true)) ||
      (await tryFetch(data.name, false)) ||
      (await tryFetch(`%${data.name.replace(/\.[^.]+$/, "")}%`, false));

    if (!row || !(row as any).file_path) return { url: null };
    const bucket = ((row as any).storage_bucket as string | null) || "sop-documents";
    const url = supabasePublic.storage
      .from(bucket)
      .getPublicUrl((row as any).file_path).data.publicUrl;
    return { url };
  });

export const submitPublicBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        fullName: z.string().min(1).max(120),
        email: z.string().email().max(200),
        phone: z.string().min(3).max(40).optional().or(z.literal("")),
        roomTypeId: z.string().uuid(),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int().min(1).max(8),
        children: z.number().int().min(0).max(8),
        rooms: z.number().int().min(1).max(8).optional(),
        extrabed: z.number().int().min(0).max(8).optional(),
        checkInTime: z.string().max(10).optional().or(z.literal("")),
        checkOutTime: z.string().max(10).optional().or(z.literal("")),
        paymentMethod: z.enum(["transfer", "onsite"]).optional(),
        specialRequests: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: property } = await supabaseAdmin
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (!property) throw new Error("Property not configured");

    const { data: rt } = await supabasePublic
      .from("room_types")
      .select("id, base_rate, extrabed_rate")
      .eq("id", data.roomTypeId)
      .single();
    if (!rt) throw new Error("Room type not found");

    const nights =
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000;
    if (nights < 1) throw new Error("Check-out must be after check-in");

    // Writes use the service-role client — the anon role can INSERT but
    // has no SELECT policy on guests/bookings, so `.select()` after an
    // anon insert returns nothing.
    const { data: guest, error: gerr } = await supabaseAdmin
      .from("guests")
      .insert({
        full_name: data.fullName,
        email: data.email,
        phone: data.phone || null,
      })
      .select("id")
      .single();
    if (gerr || !guest) throw gerr ?? new Error("Could not create guest");

    const roomsCount = data.rooms ?? 1;
    const extrabedCount = data.extrabed ?? 0;
    // Dynamic daily rate AND extrabed rate: both honour room_daily_rates
    // overrides + fallback to room_types.extrabed_rate per night.
    const dyn = await resolveBookingNightlyRate(rt, data.checkIn, data.checkOut);
    if (dyn.stopSellDates.length > 0) {
      throw new Error(
        `Kamar ini tidak dijual untuk tanggal ${dyn.stopSellDates.join(", ")}. ` +
        `Silakan pilih tanggal lain.`,
      );
    }
    const total =
      dyn.avgRate * nights * roomsCount + dyn.avgExtraBedRate * nights * extrabedCount;
    const extrabedNote =
      extrabedCount > 0 ? `Extrabed: ${extrabedCount}` : "";
    const specialRequests =
      [extrabedNote, data.specialRequests || ""].filter(Boolean).join(" | ") || null;
    const { data: booking, error: berr } = await db(supabaseAdmin)
      .from("bookings")
      .insert({
        property_id: property.id,
        guest_id: guest.id,
        check_in: data.checkIn,
        check_out: data.checkOut,
        nights: Math.round(nights),
        adults: data.adults,
        children: data.children,
        total_amount: total,
        source: "direct",
        status: "pending",
        special_requests: specialRequests,
        check_in_time: data.checkInTime || null,
        check_out_time: data.checkOutTime || null,
        payment_method: data.paymentMethod || null,
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking) throw berr ?? new Error("Could not create booking");

    // Auto room allotment — one booking_rooms line per room, each
    // assigned a free physical room where one exists.
    const assigned = await pickAvailableRooms(rt.id, data.checkIn, data.checkOut, roomsCount);
    const { error: brErr } = await supabaseAdmin.from("booking_rooms").insert(
      assigned.map((roomId) => ({
        booking_id: booking.id,
        room_id: roomId,
        room_type_id: rt.id,
        nightly_rate: dyn.avgRate,
      })),
    );
    if (brErr) throw brErr;

    // Try to generate and send the invoice PDF via WhatsApp
    try {
      const request = getRequest();
      const origin = request ? new URL(request.url).origin : undefined;
      void import("@/services/invoice-notification.service").then(({ generateAndSendInvoiceNotification }) =>
        generateAndSendInvoiceNotification({
          supabase: supabaseAdmin,
          bookingId: booking.id,
          origin,
        })
      ).catch((err) => {
        console.error("[submitPublicBooking] Notification error:", err);
      });
    } catch (notificationErr) {
      console.error("[submitPublicBooking] Notification trigger error:", notificationErr);
    }

    // Notif manager — pakai waitUntil agar tetap jalan setelah response dikirim.
    const { runDeferred } = await import("@/lib/cf-context");
    runDeferred("submitPublicBooking.notifyNewBooking", async () => {
      const { notifyNewBooking } = await import("@/services/manager-notifier.service");
      await notifyNewBooking(supabaseAdmin, booking.id);
    });

    return {
      id: booking.id,
      reference_code: booking.reference_code,
      total,
      nights,
    };
  });

export const submitCartBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        fullName: z.string().min(1).max(120),
        email: z.string().email().max(200),
        phone: z.string().min(3).max(40).optional().or(z.literal("")),
        cart: z.array(
          z.object({
            roomTypeId: z.string().uuid(),
            quantity: z.number().int().min(1).max(8),
            extraBeds: z.number().int().min(0).max(8).optional(),
          })
        ).min(1),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int().min(1).max(30),
        children: z.number().int().min(0).max(30),
        checkInTime: z.string().max(10).optional().or(z.literal("")),
        checkOutTime: z.string().max(10).optional().or(z.literal("")),
        paymentMethod: z.enum(["transfer", "onsite"]).optional(),
        specialRequests: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: property } = await supabaseAdmin
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (!property) throw new Error("Property not configured");

    const nights =
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000;
    if (nights < 1) throw new Error("Check-out must be after check-in");

    // Fetch all needed room types
    const roomTypeIds = Array.from(new Set(data.cart.map((c) => c.roomTypeId)));
    const { data: rts } = await supabasePublic
      .from("room_types")
      .select("id, name, base_rate, extrabed_rate")
      .in("id", roomTypeIds);
    if (!rts || rts.length !== roomTypeIds.length) {
      throw new Error("One or more room types not found");
    }

    let grandTotal = 0;
    let totalRooms = 0;
    const roomInserts: any[] = [];
    const extraBedNotes: string[] = [];

    // Calculate totals, extra beds notes, and assign physical rooms
    for (const item of data.cart) {
      const rt = rts.find((r) => r.id === item.roomTypeId)!;
      // Dynamic daily rate per room type. Stop-sell at ANY night in the
      // stay rejects the whole cart — guests can re-pick dates.
      const dyn = await resolveBookingNightlyRate(rt, data.checkIn, data.checkOut);
      if (dyn.stopSellDates.length > 0) {
        throw new Error(
          `${rt.name} tidak dijual untuk tanggal ${dyn.stopSellDates.join(", ")}. ` +
          `Silakan pilih tanggal lain.`,
        );
      }
      const roomBaseTotal = dyn.avgRate * nights * item.quantity;
      const extrabedTotal = item.extraBeds ? (dyn.avgExtraBedRate * nights * item.extraBeds) : 0;

      grandTotal += roomBaseTotal + extrabedTotal;
      totalRooms += item.quantity;

      if (item.extraBeds && item.extraBeds > 0) {
        extraBedNotes.push(`${item.quantity}x ${rt.name} dengan total ${item.extraBeds} Extrabed`);
      }

      // Assign physical rooms
      const assigned = await pickAvailableRooms(rt.id, data.checkIn, data.checkOut, item.quantity);
      for (const roomId of assigned) {
        roomInserts.push({
          room_id: roomId,
          room_type_id: rt.id,
          nightly_rate: dyn.avgRate,
        });
      }
    }

    const finalSpecialRequests = extraBedNotes.length > 0 
      ? `(Add-ons: ${extraBedNotes.join(", ")})\n${data.specialRequests || ""}`.trim()
      : data.specialRequests || null;

    const { data: guest, error: gerr } = await supabaseAdmin
      .from("guests")
      .insert({
        full_name: data.fullName,
        email: data.email,
        phone: data.phone || null,
      })
      .select("id")
      .single();
    if (gerr || !guest) throw gerr ?? new Error("Could not create guest");

    const { data: booking, error: berr } = await db(supabaseAdmin)
      .from("bookings")
      .insert({
        property_id: property.id,
        guest_id: guest.id,
        check_in: data.checkIn,
        check_out: data.checkOut,
        nights: Math.round(nights),
        adults: data.adults,
        children: data.children,
        total_amount: grandTotal,
        source: "direct",
        status: "pending",
        special_requests: finalSpecialRequests,
        check_in_time: data.checkInTime || null,
        check_out_time: data.checkOutTime || null,
        payment_method: data.paymentMethod || null,
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking) throw berr ?? new Error("Could not create booking");

    // Insert booking_rooms
    const { error: brErr } = await supabaseAdmin.from("booking_rooms").insert(
      roomInserts.map(r => ({
        ...r,
        booking_id: booking.id
      }))
    );
    if (brErr) throw brErr;

    try {
      const request = getRequest();
      const origin = request ? new URL(request.url).origin : undefined;
      void import("@/services/invoice-notification.service").then(({ generateAndSendInvoiceNotification }) =>
        generateAndSendInvoiceNotification({
          supabase: supabaseAdmin,
          bookingId: booking.id,
          origin,
        })
      ).catch((err) => {
        console.error("[submitCartBooking] Notification error:", err);
      });
    } catch (notificationErr) {
      console.error("[submitCartBooking] Notification trigger error:", notificationErr);
    }

    // Notif manager — pakai waitUntil agar tetap jalan setelah response dikirim.
    const { runDeferred: runDeferredCart } = await import("@/lib/cf-context");
    runDeferredCart("submitCartBooking.notifyNewBooking", async () => {
      const { notifyNewBooking } = await import("@/services/manager-notifier.service");
      await notifyNewBooking(supabaseAdmin, booking.id);
    });

    return {
      id: booking.id,
      reference_code: booking.reference_code,
      total: grandTotal,
      nights,
      rooms: totalRooms,
    };
  });

export const getBookingReference = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: booking } = await supabasePublic
      .from("bookings")
      .select("reference_code")
      .eq("id", data.id)
      .maybeSingle();
    return { reference_code: booking?.reference_code ?? null };
  });

export type BookingInvoice = {
  reference_code: string;
  status: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  room_type: string;
  nightly_rate: number;
  room_details?: {
    id: string;
    room_id: string | null;
    room_number: string | null;
    room_type_id: string | null;
    room_type: string;
    nightly_rate: number;
    extra_bed_count?: number;
    extra_bed_rate?: number;
  }[];
  total_amount: number;
  payment_status: "unpaid" | "partial" | "paid" | null;
  paid_amount: number;
  payment_method: string;
  check_in_time: string;
  check_out_time: string;
  special_requests: string;
  created_at: string;
  /** Public URL of the generated PDF invoice in Supabase Storage */
  pdf_url: string | null;
  guest: { full_name: string; email: string; phone: string };
  property: {
    name: string;
    address: string;
    bank: string;
    account_number: string;
    account_holder: string;
  };
};

/** Full invoice detail for a booking — used by the public confirmation page. */
export const getBookingInvoice = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    try {
      // Reads via the service-role client if available (bypasses RLS).
      // Fallback to supabasePublic in local development if service role key is not provisioned.
      let sb;
      try {
        sb = db(supabaseAdmin);
      } catch (err) {
        console.warn("[getBookingInvoice] supabaseAdmin failed to initialize, using supabasePublic fallback:", err);
        sb = db(supabasePublic);
      }

      // The URL param may be either the booking UUID or the human-friendly
      // booking code (reference_code, e.g. "PG-9J6Y2"). Resolve to the UUID.
      const rawId = data.id.trim();

      // Try fetching using the secure get_public_booking_invoice RPC.
      // This works for anonymous guests, local development, and server environments.
      try {
        const { data: rpcData, error: rpcErr } = await sb.rpc(
          "get_public_booking_invoice",
          { p_id: rawId }
        );
        if (!rpcErr && rpcData) {
          return { invoice: rpcData as BookingInvoice };
        }
        if (rpcErr) {
          console.warn("[getBookingInvoice] RPC lookup failed, falling back to table query:", rpcErr);
        }
      } catch (rpcCatch) {
        console.warn("[getBookingInvoice] RPC invocation threw, falling back to table query:", rpcCatch);
      }

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
      let bookingId = rawId;
      if (!isUuid) {
        const { data: byCode, error: codeErr } = await sb
          .from("bookings")
          .select("id")
          .ilike("reference_code", rawId)
          .maybeSingle();
        if (codeErr) {
          console.error("[getBookingInvoice] Error resolving booking reference code:", codeErr);
        }
        if (!byCode) {
          console.warn("[getBookingInvoice] booking not found by code:", rawId);
          return { invoice: null as BookingInvoice | null };
        }
        bookingId = (byCode as { id: string }).id;
      }

      // ── Step 1: minimal query — only columns present since day-one ────────
      // This MUST succeed for any booking that exists; never fails on missing columns.
      const { data: bBase, error: bBaseErr } = await sb
        .from("bookings")
        .select("check_in, check_out, adults, children, total_amount, status, special_requests, created_at, guest_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (bBaseErr) {
        console.error("[getBookingInvoice] base query error:", JSON.stringify(bBaseErr));
        return { invoice: null as BookingInvoice | null };
      }
      if (!bBase) {
        console.warn("[getBookingInvoice] booking not found:", bookingId);
        return { invoice: null as BookingInvoice | null };
      }

      // ── Step 2: try extended columns (added in later migrations) ─────────
      // Failures here are non-fatal; we fall back to defaults.
      let ext: Record<string, unknown> = {};
      try {
        const { data: extRow } = await sb
          .from("bookings")
          .select("reference_code, nights, payment_method, check_in_time, check_out_time, payment_status, paid_amount")
          .eq("id", bookingId)
          .maybeSingle();
        ext = (extRow ?? {}) as Record<string, unknown>;
      } catch (err) {
        console.warn("[getBookingInvoice] Failed to fetch extended columns:", err);
      }

      const b: Record<string, unknown> = { ...bBase, ...ext };

      // Try fetching guest info
      let g: Record<string, unknown> = {};
      try {
        const { data: gRow } = await sb
          .from("guests")
          .select("full_name, email, phone")
          .eq("id", b.guest_id as string)
          .maybeSingle();
        g = (gRow ?? {}) as Record<string, unknown>;
      } catch (err) {
        console.warn("[getBookingInvoice] Failed to fetch guest info:", err);
      }

      // Try fetching booking rooms and type
      let rows: Record<string, unknown>[] = [];
      let roomType = "Kamar";
      try {
        const { data: brRows } = await sb
          .from("booking_rooms")
          .select("id, room_id, room_type_id, nightly_rate, room_types(name), rooms(number)")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true });
        rows = (brRows ?? []) as Record<string, unknown>[];
        const roomTypeNames = [
          ...new Set(
            rows
              .map((row) => ((row.room_types as Record<string, unknown> | null)?.name as string | undefined) ?? "")
              .filter(Boolean),
          ),
        ];
        roomType = roomTypeNames.length ? roomTypeNames.join(", ") : "Kamar";
      } catch (err) {
        console.warn("[getBookingInvoice] Failed to fetch booking rooms or room type:", err);
      }

      // Try fetching property info
      let p: Record<string, unknown> = {};
      try {
        const { data: pRow } = await supabaseAdmin
          .from("properties")
          .select("name, address, payment_bank_name, payment_account_number, payment_account_holder")
          .limit(1)
          .maybeSingle();
        p = (pRow ?? {}) as Record<string, unknown>;
      } catch (err) {
        console.warn("[getBookingInvoice] Failed to fetch property info:", err);
      }

      // Resolve PDF URL:
      // 1. Check invoices table for a previously stored URL.
      // 2. If missing, generate the PDF on-demand (no WhatsApp) and cache result.
      let pdfUrl: string | null = null;
      try {
        const { data: invRow } = await sb
          .from("invoices" as any)
          .select("pdf_url")
          .eq("booking_id", bookingId)
          .maybeSingle();

        if (invRow && (invRow as any).pdf_url) {
          pdfUrl = (invRow as any).pdf_url as string;
        }
      } catch {
        // invoices table may not exist yet — ignore and fall through to generation
      }

      if (!pdfUrl) {
        try {
          const { generateAndSendInvoiceNotification } = await import(
            "@/services/invoice-notification.service"
          );
          const result = await generateAndSendInvoiceNotification({
            supabase: supabaseAdmin as any,
            bookingId,
            skipWhatsApp: true,
          });
          if (result.ok && result.pdf_url) {
            pdfUrl = result.pdf_url;
          } else {
            console.warn("[getBookingInvoice] PDF generation failed:", result.error);
          }
        } catch (genErr) {
          console.warn("[getBookingInvoice] PDF on-demand generation threw:", genErr);
        }
      }

      const roomDetails = rows.map((row, idx) => ({
        id: String(row.id ?? `room-${idx + 1}`),
        room_id: row.room_id ? String(row.room_id) : null,
        room_number: ((row.rooms as Record<string, unknown> | null)?.number as string | undefined) ?? null,
        room_type_id: row.room_type_id ? String(row.room_type_id) : null,
        room_type: ((row.room_types as Record<string, unknown> | null)?.name as string | undefined) ?? "Kamar",
        nightly_rate: Number(row.nightly_rate ?? 0),
      }));

      const invoice: BookingInvoice = {
        reference_code: String(b.reference_code ?? ""),
        status: String(b.status ?? "pending"),
        check_in: String(b.check_in ?? ""),
        check_out: String(b.check_out ?? ""),
        nights: Number(b.nights) || Math.max(1, Math.round(
          (Date.parse(`${String(b.check_out)}T00:00:00Z`) - Date.parse(`${String(b.check_in)}T00:00:00Z`)) / 86_400_000
        )),
        adults: Number(b.adults ?? 0),
        children: Number(b.children ?? 0),
        rooms: rows.length || 1,
        room_type: roomType,
        nightly_rate: Number(rows[0]?.nightly_rate ?? 0),
        room_details: roomDetails,
        total_amount: Number(b.total_amount ?? 0),
        payment_status: (b.payment_status as any) ?? null,
        paid_amount: Number(b.paid_amount ?? 0),
        payment_method: String(b.payment_method ?? ""),
        check_in_time: String(b.check_in_time ?? ""),
        check_out_time: String(b.check_out_time ?? ""),
        special_requests: String(b.special_requests ?? ""),
        created_at: String(b.created_at ?? ""),
        pdf_url: pdfUrl,
        guest: {
          full_name: String(g.full_name ?? ""),
          email: String(g.email ?? ""),
          phone: String(g.phone ?? ""),
        },
        property: {
          name: String(p.name ?? "Pomah Guesthouse"),
          address: String(p.address ?? ""),
          bank: String(p.payment_bank_name ?? ""),
          account_number: String(p.payment_account_number ?? ""),
          account_holder: String(p.payment_account_holder ?? ""),
        },
      };
      return { invoice };
    } catch (err) {
      console.error("[getBookingInvoice] Unexpected handler error:", err);
      return { invoice: null };
    }
  });

/**
 * One room type by slug, for its dedicated booking page: the room (with
 * gallery images), how many physical rooms it has, the property, and the
 * other room types for the "Kamar Lainnya" section.
 */
export const getRoomTypeDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const fields =
      "id, name, slug, description, base_rate, capacity, bed_type, floor_info, size_sqm, amenities, hero_image_url, images";
    const sb = db(supabasePublic);
    const [{ data: property }, { data: room }, { data: others }] = await Promise.all([
      supabaseAdmin.from("properties").select("*").limit(1).maybeSingle(),
      sb.from("room_types").select(fields).eq("slug", data.slug).maybeSingle(),
      sb.from("room_types").select(fields).neq("slug", data.slug).order("base_rate"),
    ]);

    let roomCount = 0;
    if (room) {
      const { count } = await sb
        .from("rooms")
        .select("id", { count: "exact", head: true })
        .eq("room_type_id", (room as Record<string, unknown>).id as string);
      roomCount = count ?? 0;
    }

    return { property, room: room ?? null, others: others ?? [], roomCount };
  });

/* ------------------------------------------------------------------ */
/* Room-type availability                                              */
/* ------------------------------------------------------------------ */

/**
 * For a chosen date range, return which room types still have a free
 * room. A room type is available when its total room count exceeds the
 * number of active (pending/confirmed/checked-in) bookings that overlap
 * the range. Room types with no rooms defined are omitted (treated as
 * available by the caller).
 */
export const checkRoomTypeAvailability = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { checkIn, checkOut } = data;
    if (checkIn >= checkOut) {
      return {
        availability: {} as Record<string, boolean>,
        availableRooms: {} as Record<string, number>,
        rates: {} as Record<string, { base_rate: number; extrabed_rate: number }>,
        debug: { rows: 0, error: null },
      };
    }

    // Computed by a SECURITY DEFINER DB function so booking data stays
    // private — it returns only aggregate availability per room type.
    const client = supabasePublic as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: { room_type_id: string; total: number; taken: number; available: number }[] | null;
        error: { message: string } | null;
      }>;
    };
    const { data: rows, error } = await client.rpc("room_type_availability_detail", {
      p_check_in: checkIn,
      p_check_out: checkOut,
    });

    const availability: Record<string, boolean> = {};
    const availableRooms: Record<string, number> = {};
    for (const r of rows ?? []) {
      availability[r.room_type_id] = r.available > 0;
      availableRooms[r.room_type_id] = r.available;
    }

    // Fetch base rates and extrabed rates for all room types
    const { data: rts } = await supabasePublic
      .from("room_types")
      .select("id, base_rate, extrabed_rate");

    const rates: Record<string, { base_rate: number; extrabed_rate: number }> = {};
    if (rts && rts.length > 0) {
      const overrides = await getDailyRatesForRange(
        supabasePublic,
        rts.map((rt) => rt.id),
        checkIn,
        checkOut,
      );
      for (const rt of rts) {
        const resolved = resolveRoomNightlyRates(
          {
            id: rt.id,
            name: "",
            base_rate: Number(rt.base_rate ?? 0),
            capacity: null,
            bed_type: null,
            description: null,
            extrabed_rate: rt.extrabed_rate == null ? null : Number(rt.extrabed_rate),
          },
          checkIn,
          checkOut,
          overrides.get(rt.id),
        );
        const avgRate = resolved.nights > 0
          ? resolved.total / resolved.nights
          : Number(rt.base_rate ?? 0);
        const ebrTotal = resolved.nightly.reduce((acc, n) => acc + n.extrabed_rate, 0);
        const avgExtraBed = resolved.nights > 0
          ? ebrTotal / resolved.nights
          : Number(rt.extrabed_rate ?? 0);

        rates[rt.id] = {
          base_rate: avgRate,
          extrabed_rate: avgExtraBed,
        };
      }
    }

    return {
      availability,
      availableRooms,
      rates,
      debug: { rows: (rows ?? []).length, error: error?.message ?? null },
    };
  });

/* ------------------------------------------------------------------ */
/* Google reviews (Places API)                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* AI webchat (LLM)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run one turn of the public AI chatbot. The system prompt is built from
 * the AI LAB agent instructions and live room data ("tools"); the LLM is
 * any OpenAI-compatible endpoint configured in Settings → Integrasi.
 */
export const chatWithAI = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(2000),
            }),
          )
          .min(1)
          .max(24),
        // Stable per-session id so a webchat conversation is logged as one thread.
        threadId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("*")
      .limit(1)
      .maybeSingle();
    const p = (prop ?? {}) as Record<string, unknown>;

    // LLM resolution: prefer an explicitly configured key (Settings →
    // Integrasi); otherwise fall back to the Lovable AI gateway, which is
    // available via the LOVABLE_API_KEY env var in Lovable Cloud projects.
    const explicitKey = (p.ai_api_key as string | undefined)?.trim();
    const lovableKey = process.env.LOVABLE_API_KEY?.trim();
    const useLovable = !explicitKey && !!lovableKey;
    const key = explicitKey || lovableKey;
    if (!key) return { reply: null as string | null, error: "NO_AI_KEY" };

    const configuredModel = (p.ai_model as string | undefined)?.trim();
    const baseUrl = useLovable
      ? "https://ai.gateway.lovable.dev/v1"
      : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1")
          .trim()
          .replace(/\/+$/, "");
    // Lovable gateway expects namespaced model ids (e.g. google/gemini-2.5-flash).
    const model = useLovable
      ? configuredModel && configuredModel.includes("/")
        ? configuredModel
        : "google/gemini-2.5-flash"
      : configuredModel || "gpt-4o-mini";

    const cfg = mergeAiLabConfig(p.ai_lab_config);
    const { data: rooms } = await supabasePublic
      .from("room_types")
      .select("id, name, base_rate, capacity, bed_type, description")
      .order("base_rate");
    const roomRows = (rooms ?? []) as Record<string, unknown>[];

    const agentLines = AGENT_KEYS.filter(
      (k) => cfg.agents[k]?.enabled && cfg.agents[k]?.instructions?.trim(),
    ).map((k) => {
      let instr = cfg.agents[k].instructions.trim();
      instr = instr.replace(/\{\{PROPERTY_NAME\}\}/g, (p.name as string) ?? "Pomah Guesthouse");
      instr = instr.replace(/\{\{TODAY\}\}/g, fmtDateID(new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)));
      instr = instr.replace(/\{\{ROOM_DATA\}\}/g, ""); // Not needed for general webchat prompt since it's appended globally
      instr = instr.replace(/\{\{BANK_INFO\}\}/g, "");
      instr = instr.replace(/\{\{SOP_DATA\}\}/g, "");
      return `• ${k}: ${instr}`;
    });

    const roomLines = roomRows.map(
      (rr) =>
        `• ${rr.name} — Rp ${Number(rr.base_rate ?? 0).toLocaleString("id-ID")}/malam, kapasitas ${
          rr.capacity ?? "-"
        } tamu${rr.bed_type ? `, ${rr.bed_type}` : ""}`,
    );

    // SOP knowledge base — use semantic search to fetch relevant chunks
    let sopText = "";
    if (cfg.tools["sop-knowledge"]?.enabled) {
      const userMessage = [...data.messages].reverse().find(m => m.role === "user")?.content || "";
      try {
        sopText = await retrieveRelevantSopContext(
          db(supabaseAdmin),
          userMessage,
          { apiKey: key, baseUrl, model },
          5, // match count
          0.7 // threshold
        );
      } catch (e) {
        console.warn("[Webchat] SOP vector search error:", e);
      }
    }

    // Today in WIB (UTC+7) so "hari ini" is correct for Indonesia.
    const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const nextDay = (d: string) =>
      new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

    const system = [
      `Anda adalah asisten AI untuk ${(p.name as string) ?? "Pomah Guesthouse"}, sebuah penginapan.`,
      "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",
      `Hari ini tanggal ${fmtDateID(todayStr)}.`,
      "FORMAT TANGGAL: selalu tampilkan tanggal ke tamu dalam format Indonesia, " +
        "contoh '19 Mei 2026'. JANGAN tampilkan format YYYY-MM-DD. Hasil tool menyediakan " +
        "field tanggal siap-pakai (mis. `tanggal`, `periode`, `check_in_tampil`) — gunakan itu.",
      agentLines.length ? `Panduan tiap agent:\n${agentLines.join("\n")}` : "",
      roomLines.length
        ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
        : "",
      sopText
        ? "Cuplikan Pengetahuan SOP (hasil pencarian relevan, rujuk untuk menjawab kebijakan, prosedur, lokasi & info " +
          "lainnya). Sebagian cuplikan menyertakan '(Tautan: <url>)'. Bila tamu meminta link, " +
          "lokasi, peta/Google Maps, alamat, atau panduan tertentu, KIRIMKAN URL lengkap dari " +
          "cuplikan SOP yang relevan. Tulis URL-nya POLOS dan UTUH — salin persis, jangan " +
          "dipotong, jangan dibungkus tanda kurung/markdown, dan jangan beri tanda baca " +
          `menempel di akhir URL. Jangan pernah mengarang URL.\n${sopText}`
        : "",
      "KETERSEDIAAN KAMAR: Anda memiliki tool `check_room_availability`. Setiap kali tamu " +
        "menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin " +
        "booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak ketersediaan. " +
        "Jika tamu tidak menyebut tanggal, anggap untuk hari ini (check-in hari ini, 1 malam).",
      "Saat menyampaikan hasil tool: awali dengan baris 'Ketersediaan kamar untuk <tanggal>'. " +
        "Lalu tiap tipe kamar satu baris — gunakan ✅ bila ada kamar tersedia atau ❌ bila penuh, " +
        "diikuti nama kamar, jumlah kamar tersedia, dan harga per malam. " +
        "Tutup dengan ajakan memilih kamar untuk lanjut booking.",
      "BOOKING VIA CHAT: Anda dapat membuatkan pesanan kamar langsung. Alurnya: (1) cek " +
        "ketersediaan dengan tool, (2) setelah tamu memilih satu tipe kamar, minta nama " +
        "lengkap, email, dan nomor HP tamu, (3) setelah SEMUA data lengkap baru panggil tool " +
        "`create_booking`. JANGAN pernah mengarang data tamu — bila ada yang belum diberikan, " +
        "tanyakan dulu dan jangan panggil tool.",
      "Setelah `create_booking` berhasil: sampaikan sapaan dengan nama tamu, kode booking, " +
        "total harga, lalu instruksi transfer ke rekening (bank, nomor rekening, atas nama) " +
        "bila tersedia, dan minta tamu mengirim bukti pembayaran. Bila info rekening kosong, " +
        "beritahu tamu bahwa detail pembayaran akan dikirim staf. Bila tool gagal, sampaikan " +
        "alasannya dengan sopan.",
      "Untuk pemesanan, tamu juga bisa memakai widget pemesanan di halaman lalu klik 'Cek Ketersediaan' atau 'Pesan Kamar'.",
    ]
      .filter(Boolean)
      .join("\n\n");

    // SECURITY DEFINER RPC — returns aggregate counts only, no guest data.
    const rpcClient = supabasePublic as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: { room_type_id: string; total: number; taken: number; available: number }[] | null;
        error: { message: string } | null;
      }>;
    };

    /** Execute the availability tool — returns a JSON string for the LLM. */
    const runAvailability = async (rawArgs: Record<string, unknown>): Promise<string> => {
      const isDate = (v: unknown): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const checkIn = isDate(rawArgs.check_in) ? rawArgs.check_in : todayStr;
      let checkOut = isDate(rawArgs.check_out) ? rawArgs.check_out : nextDay(checkIn);
      if (checkOut <= checkIn) checkOut = nextDay(checkIn);
      const { data: rows } = await rpcClient.rpc("room_type_availability_detail", {
        p_check_in: checkIn,
        p_check_out: checkOut,
      });
      const byId = new Map((rows ?? []).map((r) => [r.room_type_id, r]));
      const kamar = roomRows.map((rr) => {
        const d = byId.get(rr.id as string);
        return {
          nama: rr.name,
          harga_per_malam: Number(rr.base_rate ?? 0),
          kamar_tersedia: d ? d.available : null,
          total_kamar: d ? d.total : null,
          catatan: d ? undefined : "jumlah kamar belum diatur di sistem",
        };
      });
      return JSON.stringify({
        check_in: checkIn,
        check_out: checkOut,
        tanggal: fmtDateID(checkIn),
        periode: `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`,
        kamar,
      });
    };

    /** Execute the booking tool — creates a real booking, returns JSON. */
    const runCreateBooking = async (raw: Record<string, unknown>): Promise<string> => {
      const isDate = (v: unknown): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const fullName = str(raw.full_name);
      const email = str(raw.email);
      const phone = str(raw.phone);
      const roomTypeName = str(raw.room_type).toLowerCase();
      const checkIn = isDate(raw.check_in) ? raw.check_in : "";
      const checkOut = isDate(raw.check_out) ? raw.check_out : "";
      const adults = Math.max(1, Math.min(8, Number(raw.adults) || 1));
      const children = Math.max(0, Math.min(8, Number(raw.children) || 0));

      if (!fullName || !email || !phone)
        return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return JSON.stringify({ ok: false, error: "Format email tidak valid." });
      if (!checkIn || !checkOut || checkOut <= checkIn)
        return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });

      // Match the chosen room type by name.
      const rt =
        roomRows.find((r) => String(r.name).toLowerCase() === roomTypeName) ??
        roomRows.find((r) => {
          const n = String(r.name).toLowerCase();
          return n.includes(roomTypeName) || roomTypeName.includes(n);
        });
      if (!rt)
        return JSON.stringify({
          ok: false,
          error: `Tipe kamar "${str(raw.room_type)}" tidak ditemukan.`,
        });

      // Re-check availability so we never overbook.
      const { data: availRows } = await rpcClient.rpc("room_type_availability_detail", {
        p_check_in: checkIn,
        p_check_out: checkOut,
      });
      const detail = (availRows ?? []).find((r) => r.room_type_id === (rt.id as string));
      if (detail && detail.available < 1)
        return JSON.stringify({
          ok: false,
          error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
        });

      const propId = p.id as string | undefined;
      if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

      const nights = Math.round(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
      );
      // Dynamic daily rate (overrides + stop_sell). For webchat we don't
      // have the room name handy in the error path, so surface generic copy.
      const dynRate = await resolveBookingNightlyRate(
        { id: rt.id as string, base_rate: Number(rt.base_rate ?? 0), extrabed_rate: Number(rt.extrabed_rate ?? 0) },
        checkIn,
        checkOut,
      );
      if (dynRate.stopSellDates.length > 0) {
        return JSON.stringify({
          ok: false,
          error:
            `Kamar ini tidak dijual untuk tanggal ${dynRate.stopSellDates.join(", ")}. ` +
            `Pilih tanggal lain ya.`,
        });
      }
      const rate = dynRate.avgRate;
      const total = rate * nights;

      // Writes use the service-role client: booking creation is a
      // trusted server-side action and the anon role cannot read back
      // the inserted rows (no SELECT policy on guests/bookings).
      const { data: guest, error: gerr } = await supabaseAdmin
        .from("guests")
        .insert({ full_name: fullName, email, phone })
        .select("id")
        .single();
      if (gerr || !guest)
        return JSON.stringify({
          ok: false,
          error: `Gagal menyimpan data tamu: ${gerr?.message ?? "tidak diketahui"}`,
        });

      const { data: booking, error: berr } = await supabaseAdmin
        .from("bookings")
        .insert({
          property_id: propId,
          guest_id: guest.id,
          check_in: checkIn,
          check_out: checkOut,
          nights,
          adults,
          children,
          total_amount: total,
          source: "direct",
          status: "pending",
        })
        .select("id, reference_code")
        .single();
      if (berr || !booking)
        return JSON.stringify({
          ok: false,
          error: `Gagal membuat booking: ${berr?.message ?? "tidak diketahui"}`,
        });

      // Auto room allotment — assign a free physical room if one exists.
      const assignedRoomId = await pickAvailableRoom(rt.id as string, checkIn, checkOut);
      const { error: brErr } = await supabaseAdmin.from("booking_rooms").insert({
        booking_id: booking.id,
        room_id: assignedRoomId,
        room_type_id: rt.id as string,
        nightly_rate: rate,
      });
      if (brErr)
        return JSON.stringify({
          ok: false,
          error: `Gagal menyimpan detail kamar: ${brErr.message}`,
        });

      // Notif manager — pakai waitUntil agar tetap jalan setelah response dikirim.
      const { runDeferred: runDeferredWebchat } = await import("@/lib/cf-context");
      runDeferredWebchat("webchatTool.notifyNewBooking", async () => {
        const { notifyNewBooking } = await import("@/services/manager-notifier.service");
        await notifyNewBooking(supabaseAdmin, booking.id);
      });

      return JSON.stringify({
        ok: true,
        reference_code: booking.reference_code,
        room_type: rt.name,
        check_in: checkIn,
        check_out: checkOut,
        check_in_tampil: fmtDateID(checkIn),
        check_out_tampil: fmtDateID(checkOut),
        nights,
        nightly_rate: rate,
        total,
        guest: { full_name: fullName, email, phone },
        pembayaran: {
          bank: (p.payment_bank_name as string | undefined) || null,
          no_rekening: (p.payment_account_number as string | undefined) || null,
          atas_nama: (p.payment_account_holder as string | undefined) || null,
        },
        invoice_url: (() => {
          const pDom = (p.public_domain as string | undefined)?.trim();
          const base = pDom
            ? (pDom.startsWith("http") ? pDom : `https://${pDom}`).replace(/\/+$/, "")
            : "https://pomahguesthouse.com";
          return `${base}/book/confirmation/${booking.reference_code ?? booking.id}`;
        })(),
      });
    };

    const tools = [
      {
        type: "function",
        function: {
          name: "check_room_availability",
          description:
            "Cek ketersediaan kamar nyata (jumlah kamar kosong per tipe) untuk rentang tanggal. Gunakan saat tamu menanyakan kamar tersedia/kosong atau ingin booking.",
          parameters: {
            type: "object",
            properties: {
              check_in: {
                type: "string",
                description: "Tanggal check-in format YYYY-MM-DD. Kosongkan untuk hari ini.",
              },
              check_out: {
                type: "string",
                description:
                  "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk sehari setelah check-in.",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_booking",
          description:
            "Buat pesanan/booking kamar untuk tamu. Panggil HANYA setelah tamu memilih tipe kamar dan memberikan nama lengkap, email, dan nomor HP. Jangan panggil bila data belum lengkap.",
          parameters: {
            type: "object",
            properties: {
              room_type: {
                type: "string",
                description: "Nama tipe kamar yang dipilih tamu, mis. 'Single'.",
              },
              full_name: { type: "string", description: "Nama lengkap tamu." },
              email: { type: "string", description: "Alamat email tamu." },
              phone: { type: "string", description: "Nomor HP/WhatsApp tamu." },
              check_in: {
                type: "string",
                description: "Tanggal check-in format YYYY-MM-DD.",
              },
              check_out: {
                type: "string",
                description: "Tanggal check-out format YYYY-MM-DD.",
              },
              adults: { type: "number", description: "Jumlah tamu dewasa. Default 1." },
              children: { type: "number", description: "Jumlah anak. Default 0." },
            },
            required: ["room_type", "full_name", "email", "phone", "check_in", "check_out"],
          },
        },
      },
    ];

    // Friendly names for the tools, and a record of which ones actually ran.
    const TOOL_LABEL: Record<string, string> = {
      check_room_availability: "Room Availability",
      create_booking: "Booking Engine",
    };
    const toolsUsed = new Set<string>();

    /** Ask the LLM to classify the guest's intent (best-effort). */
    const classifyIntent = async (
      userMsg: string,
      reply: string,
    ): Promise<{ intent: string; confidence: number }> => {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 80,
            messages: [
              {
                role: "system",
                content:
                  "Anda pengklasifikasi intent percakapan tamu hotel. Balas HANYA JSON " +
                  '{"intent":"<3-5 kata Bahasa Indonesia>","confidence":<0..1>} tanpa teks lain.',
              },
              { role: "user", content: `Pesan tamu: ${userMsg}\nBalasan asisten: ${reply}` },
            ],
          }),
        });
        const txt = await res.text();
        const json = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content ?? "";
        const m = content.match(/\{[\s\S]*\}/);
        if (m) {
          const o = JSON.parse(m[0]) as { intent?: string; confidence?: number };
          return {
            intent: String(o.intent ?? "").slice(0, 80),
            confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
          };
        }
      } catch {
        /* classification is optional */
      }
      return { intent: "", confidence: 0 };
    };

    type LlmMsg = Record<string, unknown>;
    const messages: LlmMsg[] = [{ role: "system", content: system }, ...data.messages];

    try {
      // Tool-calling loop: the model may call the availability tool, we
      // run it, feed results back, and let it compose the final reply.
      for (let turn = 0; turn < 4; turn++) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0.6,
            max_tokens: 600,
            messages,
            tools,
            tool_choice: "auto",
          }),
        });
        const raw = await res.text();
        let json: {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: {
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
          error?: { message?: string };
        };
        try {
          json = JSON.parse(raw);
        } catch {
          return {
            reply: null as string | null,
            error: `HTTP ${res.status}: ${raw.slice(0, 200)}`,
          };
        }
        const msg = json.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls ?? [];
        if (toolCalls.length) {
          messages.push(msg as LlmMsg);
          for (const tc of toolCalls) {
            let out = JSON.stringify({ error: "unknown tool" });
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function?.arguments || "{}");
            } catch {
              args = {};
            }
            if (tc.function?.name === "check_room_availability") {
              out = await runAvailability(args);
              toolsUsed.add(TOOL_LABEL.check_room_availability);
            } else if (tc.function?.name === "create_booking") {
              out = await runCreateBooking(args);
              toolsUsed.add(TOOL_LABEL.create_booking);
            }
            messages.push({ role: "tool", tool_call_id: tc.id, content: out });
          }
          continue;
        }
        const reply = msg?.content;
        if (reply && reply.trim()) {
          const finalReply = reply.trim();
          // Log the exchange as one webchat thread with real metadata
          // (best-effort — never block the reply).
          if (data.threadId) {
            const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
            if (lastUser) {
              try {
                const { intent, confidence } = await classifyIntent(lastUser.content, finalReply);
                await rpcClient.rpc("log_webchat_message", {
                  p_thread_id: data.threadId,
                  p_user_message: lastUser.content,
                  p_ai_response: finalReply,
                  p_metadata: {
                    intent,
                    confidence,
                    tools: Array.from(toolsUsed),
                  },
                });
              } catch {
                /* logging must never break the reply */
              }
            }
          }
          return { reply: finalReply, error: null as string | null };
        }
        const detail = json.error?.message ?? `HTTP ${res.status} · ${raw.slice(0, 400)}`;
        return { reply: null as string | null, error: detail };
      }
      return { reply: null as string | null, error: "TOOL_LOOP_LIMIT" };
    } catch (e) {
      return { reply: null as string | null, error: (e as Error).message };
    }
  });

/* ------------------------------------------------------------------ */
/* Explore (public) — published items grouped by category             */
/* ------------------------------------------------------------------ */

export type PublicExploreItem = {
  id: string;
  category: "event" | "destinasi" | "kuliner" | "tips";
  title: string;
  description: string | null;
  image_url: string | null;
  rating: number | null;
  badge: string | null;
  date_text: string | null;
  location_text: string | null;
  sort_order: number;
};

export const getPublicExploreItems = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { data, error } = await db(supabasePublic)
      .from("explore_items")
      .select("id, category, title, description, image_url, rating, badge, date_text, location_text, sort_order")
      .eq("is_published", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) {
      const message = String(error.message ?? error);
      console.warn("[PublicExplore] failed to load items:", message.slice(0, 300));
      return [] as PublicExploreItem[];
    }
    return (data ?? []) as PublicExploreItem[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[PublicExplore] request failed:", message.slice(0, 300));
    return [] as PublicExploreItem[];
  }
});
