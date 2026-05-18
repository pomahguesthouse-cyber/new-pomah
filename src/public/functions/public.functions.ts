import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabasePublic } from "@/integrations/supabase/client.server";

export const getPublicSiteData = createServerFn({ method: "GET" }).handler(async () => {
  const [{ data: property }, { data: roomTypes }] = await Promise.all([
    supabasePublic.from("properties").select("*").limit(1).maybeSingle(),
    supabasePublic
      .from("room_types")
      .select(
        "id, name, slug, description, base_rate, capacity, bed_type, size_sqm, amenities, hero_image_url",
      )
      .order("base_rate"),
  ]);
  return { property, roomTypes: roomTypes ?? [] };
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
        specialRequests: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: property } = await supabasePublic
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (!property) throw new Error("Property not configured");

    const { data: rt } = await supabasePublic
      .from("room_types")
      .select("id, base_rate")
      .eq("id", data.roomTypeId)
      .single();
    if (!rt) throw new Error("Room type not found");

    const nights =
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000;
    if (nights < 1) throw new Error("Check-out must be after check-in");

    const { data: guest, error: gerr } = await supabasePublic
      .from("guests")
      .insert({
        full_name: data.fullName,
        email: data.email,
        phone: data.phone || null,
      })
      .select("id")
      .single();
    if (gerr || !guest) throw gerr ?? new Error("Could not create guest");

    const total = Number(rt.base_rate) * nights;
    const { data: booking, error: berr } = await supabasePublic
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
        special_requests: data.specialRequests || null,
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking) throw berr ?? new Error("Could not create booking");

    // One booking_rooms line for the chosen room type (room assigned
    // later by staff).
    const { error: brErr } = await supabasePublic.from("booking_rooms").insert({
      booking_id: booking.id,
      room_id: null,
      room_type_id: rt.id,
      nightly_rate: rt.base_rate,
    });
    if (brErr) throw brErr;

    return { id: booking.id, reference_code: booking.reference_code, total, nights };
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

/* ------------------------------------------------------------------ */
/* Google reviews (Places API)                                         */
/* ------------------------------------------------------------------ */

export interface GoogleReview {
  author: string;
  text: string;
  rating: number;
}
export interface GoogleReviewsResult {
  rating: number | null;
  total: number | null;
  reviews: GoogleReview[];
  /** Diagnostic — Places API status or a local error code. */
  status: string;
}

const empty = (status: string): GoogleReviewsResult => ({
  rating: null,
  total: null,
  reviews: [],
  status,
});

/**
 * Fetch the property's Google rating, review count and recent reviews
 * from the Google Places API. The Place ID and API key come from the
 * property's integration settings (Settings → Integrasi); the key also
 * falls back to the GOOGLE_PLACES_API_KEY env var. Returns empty data
 * (so the homepage falls back) on any failure.
 */
export const getGoogleReviews = createServerFn({ method: "GET" }).handler(async () => {
  const { data: prop } = await supabasePublic
    .from("properties")
    .select("google_place_id, google_places_api_key")
    .limit(1)
    .maybeSingle();
  const row = (prop as Record<string, unknown> | null) ?? {};
  const placeId = (row.google_place_id as string | undefined)?.trim();
  const key = (
    (row.google_places_api_key as string | undefined) || process.env.GOOGLE_PLACES_API_KEY
  )?.trim();
  if (!key) return empty("NO_API_KEY");
  if (!placeId) return empty("NO_PLACE_ID");

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(placeId)}` +
      "&fields=rating,user_ratings_total,reviews&language=id" +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: { author_name?: string; text?: string; rating?: number }[];
      };
    };
    if (json.status !== "OK") {
      // e.g. REQUEST_DENIED (key restricted / Places API off), NOT_FOUND.
      return empty(
        json.status ? `${json.status}: ${json.error_message ?? ""}`.trim() : "API_ERROR",
      );
    }
    const r = json.result ?? {};
    const reviews: GoogleReview[] = Array.isArray(r.reviews)
      ? r.reviews
          .slice(0, 6)
          .map((rv) => ({
            author: String(rv.author_name ?? "Tamu"),
            text: String(rv.text ?? ""),
            rating: Number(rv.rating ?? 0),
          }))
          .filter((rv) => rv.text)
      : [];
    return {
      rating: typeof r.rating === "number" ? r.rating : null,
      total: typeof r.user_ratings_total === "number" ? r.user_ratings_total : null,
      reviews,
      status: "OK",
    };
  } catch (e) {
    return empty(`FETCH_ERROR: ${(e as Error).message}`);
  }
});
