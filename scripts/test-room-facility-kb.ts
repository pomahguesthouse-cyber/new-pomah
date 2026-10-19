import assert from "node:assert/strict";
import {
  answerFromFacilityKb,
  buildFacilityKbPromptBlock,
  detectFacilityTopic,
  missingFacilityFields,
  resolveFacilityField,
  type FacilityKbRow,
} from "../src/services/room-facility-kb";
import { buildPropertyFaqReply } from "../src/services/property-faq";

// Deteksi topik
const cases: Array<[string, ReturnType<typeof detectFacilityTopic>]> = [
  ["password wifi apa kak?", "wifi_password"],
  ["Wifinya apa ya", "wifi_password"],
  ["pw wifi nya kak", "wifi_password"],
  ["password wifi ditempel dimana kak?", "wifi_location"],
  ["Di dapur disediain alat masaknya kak? Ada apa aja?", "cooking_tools"],
  ["ada dapur kak?", "kitchen"],
  ["handuknya disediakan?", "towels"],
  ["ada hairdryer?", "hairdryer"],
  ["Check in nya di sebelah mana ya kak?", "checkin_point"], // SULO PG-MBGMB 17 Okt
  ["ambil kuncinya dimana?", "checkin_point"],
  ["check in jam berapa?", null],
  ["ada wifi?", null],
  ["harga deluxe berapa", null],
];
for (const [t, want] of cases) assert.equal(detectFacilityTopic(t), want, t);

const ROOM_FS = "fs-100";
const rows: FacilityKbRow[] = [
  { room_type_id: null, wifi_password: "enjoythestay", kitchen: "Ada dapur bersama.", towels: "2 handuk mandi per kamar.", wifi_password_location: "", cooking_tools: null },
  { room_type_id: ROOM_FS, kitchen: "Mini kitchen di unit + dapur bersama." },
];

assert.equal(resolveFacilityField(rows, "kitchen"), "Ada dapur bersama.");
assert.equal(resolveFacilityField(rows, "kitchen", [ROOM_FS]), "Mini kitchen di unit + dapur bersama.");
assert.equal(resolveFacilityField(rows, "hairdryer", [ROOM_FS]), null);

const pw = answerFromFacilityKb({ topic: "wifi_password", rows });
assert.equal(pw.kind, "answer");
assert.match((pw as any).reply, /enjoythestay/);

// Letak password belum diisi → TIDAK menebak (balik kunci / stiker TV), handoff dengan password saja.
const loc = answerFromFacilityKb({ topic: "wifi_location", rows });
assert.equal(loc.kind, "handoff");
assert.deepEqual((loc as any).missing, ["wifi_password_location"]);
assert.match((loc as any).partialReply, /enjoythestay/);
assert.ok(!/kunci|stiker|TV/i.test((loc as any).partialReply));

const tools = answerFromFacilityKb({ topic: "cooking_tools", rows });
assert.equal(tools.kind, "handoff");
const checkin = answerFromFacilityKb({ topic: "checkin_point", rows, fallbackMapsUrl: "https://maps/x" });
assert.equal(checkin.kind, "handoff");

const filled = answerFromFacilityKb({
  topic: "checkin_point",
  rows: [{ room_type_id: null, checkin_point: "pintu depan lantai 1" }],
  fallbackMapsUrl: "https://www.google.com/maps/place/?q=place_id:abc",
});
assert.equal(filled.kind, "answer");
assert.match((filled as any).reply, /pintu depan lantai 1[\s\S]*maps/);

assert.deepEqual(missingFacilityFields(rows), ["wifi_password_location", "cooking_tools", "hairdryer", "checkin_point", "maps_url"]);

const block = buildFacilityKbPromptBlock(rows, new Map([[ROOM_FS, "Family Suite 100"]]));
assert.match(block, /Password WiFi: semua kamar: enjoythestay/);
assert.match(block, /Dapur: semua kamar: Ada dapur bersama.; Family Suite 100: Mini kitchen/);
assert.match(block, /Hairdryer: BELUM DIKETAHUI/);

// Template FAQ lama tidak boleh lagi menjawab pertanyaan password wifi dengan "ada WiFi gratis".
assert.equal(buildPropertyFaqReply({ message: "password wifi apa kak", property: {}, mode: "late" }), null);
assert.ok(buildPropertyFaqReply({ message: "ada wifi?", property: {}, mode: "late" }));

console.log("✓ room facility KB: satu sumber, kolom kosong → handoff, tanpa tebakan");
