/**
 * Tamu MEMILIH kombinasi kamar dengan kata-katanya sendiri saat tanggal &
 * jumlah tamu sudah diketahui di slot (kasus Sofiah 8 Nov 2026: "iyaa kak,
 * yang 1 family room + 1 kamar deluxe boleh kak", slot 11–12 Des, 7 orang).
 * Sebelumnya tidak ada jalur deterministik: pesan jatuh ke LLM, LLM gagal /
 * ditimpa guard kapasitas, dan bot menanyakan tanggal lagi.
 *
 * Modul ini MURNI (tanpa I/O). Ia hanya menentukan:
 *   - kamar yang dipilih (nama persis dari room_types; ambigu → null),
 *   - tanggal & jumlah tamu dari slot (hanya bila masih di masa depan),
 *   - apakah checkout masih asumsi (→ tanya checkout saja dulu).
 * Pembuatan booking tetap lewat start_booking_details → ringkasan →
 * persetujuan eksplisit → create_booking (tidak ada create di sini).
 */
type RoomRow = { name: string };

export type RoomSelectionItem = { roomName: string; quantity: number };

export type RoomSelectionDecision =
  | { kind: "start"; rooms: RoomSelectionItem[]; checkIn: string; checkOut: string; adults: number; children: number }
  | { kind: "ask_checkout"; rooms: RoomSelectionItem[]; checkIn: string; checkOut: string | null; adults: number; children: number };

const NEG_RE =
  /\b(tidak|tdk|gak|ga|nggak|ngga|enggak|belum|blm|batal|nanti\s+dulu|pikir|diskusi|tanya\s+dulu|bukan)\b/i;
const CHOOSE_RE = /\b(boleh|ambil|pilih|mau|jadi|oke|ok|iya+|ya|deal|fix|yang\s+ini|itu\s+aja|aja|saja|setuju|lanjut)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();

/** Kamar yang disebut di teks bot terbaru (untuk memecah alias ambigu seperti "family"). */
function mentionedInBot(botTexts: string[], name: string): boolean {
  const n = norm(name);
  return botTexts.some((t) => norm(t).includes(n));
}

/**
 * Baca pilihan kamar dari pesan tamu. Mendukung "1 family room + 1 kamar
 * deluxe", "family room dan deluxe", "2 deluxe". Nama tamu harus cocok ke
 * SATU tipe kamar; bila cocok ke beberapa (mis. "family" → Family Room 222 &
 * Family Suite 100), dipecah memakai tipe yang disebut bot terakhir; tetap
 * ambigu → null (biarkan agent bertanya).
 */
