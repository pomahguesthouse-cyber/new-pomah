/**
 * Tempat terdekat dari Pomah Guesthouse (Jl. Dewi Sartika IV No. 71).
 *
 * Sumber: OpenStreetMap (Overpass, radius 2 km dari titik OSM gedung Pomah
 * -7.02082, 110.38807) + rute OSRM (berkendara & jalan kaki), diambil 30 Okt 2026.
 * Waktu berkendara OSRM tanpa macet, jadi dibulatkan ke atas. Hanya tempat
 * dengan keyakinan cukup yang masuk; kategori lain (laundry, kuliner, mall)
 * sengaja TIDAK dijawab otomatis → bot bilang "kami cek terlebih dahulu".
 * Kalau ada data yang salah, perbaiki di sini — prompt & fast-path ikut.
 */
export type NearbyPlace = { name: string; distance: string; time: string };
export type NearbyCategory = {
  key: string;
  label: string;
  /** Kata yang memicu kategori ini. */
  re: RegExp;
  /** true = kata itu sendiri sudah jelas tempat di luar (Indomaret, ATM). */
  standalone: boolean;
  places: NearbyPlace[];
};

export const NEARBY_PLACES_SOURCE = "OpenStreetMap + OSRM, dicek 30 Okt 2026";

export const NEARBY_CATEGORIES: ReadonlyArray<NearbyCategory> = [
  {
    key: "minimarket",
    label: "minimarket",
    re: /\b(indomaret|alfamart|alfa\s*mart|minimarket|mini\s*market|swalayan|toko\s+kelontong)\b/i,
    standalone: true,
    places: [
      // Sumber: Faizal (pemilik), 31 Okt 2026 — belum tercatat di OSM (<600 m).
      { name: "Indomaret terdekat", distance: "sekitar 250 m", time: "kurang lebih 3 menit jalan kaki" },
      { name: "Alfamart Sampangan", distance: "sekitar 1,5 km", time: "kurang lebih 5 menit berkendara" },
      { name: "Indomaret Sampangan", distance: "sekitar 1,5 km", time: "kurang lebih 5 menit berkendara" },
    ],
  },
  {
    key: "brt",
    label: "halte BRT Trans Semarang (transportasi umum)",
    re: /\b(halte(?:\s+(?:bus|brt))?|brt|trans\s*semarang|bus\s+raya\s+terpadu|bus|transportasi\s+umum|kendaraan\s+umum|angkutan\s+umum)\b/i,
    standalone: true,
    // Sumber: Faizal (pemilik), 31 Okt 2026. Nomor koridor sengaja tidak disebut.
    places: [{ name: "Halte BRT Sampangan Timur", distance: "sekitar 100 m", time: "kurang lebih 1–2 menit jalan kaki" }],
  },
  {
    key: "pasar",
    label: "pasar",
    re: /\bpasar\b/i,
    standalone: true,
    places: [{ name: "Pasar Sampangan Baru", distance: "sekitar 1 km", time: "kurang lebih 3 menit berkendara atau 13 menit jalan kaki" }],
  },
  {
    key: "atm",
    label: "ATM / bank",
    re: /\b(atm|bank|bni|bri|mandiri|bca|tarik\s+tunai)\b/i,
    standalone: true,
    places: [
      // Sumber: Faizal (pemilik), 31 Okt 2026 — lokasi terpisah dari Indomaret.
      { name: "ATM BCA", distance: "sekitar 400 m", time: "kurang lebih 5 menit jalan kaki" },
      { name: "ATM Bank Mandiri", distance: "sekitar 400 m", time: "kurang lebih 5 menit jalan kaki" },
      { name: "ATM BNI (dekat SPBU Sampangan)", distance: "sekitar 1 km", time: "kurang lebih 3 menit berkendara" },
      { name: "Bank BRI Sampangan", distance: "sekitar 1,2 km", time: "kurang lebih 3–5 menit berkendara" },
    ],
  },
  {
    key: "spbu",
    label: "SPBU",
    re: /\b(spbu|pom\s*bensin|pombensin|isi\s+bensin|pertamina)\b/i,
    standalone: true,
    places: [{ name: "SPBU 44.502.15 Sampangan", distance: "sekitar 1 km", time: "kurang lebih 3 menit berkendara" }],
  },
  {
    key: "apotek",
    label: "apotek",
    re: /\b(apotek|apotik|farmasi|beli\s+obat)\b/i,
    standalone: true,
    places: [{ name: "Apotek Viva Generik", distance: "sekitar 1,5 km", time: "kurang lebih 5 menit berkendara" }],
  },
  {
    key: "kesehatan",
    label: "klinik / rumah sakit",
    re: /\b(klinik|rumah\s*sakit|rs|puskesmas|dokter|ugd|igd)\b/i,
    standalone: false,
    places: [
      { name: "Klinik Pratama & Klinik Aulia Fawwaz", distance: "sekitar 600 m", time: "kurang lebih 8 menit jalan kaki" },
      { name: "Rumah Sakit Permata Sari", distance: "sekitar 2,5 km", time: "kurang lebih 7–10 menit berkendara" },
    ],
  },
  {
    key: "masjid",
    label: "masjid",
    re: /\b(masjid|mesjid|musholl?a|musala|surau|sholat|shalat|jumatan)\b/i,
    standalone: true,
    places: [{ name: "Masjid Jami' Nurul Ilmi", distance: "sekitar 500 m", time: "kurang lebih 7 menit jalan kaki" }],
  },
  {
    key: "gereja",
    label: "gereja",
    re: /\b(gereja|kebaktian|misa)\b/i,
    standalone: true,
    places: [{ name: "Gereja Kristen Jawa (GKJ) Sampangan", distance: "sekitar 650 m", time: "kurang lebih 8 menit jalan kaki" }],
  },
];

