import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "check_availability",
  title: "Check room availability",
  description:
    "Check available room types at Pomah Guesthouse for a given check-in / check-out date range (YYYY-MM-DD).",
  inputSchema: {
    check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date, format YYYY-MM-DD."),
    check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date, format YYYY-MM-DD."),
    guests: z.number().int().positive().optional().describe("Number of guests (optional)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ check_in, check_out, guests }) => {
    if (new Date(check_out) <= new Date(check_in)) {
      return {
        content: [{ type: "text", text: "check_out must be after check_in" }],
        isError: true,
      };
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: rooms, error } = await supabase
      .from("room_types")
      .select("id, name, slug, base_rate, max_occupancy, total_units")
      .eq("is_published", true);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }

    const filtered = (rooms ?? []).filter(
      (r) => !guests || (r.max_occupancy ?? 0) >= guests,
    );

    // Best-effort availability: overlap = booking_rooms whose booking overlaps range.
    const { data: overlaps } = await supabase
      .from("booking_rooms")
      .select("room_type_id, bookings!inner(check_in, check_out, status)")
      .lt("bookings.check_in", check_out)
      .gt("bookings.check_out", check_in)
      .in("bookings.status", ["confirmed", "pending", "checked_in"]);

    const takenByRoom: Record<string, number> = {};
    for (const row of (overlaps ?? []) as Array<{ room_type_id: string }>) {
      takenByRoom[row.room_type_id] = (takenByRoom[row.room_type_id] ?? 0) + 1;
    }

    const result = filtered.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      base_rate: r.base_rate,
      max_occupancy: r.max_occupancy,
      units_available: Math.max(0, (r.total_units ?? 0) - (takenByRoom[r.id] ?? 0)),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: { check_in, check_out, guests, rooms: result },
    };
  },
});
