import assert from "node:assert/strict";
import { canReserveRooms, getAvailableRoomCount, roomAvailabilityLabel } from "../src/lib/public-room-availability.ts";

// API responses may contain numeric strings; zero must never fall back to physical stock.
for (const stock of [0, "0", -1, null, undefined, "invalid", Infinity]) {
  const count = getAvailableRoomCount({ availableRooms: { deluxe: stock } }, "deluxe");
  assert.equal(count, 0);
  assert.equal(roomAvailabilityLabel(count), "Tidak tersedia");
  assert.equal(canReserveRooms(count), false);
}

assert.equal(getAvailableRoomCount({ availableRooms: {} }, "deluxe"), 0);
for (const result of [undefined, null, { availableRooms: { deluxe: 5 }, debug: { error: "RPC failed" } }]) {
  const count = getAvailableRoomCount(result, "deluxe");
  assert.equal(count, null);
  assert.equal(canReserveRooms(count), false);
  assert.equal(roomAvailabilityLabel(count), "Mengecek ketersediaan…");
}

for (const stock of [1, 3, "3"]) {
  const count = getAvailableRoomCount({ availableRooms: { deluxe: stock } }, "deluxe");
  assert.equal(roomAvailabilityLabel(count), `${stock} kamar tersedia`);
  assert.equal(canReserveRooms(count), true);
  assert.equal(canReserveRooms(count, Number(stock)), true);
  assert.equal(canReserveRooms(count, Number(stock) + 1), false);
}

// An existing cart becomes invalid when a new date range or refreshed stock has fewer rooms.
for (const stock of [2, 1, 0]) {
  const count = getAvailableRoomCount({ availableRooms: { deluxe: stock } }, "deluxe");
  assert.equal(canReserveRooms(count, 2), stock >= 2);
}
for (const quantity of [0, -1, 1.5, NaN]) assert.equal(canReserveRooms(3, quantity), false);

console.log("Public room availability regression tests passed.");
