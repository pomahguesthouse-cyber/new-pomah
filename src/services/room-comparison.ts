/**
 * Perbandingan tipe kamar + tawaran brosur (permintaan pemilik 31 Okt 2026).
 *
 * Log WA 90 hari: ±15 pertanyaan "bedanya apa", "beda family suite sama family
 * room", "bedanya deluxe sm grand deluxe". Sebagian dioper ("Sebentar Kak, saya
 * cekkan dulu"), sebagian ditelan jalur availability (dijawab harga, bukan
 * perbedaan). Modul ini menjawab perbedaan dari data `room_types` saat runtime
 * (luas, lantai, kasur, kapasitas, kamar tidur/mandi, fasilitas) lalu SELALU
 * ditutup tawaran brosur. Bila tamu membalas "ya/mau/boleh", jalur media
 * mengirim brosur PDF (lihat `isBrochureOfferAcceptance`).
 *
 * Harga sengaja TIDAK disebut: harga ikut kalender harga / harga dasar dan
 * dijawab jalur harga.
 *
 * Pure — tanpa I/O.
 */

export interface ComparisonRoom {
  name?: unknown;
  amenities?: unknown;
  floor_info?: unknown;
  size_sqm?: unknown;
  bed_type?: unknown;
  bed_size?: unknown;
  capacity?: unknown;
  max_occupancy?: unknown;
  extrabed_capacity?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
}

/** Penanda kalimat tawaran — dipakai untuk mengenali balasan "mau" tamu. */
export const ROOM_BROCHURE_OFFER_MARKER = "kami bisa kirimkan brosur kamarnya";
export const ROOM_BROCHURE_OFFER =
  "Kalau Kakak berkenan, kami bisa kirimkan brosur kamarnya (lengkap dengan foto tiap tipe). Mau dikirimkan, Kak?";

const DIFF_RE =
  /\b(?:perbedaan(?:nya)?|bedanya|beda(?:nya)?|bedain|membedakan|perbandingan|bandingkan|bandingin|dibanding(?:kan)?|difference|compare)\b/i;
const WHICH_RE =
  /\b(?:mana\s+yang\s+(?:lebih\s+)?(?:luas|besar|lega|bagus|nyaman|cocok)|lebih\s+(?:luas|besar|lega)\s+(?:mana|yang\s+mana)|kamar\s+(?:mana|apa)\s+yang\s+cocok|yang\s+cocok\s+(?:kamar|tipe)\s+(?:apa|mana)|cocoknya\s+(?:kamar|tipe)\s+(?:apa|mana)|lebih\s+(?:luas|besar|lega)\b)/i;
const ROOM_WORD_RE =
  /\b(?:kamar(?:nya)?|room|tipe|type|single|deluxe|grand|family|suite|100|222)\b/i;
/** Perbedaan yang jelas bukan soal kamar. */
const NON_ROOM_DIFF_RE =
  /\b(?:harga(?:nya)?|tarif|price|rate|weekend|weekday|hari\s+biasa|ota|traveloka|tiket\.?com|booking\.com|agoda|bayar|transfer|dp|jam|check.?in|check.?out)\b/i;

/** Alias nama tamu → nama `room_types` (dicocokkan lewat key huruf saja). */
const ROOM_ALIASES: Array<{ re: RegExp; key: string }> = [
  { re: /\bfamily\s*suite(?:\s*100)?\b|\bsuite\s*100\b|\bsuite\b|\bfs\s*100\b|(?:^|\s)100\b/i, key: "familysuite100" },
  { re: /\bfamily\s*room(?:\s*222)?\b|\bfs\s*222\b|(?:^|\s)222\b/i, key: "familyroom222" },
  { re: /\bgrand\s*deluxe\b|\bgrand\b|\bgd\b/i, key: "granddeluxe" },
  { re: /\bdeluxe\b|\bdeluks\b|\bdelux\b/i, key: "deluxe" },
  { re: /\bsingle\b|\bsingel\b/i, key: "single" },
];

