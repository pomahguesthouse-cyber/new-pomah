import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRoomNightlyRates } from "../src/services/pricing/daily-rate.service";
import {
  formatNightlyBreakdownLines,
  formatRoomQuoteText,
  formatStartingFromPrice,
  hasVaryingRates,
} from "../src/services/pricing/price-quote";

const room = { id: "rt-single", name: "Single", base_rate: 150000, extrabed_rate: 100000 } as any;
const ov = (date: string, rate: number, extrabed_rate: number | null = null) => ({
  room_type_id: "rt-single", date, rate, extrabed_rate, min_stay: 1, stop_sell: false, note: null,
});

// 1) Tanpa harga kalender → fallback base_rate.
const base = resolveRoomNightlyRates(room, "2026-11-02", "2026-11-04", undefined);
assert.equal(base.total, 300000);
assert.equal(base.all_base, true);
assert.deepEqual(base.nightly.map((n) => n.source), ["base_rate", "base_rate"]);

// 2) Harga kalender menimpa base_rate hanya di tanggal yang diatur; total = jumlah per malam.
const overrides = new Map([["2026-11-07", ov("2026-11-07", 200000, 120000)]]);
const mixed = resolveRoomNightlyRates(room, "2026-11-06", "2026-11-09", overrides);
assert.deepEqual(mixed.nightly.map((n) => n.rate), [150000, 200000, 150000]);
assert.deepEqual(mixed.nightly.map((n) => n.source), ["base_rate", "daily_rate", "base_rate"]);
assert.deepEqual(mixed.nightly.map((n) => n.extrabed_rate), [100000, 120000, 100000]);
assert.equal(mixed.total, 500000);
assert.equal(hasVaryingRates(mixed.nightly), true);
assert.equal(hasVaryingRates(base.nightly), false);
assert.deepEqual(formatNightlyBreakdownLines(mixed.nightly), [
  "  · 6 Nov: Rp150.000",
  "  · 7 Nov: Rp200.000",
  "  · 8 Nov: Rp150.000",
]);

// 3) Teks harga untuk tamu.
assert.equal(formatRoomQuoteText({ harga_per_malam: 150000, malam: 1, total_rate: 150000 }), ", Rp150.000/malam");
assert.equal(
  formatRoomQuoteText({ harga_per_malam: 175000, malam: 2, total_rate: 350000 }),
  ", Rp175.000/malam (total Rp350.000 untuk 2 malam)",
);
assert.equal(
  formatRoomQuoteText({
    harga_per_malam: 150000, malam: 2, total_rate: 350000,
    nightly_breakdown: [{ tanggal: "2026-11-06", harga: 150000 }, { tanggal: "2026-11-07", harga: 200000 }],
  }),
  ", total Rp350.000 untuk 2 malam (6 Nov Rp150.000, 7 Nov Rp200.000)",
);
assert.equal(formatRoomQuoteText({ harga_per_malam: 0 }), "");
assert.match(formatStartingFromPrice(150000), /^mulai dari Rp150\.000\/malam/);

// 4) Wiring: formatter & ringkasan booking memakai kalender harga.
const fmt = readFileSync("src/services/wa-autoreply/availability-formatters.ts", "utf8");
assert.match(fmt, /formatRoomQuoteText\(/);
assert.doesNotMatch(fmt, /Rp\$\{price\.toLocaleString\("id-ID"\)\}\/malam/);
const bm = readFileSync("src/ai/state-machine/booking-machine.ts", "utf8");
assert.match(bm, /Rincian per malam/);
const tool = readFileSync("src/tools/availability.tool.ts", "utf8");
assert.match(tool, /aturan_harga:/);
assert.match(tool, /resolved\.nightly\.reduce\(\(sum, n\) => sum \+ n\.extrabed_rate/);

// 5) Prompt chatbot tidak boleh berisi harga kamar statis.
const ROOM_PRICE = /Rp\s?\d{2,3}\.000\s?\/\s?malam/;
for (const file of [
  "src/ai/agents/front-office.agent.ts",
  "src/ai/context-builder.ts",
  "src/tools/room-specifications.tool.ts",
]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), ROOM_PRICE, `${file} masih berisi harga kamar statis`);
}
const fo = readFileSync("src/ai/agents/front-office.agent.ts", "utf8");
assert.match(fo, /ACUAN HARGA = KALENDER HARGA/);
assert.match(readFileSync("src/ai/context-builder.ts", "utf8"), /mulai dari Rp/);

console.log("chatbot calendar pricing: OK");
