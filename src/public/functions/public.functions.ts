import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  getDailyRatesForRange,
  resolveRoomNightlyRates,
} from "@/services/pricing/daily-rate.service";
import { resolveOrCreateGuest } from "@/services/guest-resolver.service";
import { computeBookingExpiryIso } from "@/lib/booking-expiry";
import { stripPastEventsFromExploreConfig } from "@/lib/explore-event-date";
import {
  applyApprovedHomepageSeo,
  applyGuideCardIntros,
  patchUnnesDistance,
  publicRoomBlurb,
} from "@/public/content/approved-seo";
import { PUBLIC_PROPERTY_FIELDS, toPublicSettings } from "@/public/lib/public-settings";
import { loadPublicPropertyRow } from "@/public/lib/public-property.server";

/**
 * Resolve dynamic per-night rate AND extrabed rate for ONE room type
 * over a stay.
 *
 * Used by every booking-creation path here (single room and cart) so
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

type PublicSiteData = { property: PublicProperty | null; roomTypes: any[] };

const SITE_DATA_TTL_MS = 60_000;
let siteDataCache: { at: number; value: PublicSiteData } | null = null;
let siteDataPending: Promise<PublicSiteData> | null = null;

async function loadPublicSiteData(): Promise<PublicSiteData> {
  const now = Date.now();
  if (siteDataCache && now - siteDataCache.at < SITE_DATA_TTL_MS) return siteDataCache.value;
  if (siteDataPending) return siteDataPending;
  siteDataPending = (async () => {
    const [propertyData, roomTypesResult] = await Promise.all([
      loadPublicPropertyRow(),
      supabasePublic
        .from("room_types")
        .select(
          "id, name, slug, description, base_rate, extrabed_rate, extrabed_capacity, capacity, bed_type, floor_info, size_sqm, amenities, hero_image_url, images, rooms(id)",
        )
        .order("base_rate"),
    ]);
    const value = shapePublicSiteData(propertyData, roomTypesResult.data);
    if (value.property || value.roomTypes.length > 0) {
      siteDataCache = { at: Date.now(), value };
    }
    return value;
  })().finally(() => {
    siteDataPending = null;
  });
  return siteDataPending;
}

function shapePublicSiteData(propertyData: unknown, roomTypesRaw: any[] | null): PublicSiteData {

  const propertyRaw = (propertyData ?? null) as (PublicProperty & Record<string, unknown>) | null;
  const property = propertyRaw
    ? (toPublicSettings({
        ...propertyRaw,
        homepage_config: applyApprovedHomepageSeo(patchUnnesDistance(propertyRaw.homepage_config)) as Json,
        explore_config: applyGuideCardIntros(
          stripPastEventsFromExploreConfig(propertyRaw.explore_config),
        ) as Json,
      }) as PublicProperty)
    : null;

  const normalizedRoomTypes = (roomTypesRaw ?? []).map((rt: any) => ({
    ...rt,
    description: publicRoomBlurb(rt.slug, rt.description),
    rooms: undefined,
    total_physical_rooms: Array.isArray(rt.rooms) ? rt.rooms.length : 0,
  }));

  const roomTypesByKey = new Map<string, any>();

  for (const rt of normalizedRoomTypes) {
    const key = String(rt.slug || rt.name || rt.id).trim().toLowerCase();
    const existing = roomTypesByKey.get(key);
    const existingRooms = Number(existing?.total_physical_rooms ?? 0);
    const currentRooms = Number(rt.total_physical_rooms ?? 0);

    if (!existing || currentRooms > existingRooms) {
      roomTypesByKey.set(key, rt);
    }
  }

  const roomTypes = Array.from(roomTypesByKey.values()).sort(
    (a: any, b: any) => Number(a.base_rate ?? 0) - Number(b.base_rate ?? 0),
  );

  return { property, roomTypes };
}

export const getPublicSiteData = createServerFn({ method: "GET" }).handler(async () => loadPublicSiteData());

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

    const row =
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
    const guest = await resolveOrCreateGuest(supabaseAdmin as any, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      source: "booking",
    });

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
        expires_at: computeBookingExpiryIso(),
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

    const guest = await resolveOrCreateGuest(supabaseAdmin as any, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      source: "booking",
    });

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
        expires_at: computeBookingExpiryIso(),
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

/**
 * Bentuk identifier booking yang boleh masuk ke lookup publik: UUID atau kode
 * booking (huruf/angka/strip). Wildcard `%`/`_`, spasi, dan karakter lain
 * ditolak di sini — audit 7 Agu 2026 (S1): `ilike("reference_code", "%")`
 * mengembalikan invoice tamu acak lengkap dengan email + nomor HP.
 */
const BOOKING_LOOKUP_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9-]{3,20})$/i;

/** Full invoice detail for a booking — used by the public confirmation page. */
export const getBookingInvoice = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: z
          .string()
          .min(1)
          .max(64)
          .transform((v) => v.trim())
          .refine((v) => BOOKING_LOOKUP_ID_RE.test(v), "Format kode booking tidak valid"),
      })
      .parse(d),
  )
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
        // Pencocokan persis (case-insensitive lewat normalisasi ke huruf
        // besar), BUKAN `ilike` — pola akan memperlakukan `%`/`_` sebagai
        // wildcard dan membocorkan booking milik tamu lain.
        const upper = rawId.toUpperCase();
        const candidates = upper === rawId ? [upper] : [upper, rawId];
        let byCode: { id: string } | null = null;
        let codeErr: unknown = null;
        for (const candidate of candidates) {
          const res = await sb.from("bookings").select("id").eq("reference_code", candidate).maybeSingle();
          if (res.error) codeErr = res.error;
          if (res.data) {
            byCode = res.data as { id: string };
            break;
          }
        }
        if (codeErr && !byCode) {
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
          .select("id, room_id, room_type_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(name), rooms(number)")
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
        extra_bed_count: Number(row.extra_bed_count ?? 0),
        extra_bed_rate: Number(row.extra_bed_rate ?? 0),
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
      "id, name, slug, description, base_rate, capacity, bed_type, floor_info, size_sqm, amenities, hero_image_url, images, seo_h1, seo_title, meta_description";
    const sb = db(supabasePublic);
    const [{ data: propertyRow }, { data: room }, { data: others }] = await Promise.all([
      db(supabaseAdmin)
        .from("properties")
        .select(PUBLIC_PROPERTY_FIELDS.join(", "))
        .limit(1)
        .maybeSingle(),
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

    const withPublicBlurb = <T extends { slug?: string | null; description?: string | null }>(row: T | null) =>
      row ? { ...row, description: publicRoomBlurb(row.slug, row.description) } : null;
    const property = toPublicSettings(propertyRow) as PublicProperty | null;

    return {
      property: property
        ? {
            ...property,
            homepage_config: applyApprovedHomepageSeo(
              patchUnnesDistance(property.homepage_config),
            ) as Json,
            explore_config: applyGuideCardIntros(
              stripPastEventsFromExploreConfig(property.explore_config),
            ) as Json,
          }
        : property,
      room: withPublicBlurb(room),
      others: (others ?? []).map((row) => withPublicBlurb(row)),
      roomCount,
    };
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
