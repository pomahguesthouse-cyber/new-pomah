import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import type { PublicProperty } from "@/public/functions/public.functions";

async function handle(): Promise<Response> {
  try {
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

    return Response.json({ property, roomTypes }, {
      headers: {
        "Cache-Control": "public, max-age=60",
      }
    });
  } catch (error: any) {
    console.error("[api.public-site-data] Error fetching site data:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public-site-data")({
  server: {
    handlers: {
      GET: async () => handle(),
    },
  },
});
