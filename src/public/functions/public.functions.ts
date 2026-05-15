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
        room_type_id: rt.id,
        guest_id: guest.id,
        check_in: data.checkIn,
        check_out: data.checkOut,
        adults: data.adults,
        children: data.children,
        nightly_rate: rt.base_rate,
        total_amount: total,
        source: "direct",
        status: "pending",
        special_requests: data.specialRequests || null,
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking) throw berr ?? new Error("Could not create booking");

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

/**
 * Fetch a PUBLISHED landing page by slug for the public `/p/$slug` route.
 * RLS restricts the anon key to `status = 'published'` rows, so drafts
 * are never exposed. The builder tables are not in the generated types,
 * hence the untyped client view.
 */
export const getPublishedLandingPage = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const client = supabasePublic as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
          };
        };
      };
    };
    const { data: page } = await client
      .from("landing_pages")
      .select("title, slug, published_content, seo_title, seo_description, og_image_url, noindex")
      .eq("slug", data.slug)
      .eq("status", "published")
      .maybeSingle();
    return { page: page ?? null };
  });
