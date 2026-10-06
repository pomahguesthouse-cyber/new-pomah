/**
 * Regresi MCP `check_availability`.
 *
 * Tool wajib memakai RPC `room_type_availability_detail`, bukan baca
 * `booking_rooms` dengan client anon. 20 Nov 2026 penuh (available=0).
 * 16 Okt 2026 hanya Grand Deluxe yang tersisa 1. Error RPC adalah
 * isError — jangan menganggap semua tipe tersedia.
 *
 * `bun run test:mcp-availability`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handleCheckAvailability,
  type AvailabilityReader,
  type RoomTypeAvailabilityDetailRow,
  type RoomTypePublicRow,
} from "../src/lib/mcp/tools/check-availability";

const GRAND: RoomTypePublicRow = {
  id: "rt-grand",
  name: "Grand Deluxe",
  slug: "grand-deluxe",
  base_rate: 550000,
  max_occupancy: 3,
};
const DELUXE: RoomTypePublicRow = {
  id: "rt-deluxe",
  name: "Deluxe",
  slug: "deluxe",
  base_rate: 350000,
  max_occupancy: 2,
};
const FAMILY: RoomTypePublicRow = {
  id: "rt-family",
  name: "Family",
  slug: "family",
  base_rate: 650000,
  max_occupancy: 4,
};

function row(
  room_type_id: string,
  total: number,
  taken: number,
  available: number,
): RoomTypeAvailabilityDetailRow {
  return { room_type_id, total, taken, available };
}

function mockClient(opts: {
  rooms?: RoomTypePublicRow[];
  roomsError?: { message: string } | null;
  availability?: RoomTypeAvailabilityDetailRow[] | null;
  availabilityError?: { message: string } | null;
  throwOnRpc?: boolean;
}): { client: AvailabilityReader; calls: { tables: string[]; rpc: number } } {
  const calls = { tables: [] as string[], rpc: 0 };
  const client: AvailabilityReader = {
    from(table) {
      calls.tables.push(table);
      if (table !== "room_types") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq: async () => ({
              data: opts.roomsError ? null : (opts.rooms ?? []),
              error: opts.roomsError ?? null,
            }),
          };
        },
      };
    },
    rpc: async (fn) => {
      calls.rpc += 1;
      if (fn !== "room_type_availability_detail") {
        throw new Error(`unexpected rpc ${fn}`);
      }
      if (opts.throwOnRpc) throw new Error("rpc transport failed");
      return {
        data: opts.availabilityError ? null : (opts.availability ?? null),
        error: opts.availabilityError ?? null,
      };
    },
  };
  return { client, calls };
}

const source = readFileSync(
  new URL("../src/lib/mcp/tools/check-availability.ts", import.meta.url),
  "utf8",
);
assert.equal(
  source.includes('.from("booking_rooms")') || source.includes(".from('booking_rooms')"),
  false,
  "tool tidak boleh membaca booking_rooms",
);
assert.match(source, /room_type_availability_detail/);

// 20–21 Nov 2026: semua tipe penuh.
{
  const { client, calls } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 2, 0), row(DELUXE.id, 4, 4, 0), row(FAMILY.id, 2, 2, 0)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-11-20", check_out: "2026-11-21" },
    client,
  );
  assert.equal(res.isError, undefined);
  assert.deepEqual(calls.tables, ["room_types"]);
  assert.equal(calls.rpc, 1);
  const rooms = res.structuredContent?.rooms ?? [];
  assert.equal(rooms.length, 3);
  assert.ok(rooms.every((r) => r.available === false && r.units_available === 0));
  assert.deepEqual(
    rooms.map((r) => r.slug),
    ["grand-deluxe", "deluxe", "family"],
  );
  const parsed = JSON.parse(res.content[0].text) as typeof rooms;
  assert.deepEqual(parsed, rooms);
}

// 16–17 Okt 2026: hanya Grand Deluxe sisa 1.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 1, 1), row(DELUXE.id, 4, 4, 0), row(FAMILY.id, 2, 2, 0)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  const rooms = res.structuredContent?.rooms ?? [];
  const grand = rooms.find((r) => r.name === "Grand Deluxe");
  assert.ok(grand);
  assert.equal(grand.units_available, 1);
  assert.equal(grand.available, true);
  assert.equal(grand.base_rate, 550000);
  assert.equal(grand.max_occupancy, 3);
  assert.equal(grand.id, GRAND.id);
  assert.equal(rooms.filter((r) => r.available).length, 1);
  assert.ok(rooms.filter((r) => r.slug !== "grand-deluxe").every((r) => r.units_available === 0));
}

// Tipe published yang tidak ada di RPC tidak boleh dianggap tersedia.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE],
    availability: [row(DELUXE.id, 4, 0, 4)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  const grand = res.structuredContent?.rooms.find((r) => r.id === GRAND.id);
  assert.equal(grand?.units_available, 0);
  assert.equal(grand?.available, false);
  const deluxe = res.structuredContent?.rooms.find((r) => r.id === DELUXE.id);
  assert.equal(deluxe?.units_available, 4);
  assert.equal(deluxe?.available, true);
}

// Filter tamu tetap memakai max_occupancy.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 1, 1), row(DELUXE.id, 4, 0, 4), row(FAMILY.id, 2, 2, 0)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17", guests: 4 },
    client,
  );
  assert.deepEqual(
    res.structuredContent?.rooms.map((r) => r.slug),
    ["family"],
  );
  assert.equal(res.structuredContent?.rooms[0].available, false);
  assert.equal(res.structuredContent?.guests, 4);
}

// Error RPC → isError, tanpa daftar kamar "tersedia".
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availabilityError: { message: "permission denied for table bookings" },
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-11-20", check_out: "2026-11-21" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.equal(res.content[0].text, "permission denied for table bookings");
  assert.doesNotMatch(res.content[0].text, /units_available|Grand Deluxe/);
}

// Payload RPC kosong/invalid bukan berarti stok penuh tersedia.
{
  const { client } = mockClient({
    rooms: [GRAND],
    availability: null,
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.match(res.content[0].text, /invalid payload/);
}

{
  const { client } = mockClient({
    rooms: [GRAND],
    availability: [row("", 1, 0, 1)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  assert.equal(res.isError, true);
}

// Exception saat RPC tidak boleh jatuh ke sukses.
{
  const { client } = mockClient({ rooms: [GRAND], throwOnRpc: true });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /rpc transport failed/);
}

// Error daftar tipe kamar.
{
  const { client } = mockClient({
    roomsError: { message: "room_types unavailable" },
    availability: [row(GRAND.id, 1, 0, 1)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "room_types unavailable");
}

// Tanggal terbalik tidak memanggil RPC.
{
  const { client, calls } = mockClient({
    rooms: [GRAND],
    availability: [row(GRAND.id, 1, 0, 1)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-11-21", check_out: "2026-11-20" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "check_out must be after check_in");
  assert.equal(calls.rpc, 0);
  assert.deepEqual(calls.tables, []);
}

console.log("test-mcp-check-availability: ok");
