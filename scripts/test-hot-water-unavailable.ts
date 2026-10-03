/**
 * Regresi 3 Okt 2026: bot WhatsApp menjawab "Tipe Deluxe ada shower dengan
 * air hangat" padahal Pomah belum menyediakan air panas di kamar mana pun.
 *
 * Yang dikunci:
 *   1. Prompt Front Office (tamu + manajer) menyatakan fakta itu dan melarang
 *      menyimpulkan air hangat dari kata "shower".
 *   2. Perbandingan Deluxe vs Grand Deluxe tidak lagi menyebut Air Panas,
 *      tetapi lantai dan area lebih luas tetap ada.
 *   3. Formatter fasilitas dan tool detail kamar membuang item air panas /
 *      air hangat / hot water sebelum sampai ke tamu.
 *   4. Pertanyaan langsung dijawab jujur lewat FAQ deterministik.
 */
import assert from "node:assert/strict";
import { frontOfficeAgent } from "../src/ai/agents/front-office.agent";
import type { AgentContext } from "../src/ai/agents/types";
import {
  buildFacilityReply,
  omitUnavailableHotWaterAmenities,
  redactUnavailableHotWaterText,
} from "../src/ai/state-machine/booking-inline-answers";
import { buildPropertyFaqReply } from "../src/services/property-faq";
import { getRoomSpecifications } from "../src/tools/room-specifications.tool";
import type { ToolContext } from "../src/tools/types";

const HOT_WATER_CLAIM = /\b(?:air\s*panas|air\s*hangat|hot\s*water|water\s*heater|pemanas\s*air)\b/i;

const ctx = (over: Partial<AgentContext> = {}): AgentContext =>
  ({
    property: { name: "Pomah Guesthouse" },
    rooms: [
      {
        name: "Deluxe",
        base_rate: 230000,
        capacity: 2,
        amenities: ["Shower", "Air Panas", "WiFi"],
        description: "Kamar dengan shower air hangat dan view taman",
      },
      {
        name: "Grand Deluxe",
        base_rate: 300000,
        capacity: 2,
        amenities: ["AC", "Hot Water", "Water Heater"],
        description: "Area lebih luas di lantai 1",
      },
    ],
    sopText: "",
    today: "2026-10-03",
    ...over,
  }) as unknown as AgentContext;

const prompt = (over: Partial<AgentContext> = {}) =>
  frontOfficeAgent.buildSystemPrompt(ctx(over));

function renderedFacilityLines(text: string): string[] {
  return text.split("\n").filter((line) => /fasilitas:|deskripsi:/i.test(line));
}

// ─── 1. Prompt: fakta tetap, di jalur tamu maupun manajer ────────────────────

for (const [label, over] of [
  ["penuh", {}],
  ["sapaan", { intent: "general" as const }],
  ["ketersediaan", { intent: "availability_check" as const }],
  ["manajer", { mode: "managerial" as const }],
] as const) {
  const text = prompt(over);
  assert.match(text, /BELUM menyediakan air hangat/i, `${label}: fakta air hangat hilang`);
  assert.match(text, /air biasa/i, `${label}: shower air biasa tidak disebut`);
  assert.match(
    text,
    /jangan menyimpulkan|jangan laporkan sebaliknya/i,
    `${label}: larangan mengarang dari data/shower hilang`,
  );
}

const guestPrompt = prompt();
assert.match(guestPrompt, /jangan menyimpulkan air hangat dari kata 'shower'/i);
for (const line of renderedFacilityLines(guestPrompt)) {
  assert.doesNotMatch(line, HOT_WATER_CLAIM, `katalog kamar masih menyodorkan air panas: ${line}`);
}
assert.match(guestPrompt, /fasilitas: Shower, WiFi/);
assert.match(guestPrompt, /fasilitas: AC/);
assert.match(guestPrompt, /deskripsi: Kamar dengan shower dan view taman/);
assert.match(guestPrompt, /deskripsi: Area lebih luas di lantai 1/);

// ─── 2. Perbandingan Deluxe vs Grand Deluxe ──────────────────────────────────

const fallback = buildFacilityReply("apa bedanya deluxe dan grand deluxe?", [
  { name: "Deluxe" },
  { name: "Grand Deluxe" },
]);
assert.ok(fallback, "perbandingan fallback harus tetap terkirim");
assert.doesNotMatch(fallback!, HOT_WATER_CLAIM);
assert.match(fallback!, /Lantai 2/);
assert.match(fallback!, /View Taman/);
assert.match(fallback!, /Lantai 1/);
assert.match(fallback!, /Area lebih luas/);
assert.match(fallback!, /Shower/);

