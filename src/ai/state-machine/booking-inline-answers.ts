/**
 * Jawaban deterministik inline untuk pertanyaan tamu di tengah alur booking.
 *
 * Latar (analisa 3 Juli 2026): tamu bertanya "dp dulu apa gimana?" saat bot
 * sedang mengumpulkan data booking, dan bot MENUNDA jawabannya ("akan kami
 * informasikan setelah nama lengkap ada"). Kebijakan DP itu statis — jawab
 * langsung, jangan digantungkan pada slot lain. Modul ini juga memperbaiki
 * jawaban fasilitas yang generik ("Fasilitas tergantung tipe kamar...")
 * padahal tamu menanyakan PERBEDAAN dua tipe kamar tertentu.
 *
 * Pure function — tanpa I/O, tanpa database call — agar mudah di-unit-test.
 */

// ─── Pembayaran / DP ──────────────────────────────────────────────────────────

export interface PaymentAnswerOpts {
  /** Total harga booking bila sudah diketahui (untuk menghitung nominal DP). */
  totalPrice?: number;
  /** Persentase DP default properti (0-1). Default 0.5 — selaras dengan
   *  fallback `dpAmount` di CONFIRMING_BOOKING (booking-machine.ts). */
  dpRatio?: number;
  /** Sertakan info rekening (untuk pertanyaan "minta norek"). */
  includeBank?: boolean;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
}

const fmtRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

/**
 * Jawaban kebijakan pembayaran yang bisa langsung dikirim tanpa menunggu
 * data booking lengkap.
 */
export function buildPaymentPolicyAnswer(opts: PaymentAnswerOpts = {}): string {
  const ratio = opts.dpRatio ?? 0.5;
  const pct = Math.round(ratio * 100);
  const parts: string[] = [];

  if (opts.totalPrice && opts.totalPrice > 0) {
    const dp = Math.round(opts.totalPrice * ratio);
    parts.push(
      `Untuk pembayaran, Kakak bisa DP dulu ${pct}% (${fmtRp(dp)} dari total ${fmtRp(opts.totalPrice)}) ` +
        `dan sisanya dilunasi saat check-in, atau langsung bayar lunas — dua-duanya bisa.`,
    );
  } else {
    parts.push(
      `Untuk pembayaran, Kakak bisa DP dulu ${pct}% dari total dan sisanya dilunasi saat check-in, ` +
        `atau langsung bayar lunas — dua-duanya bisa.`,
    );
  }

  if (opts.includeBank) {
    const bank = (opts.bankName ?? "").trim();
    const acc = (opts.accountNumber ?? "").trim();
    const holder = (opts.accountHolder ?? "").trim();
    if (bank && acc) {
      parts.push(`Transfer ke ${bank} ${acc}${holder ? ` a.n. ${holder}` : ""}.`);
    }
  }

  return parts.join(" ");
}

// ─── Fasilitas per tipe kamar ─────────────────────────────────────────────────

export interface FacilityRoom {
  name?: unknown;
  amenities?: unknown;
}

const PRIVATE_BATHROOM_AMENITY = "Kamar mandi dalam";

const MISLEADING_BATHROOM_RE =
  /\b(kamar\s+mandi\s+(?:terpisah|luar|bersama)|toilet\s+(?:luar|bersama)|wc\s+(?:luar|bersama)|shared\s+bathroom|bathroom\s+outside|bukan\s+di\s+dalam)\b/i;

const BATHROOM_AMENITY_RE =
  /\b(kamar\s+mandi|toilet|wc|bathroom|bath\s*room)\b/i;

/** Normalisasi untuk dedup: "WI-FI", "WIfi", "wifi" → "wifi". */
function amenityKey(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupeAmenities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const pushUnique = (value: string) => {
    const s = value.trim();
    if (!s) return;
    const key = amenityKey(s);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const v of raw) {
    const s = String(v).trim();
    if (!s || MISLEADING_BATHROOM_RE.test(s)) continue;
    pushUnique(BATHROOM_AMENITY_RE.test(s) ? PRIVATE_BATHROOM_AMENITY : s);
  }

  // Fakta bisnis Pomah Guesthouse: semua tipe kamar punya kamar mandi di dalam.
  // Guard ini sengaja ada di formatter agar jawaban fasilitas tetap benar
  // meskipun data amenities di database/seed belum lengkap.
  pushUnique(PRIVATE_BATHROOM_AMENITY);
  return out;
}

