import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { PUBLIC_LISTED_ROOM_TYPE_COLUMNS, queryWithOptionalRoomLayout, selectColumns } from "@/lib/room-layout";
import { toPublicSettings } from "@/public/lib/public-settings";

async function handle(): Promise<Response> {
  try {
    const [{ data: propertyData }, { data: roomTypesRaw }] = await Promise.all([
      supabasePublic.rpc("get_public_property" as never),
      queryWithOptionalRoomLayout(PUBLIC_LISTED_ROOM_TYPE_COLUMNS, (columns) =>
        selectColumns(supabasePublic.from("room_types"), columns).order("base_rate"),
      ),
    ]);

    const property = toPublicSettings(propertyData);

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
