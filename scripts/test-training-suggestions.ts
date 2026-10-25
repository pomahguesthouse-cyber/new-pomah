import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approvalBlockers,
  buildSuggestions,
  dedupeKey,
  hasPrice,
  isStaffReply,
  isTrivialReply,
  sanitizeText,
  type CaptureMessage,
} from "../src/services/training-suggestions/capture";

const T = "00000000-0000-0000-0000-000000000001";
let n = 0;
const at = (min: number) => new Date(Date.UTC(2026, 9, 25, 3, 0) + min * 60_000).toISOString();
const guest = (body: string, min: number): CaptureMessage => ({ id: `m${++n}`, thread_id: T, direction: "in", body, sent_at: at(min) });
const staff = (body: string, min: number, md: Record<string, unknown> = { source: "admin_inbox", is_manual_admin: true }): CaptureMessage => ({
  id: `m${++n}`, thread_id: T, direction: "out", body, sent_at: at(min), metadata: md,
});
const bot = (body: string, min: number): CaptureMessage => ({ id: `m${++n}`, thread_id: T, direction: "out", body, sent_at: at(min), metadata: { agent: "Front Office Agent" } });

// Staf vs bot/sistem
assert.equal(isStaffReply(staff("x", 0)), true);
assert.equal(isStaffReply(staff("x", 0, { source: "whatsapp_native", is_native_human: true })), true);
assert.equal(isStaffReply(bot("x", 0)), false);
assert.equal(isStaffReply(staff("[sistem] AI dinonaktifkan", 0, { source: "wa_command", is_system_command: true })), false);

// Balasan remeh dilewati
for (const t of ["ok", "Oke kak", "Siap kak 🙏", "Terima kasih kak", "Selamat pagi", "🙏🙏", "", "per kamar kak", "bisa kak gpp"]) {
  assert.equal(isTrivialReply(t), true, `harus remeh: "${t}"`);
}
assert.equal(isTrivialReply("", { media_type: "image" }), true);
assert.equal(isTrivialReply("foto", { media_type: "image" }), true);
assert.equal(isTrivialReply("Dapur bersama ada di lantai 1 dekat tangga, bisa dipakai sampai jam 21.00 kak"), false);

// Harga, nomor, kode booking, nama
for (const t of ["Rp150.000", "rp 230.000", "harganya 230.000", "150rb per malam", "300 ribu", "1,5 juta"]) assert.equal(hasPrice(t), true, t);
assert.equal(hasPrice("check-in jam 14.00, kamar nomor 222"), false);
const s = sanitizeText("Halo Kak Raisha, booking PG-TSKPR sudah kami cek. Hubungi 0812-3456-7890 atau +62 812 3456 7890", ["Raisha"]);
assert.ok(!s.text.includes("Raisha") && !s.text.includes("PG-TSKPR") && !/\d{4}/.test(s.text), s.text);
assert.deepEqual(new Set(s.flags), new Set(["guest_name", "booking_code", "phone"]));
assert.ok(sanitizeText("Deluxe Rp230.000 per malam kak").flags.includes("price"));

// Persetujuan diblokir bila masih ada harga/nomor/kode
assert.ok(approvalBlockers("Berapa harga deluxe?", "Deluxe Rp230.000 kak").length > 0);
assert.ok(approvalBlockers("Boleh telepon?", "Silakan hubungi 081234567890 kak").length > 0);
assert.equal(approvalBlockers("Ada hairdryer?", "Hairdryer bisa dipinjam di resepsionis kak").length, 0);

// Pairing: pertanyaan tamu (meski bot sempat handoff) + balasan staf beruntun digabung
n = 0;
const thread = [
  guest("Halo", 0),
  guest("Kak, ada hairdryer di kamar?", 1),
  bot("Kami cek terlebih dahulu ya, Kak", 2),
  staff("Hairdryer tidak ada di kamar kak", 20),
  staff("Bisa dipinjam di resepsionis, silakan hubungi staf jaga kak", 22),
  staff("ok", 23),
  guest("Oke makasih kak", 30),
  staff("Sama sama kak", 31),
  guest("Dapurnya boleh dipakai malam?", 60),
  staff("Dapur bersama bisa dipakai sampai jam 21.00 kak", 65),
];
const out = buildSuggestions(thread, "Raisha");
assert.equal(out.length, 2, JSON.stringify(out, null, 1));
assert.match(out[0].guest_question, /hairdryer/);
assert.match(out[0].staff_answer, /tidak ada di kamar[\s\S]*resepsionis/);
assert.ok(!out[0].staff_answer.includes("ok\n") && !out[0].staff_answer.endsWith("ok"));
assert.equal(out[0].source_message_id, "m4");
assert.match(out[1].guest_question, /^Dapurnya/);

// Idempoten & dedupe
assert.deepEqual(buildSuggestions(thread, "Raisha"), out);
assert.equal(dedupeKey("Ada Hairdryer?", "Bisa dipinjam."), dedupeKey("ada hairdryer", "bisa dipinjam"));

// Pertanyaan > 6 jam sebelum balasan tidak dipasangkan
n = 0;
assert.equal(buildSuggestions([guest("Ada parkir mobil kak?", 0), staff("Parkir mobil ada di depan untuk dua mobil kak", 7 * 60)]).length, 0);

// Harga di jawaban staf ditandai
n = 0;
const priced = buildSuggestions([guest("Berapa harga deluxe kak?", 0), staff("Deluxe Rp230.000 per malam sudah termasuk sarapan kak", 3)]);
assert.ok(priced[0].flags.includes("price"));

// Migrasi: RLS staf/admin, status pending default, unik untuk dedupe
const mig = readFileSync("supabase/migrations/20261025120000_chatbot_training_suggestions.sql", "utf8");
assert.match(mig, /ENABLE ROW LEVEL SECURITY/);
assert.match(mig, /status text NOT NULL DEFAULT 'pending'/);
assert.match(mig, /UNIQUE \(source_message_id\)/);
assert.match(mig, /UNIQUE \(dedupe_key\)/);
assert.match(mig, /WITH CHECK \(public\.is_staff\(auth\.uid\(\)\) AND status = 'pending'\)/);
assert.doesNotMatch(mig, /UPDATE public\.chatbot_training_examples|DELETE FROM/);

// Approve satu-satunya jalur ke chatbot_training_examples
const fn = readFileSync("src/admin/modules/training-suggestions/training-suggestions.functions.ts", "utf8");
assert.equal((fn.match(/from\("chatbot_training_examples"\)/g) ?? []).length, 1);
assert.match(fn, /approvalBlockers\(data\.guestQuestion, data\.staffAnswer\)/);

console.log("✓ usulan training dari balasan staf: filter, sanitasi, pairing, dedupe");
