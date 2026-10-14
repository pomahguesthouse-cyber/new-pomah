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
  "Baik Kak, untuk melanjutkan booking, rencana check-in tanggal berapa dan untuk berapa malam?",
);
assert.equal(
  buildStateAwareFallback("CONFIRMING_NAME"),
  "Baik Kak, boleh dibantu nama lengkap untuk booking ini?",
);
assert.equal(
  buildStateAwareFallback("AWAITING_PHONE"),
  "Baik Kak, boleh dibantu nomor WhatsApp yang bisa kami hubungi?",
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

// Fallback tidak boleh menyuruh tamu mengetik 'lanjut' (insiden 9 Agu 2026):
// tidak ada handler untuk kata itu, dan bot tetap mengirim jawaban aslinya
// beberapa detik kemudian — tamu melihat sistem menyerah lalu menjawab sendiri.
assert.ok(!/\blanjut\b/i.test(FALLBACK_MESSAGE));
assert.ok(/maaf/i.test(FALLBACK_MESSAGE));
assert.ok(MANAGER_FALLBACK_MESSAGE.includes("Admin"));
assert.ok(QUICK_ACK_MESSAGE === "Kami cek terlebih dahulu ya, Kak.");

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

// Tanpa janji batas waktu verifikasi pembayaran.
import { PAYMENT_PROOF_ACK_REPLY } from "../src/services/wa-inbound-media";
import { FORM_EXPIRY_MESSAGE } from "../src/services/booking-form-followup.service";
import { readFileSync as _rf } from "node:fs";
assert.ok(PAYMENT_PROOF_ACK_REPLY.includes("Kami cek terlebih dahulu ya, Kak."));
assert.ok(!/24\s*jam/.test(PAYMENT_PROOF_ACK_REPLY));
assert.ok(!/1\s*[x×]\s*24/.test(_rf("src/admin/modules/ai-lab/ai-lab.functions.ts", "utf8")));
assert.ok(_rf("src/ai/agents/front-office.agent.ts", "utf8").includes("Kami cek terlebih dahulu ya, Kak."));
// Pesan kedaluwarsa formulir: satu sumber, dipakai booking-machine.
assert.ok(_rf("src/ai/state-machine/booking-machine.ts", "utf8").includes("FORM_EXPIRY_MESSAGE"));
assert.ok(FORM_EXPIRY_MESSAGE.startsWith("Mohon maaf Kak, tautan formulir"));
console.log("rani-tone: OK");