const key = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function isRoomComparisonQuestion(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 280) return false;
  const diff = DIFF_RE.test(raw);
  const which = WHICH_RE.test(raw);
  if (!diff && !which) return false;
  if (NON_ROOM_DIFF_RE.test(raw) && matchComparisonRoomsRaw(raw).length < 2) return false;
  // "bedanya apa kak?" tanpa kata kamar — tetap perbandingan kamar (log 31 Okt
  // 09:39 & 3 Sep), karena di Pomah satu-satunya hal yang dibandingkan tamu
  // adalah tipe kamar.
  if (diff && /^(?:kak[,\s]*)?(?:kalau\s+)?(?:bedanya|beda(?:nya)?|perbedaan(?:nya)?)\s*(?:apa|aap|apaan|apa\s+aja|apa\s+saja|dimana|di\s*mana(?:nya)?)?\s*(?:ya|yaa|yah)?\s*(?:kak|ka|kakak|min)?\s*\??$/i.test(raw))
    return true;
  return ROOM_WORD_RE.test(raw);
}

function matchComparisonRoomsRaw(text: string): string[] {
  let scan = ` ${text.toLowerCase()} `;
  const keys: string[] = [];
  for (const a of ROOM_ALIASES) {
    if (a.re.test(scan)) {
      keys.push(a.key);
      scan = scan.replace(new RegExp(a.re.source, "gi"), " ");
    }
  }
  return keys;
}

/** Tipe kamar yang disebut tamu, urut sesuai daftar; alias "family suite"/"222" dikenali. */
export function matchComparisonRooms<T extends ComparisonRoom>(text: string, rooms: T[]): T[] {
  const keys = matchComparisonRoomsRaw(text);
  const out: T[] = [];
  for (const k of keys) {
    const r = rooms.find((room) => key(room.name) === k) ??
      rooms.find((room) => key(room.name).startsWith(k) || k.startsWith(key(room.name)));
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function floorText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /lantai/i.test(s) ? s.replace(/^lantai/i, "lantai") : `lantai ${s}`;
}

/** Fakta pemilik: hanya Family Suite 100 punya dapur sendiri di unit. */
function kitchenText(name: unknown): string {
  return key(name) === "familysuite100" ? "dapur sendiri di dalam unit" : "dapur bersama";
}

function cleanAmenities(r: ComparisonRoom): string[] {
  const list = Array.isArray(r.amenities) ? r.amenities : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const s = String(a ?? "").trim();
    const k = key(s);
    if (!s || seen.has(k)) continue;
    // Dapur/kamar tidur/kamar mandi sudah disebut di baris struktur.
    if (/dapur|kitchen|k\.?\s*tidur|k\.?\s*mandi|kamar\s*(tidur|mandi)/i.test(s)) continue;
    seen.add(k);
    out.push(s.replace(/^wi-?fi$/i, "WiFi"));
  }
  return out;
}

export function describeRoomForComparison(r: ComparisonRoom): string {
  const parts: string[] = [];
  const size = num(r.size_sqm);
  if (size) parts.push(`${size} m²`);
  const fl = floorText(r.floor_info);
  if (fl) parts.push(fl);
  const bedrooms = num(r.bedrooms);
  const bathrooms = num(r.bathrooms);
  if (bedrooms && bedrooms > 1) parts.push(`${bedrooms} kamar tidur`);
  if (bathrooms && bathrooms > 1) parts.push(`${bathrooms} kamar mandi dalam`);
  else parts.push("kamar mandi dalam");
  const bedType = String(r.bed_type ?? "").trim();
  const bedSize = String(r.bed_size ?? "").trim().replace(/\s*cm\b.*$/i, " cm").replace(/\s+/g, " ");
  if (bedType || bedSize) {
    const typeLabel = bedType && !new RegExp(bedType, "i").test(bedSize) ? bedType : "";
    parts.push(`kasur ${[typeLabel, bedSize].filter(Boolean).join(" ")}`.trim());
  }
  const cap = num(r.max_occupancy) ?? num(r.capacity);
  const extra = num(r.extrabed_capacity);
  if (cap) parts.push(`maks. ${cap} orang${extra ? ` (+${extra} extra bed)` : ""}`);
  parts.push(kitchenText(r.name));
  const am = cleanAmenities(r);
  if (am.length) parts.push(am.join(", "));
  return `*${String(r.name)}*: ${parts.join(", ")}`;
}

