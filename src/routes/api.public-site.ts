import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { PUBLIC_LISTED_ROOM_TYPE_COLUMNS, queryWithOptionalRoomLayout, selectColumns } from "@/lib/room-layout";
import { toPublicSettings } from "@/public/lib/public-settings";

async function handle(): Promise<Response> {
  try {
    const [{ data: propertyData, error: propertyError }, { data: roomTypesRaw, error: roomTypesError }] = await Promise.all([
      supabasePublic.rpc("get_public_property" as never),
      queryWithOptionalRoomLayout(PUBLIC_LISTED_ROOM_TYPE_COLUMNS, (columns) =>
        selectColumns(supabasePublic.from("room_types"), columns).order("base_rate"),
      ),
    ]);

    if (propertyError) throw new Error(propertyError.message);
    if (roomTypesError) throw new Error(roomTypesError.message);

    const roomTypes = (roomTypesRaw ?? []).map((rt: any) => ({
      ...rt,
      rooms: undefined,
      total_physical_rooms: Array.isArray(rt.rooms) ? rt.rooms.length : 0,
    }));

    return new Response(JSON.stringify({ property: toPublicSettings(propertyData), roomTypes }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api/public-site]", err);
    return new Response(JSON.stringify({ property: null, roomTypes: [], error: (err as Error).message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public-site")({
  server: {
    handlers: {
      GET: async () => handle(),
    },
  },
});
