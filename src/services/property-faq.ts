/**
 * Property FAQ builder — SATU-SATUNYA sumber jawaban FAQ deterministik
 * (greeting, thanks, alamat, kontak, jam check-in/out, wifi, parkir,
 * fasilitas).
 *
 * Konsolidasi 3 Jul 2026 (O3): sebelumnya logika ini terpecah di DUA builder
 * dalam wa-autoreply.service.ts (`buildFastFaqReply` dijalankan sebelum jalur
 * availability, `buildDeterministicPropertyFaqReply` sesudahnya) dengan regex
 * dan template yang saling berbeda — bug "checkout" harus ditambal dua kali.
 * Kini satu builder dengan `mode`:
 *   - "early": dipanggil SEBELUM fast-path availability → blocklist kata
 *     booking/harga/tanggal aktif agar "halo, ada kamar ga?" tetap sampai ke
 *     jalur availability.
 *   - "late": dipanggil SETELAH jalur availability mendapat kesempatan →
 *     blocklist dilewati.
 *
 * Pure function — tanpa I/O — sehingga scripts/test-chatbot-fastpath.ts bisa
 * mengimpor langsung (tidak ada lagi salinan manual yang bisa drift).
 */

import { buildFacilityReply, findMentionedRooms, type FacilityRoom } from "@/ai/state-machine/booking-inline-answers";

export interface PropertyFaqReply {
  reply: string;
  intent: string;
}

export interface PropertyFaqInput {
  message: string;
  property: Record<string, unknown> | null | undefined;
  rooms?: FacilityRoom[];
  /** true → jangan tambahkan opener "Halo Kak 👋 " (tamu sudah disapa / bot
   *  sudah membalas di sesi berjalan). */
  greetingUsed?: boolean;
  mode: "early" | "late";
}

// ─── Guard patterns ──────────────────────────────────────────────────────────

/** Kata yang menandakan pesan milik jalur booking/availability, bukan FAQ. */
export const FAQ_BLOCK_RE =
  /\b(booking|pesan|reservasi|available|availability|tersedia|kamar|room|harga|rate|tarif|tanggal|check.?in|check.?out|malam|orang|tamu|bayar|transfer|dp|invoice)\b/i;

/** Sinyal komplain/kerusakan — template FAQ dilarang menjawab keluhan. */
export const COMPLAINT_SIGNAL_RE =
  /\b(rusak|mati|lemot|lambat|putus|bocor|kotor|bau|berisik|bising|tidak bisa|ga bisa|gak bisa|nggak bisa|gabisa|g bisa|gbs|error|eror|bermasalah|komplain|keluhan|kecewa|baret|lecet|hilang|kemalingan|denda)\b/i;

/** Sinyal tanggal/durasi menginap — pesan begini adalah jawaban tanggal. */
const DATE_SIGNAL_RE =
  /\b(tgl\.?|tanggal|\d{1,2}\s*[-–/]\s*\d{1,2}|\d{1,2}\s*(?:jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|ags|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)|besok|lusa|minggu\s+depan|bulan\s+depan|malam\s+ini|nanti\s+malam|menginap(?:nya)?)\b/i;

/** Filler ekor: "kak", "min", "yaa", "dong", dst. — boleh berulang. */
const FILLER = "(?:\\s+(?:kak|kakak|ka|min|admin|pak|bu|y+a+h?|dong|banget|banyak|deh|nih|loh|lho))*";

/** Interjeksi awal yang bukan isi pesan ("Yahh, oke kak makasih ya"). */
const LEAD_INTERJECTION_RE =
  /^(?:(?:y+a+h*|wah|waduh|oalah|aduh|hmm+|oh+|nah|deh|dong|ya\s?udah?|yaudah|yasudah|baik(?:lah)?|ok|oke?y?|okay|kak|kakak|ka|min|admin|pak|bu)[\s,!.…~-]+)+/i;

const GREET_RE = new RegExp(
  `^(halo|hai|hi|hello|assalamu?alaikum|salam|permisi|selamat (pagi|siang|sore|malam))${FILLER}[\\s!.\\-,]*$`,
  "i",
);

const THANKS_RE = new RegExp(
  `^(makasih|terima\\s*kasih|t(e)?rima?\\s*kasih|trims?|thanks|thank\\s*you|thx|tq|ty|oke\\s*(makasih|thanks)?|sip|siap)${FILLER}[^a-z0-9]*$`,
  "i",
);

