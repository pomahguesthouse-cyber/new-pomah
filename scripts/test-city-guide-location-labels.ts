// Tes: alamat tempat selalu berlabel dan jarak dari Pomah tampil terpisah.
import assert from "node:assert/strict";
import {
  collectCityGuidePlaces,
  compactPlaceLocation,
  placeLocationLines,
  PLACE_ADDRESS_LABEL,
  PLACE_DISTANCE_LABEL,
} from "../src/public/lib/city-guide";

const SOTO_ADDRESS = "Sukorejo, Kec. Gn. Pati, Kota Semarang, Jawa Tengah 50221, Indonesia";

const places = collectCityGuidePlaces({
  culinary: [
    { name: "Soto Pak Wito Trangkil", category: "Kuliner Khas", address: SOTO_ADDRESS, nearby_distance: "1.8 km (4 menit)" },
    { name: "Warung Tanpa Jarak", address: "Jl. Pemuda, Semarang" },
  ],
  destinations: [{ name: "Tempat Jarak Saja", nearby_distance: "3 km" }],
});

const soto = places.find((p) => p.name === "Soto Pak Wito Trangkil");
assert.ok(soto);
assert.equal(soto.address, SOTO_ADDRESS);
assert.equal(soto.distanceFromPomah, "1.8 km (4 menit)");
assert.deepEqual(placeLocationLines(soto), [
  { kind: "distance", label: "Jarak dari Pomah:", value: "1.8 km (4 menit)" },
  { kind: "address", label: "Alamat tempat:", value: SOTO_ADDRESS },
]);
// Kartu ringkas memprioritaskan jarak.
assert.equal(compactPlaceLocation(soto), "Jarak dari Pomah: 1.8 km (4 menit)");

const noDistance = places.find((p) => p.name === "Warung Tanpa Jarak");
assert.ok(noDistance);
assert.equal(compactPlaceLocation(noDistance), "Alamat tempat: Jl. Pemuda, Semarang");

const distOnly = places.find((p) => p.name === "Tempat Jarak Saja");
assert.ok(distOnly);
assert.equal(distOnly.address, null);
assert.deepEqual(placeLocationLines(distOnly).map((l) => l.kind), ["distance"]);

// Setiap baris alamat selalu memakai label.
for (const place of places) {
  for (const line of placeLocationLines(place)) {
    assert.equal(line.label, line.kind === "address" ? PLACE_ADDRESS_LABEL : PLACE_DISTANCE_LABEL);
  }
}
assert.equal(compactPlaceLocation({}), "");

console.log("test-city-guide-location-labels: ok");