/**
 * Deteksi tipe kamar yang disebut dalam pesan. Nama terpanjang dicek dulu dan
 * span yang cocok dihapus dari teks, supaya "grand deluxe" tidak tertangkap
 * dobel sebagai "Grand Deluxe" + "Deluxe".
 */
export function findMentionedRooms<T extends FacilityRoom>(text: string, rooms: T[]): T[] {
  const lower = text.toLowerCase();
  const sorted = [...rooms].sort(
    (a, b) => String(b.name ?? "").length - String(a.name ?? "").length,
  );
  let scan = lower;
  const mentioned: T[] = [];
  for (const r of sorted) {
    const nm = String(r.name ?? "").toLowerCase().trim();
    if (nm.length >= 3 && scan.includes(nm)) {
      mentioned.push(r);
      scan = scan.split(nm).join(" ");
    }
  }
  return mentioned;
}

/**
 * Jawaban pertanyaan fasilitas.
 * - ≥2 kamar disebut → perbandingan per kamar + sorot perbedaannya.
 * - 1 kamar disebut → daftar fasilitas kamar itu.
 * - Tidak ada kamar disebut → ringkasan umum (amenities gabungan, dedup).
 * Mengembalikan null bila tidak ada data fasilitas sama sekali.
 */
export function buildFacilityReply(text: string, rooms: FacilityRoom[]): string | null {
  const mentioned = findMentionedRooms(text, rooms);

  if (mentioned.length >= 2) {
    const lines: string[] = ["Perbandingan fasilitasnya ya Kak:", ""];
    let anyData = false;
    for (const r of mentioned) {
      const items = dedupeAmenities(r.amenities);
      if (items.length > 0) anyData = true;
      lines.push(`*${String(r.name)}*: ${items.length ? items.join(", ") : "(data fasilitas belum tersedia)"}`);
    }
    if (!anyData) return null;

    // Sorot perbedaan dua kamar pertama yang disebut.
    const [a, b] = mentioned;
    const aItems = dedupeAmenities(a.amenities);
    const bItems = dedupeAmenities(b.amenities);
    const aKeys = new Set(aItems.map(amenityKey));
    const bKeys = new Set(bItems.map(amenityKey));
    const onlyA = aItems.filter((v) => !bKeys.has(amenityKey(v)));
    const onlyB = bItems.filter((v) => !aKeys.has(amenityKey(v)));
    const diffs: string[] = [];
    if (onlyB.length) diffs.push(`*${String(b.name)}* punya ${onlyB.join(", ")}`);
    if (onlyA.length) diffs.push(`*${String(a.name)}* punya ${onlyA.join(", ")}`);
    lines.push("");
    lines.push(
      diffs.length
        ? `Perbedaan utamanya: ${diffs.join(", sedangkan ")}.`
        : "Fasilitas keduanya sama; perbedaannya di ukuran/harga kamar.",
    );
    return lines.join("\n");
  }

  if (mentioned.length === 1) {
    const r = mentioned[0]!;
    const items = dedupeAmenities(r.amenities);
    if (items.length === 0) return null;
    return `Fasilitas kamar *${String(r.name)}*: ${items.join(", ")}.`;
  }

  // Generik: gabungan semua kamar, dedup case-insensitive.
  const all = dedupeAmenities(rooms.flatMap((r) => (Array.isArray(r.amenities) ? r.amenities : [])));
  if (all.length === 0) return null;
  return (
    `Fasilitas tergantung tipe kamar yang dipilih Kak. Beberapa di antaranya: ${all.slice(0, 8).join(", ")}. ` +
    `Sebutkan tipe kamarnya kalau mau saya rincikan ya.`
  );
}
