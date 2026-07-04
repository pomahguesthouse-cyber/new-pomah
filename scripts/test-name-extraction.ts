/**
 * Regression script untuk ekstraksi nama tamu di alur booking.
 *
 * Latar: percakapan produksi 3 Juli 2026 — tamu menulis
 * "atas nama Lutfi Jihan Priyanti ya minn" (tanpa titik dua, dengan filler),
 * bot gagal menangkap nama dan menanyakannya lagi.
 *
 * Jalankan: bun run scripts/test-name-extraction.ts
 *       atau npx tsx scripts/test-name-extraction.ts
 */

import { extractAllSlots } from "../src/ai/state-machine/flexible-slot-extractor";

const rooms = [
  { id: "r1", name: "Deluxe", base_rate: 350000 },
  { id: "r2", name: "Grand Deluxe", base_rate: 450000 },
  { id: "r3", name: "Family Room 222", base_rate: 500000 },
];

let pass = 0;
let fail = 0;

function expectName(message: string, expected: string | undefined, note = "") {
  const got = extractAllSlots(message, rooms, "6281228852015", "2026-07-03").guest_name;
  const ok = got === expected;
  if (ok) {
    pass++;
    console.log(`  ✅ ${JSON.stringify(message)} → ${JSON.stringify(got)}`);
  } else {
    fail++;
    console.error(
      `  ❌ ${JSON.stringify(message)} → ${JSON.stringify(got)}, expected ${JSON.stringify(expected)} ${note}`,
    );
  }
}

console.log("— Kasus produksi (label tanpa titik dua + filler ekor) —");
expectName("atas nama Lutfi Jihan Priyanti ya minn", "Lutfi Jihan Priyanti");
expectName("atas nama Budi Santoso", "Budi Santoso");
expectName("a/n Siti Rahma dong", "Siti Rahma");
expectName("nama saya Andi Wijaya kak", "Andi Wijaya");
expectName("namaku Dewi", "Dewi");

console.log("— Kasus lama (label dengan titik dua) tetap jalan —");
expectName("atas nama: Cindyaz Galuh Nialifia", "Cindyaz Galuh Nialifia");
expectName("nama: Rudi Hartono", "Rudi Hartono");
expectName("name: John Smith", "John Smith");
expectName("a/n: Tono", "Tono");

console.log("— Filler & honorifik dibuang, nama tidak rusak —");
expectName("atas nama Ratih Asmarani ya", "Ratih Asmarani");
expectName("atas nama Yanti", "Yanti"); // "ya" di tengah nama tidak boleh terpotong
expectName("atas nama Pak Joko Susilo yaa minn", "Joko Susilo");
expectName("atas nama Karmin", "Karmin"); // berakhiran "min" tapi satu kata utuh

console.log("— Kalimat tanya TIDAK boleh salah tangkap sebagai nama —");
expectName("nama hotelnya apa ya min?", undefined);
expectName("nama wifi nya apa?", undefined);

console.log("— Jumlah tamu: slang anak (insiden 4 Jul 2026) —");
{
  const slots = extractAllSlots("Saya 2 dewasa dan 2 bocil", rooms, "6281251193914", "2026-07-03");
  const ok = slots.adults === 2 && slots.children === 2;
  if (ok) {
    pass++;
    console.log(`  ✅ "2 dewasa dan 2 bocil" → adults=2, children=2`);
  } else {
    fail++;
    console.error(`  ❌ "2 dewasa dan 2 bocil" → adults=${slots.adults}, children=${slots.children}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
