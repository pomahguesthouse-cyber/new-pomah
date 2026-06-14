import { detectRequestedRoomChange } from "../src/ai/state-machine/booking-machine";

const rooms = [
  { id: "family-room", name: "Family Room 222", base_rate: 400_000 },
  { id: "family-suite", name: "Family Suite 100", base_rate: 500_000 },
  { id: "deluxe", name: "Deluxe", base_rate: 250_000 },
];

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const correction = detectRequestedRoomChange(
  "eh sorry ka family suite 100 ya",
  rooms,
  "family-room",
);
assertEqual("detects a room correction even when the message contains ya", correction, {
  id: "family-suite",
  name: "Family Suite 100",
  pricePerNight: 500_000,
});

assertEqual(
  "does not treat a plain confirmation as a room correction",
  detectRequestedRoomChange("ya lanjut", rooms, "family-room"),
  null,
);

assertEqual(
  "does not treat the current room as a change",
  detectRequestedRoomChange("family room 222 ya", rooms, "family-room"),
  null,
);

console.info("3 booking room-change regression tests passed");