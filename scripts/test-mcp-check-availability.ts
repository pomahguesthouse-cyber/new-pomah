/**
 * Regresi MCP `check_availability`.
 *
 * Tool wajib memakai RPC `room_type_availability_detail`, bukan baca
 * `booking_rooms` dengan client anon. 20 Nov 2026 penuh (available=0).
 * 16 Okt 2026 hanya Grand Deluxe yang tersisa 1. Error RPC adalah
 * isError — jangan menganggap semua tipe tersedia.
 *
 * Stop-sell (`room_daily_rates.stop_sell`) menutup tipe kamar yang
 * RPC-nya masih available > 0. Gagal baca tarif harian adalah isError,
 * bukan "semua kamar bebas".
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

type DailyRateFixture = {
  room_type_id: string;
  date: string;
  rate: number;
  extrabed_rate: number | null;
  min_stay: number;
  stop_sell: boolean;
  note: string | null;
};

function row(
  room_type_id: string,
  total: number,
  taken: number,
  available: number,
): RoomTypeAvailabilityDetailRow {
  return { room_type_id, total, taken, available };
}

function dailyRate(
  room_type_id: string,
  date: string,
  stop_sell: boolean,
  note: string | null = stop_sell ? "Diblokir dari kalender admin" : null,
): DailyRateFixture {
  return {
    room_type_id,
    date,
    rate: 550000,
    extrabed_rate: null,
    min_stay: 1,
    stop_sell,
    note,
  };
}

function mockClient(opts: {
  rooms?: RoomTypePublicRow[];
  roomsError?: { message: string } | null;
  availability?: RoomTypeAvailabilityDetailRow[] | null;
  availabilityError?: { message: string } | null;
  throwOnRpc?: boolean;
  dailyRates?: DailyRateFixture[];
  dailyRatesError?: { message: string } | null;
  throwOnDailyRates?: boolean;
}): { client: AvailabilityReader; calls: { tables: string[]; rpc: number } } {
  const calls = { tables: [] as string[], rpc: 0 };
  const client = {
    from(table: string) {
      calls.tables.push(table);
      if (table === "room_types") {
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
      }
      if (table === "room_daily_rates") {
        const filters: { ids: string[]; gte?: string; lt?: string } = { ids: [] };
        const run = () => {
          if (opts.throwOnDailyRates) throw new Error("room_daily_rates transport failed");
          const rows = (opts.dailyRates ?? []).filter((rate) => {
            if (filters.ids.length > 0 && !filters.ids.includes(rate.room_type_id)) return false;
            if (filters.gte && rate.date < filters.gte) return false;
            if (filters.lt && rate.date >= filters.lt) return false;
            return true;
          });
          return {
            data: opts.dailyRatesError ? null : rows,
            error: opts.dailyRatesError ?? null,
          };
        };
        const builder = {
          select() {
            return builder;
          },
          in(_column: string, ids: string[]) {
            filters.ids = [...ids];
            return builder;
          },
          gte(_column: string, value: string) {
            filters.gte = value;
            return builder;
          },
          lt(_column: string, value: string) {
            filters.lt = value;
            return Promise.resolve().then(run);
          },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string) => {
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
  return { client: client as AvailabilityReader, calls };
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
assert.match(source, /getDailyRatesForRange/);
assert.match(source, /resolveRoomNightlyRates/);
assert.match(source, /strict:\s*true/);

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
  assert.deepEqual(calls.tables, ["room_types", "room_daily_rates"]);
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

// 16–19 Okt 2026: RPC masih sisa 1 Grand Deluxe, tapi stop_sell menutupnya.
// Tipe lain penuh (bukan stop_sell) tetap available=false tanpa field blokir.
{
  const nights = ["2026-10-16", "2026-10-17", "2026-10-18"];
  const { client, calls } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 1, 1), row(DELUXE.id, 4, 4, 0), row(FAMILY.id, 2, 2, 0)],
    dailyRates: nights.map((date) => dailyRate(GRAND.id, date, true)),
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-19" },
    client,
  );
  assert.equal(res.isError, undefined);
  assert.deepEqual(calls.tables, ["room_types", "room_daily_rates"]);
  const rooms = res.structuredContent?.rooms ?? [];
  const grand = rooms.find((r) => r.slug === "grand-deluxe");
  assert.ok(grand);
  assert.equal(grand.units_available, 0);
  assert.equal(grand.available, false);
  assert.equal(grand.stop_sell, true);
  assert.deepEqual(grand.stop_sell_dates, nights);
  assert.match(grand.reason ?? "", /stop_sell/);
  assert.match(grand.reason ?? "", /bukan karena terbooking/);
  assert.match(grand.reason ?? "", /16 Oktober 2026/);
  assert.ok(
    rooms
      .filter((r) => r.slug !== "grand-deluxe")
      .every((r) => r.available === false && r.units_available === 0 && r.stop_sell === undefined),
  );
  const parsed = JSON.parse(res.content[0].text) as typeof rooms;
  assert.deepEqual(parsed, rooms);
}

// Stok > 0 dan tidak ada stop_sell di rentang tetap tersedia.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE],
    availability: [row(GRAND.id, 2, 1, 1), row(DELUXE.id, 4, 0, 2)],
    dailyRates: [
      dailyRate(GRAND.id, "2026-10-16", false),
      dailyRate(GRAND.id, "2026-10-20", true),
      dailyRate(DELUXE.id, "2026-10-19", true),
    ],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-19" },
    client,
  );
  const rooms = res.structuredContent?.rooms ?? [];
  const grand = rooms.find((r) => r.id === GRAND.id);
  const deluxe = rooms.find((r) => r.id === DELUXE.id);
  assert.equal(grand?.units_available, 1);
  assert.equal(grand?.available, true);
  assert.equal(grand?.stop_sell, undefined);
  assert.equal(deluxe?.units_available, 2);
  assert.equal(deluxe?.available, true);
  assert.equal(deluxe?.stop_sell, undefined);
}

// Satu malam stop_sell di tengah menginap menutup seluruh stay.
{
  const { client } = mockClient({
    rooms: [GRAND],
    availability: [row(GRAND.id, 2, 0, 1)],
    dailyRates: [
      dailyRate(GRAND.id, "2026-10-16", false),
      dailyRate(GRAND.id, "2026-10-17", true),
      dailyRate(GRAND.id, "2026-10-18", false),
    ],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-19" },
    client,
  );
  const grand = res.structuredContent?.rooms[0];
  assert.equal(grand?.units_available, 0);
  assert.equal(grand?.available, false);
  assert.equal(grand?.stop_sell, true);
  assert.deepEqual(grand?.stop_sell_dates, ["2026-10-17"]);
}

// stop_sell pada tanggal check_out (eksklusif) tidak memblokir malam menginap.
{
  const { client } = mockClient({
    rooms: [GRAND],
    availability: [row(GRAND.id, 2, 1, 1)],
    dailyRates: [dailyRate(GRAND.id, "2026-10-17", true)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  const grand = res.structuredContent?.rooms[0];
  assert.equal(grand?.units_available, 1);
  assert.equal(grand?.available, true);
  assert.equal(grand?.stop_sell, undefined);
}

// Filter tamu tetap jalan; tipe yang lolos dan kena stop_sell dilaporkan blokir.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 0, 2), row(DELUXE.id, 4, 0, 4), row(FAMILY.id, 2, 0, 1)],
    dailyRates: [dailyRate(FAMILY.id, "2026-10-16", true)],
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
  assert.equal(res.structuredContent?.rooms[0].units_available, 0);
  assert.equal(res.structuredContent?.rooms[0].stop_sell, true);
  assert.deepEqual(res.structuredContent?.rooms[0].stop_sell_dates, ["2026-10-16"]);
}

// Stok 0 sekaligus stop_sell tetap menandai blokir, bukan sekadar penuh.
{
  const { client } = mockClient({
    rooms: [DELUXE],
    availability: [row(DELUXE.id, 4, 4, 0)],
    dailyRates: [dailyRate(DELUXE.id, "2026-10-16", true)],
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  const deluxe = res.structuredContent?.rooms[0];
  assert.equal(deluxe?.units_available, 0);
  assert.equal(deluxe?.available, false);
  assert.equal(deluxe?.stop_sell, true);
}

// Error baca room_daily_rates → isError, jangan anggap Grand Deluxe tersedia.
{
  const { client } = mockClient({
    rooms: [GRAND, DELUXE, FAMILY],
    availability: [row(GRAND.id, 2, 1, 1), row(DELUXE.id, 4, 4, 0), row(FAMILY.id, 2, 2, 0)],
    dailyRatesError: { message: "permission denied for table room_daily_rates" },
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-19" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.equal(res.content[0].text, "permission denied for table room_daily_rates");
  assert.doesNotMatch(res.content[0].text, /units_available|Grand Deluxe|available/);
}

// Exception saat baca tarif harian tidak boleh jatuh ke sukses.
{
  const { client } = mockClient({
    rooms: [GRAND],
    availability: [row(GRAND.id, 2, 0, 1)],
    throwOnDailyRates: true,
  });
  const res = await handleCheckAvailability(
    { check_in: "2026-10-16", check_out: "2026-10-17" },
    client,
  );
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.match(res.content[0].text, /room_daily_rates transport failed/);
}

console.log("test-mcp-check-availability: ok");
