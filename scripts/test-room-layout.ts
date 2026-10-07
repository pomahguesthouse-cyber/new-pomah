/**
 * Fallback jumlah kamar tidur/mandi saat kolom belum ada di database.
 */
import assert from "node:assert/strict";

import {
  isMissingRoomLayoutColumnError,
  kamarMandiLabel,
  kamarTidurLabel,
  omitRoomLayoutColumns,
  omitRoomLayoutFields,
  queryWithOptionalRoomLayout,
  roomLayoutCount,
} from "../src/lib/room-layout";

assert.equal(roomLayoutCount(undefined), 1);
assert.equal(roomLayoutCount(null), 1);
assert.equal(roomLayoutCount(0), 1);
assert.equal(roomLayoutCount(-2), 1);
assert.equal(roomLayoutCount(""), 1);
assert.equal(roomLayoutCount("nope"), 1);
assert.equal(roomLayoutCount(2), 2);
assert.equal(roomLayoutCount(2.9), 2);
assert.equal(roomLayoutCount("2"), 2);
assert.equal(kamarTidurLabel(2), "2 K. Tidur");
assert.equal(kamarMandiLabel(undefined), "1 K. Mandi");
assert.equal(kamarTidurLabel(null), "1 K. Tidur");

assert.equal(
  isMissingRoomLayoutColumnError({
    code: "PGRST204",
    message: "Could not find the 'bedrooms' column of 'room_types' in the schema cache",
  }),
  true,
);
assert.equal(
  isMissingRoomLayoutColumnError({
    code: "42703",
    message: 'column room_types.bathrooms does not exist',
  }),
  true,
);
assert.equal(
  isMissingRoomLayoutColumnError({ code: "42501", message: "permission denied for table room_types" }),
  false,
);
assert.equal(isMissingRoomLayoutColumnError(null), false);

assert.equal(
  omitRoomLayoutColumns(
    "id, name, bedrooms, bathrooms, rooms(id)",
  ),
  "id, name, rooms(id)",
);

assert.deepEqual(omitRoomLayoutFields({ name: "Deluxe", bedrooms: 2, bathrooms: 2, capacity: 2 }), {
  name: "Deluxe",
  capacity: 2,
});

const calls: string[] = [];
const missing = await queryWithOptionalRoomLayout("id, bedrooms, bathrooms", async (columns) => {
  calls.push(columns);
  if (columns.includes("bedrooms")) {
    return {
      data: null,
      error: { code: "42703", message: "column room_types.bedrooms does not exist" },
    };
  }
  return { data: [{ id: "a" }], error: null };
});
assert.deepEqual(calls, ["id, bedrooms, bathrooms", "id"]);
assert.deepEqual(missing.data, [{ id: "a" }]);

const presentCalls: string[] = [];
const present = await queryWithOptionalRoomLayout("id, bedrooms", async (columns) => {
  presentCalls.push(columns);
  return { data: [{ id: "b", bedrooms: 2 }], error: null };
});
assert.deepEqual(presentCalls, ["id, bedrooms"]);
assert.equal(present.data?.[0]?.bedrooms, 2);

console.log("room-layout ok");
