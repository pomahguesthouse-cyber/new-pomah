import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AI_TIMEOUT_LIGHT_MS,
  AI_TIMEOUT_MS,
  FALLBACK_MESSAGE,
  MANAGER_FALLBACK_MESSAGE,
  QUICK_ACK_MESSAGE,
  buildStateAwareFallback,
  pickAiBudgetMs,
} from "../src/services/wa-autoreply/runtime-policy";

assert.equal(buildStateAwareFallback(), FALLBACK_MESSAGE);
assert.equal(
  buildStateAwareFallback("WAITING_DATE_CHANGE"),
  "Baik Kak, untuk melanjutkan booking, tanggal barunya kapan dan berapa malam?",
);
assert.equal(
  buildStateAwareFallback("CONFIRMING_NAME"),
  "Baik Kak, mohon ketikkan nama lengkap untuk booking ini.",
);
assert.equal(
  buildStateAwareFallback("AWAITING_PHONE"),
  "Baik Kak, mohon ketikkan nomor WhatsApp yang bisa dihubungi.",
);
assert.equal(
  buildStateAwareFallback("CONFIRMING_BOOKING"),
  "Apakah data booking sudah sesuai? Kakak bisa balas Ya, Lanjut, atau Batal.",
);

assert.equal(pickAiBudgetMs("halo kak"), AI_TIMEOUT_LIGHT_MS);
assert.equal(pickAiBudgetMs("terima kasih"), AI_TIMEOUT_LIGHT_MS);
assert.equal(pickAiBudgetMs("berapa harga kamar deluxe?"), AI_TIMEOUT_MS);
assert.equal(pickAiBudgetMs("saya mau booking tanggal 15 juli"), AI_TIMEOUT_MS);
assert.equal(pickAiBudgetMs("x".repeat(121)), AI_TIMEOUT_MS);
assert.equal(pickAiBudgetMs(""), AI_TIMEOUT_LIGHT_MS);

assert.ok(FALLBACK_MESSAGE.includes("lanjut"));
assert.ok(MANAGER_FALLBACK_MESSAGE.includes("Admin"));
assert.ok(QUICK_ACK_MESSAGE.includes("cekkan"));

const serviceSource = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.ok(
  serviceSource.includes('from "@/services/wa-autoreply/runtime-policy"'),
  "wa-autoreply.service.ts must import runtime-policy",
);
for (const forbidden of [
  "const FALLBACK_MESSAGE =",
  "const MANAGER_FALLBACK_MESSAGE =",
  "const QUICK_ACK_MESSAGE =",
  "function buildStateAwareFallback(",
  "const AI_TIMEOUT_MS =",
  "const AI_TIMEOUT_LIGHT_MS =",
  "const HEAVY_INTENT_RE =",
  "function pickAiBudgetMs(",
]) {
  assert.equal(
    serviceSource.includes(forbidden),
    false,
    `wa-autoreply.service.ts still duplicates runtime policy: ${forbidden}`,
  );
}

console.log("✓ WhatsApp runtime policy regression and wiring cases passed");
