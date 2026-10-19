import assert from "node:assert/strict";
import { sanitizeGuestFacingRoleDisclosure } from "../src/services/wa-autoreply/guest-role-disclosure";

assert.equal(
  sanitizeGuestFacingRoleDisclosure(
    "Waalaikumsalam, Kak. Selamat datang di Pomah Guesthouse. Saya Rani, Pricing Specialist di sini.\n\nUntuk info harga per malam, boleh tahu tanggal menginapnya?",
  ),
  "Waalaikumsalam, Kak. Selamat datang di Pomah Guesthouse. Saya asisten otomatis Pomah Guesthouse.\n\nUntuk info harga per malam, boleh tahu tanggal menginapnya?",
);

assert.equal(
  sanitizeGuestFacingRoleDisclosure("Saya Rani, Front Office Agent. Ada yang bisa dibantu, Kak?"),
  "Saya asisten otomatis Pomah Guesthouse. Ada yang bisa dibantu, Kak?",
);

// Insiden 17 Okt 2026: persona mengaku staf Finance, tamu ragu rekening aman.
assert.equal(
  sanitizeGuestFacingRoleDisclosure("Halo Kak, saya Rani dari Finance & Pembayaran. Silakan transfer ke BCA."),
  "Halo Kak, saya asisten otomatis Pomah Guesthouse. Silakan transfer ke BCA.",
);
assert.ok(!/Finance & Pembayaran/.test(sanitizeGuestFacingRoleDisclosure("Ini tim Finance & Pembayaran ya Kak.")));

// Pesan non-identitas tidak disentuh; persona lama tetap untuk Pricing Specialist lain.
assert.equal(
  sanitizeGuestFacingRoleDisclosure("Saya Budi, Pricing Specialist di sini."),
  "Saya Budi siap membantu.",
);
assert.equal(
  sanitizeGuestFacingRoleDisclosure("Harga Deluxe Rp400.000 per malam, Kak."),
  "Harga Deluxe Rp400.000 per malam, Kak.",
);

console.log("✓ Guest-facing agent role disclosures are sanitized (honest automated assistant)");
