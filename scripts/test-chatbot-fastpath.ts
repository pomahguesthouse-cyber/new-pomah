/**
 * Regression script untuk fast-path deterministik chatbot.
 *
 * Menjalankan skenario percakapan inti tanpa memanggil LLM: greeting,
 * thanks, alamat, kontak, jam check-in, dan booking inquiry sederhana.
 * Berjalan sepenuhnya di memori dengan property tiruan sehingga aman
 * dijalankan lokal (`bun run scripts/test-chatbot-fastpath.ts`) atau di CI
 * tanpa kredensial Supabase.
 *
 * Tujuan: mendeteksi regresi pola regex pada `buildDeterministicPropertyFaqReply`
 * sebelum di-deploy — bug fast-path terlihat setelah ke produksi karena LLM
 * "menutupinya" dengan jawaban yang mirip.
 */

// Kita duplikasi helper regex di sini agar tidak menarik seluruh service +
// dependensinya (Supabase, dsb). Signature dan body harus disinkronkan
// dengan `buildDeterministicPropertyFaqReply` di
// src/services/wa-autoreply.service.ts.
type FaqOut = { reply: string; intent: string } | null;

function buildDeterministicPropertyFaqReply(params: {
  message: string;
  property: any;
  greetingUsed: boolean;
}): FaqOut {
  const raw = params.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 200) return null;
  const p = params.property ?? {};
  const opener = params.greetingUsed ? "" : "Halo Kak 👋 ";

  const FILLER = "(?:\\s+(?:kak|kakak|ka|min|admin|pak|bu|ya|dong|banget|deh|nih))*";
  if (
    new RegExp(
      `^(halo|hai|hi|hello|assalamu?alaikum|salam|permisi|selamat (pagi|siang|sore|malam))${FILLER}[\\s!.\\-,]*$`,
      "i",
    ).test(raw)
  ) {
    return { reply: `Halo Kak, terima kasih sudah menghubungi ${p.name ?? "Pomah Guesthouse"}`, intent: "greeting" };
  }
  if (
    new RegExp(
      `^(makasih|terima\\s*kasih|thanks|thank\\s*you|thx|tq|ty|oke\\s*(makasih|thanks)?|sip|siap)${FILLER}[\\s!.\\-,]*$`,
      "i",
    ).test(raw)
  ) {
    return { reply: `Sama-sama Kak`, intent: "thanks" };
  }

  if (/\b(alamat|lokasi|dimana|di mana|dmn|maps|map|lokasinya|arah|arahan|posisi)\b/i.test(raw) && p.address) {
    return { reply: `${opener}Alamat kami: ${p.address}`, intent: "location_question" };
  }
  if (/\b(kontak|nomor|no\.?\s*wa|whatsapp|telepon|telp|hp|email|ig|instagram)\b/i.test(raw)) {
    if (!(p.whatsapp_number || p.phone || p.email || p.instagram_url)) return null;
    return { reply: `${opener}Kontak: ${p.whatsapp_number ?? p.phone ?? p.email}`, intent: "contact_request" };
  }
  if (/\b(check\s*[- ]?in|checkin|jam\s*masuk|waktu\s*masuk|check\s*[- ]?out|checkout|jam\s*keluar|waktu\s*keluar)\b/i.test(raw)) {
    return { reply: `${opener}Check-in ${p.check_in_time?.slice(0, 5) ?? "14:00"}`, intent: "policy_question" };
  }
  return null;
}

// ── Scenarios ──────────────────────────────────────────────────────────────
const PROPERTY = {
  name: "Pomah Guesthouse",
  address: "Jl. Contoh 1, Ambarawa",
  whatsapp_number: "+6281200000000",
  email: "hi@pomah.id",
  instagram_url: "https://ig.com/pomah",
  check_in_time: "14:00:00",
  check_out_time: "12:00:00",
};

const CASES: Array<{ label: string; input: string; expectIntent: string | null }> = [
  { label: "greeting halo", input: "Halo kak", expectIntent: "greeting" },
  { label: "greeting selamat pagi", input: "selamat pagi", expectIntent: "greeting" },
  { label: "thanks", input: "makasih ya kak", expectIntent: "thanks" },
  { label: "thanks siap", input: "siap", expectIntent: "thanks" },
  { label: "alamat", input: "alamatnya dimana?", expectIntent: "location_question" },
  { label: "lokasi maps", input: "share maps dong", expectIntent: "location_question" },
  { label: "kontak wa", input: "nomor wa berapa?", expectIntent: "contact_request" },
  { label: "kontak instagram", input: "IG kalian apa?", expectIntent: "contact_request" },
  { label: "jam check-in", input: "jam checkin jam berapa?", expectIntent: "policy_question" },
  { label: "jam check-out", input: "checkout jam brp", expectIntent: "policy_question" },
  // Negatif: harus TIDAK match agar tidak "menelan" pesan booking
  { label: "booking (bukan FAQ)", input: "mau booking kamar untuk besok", expectIntent: null },
  { label: "pertanyaan bebas", input: "boleh bawa hewan peliharaan?", expectIntent: null },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const out = buildDeterministicPropertyFaqReply({
    message: c.input,
    property: PROPERTY,
    greetingUsed: false,
  });
  const gotIntent = out?.intent ?? null;
  const ok = gotIntent === c.expectIntent;
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${c.label} → ${gotIntent ?? "(no-match)"}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${c.label} — expected ${c.expectIntent ?? "(no-match)"}, got ${gotIntent ?? "(no-match)"}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