const NEARBY_SIGNAL_RE = /\b(dekat|deket|terdekat|sekitar|seputar|deket2|dekat2|jauh|jarak|di\s*mana|dimana|dmn|ada\s+(?:gak|ga|nggak|tidak|enggak))\b/i;

const GENERIC_FOLLOW = new Set([
  "terdekat", "dekat", "deket", "ga", "gak", "nggak", "enggak", "tidak", "kak", "ka", "kakak", "ya", "yg", "yang",
  "sekitar", "atau", "dan", "dong", "nya", "ada", "dimana", "mana", "dmn", "sini", "situ", "buat", "untuk", "jauh",
  "berapa", "gitu", "dari", "gimana", "bagaimana", "apa", "juga", "deh", "min", "mas", "mbak", "pak", "bu", "di",
]);

export function findNearbyCategory(raw: string): NearbyCategory | null {
  const t = raw.toLowerCase();
  const cat = NEARBY_CATEGORIES.find((c) => c.re.test(t));
  if (!cat) return null;
  if (!cat.standalone && !NEARBY_SIGNAL_RE.test(t)) return null;
  // Terminal/stasiun/bandara punya jawaban landmark sendiri.
  if (cat.key === "brt" && /\b(terminal|stasiun|bandara|airport|ahmad\s*yani|poncol|tawang)\b/i.test(t)) return null;
  // "pasar johar", "atm di simpang lima" = tempat bernama/di lokasi lain → AI.
  const m = cat.re.exec(t);
  const next = m ? t.slice(m.index + m[0].length).match(/^[\s,]*([a-z0-9]+)/)?.[1] : undefined;
  if (next && !GENERIC_FOLLOW.has(next)) return null;
  if (next === "di" || next === "dekat" || next === "deket") {
    const after = t.slice(m!.index + m![0].length).match(/^[\s,]*[a-z]+\s+([a-z0-9]+)/)?.[1];
    if (after && !["sini", "situ", "sekitar", "penginapan", "pomah", "guesthouse", "homestay", "lokasi", "daerah", "situ?"].includes(after)) return null;
  }
  return cat;
}

export function formatNearbyReply(cat: NearbyCategory): string {
  const items = cat.places.map((p) => `• ${p.name} — ${p.distance}, ${p.time}`);
  return `Ada Kak, ${cat.label} terdekat dari Pomah Guesthouse:\n${items.join("\n")}\nJarak dan waktu tempuh perkiraan ya, Kak 🙏`;
}

/** Ringkasan untuk prompt Front Office (satu-satunya daftar yang boleh dipakai). */
export function nearbyPlacesPromptText(): string {
  return NEARBY_CATEGORIES.map(
    (c) => `${c.label}: ${c.places.map((p) => `${p.name} (${p.distance}, ${p.time})`).join("; ")}`,
  ).join(" | ");
}
