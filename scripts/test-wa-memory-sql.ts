import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Memori percakapan WA:
 *  (1) 20261002100000_fix_seed_context_summary.sql — seed tidak menimpa ringkasan.
 *  (2) 20261002100100_merge_conversation_slots.sql — slots digabung, bukan ditimpa.
 * Statis + simulasi logika merge jsonb (tanpa DB sungguhan).
 */
const read = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const seed = read("20261002100000_fix_seed_context_summary.sql").replace(/--.*$/gm, "");  // tanpa komentar
const topic = read("20261002100100_merge_conversation_slots.sql").replace(/--.*$/gm, "");

// ── (1) seed trigger ────────────────────────────────────────────────────────
assert.match(seed, /CREATE OR REPLACE FUNCTION public\.seed_whatsapp_context_summary\(\)/);
assert.match(seed, /RETURNS trigger/);
assert.match(seed, /SECURITY DEFINER\s+SET search_path = public/);
assert.doesNotMatch(seed, /Auto generated summary/, "kode (bukan komentar) tidak menulis seed kosong");
assert.doesNotMatch(seed, /DROP (TRIGGER|FUNCTION|TABLE)/i, "idempoten, tanpa DROP");
assert.doesNotMatch(seed, /GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated)\b/i, "tanpa grant ke anon/authenticated");
assert.match(seed, /REVOKE ALL ON FUNCTION public\.seed_whatsapp_context_summary\(\) FROM anon, authenticated/);
assert.match(seed, /GRANT EXECUTE ON FUNCTION public\.seed_whatsapp_context_summary\(\) TO service_role/);
assert.match(seed, /trg_seed_whatsapp_context_summary/);
// Guard dini + guard atomik di UPDATE.
assert.equal((seed.match(/v_existing_json = '\{\}'::jsonb/g) ?? []).length, 1);
assert.match(seed, /AND \(\s+chat_summary_json IS NULL/);
// Tepat satu UPDATE, dan chat_summary_updated_at hanya diset di sana (seed pertama).
assert.equal((seed.match(/UPDATE public\.whatsapp_threads/g) ?? []).length, 1);
assert.equal((seed.match(/chat_summary_updated_at\s*=/g) ?? []).length, 1);
// Tidak ada lagi pengecualian "boleh refresh seed lama".
assert.doesNotMatch(seed, /NOT IN \('auto_seed'/);

// Model logika guard (cermin dari SQL).
type J = Record<string, unknown> | null | unknown[] | string;
const isEmpty = (j: J): boolean => {
  if (j === null || typeof j !== "object" || Array.isArray(j)) return true;
  if (Object.keys(j).length === 0) return true;
  return !String(j.source ?? "") && !String(j.short_summary ?? "");
};
assert.equal(isEmpty(null), true);
assert.equal(isEmpty({}), true);
assert.equal(isEmpty({ source: "llm", short_summary: "Tamu minta Deluxe 3-5 Okt" }), false);
assert.equal(isEmpty({ source: "auto_seed", short_summary: "x" }), false);
assert.equal(isEmpty({ source: "human_takeover_auto", short_summary: "x" }), false);
assert.equal(isEmpty({ guest_name: "Budi" }), true, "tanpa source & short_summary = belum ada ringkasan");

// ── (2) update_conversation_topic ───────────────────────────────────────────
assert.match(topic, /CREATE OR REPLACE FUNCTION public\.update_conversation_topic\(\s+p_phone\s+TEXT,\s+p_last_topic\s+TEXT,\s+p_last_entity JSONB,\s+p_slots\s+JSONB\s*\) RETURNS VOID/);
assert.match(topic, /slots\s+= COALESCE\(public\.wa_booking_states\.slots, '\{\}'::jsonb\) \|\| COALESCE\(EXCLUDED\.slots, '\{\}'::jsonb\)/);
assert.doesNotMatch(topic, /slots\s+= COALESCE\(EXCLUDED\.slots, public\.wa_booking_states\.slots\)/);
assert.match(topic, /SECURITY DEFINER SET search_path = public/);
assert.match(topic, /REVOKE EXECUTE ON FUNCTION public\.update_conversation_topic\(TEXT, TEXT, JSONB, JSONB\) FROM anon, authenticated/);
assert.doesNotMatch(topic, /GRANT[^;]*\b(anon|authenticated)\b/i);

// Model merge (jsonb || : key kanan menang, key kiri yang tak dikirim dipertahankan).
const mergeSlots = (existing: Record<string, unknown> | null, p: unknown) => {
  const incoming = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  return { ...(existing ?? {}), ...incoming };
};
const before = { partialAdults: 4, partialRoomType: "Deluxe", checkIn: "2026-10-03", checkOut: "2026-10-05" };
assert.deepEqual(
  mergeSlots(before, { checkIn: "2026-10-10", checkOut: "2026-10-12" }),
  { partialAdults: 4, partialRoomType: "Deluxe", checkIn: "2026-10-10", checkOut: "2026-10-12" },
  "fast-path tanpa jumlah tamu hanya kirim tanggal; jumlah tamu & tipe kamar tetap",
);
assert.deepEqual(
  mergeSlots(before, { checkIn: "2026-10-10", checkOut: "2026-10-12", partialAdults: 3, partialChildren: 1 }),
  {
    partialAdults: 3,
    partialChildren: 1,
    partialRoomType: "Deluxe",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
  },
  "jumlah tamu yang baru disebut menimpa slot tamu, tipe kamar tetap",
);
assert.deepEqual(mergeSlots(before, null), before, "p_slots NULL tidak mengubah slots");
assert.deepEqual(mergeSlots(before, {}), before, "p_slots {} tidak menghapus");
assert.deepEqual(mergeSlots(before, [1, 2]), before, "non-object diabaikan");
assert.deepEqual(mergeSlots(null, { checkIn: "2026-10-03" }), { checkIn: "2026-10-03" });

// ── kode pemanggil ──────────────────────────────────────────────────────────
const wa = readFileSync(new URL("../src/services/wa-autoreply.service.ts", import.meta.url), "utf8");
assert.equal((wa.match(/const \w+ = availabilitySlotPatch\(/g) ?? []).length, 2, "dua fast-path availability");
assert.match(wa, /partialAdults = result\.guests\.adults/, "jumlah tamu ikut disimpan bila sudah diketahui");
assert.equal((wa.match(/MENGGABUNG slots/g) ?? []).length, 2);
const sim = readFileSync(new URL("../src/admin/modules/ai-lab/simulator.functions.ts", import.meta.url), "utf8");
assert.match(sim, /\.from\("wa_booking_states"\)\s*\.update\(\{ slots: \{\}/, "reset simulator eksplisit karena RPC kini menggabung");
assert.doesNotMatch(sim, /p_slots:\s+\{\},/);

console.log("wa memory sql ok");