export function parseGuestRoomSelection(
  message: string,
  rooms: RoomRow[],
  recentBotTexts: string[] = [],
): RoomSelectionItem[] | null {
  const text = ` ${norm(message)} `;
  if (/\?\s*$/.test(message.trim())) return null;
  if (NEG_RE.test(message) || !CHOOSE_RE.test(message)) return null;
  const parts = text.split(/\s(?:\+|dan|sama|plus|&)\s|,/).map((p) => p.trim()).filter(Boolean);
  const picks = new Map<string, number>();
  for (const part of parts) {
    const cleaned = part
      .replace(/\b(boleh|kak|ka|kk|min|ya|aja|saja|deh|dong|yang|yg|iya+|oke|ok|mau|ambil|pilih|jadi|saya|kami|untuk|nya|ini|itu|setuju|lanjut|deal|fix)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const m = cleaned.match(/^(?:(\d{1,2})\s*(?:x\s*)?)?(?:kamar\s+|unit\s+|tipe\s+)?([a-z][a-z0-9 ]*)$/);
    if (!m) continue;
    const phrase = m[2]!.trim();
    if (!phrase) continue;
    // Kandidat: tipe yang namanya diawali/mengandung frasa tamu, atau frasa mengandung nama.
    let cands = rooms.filter((r) => {
      const n = norm(r.name);
      return n === phrase || n.startsWith(`${phrase} `) || phrase.endsWith(n) || n.includes(phrase);
    });
    // "deluxe" tidak boleh menangkap "grand deluxe" bila ada tipe "deluxe" persis.
    const exact = cands.filter((r) => norm(r.name) === phrase || phrase.endsWith(norm(r.name)));
    if (exact.length > 0) cands = exact.sort((a, b) => b.name.length - a.name.length).slice(0, 1);
    if (cands.length > 1) {
      const fromBot = cands.filter((r) => mentionedInBot(recentBotTexts, r.name));
      if (fromBot.length !== 1) return null;
      cands = fromBot;
    }
    if (cands.length !== 1) continue;
    const qty = m[1] ? Number(m[1]) : 1;
    if (qty < 1 || qty > 5) return null;
    picks.set(cands[0]!.name, (picks.get(cands[0]!.name) ?? 0) + qty);
  }
  if (picks.size === 0) return null;
  const items = [...picks.entries()].map(([roomName, quantity]) => ({ roomName, quantity }));
  // Hanya kombinasi (≥2 unit) — satu kamar tunggal sudah ditangani jalur tawaran/LLM.
  if (items.reduce((s, i) => s + i.quantity, 0) < 2) return null;
  return items;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Gabungkan pilihan kamar dengan slot yang sudah diketahui. */
export function decideRoomSelection(params: {
  message: string;
  rooms: RoomRow[];
  slots: Record<string, unknown>;
  today: string;
  recentBotTexts?: string[];
}): RoomSelectionDecision | null {
  const items = parseGuestRoomSelection(params.message, params.rooms, params.recentBotTexts);
  if (!items) return null;
  const s = params.slots ?? {};
  const checkIn = typeof s.checkIn === "string" && ISO.test(s.checkIn) && s.checkIn >= params.today ? s.checkIn : null;
  if (!checkIn) return null; // tanggal belum diketahui / stale → biar agent yang tanya
  const checkOut = typeof s.checkOut === "string" && ISO.test(s.checkOut) && s.checkOut > checkIn ? s.checkOut : null;
  const adults = Number(s.adults ?? s.partialAdults ?? s.guestCount ?? 0) || 0;
  const children = Number(s.children ?? s.partialChildren ?? 0) || 0;
  if (adults <= 0) return null;
  if (!checkOut || s.checkoutAssumed === true) {
    return { kind: "ask_checkout", rooms: items, checkIn, checkOut, adults, children };
  }
  return { kind: "start", rooms: items, checkIn, checkOut, adults, children };
}

/** Pertanyaan HANYA checkout (check-in sudah diketahui). */
export function formatCheckoutOnlyQuestion(
  rooms: RoomSelectionItem[],
  checkInLabel: string,
  checkOutLabel: string | null,
): string {
  const label = rooms.map((r) => `${r.quantity} ${r.roomName}`).join(" + ");
  return checkOutLabel
    ? `Baik Kak, ${label} untuk check-in ${checkInLabel}. Check-out-nya tanggal ${checkOutLabel} (1 malam) ya, Kak? Kalau berbeda, sebutkan tanggal check-out-nya.`
    : `Baik Kak, ${label} untuk check-in ${checkInLabel}. Check-out-nya tanggal berapa, Kak?`;
}

/**
 * Pilihan yang sedang menunggu jawaban checkout (disimpan di slots
 * `pendingRoomSelection`). Kembali "start" hanya bila checkout sekarang
 * sudah dikonfirmasi; jawaban pendek "iya/betul" mengonfirmasi checkout
 * yang diusulkan. Penolakan/koreksi kamar → null (pending dibuang caller).
 */
export function resumePendingSelection(params: {
  pending: unknown;
  message: string;
  slots: Record<string, unknown>;
  today: string;
}): RoomSelectionDecision | null {
  const p = params.pending as { rooms?: RoomSelectionItem[]; checkIn?: string; checkOut?: string | null } | null;
  if (!p || !Array.isArray(p.rooms) || p.rooms.length === 0) return null;
  const s = params.slots ?? {};
  const checkIn = typeof s.checkIn === "string" && s.checkIn >= params.today ? s.checkIn : null;
  if (!checkIn || checkIn !== p.checkIn) return null; // tanggal berubah → jangan pakai pilihan lama
  const adults = Number(s.adults ?? s.partialAdults ?? s.guestCount ?? 0) || 0;
  const children = Number(s.children ?? s.partialChildren ?? 0) || 0;
  if (adults <= 0) return null;
  const msg = params.message.trim();
  if (NEG_RE.test(msg)) return null;
  const checkOut = typeof s.checkOut === "string" && s.checkOut > checkIn ? s.checkOut : null;
  if (checkOut && s.checkoutAssumed !== true) {
    return { kind: "start", rooms: p.rooms, checkIn, checkOut, adults, children };
  }
  const shortYes = /^(?:iya+|ya+|betul|benar|bener|oke|ok|sip|siap|boleh|setuju)(?:[\s,!.]+(?:kak|ka|kk|min|betul|benar|ya|1\s*malam))*[\s!.🙏👍]*$/iu;
  if (checkOut && p.checkOut === checkOut && shortYes.test(msg)) {
    return { kind: "start", rooms: p.rooms, checkIn, checkOut, adults, children };
  }
  return null;
}