function highlight(a: ComparisonRoom, b: ComparisonRoom): string | null {
  const notes: string[] = [];
  const sa = num(a.size_sqm);
  const sb = num(b.size_sqm);
  if (sa && sb && sa !== sb) {
    const [big, small] = sa > sb ? [a, b] : [b, a];
    notes.push(`*${String(big.name)}* lebih luas (${num(big.size_sqm)} m² vs ${num(small.size_sqm)} m²)`);
  }
  const fa = floorText(a.floor_info);
  const fb = floorText(b.floor_info);
  if (fa && fb && key(fa) !== key(fb)) notes.push(`${String(a.name)} di ${fa}, ${String(b.name)} di ${fb}`);
  const ka = kitchenText(a.name);
  const kb = kitchenText(b.name);
  if (ka !== kb) {
    const own = ka.startsWith("dapur sendiri") ? a : b;
    notes.push(`hanya *${String(own.name)}* yang punya dapur sendiri di dalam unit`);
  }
  if (!notes.length) return null;
  return `Perbedaan utamanya: ${notes.join("; ")}.`;
}

/**
 * Balasan perbandingan dari data kamar. `null` bila data kamar kosong — biar
 * jalur lain/AI yang menjawab (atau oper ke staf).
 */
export function buildRoomComparisonReply(
  text: string,
  rooms: ComparisonRoom[],
  opts?: { includeOffer?: boolean },
): string | null {
  const usable = (rooms ?? []).filter((r) => String(r.name ?? "").trim());
  if (!usable.length) return null;
  const mentioned = matchComparisonRooms(text, usable);
  const list = mentioned.length >= 2 ? mentioned : usable;
  const lines: string[] = [
    mentioned.length >= 2 ? "Berikut perbedaannya ya Kak:" : "Berikut perbedaan tipe kamar kami ya Kak:",
    "",
    ...list.map(describeRoomForComparison),
  ];
  if (mentioned.length >= 2) {
    const h = highlight(mentioned[0]!, mentioned[1]!);
    if (h) lines.push("", h);
  } else if (mentioned.length === 1) {
    lines.splice(1, 0, `(Kakak menyebut *${String(mentioned[0]!.name)}* — ini perbandingan dengan tipe lainnya.)`);
  }
  lines.push("", "Semua kamar dapat 2 handuk.");
  if (opts?.includeOffer !== false) lines.push("", ROOM_BROCHURE_OFFER);
  return lines.join("\n");
}

const AFFIRM_RE =
  /^(?:(?:iya|iy|ya|yaa|yup|yes|y|boleh|bole|mau|oke|ok|okay|okey|siap|sip|monggo|silakan|silahkan|kirim(?:in|kan)?|kirim\s+aja|kirim\s+saja|minta|tolong|please|gas|lanjut|bisa)\b[\s,!.]*){1,4}(?:(?:kak|ka|kakak|min|dong|ya|yaa|deh|aja|saja|kirim(?:kan|in)?|brosur(?:nya)?|nya|boleh|mau|terima\s*kasih|makasih|thanks|🙏|😊|👍)[\s,!.]*)*$/i;
const NEGATIVE_RE = /\b(?:tidak|gak|ga|nggak|ngga|enggak|engga|jangan|no|nanti\s+saja|nanti\s+aja|gausah|ga\s+usah|tidak\s+usah)\b/i;

/**
 * Tamu menerima tawaran brosur: pesan keluar terakhir berisi tawaran, dan
 * burst tamu sesudahnya hanya persetujuan singkat ("ya", "boleh kak", "mau").
 */
export function isBrochureOfferAcceptance(messages: Array<{ direction: string; body?: string }>): boolean {
  let i = messages.length - 1;
  const burst: string[] = [];
  while (i >= 0 && messages[i]?.direction === "in") {
    burst.unshift(messages[i]!.body ?? "");
    i--;
  }
  if (!burst.length || i < 0) return false;
  const lastOut = messages[i]!;
  if (!String(lastOut.body ?? "").toLowerCase().includes(ROOM_BROCHURE_OFFER_MARKER)) return false;
  const text = burst.join(" ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 60 || NEGATIVE_RE.test(text)) return false;
  return AFFIRM_RE.test(text);
}
