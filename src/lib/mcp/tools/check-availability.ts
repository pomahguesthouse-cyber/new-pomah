import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Klien minimal yang dipakai tool. Client anon (publishable key) boleh
 * membaca `room_types` yang published dan memanggil RPC
 * `room_type_availability_detail` (SECURITY DEFINER). Jangan baca
 * `bookings` / `booking_rooms` langsung: RLS anon mengosongkan hasil,
 * dan error yang diabaikan membuat semua tipe terlihat tersedia.
 */
export type RoomTypePublicRow = {
  id: string;
  name: string;
  slug: string;
  base_rate: number;
  max_occupancy: number | null;
};

export type RoomTypeAvailabilityDetailRow = {
  room_type_id: string;
  total: number;
  taken: number;
  available: number;
};

type QueryError = { message: string };

export type AvailabilityReader = {
  from(table: "room_types"): {
    select(columns: string): {
      eq(
        column: "is_published",
        value: boolean,
      ): PromiseLike<{ data: RoomTypePublicRow[] | null; error: QueryError | null }>;
    };
  };
  rpc(
    fn: "room_type_availability_detail",
    args: { p_check_in: string; p_check_out: string },
  ): PromiseLike<{
    data: RoomTypeAvailabilityDetailRow[] | null;
    error: QueryError | null;
  }>;
};

export type CheckAvailabilityInput = {
  check_in: string;
  check_out: string;
  guests?: number;
};

export type CheckAvailabilityRoom = {
  id: string;
  name: string;
  slug: string;
  base_rate: number;
  max_occupancy: number | null;
  units_available: number;
  available: boolean;
};

export type CheckAvailabilityResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: {
    check_in: string;
    check_out: string;
    guests?: number;
    rooms: CheckAvailabilityRoom[];
  };
};

function fail(message: string): CheckAvailabilityResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Hitung ketersediaan tipe kamar published.
 * `units_available` hanya dari RPC. Tipe yang tidak ada di hasil RPC
 * dianggap 0 (jangan fallback ke `total_units`). Error RPC mengembalikan
 * kegagalan — tidak pernah diasumsikan semua kamar kosong/tersedia.
 * Tipe yang lolos filter tamu tetap dikembalikan, termasuk yang penuh,
 * dengan `available: false`.
 */
export async function handleCheckAvailability(
  input: CheckAvailabilityInput,
  supabase: AvailabilityReader,
): Promise<CheckAvailabilityResult> {
  const { check_in, check_out, guests } = input;
  if (new Date(check_out) <= new Date(check_in)) {
    return fail("check_out must be after check_in");
  }

  let rooms: RoomTypePublicRow[] | null;
  let roomsError: QueryError | null;
  let rows: RoomTypeAvailabilityDetailRow[] | null;
  let availError: QueryError | null;
  try {
    const [typesResult, availResult] = await Promise.all([
      supabase
        .from("room_types")
        .select("id, name, slug, base_rate, max_occupancy")
        .eq("is_published", true),
      supabase.rpc("room_type_availability_detail", {
        p_check_in: check_in,
        p_check_out: check_out,
      }),
    ]);
    rooms = typesResult.data;
    roomsError = typesResult.error;
    rows = availResult.data;
    availError = availResult.error;
  } catch (e) {
    const message = e instanceof Error ? e.message : "availability check failed";
    return fail(message);
  }

  if (roomsError) return fail(roomsError.message);
  // Jangan lanjut dengan stok kosong palsu bila agregat ketersediaan gagal.
  if (availError) return fail(availError.message);
  if (!Array.isArray(rows)) {
    return fail("room_type_availability_detail returned an invalid payload");
  }

  const availableByType = new Map<string, number>();
  for (const row of rows) {
    const units = Number(row.available);
    if (!row.room_type_id || row.available == null || !Number.isFinite(units)) {
      return fail("room_type_availability_detail returned an invalid payload");
    }
    availableByType.set(row.room_type_id, units);
  }

  const filtered = (rooms ?? []).filter((r) => !guests || (r.max_occupancy ?? 0) >= guests);
  const result: CheckAvailabilityRoom[] = filtered.map((r) => {
    const unitsAvailable = Math.max(0, availableByType.get(r.id) ?? 0);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      base_rate: r.base_rate,
      max_occupancy: r.max_occupancy,
      units_available: unitsAvailable,
      available: unitsAvailable > 0,
    };
  });

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: { check_in, check_out, guests, rooms: result },
  };
}

export default defineTool({
  name: "check_availability",
  title: "Check room availability",
  description:
    "Check published room types at Pomah Guesthouse for a check-in / check-out range (YYYY-MM-DD). Each room includes units_available and available (false when none are left, including sold-out types). A failed lookup is an error and must not be treated as free rooms.",
  inputSchema: {
    check_in: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Check-in date, format YYYY-MM-DD."),
    check_out: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Check-out date, format YYYY-MM-DD."),
    guests: z.number().int().positive().optional().describe("Number of guests (optional)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ check_in, check_out, guests }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    return handleCheckAvailability(
      { check_in, check_out, guests },
      supabase as unknown as AvailabilityReader,
    );
  },
});