// O5 — batas panjang untuk branch template satu-baris (wifi/parkir/kontak):
// pesan panjang hampir pasti multi-intent ("wifi ada? terus saya juga mau
// tanya soal ...") — branch pertama yang cocok akan MENELAN sisa pesan.
// Biarkan AI menjawab utuh.
const ONE_LINER_MAX_LEN = 80;

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildPropertyFaqReply(input: PropertyFaqInput): PropertyFaqReply | null {
  const raw = input.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 200) return null;
  if (COMPLAINT_SIGNAL_RE.test(raw)) return null;
  if (input.mode === "early" && FAQ_BLOCK_RE.test(raw)) return null;
  // ≥2 pertanyaan dalam satu pesan ("Lokasi dimana? Ke UNNES jauh?") — branch
  // template hanya menjawab satu topik dan menelan sisanya. Serahkan ke AI.
  if ((raw.match(/\?/g) ?? []).length >= 2) return null;

  const p = input.property ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const propertyName = str(p.name) || str(p.title) || "Pomah Guesthouse";
  const address = str(p.address) || str(p.location);
  const phone = str(p.whatsapp_number) || str(p.phone) || str(p.whatsapp);
  const email = str(p.email);
  const instagram = str(p.instagram_url);
  const mapUrl = str(p.google_maps_url) || str(p.maps_url);
  const placeId = str(p.google_place_id);
  const checkInTime = (str(p.check_in_time) || str(p.checkin_time) || "14:00").slice(0, 5);
  const checkOutTime = (str(p.check_out_time) || str(p.checkout_time) || "12:00").slice(0, 5);
  const opener = input.greetingUsed ? "" : "Halo Kak 👋 ";
  const rooms = input.rooms ?? [];

  const core = raw.replace(LEAD_INTERJECTION_RE, "");

  // — Greeting murni —
  if (GREET_RE.test(core) || GREET_RE.test(raw)) {
    return {
      reply:
        `Halo Kak, terima kasih sudah menghubungi ${propertyName} 🙏\n` +
        `Ada yang bisa kami bantu — mau cek ketersediaan kamar, harga, atau info fasilitas?`,
      intent: "greeting",
    };
  }

  // — Terima kasih / penutup —
  if (THANKS_RE.test(core) || THANKS_RE.test(raw)) {
    return {
      reply: `Sama-sama Kak 🙏 Kalau ada yang perlu ditanyakan lagi, silakan chat kami ya.`,
      intent: "thanks",
    };
  }

  // — Alamat / lokasi —
  if (
    /\b(alamat|lokasi|dimana|di mana|dmn|maps?|map|lokasinya|rute|arah|arahan|posisi|google maps)\b/i.test(raw) &&
    address
  ) {
    const mapsLink =
      mapUrl ||
      (placeId
        ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
    const lines = [`${opener}Alamat kami:\n📍 ${address}`, `Maps: ${mapsLink}`];
    if (phone) lines.push(`Kalau Kakak kesulitan mencari lokasi, bisa hubungi kami di ${phone}.`);
    return { reply: lines.join("\n\n"), intent: "location_question" };
  }

  // — Kontak — (satu-baris → batas panjang O5)
  if (
    raw.length <= ONE_LINER_MAX_LEN &&
    /\b(kontak|nomor|no\.?\s*wa|whatsapp|telepon|telp|hp|email|ig|instagram)\b/i.test(raw)
  ) {
    const bits: string[] = [];
    if (phone) bits.push(`📱 WA/Telp: ${phone}`);
    if (email) bits.push(`✉️ Email: ${email}`);
    if (instagram) bits.push(`📸 Instagram: ${instagram}`);
    if (bits.length === 0) return null;
    return { reply: `${opener}Berikut kontak kami:\n${bits.join("\n")}`, intent: "contact_request" };
  }

  // — Jam check-in / check-out — (guard sinyal tanggal: "tgl 8 udh checkout"
  //   adalah jawaban tanggal, bukan pertanyaan kebijakan)
  if (
    /\b(check\s*[- ]?in|checkin|jam\s*masuk|waktu\s*masuk|check\s*[- ]?out|checkout|jam\s*keluar|waktu\s*keluar)\b/i.test(raw) &&
    !DATE_SIGNAL_RE.test(raw)
  ) {
    return {
      reply:
        `${opener}Waktu check-in mulai pukul *${checkInTime}* dan check-out paling lambat *${checkOutTime}*.\n` +
        `Early check-in / late check-out mengikuti ketersediaan kamar ya Kak 🙏`,
      intent: "policy_question",
    };
  }

  // — WiFi — (satu-baris → batas panjang O5)
  if (raw.length <= ONE_LINER_MAX_LEN && /\b(wifi|wi-fi|internet)\b/i.test(raw)) {
    return { reply: "Iya Kak, tersedia WiFi untuk tamu.", intent: "faq_wifi" };
  }

  // — Parkir — (satu-baris → batas panjang O5)
  if (raw.length <= ONE_LINER_MAX_LEN && /\b(parkir|parking|mobil|motor)\b/i.test(raw)) {
    return {
      reply:
        "Iya Kak, tersedia area parkir untuk tamu. Untuk kendaraan besar atau rombongan, " +
        "kabari kami dulu ya agar bisa dibantu arahkan.",
      intent: "faq_parking",
    };
  }

  // — Fasilitas: per tipe kamar / perbandingan —
  const facilityKeyword = /\b(fasilitas|amenities|ada apa saja)\b/i.test(raw);
  const diffKeyword = /\b(perbedaan|bedanya|beda)\b/i.test(raw);
  const priceOnlyQuestion = /\b(harga|tarif|price|rate)\b/i.test(raw) && !facilityKeyword;
  if (facilityKeyword || (diffKeyword && !priceOnlyQuestion)) {
    const mentionedRooms = findMentionedRooms(raw, rooms);
    if (facilityKeyword || mentionedRooms.length >= 2) {
      const reply = buildFacilityReply(raw, rooms);
      if (reply) return { reply, intent: "faq_facility" };
      if (facilityKeyword) {
        return {
          reply: "Fasilitas tergantung tipe kamar yang dipilih Kak. Sebutkan tipe kamarnya ya, nanti saya rincikan.",
          intent: "faq_facility",
        };
      }
    }
  }

  return null;
}