const fromData = buildFacilityReply("fasilitas deluxe dan grand deluxe", [
  { name: "Deluxe", amenities: ["WIfi", "AC", "Shower", "View Taman"] },
  {
    name: "Grand Deluxe",
    amenities: ["AC", "WI-FI", "Air Panas", "Hot Water", "air hangat", "Water Heater"],
  },
]);
assert.ok(fromData);
assert.doesNotMatch(fromData!, HOT_WATER_CLAIM);
assert.match(fromData!, /\*Grand Deluxe\*: AC, WI-FI, Kamar mandi dalam/);
assert.match(fromData!, /Lantai 2/);
assert.match(fromData!, /Area lebih luas/);

const single = buildFacilityReply("fasilitas kamar deluxe apa saja?", [
  { name: "Deluxe", amenities: ["AC", "Shower dengan air hangat", "WiFi"] },
]);
assert.ok(single);
assert.doesNotMatch(single!, HOT_WATER_CLAIM);
assert.match(single!, /AC/);
assert.match(single!, /WiFi/);
assert.doesNotMatch(single!, /Shower dengan/);

assert.deepEqual(
  omitUnavailableHotWaterAmenities(["AC", "Air Panas", "pemanas air", "Kamar mandi dalam", "hot water"]),
  ["AC", "Kamar mandi dalam"],
);
assert.equal(
  redactUnavailableHotWaterText("Tipe Deluxe ada shower dengan air hangat"),
  "Tipe Deluxe ada shower dengan",
);
assert.equal(redactUnavailableHotWaterText("AC dan WiFi"), "AC dan WiFi");

// ─── 3. Tool detail kamar ────────────────────────────────────────────────────

const rooms = [
  {
    id: "gd",
    name: "Grand Deluxe",
    base_rate: 300000,
    capacity: 2,
    bed_type: "double",
    description: "Kamar lantai 1 dengan air panas",
    amenities: ["AC", "Air Panas", "Hot Water", "WiFi"],
  },
  {
    id: "dx",
    name: "Deluxe",
    base_rate: 230000,
    capacity: 2,
    bed_type: "queen",
    description: "View taman",
    amenities: ["Shower", "water heater"],
  },
];

const one = JSON.parse(
  await getRoomSpecifications({ room_type: "Grand Deluxe" }, { rooms } as unknown as ToolContext),
);
assert.deepEqual(one.fasilitas, ["AC", "WiFi"]);
assert.equal(one.deskripsi, "Kamar lantai 1 dengan");
assert.doesNotMatch(JSON.stringify(one.fasilitas), HOT_WATER_CLAIM);

const all = JSON.parse(
  await getRoomSpecifications({}, { rooms } as unknown as ToolContext),
);
const deluxe = all.room_specifications.find((r: { nama: string }) => r.nama === "Deluxe");
assert.deepEqual(deluxe.fasilitas, ["Shower"]);
assert.equal(deluxe.deskripsi, "View taman");

// ─── 4. FAQ deterministik: jujur, dan jangan menyambar kata shower ───────────

const ask = (message: string, mode: "early" | "late" = "late") =>
  buildPropertyFaqReply({
    message,
    property: { name: "Pomah Guesthouse" },
    rooms: [],
    mode,
    greetingUsed: true,
  });

const hot = ask("tipe deluxe ada air hangat kak?");
assert.equal(hot?.intent, "faq_hot_water");
assert.match(hot!.reply, /belum menyediakan air hangat atau air panas/i);
assert.match(hot!.reply, /air biasa/);
assert.match(hot!.reply, /bisa saya bantu/i);
assert.doesNotMatch(hot!.reply, /ada shower dengan air hangat/i);

assert.equal(ask("ada hot water?", "early")?.intent, "faq_hot_water");
assert.equal(ask("kamar deluxe ada air panas?")?.intent, "faq_hot_water");
assert.notEqual(ask("ada shower?")?.intent, "faq_hot_water");
assert.equal(ask("kamar mandinya di dalam?")?.intent, "faq_private_bathroom");
assert.equal(ask("air panasnya rusak kak"), null);
assert.equal(ask("ada air panas? terus wifi ada?"), null);
assert.notEqual(ask("mau booking deluxe, ada air panas?")?.intent, "faq_hot_water");

console.log("✓ hot water unavailable regressions passed");
