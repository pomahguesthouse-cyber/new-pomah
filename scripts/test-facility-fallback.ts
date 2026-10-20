import assert from "node:assert/strict";
import {
  cleanSourceAnswer,
  facilityHandoffPauseMs,
  findFacilityAnswerInSources,
  parseQaPairs,
} from "../src/services/wa-autoreply/facility-fallback";
import { triggerAdminHandoff, ADMIN_HANDOFF_PAUSE_MS } from "../src/services/wa-autoreply/admin-handoff";
import { buildFacilityKbPromptBlock } from "../src/services/room-facility-kb";

// Data nyata produksi (20 Okt 2026), dipangkas.
const SOP_WIFI = { id: "13d7b24e", content: "Password WiFi Pomah Guesthouse: enjoythestay Nama jaringan (SSID) WiFi tersedia di seluruh area penginapan." };
const SOP_QA = {
  id: "2599482e",
  content:
    "Pertanyaan : Fasilitasnya apa saja? Jawab : Fasilitas Guesthouse : - Parkir mobil luas - Wi-Fi gratis di area umum Pertanyaan : Ada dapur yang bisa dipakai? Jawab : Ada Kak, tersedia Dapur Bersama untuk tamu. Khusus Family Suite 100 juga ada mini kitchen di dalam unit.",
};
const SOP_AMENITIES = { id: "4da70849", content: "2. AMENITIES STANDAR PER KAMAR - Handuk mandi 2 buah - Sabun, Shampo" };
const TR_WIFI = {
  id: "tr-wifi-password-20261018",
  user_message: "Password WiFi apa kak?",
  ideal_assistant_response: "Password WiFi Pomah: enjoythestay, Kak (huruf kecil semua, tanpa spasi) 😊 WiFi tersedia di seluruh area penginapan.",
};
const sources = { sop: [SOP_WIFI, SOP_QA, SOP_AMENITIES], training: [TR_WIFI] };

// Q&A parser
const qa = parseQaPairs(SOP_QA.content);
assert.equal(qa.length, 2);
assert.match(qa[1].a, /Dapur Bersama/);

// WiFi → training row dulu
const w = findFacilityAnswerInSources("wifi_password", sources);
assert.ok(w);
assert.equal(w.source, "training:tr-wifi-password-20261018");
assert.match(w.reply, /enjoythestay/);
// tanpa training → SOP WiFi chunk
const w2 = findFacilityAnswerInSources("wifi_password", { sop: [SOP_WIFI] });
assert.equal(w2?.source, "sop:13d7b24e");
assert.match(w2!.reply, /\*enjoythestay\*/);

// Dapur → Q&A SOP
const k = findFacilityAnswerInSources("kitchen", sources);
assert.equal(k?.source, "sop:2599482e");
assert.match(k!.reply, /Dapur Bersama/);

// Handuk → amenities SOP
const t = findFacilityAnswerInSources("towels", sources);
assert.match(t!.reply, /2 handuk mandi/);

// Tidak ada sumber → null (tetap tidak menebak)
assert.equal(findFacilityAnswerInSources("hairdryer", sources), null);
assert.equal(findFacilityAnswerInSources("checkin_point", sources), null);
assert.equal(findFacilityAnswerInSources("cooking_tools", sources), null);
// Letak password: "tersedia di seluruh area" BUKAN letak tulisan password
assert.equal(findFacilityAnswerInSources("wifi_location", sources), null);

// Persona lama dibersihkan, pertanyaan jualan dibuang
const c = cleanSourceAnswer("Ada dapur bersama. Kakak tertarik tipe kamar yang mana? Nanti Rani jelaskan lengkap.");
assert.doesNotMatch(c, /Rani|\?/);

// Kebijakan jeda
assert.equal(facilityHandoffPauseMs(false), 0);
assert.equal(facilityHandoffPauseMs(true), 30 * 60 * 1000);

// pauseMs=0 → tiket + alert, thread TIDAK dijeda
async function run() {
  const updates: unknown[] = [];
  const db = {
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      update: (v: unknown) => {
        updates.push(v);
        return { eq: async () => ({}) };
      },
    }),
  };
  let notified = 0;
  const deps = { createTicket: async () => ({ id: "t1" }), notify: async () => { notified++; } } as any;
  const now = new Date("2026-10-20T00:00:00Z");
  const r0 = await triggerAdminHandoff(db as any, { phone: "62811", threadId: "th", kind: "facility_unknown", triggerMessage: "ada hairdryer?", pauseMs: 0, now }, deps);
  assert.equal(r0.pausedUntil, null);
  assert.equal(r0.ticketId, "t1");
  assert.equal(updates.length, 0);
  assert.equal(notified, 1);
  const r1 = await triggerAdminHandoff(db as any, { phone: "62811", threadId: "th", kind: "facility_unknown", triggerMessage: "x", pauseMs: 30 * 60 * 1000, now }, deps);
  assert.equal(r1.pausedUntil, "2026-10-20T00:30:00.000Z");
  const r2 = await triggerAdminHandoff(db as any, { phone: "62811", threadId: "th", kind: "admin_request", triggerMessage: "admin", now }, deps);
  assert.equal(Date.parse(r2.pausedUntil!) - now.getTime(), ADMIN_HANDOFF_PAUSE_MS);

  // Prompt AI tidak lagi melarang memakai SOP untuk kolom kosong
  const block = buildFacilityKbPromptBlock([{ room_type_id: null, wifi_password: "enjoythestay" }]);
  assert.match(block, /HANYA dari SOP\/FAQ\/contoh pelatihan/);
  console.log("facility-fallback: OK");
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
