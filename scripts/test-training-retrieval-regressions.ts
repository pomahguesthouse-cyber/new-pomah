import assert from "node:assert/strict";
import { inferTrainingIntent } from "../src/services/training-retrieval.service";

type Case = {
  message: string;
  expected: string;
};

const cases: Case[] = [
  // Short stays must remain normal daily stays.
  { message: "Saya mau menginap 1 malam", expected: "general" },
  { message: "Saya mau menginap 2 malam", expected: "general" },
  { message: "Tinggal 3 hari", expected: "general" },
  { message: "Sewa 6 malam", expected: "general" },

  // Long stays and explicit package words.
  { message: "Saya mau menginap 7 malam", expected: "inquiry_monthly_rental" },
  { message: "Tinggal 20 hari", expected: "inquiry_monthly_rental" },
  { message: "Sewa 1 minggu", expected: "inquiry_monthly_rental" },
  { message: "Ada harga kost bulanan?", expected: "inquiry_monthly_rental" },
  { message: "Bisa kontrak satu bulan?", expected: "inquiry_monthly_rental" },

  // Booking lifecycle must not collapse into availability.
  { message: "Saya mau booking Deluxe", expected: "booking_request" },
  { message: "Tolong pesan kamar Family", expected: "booking_request" },
  { message: "Saya sudah booking", expected: "booking_status" },
  { message: "Status booking saya bagaimana?", expected: "booking_status" },
  { message: "Kode booking saya mana?", expected: "booking_status" },
  { message: "Mau batal booking", expected: "booking_cancel" },
  { message: "Tolong hapus reservasi saya", expected: "booking_cancel" },
  { message: "Bisa ganti tanggal booking?", expected: "booking_change" },
  { message: "Saya mau reschedule reservasi", expected: "booking_change" },

  // Availability must require an actual availability signal.
  { message: "Masih ada kamar besok?", expected: "availability_check" },
  { message: "Cek ketersediaan Deluxe", expected: "availability_check" },
  { message: "Ada kamar kosong?", expected: "availability_check" },
  { message: "Booking", expected: "general" },

  // Other core intents should remain stable.
  { message: "Harga Deluxe berapa?", expected: "pricing_inquiry" },
  { message: "Ada wifi dan air panas?", expected: "facility_inquiry" },
  { message: "Lokasinya dekat UNNES?", expected: "location_inquiry" },
  { message: "Saya sudah transfer DP", expected: "payment_inquiry" },
  { message: "Kamarnya kotor dan AC rusak", expected: "complaint" },
];

for (const testCase of cases) {
  const actual = inferTrainingIntent(testCase.message);
  assert.equal(
    actual,
    testCase.expected,
    `Intent mismatch for ${JSON.stringify(testCase.message)}: expected ${testCase.expected}, got ${actual}`,
  );
}

console.log(`✓ ${cases.length} training retrieval regression cases passed`);
