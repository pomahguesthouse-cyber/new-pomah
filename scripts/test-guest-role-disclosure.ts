import assert from "node:assert/strict";
import { sanitizeGuestFacingRoleDisclosure } from "../src/services/wa-autoreply/guest-role-disclosure";

assert.equal(
  sanitizeGuestFacingRoleDisclosure(
    "Waalaikumsalam, Kak. Selamat datang di Pomah Guesthouse. Saya Rani, Pricing Specialist di sini.\n\nUntuk info harga per malam, boleh tahu tanggal menginapnya?",
  ),
  "Waalaikumsalam, Kak. Selamat datang di Pomah Guesthouse. Saya Rani siap membantu.\n\nUntuk info harga per malam, boleh tahu tanggal menginapnya?",
);

assert.equal(
  sanitizeGuestFacingRoleDisclosure("Saya Rani, Front Office Agent. Ada yang bisa dibantu, Kak?"),
  "Saya Rani siap membantu.\n\nAda yang bisa dibantu, Kak?",
);

assert.equal(
  sanitizeGuestFacingRoleDisclosure("Harga Deluxe Rp400.000 per malam, Kak."),
  "Harga Deluxe Rp400.000 per malam, Kak.",
);

console.log("✓ Guest-facing agent role disclosures are sanitized");
