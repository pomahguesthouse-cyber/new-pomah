// Tes label spesifikasi kamar: multi kamar tidur tanpa jenis kasur tunggal.
import assert from "node:assert/strict";
import { MULTI_BEDROOM_BED_NOTE, roomBedLine, roomSpecLabel } from "../src/public/lib/room-spec-label";

const family222 = { capacity: 4, size_sqm: 50, bed_type: "Queen", bedrooms: 2, bathrooms: 2 };
const suite100 = { capacity: 4, size_sqm: 60, bed_type: "Double", bedrooms: 2, bathrooms: 2 };
const deluxe = { capacity: 2, size_sqm: 18, bed_type: "Queen", bedrooms: 1, bathrooms: 1 };

assert.equal(roomSpecLabel(family222), "4 tamu · 50 m² · 2 kamar tidur · 2 kamar mandi");
assert.ok(!/Queen/i.test(roomSpecLabel(family222)));
assert.ok(roomSpecLabel(suite100).includes("2 kamar tidur"));
assert.ok(!/Double/i.test(roomSpecLabel(suite100)));
assert.equal(roomBedLine(family222), MULTI_BEDROOM_BED_NOTE);
assert.ok(!/Queen|Double/i.test(roomBedLine(suite100) ?? ""));

assert.equal(roomSpecLabel(deluxe), "2 tamu · 18 m² · Queen");
assert.equal(roomBedLine(deluxe), "Queen");
// bedrooms kosong dianggap 1 → jenis kasur tetap tampil.
assert.ok(roomSpecLabel({ capacity: 1, size_sqm: 15, bed_type: "Single", bedrooms: null }).includes("Single"));
assert.equal(roomBedLine({ bedrooms: 1, bed_type: null }), null);

console.log("test-room-spec-label: ok");
