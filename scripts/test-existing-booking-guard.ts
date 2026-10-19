import assert from "node:assert/strict";
import { shouldSkipAvailabilityForExistingBooking as skip } from "../src/services/wa-autoreply/existing-booking-guard";
import { detectFacilityTopic } from "../src/services/room-facility-kb";

// SULO PG-MBGMB, 17 Okt 14:24–14:26
assert.equal(detectFacilityTopic("Permisi mau tanya, untuk check in nya di sebelah mana ya?"), "checkin_point");
assert.equal(detectFacilityTopic("Maksudnya kamarnya di sebelah mana ya?"), "checkin_point");
assert.equal(skip({ message: "Saya sudah pesan kamar sebelumnya. Dengan kode booking PG-MBGMB", hasActiveBooking: false }), true);
assert.equal(skip({ message: "untuk 2 orang", hasActiveBooking: true }), true);
assert.equal(skip({ message: "Iya, sudah di depan", hasActiveBooking: false }), true);

// Tamu baru / permintaan menginap baru tetap boleh cek ketersediaan
assert.equal(skip({ message: "ada kamar kosong untuk 2 orang?", hasActiveBooking: false }), false);
assert.equal(skip({ message: "untuk 2 orang", hasActiveBooking: false }), false);
assert.equal(skip({ message: "masih ada kamar kosong tanggal 25?", hasActiveBooking: true }), false);
assert.equal(skip({ message: "mau tambah kamar lain kak", hasActiveBooking: true }), false);

console.log("✓ existing booking guard: tamu yang sudah pesan tidak ditawari cek ketersediaan");
