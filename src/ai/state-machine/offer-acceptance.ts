/**
 * Tamu menyetujui tawaran booking terakhir dari bot ("Mau kami bantu proses
 * pemesanannya?") → langsung mulai booking dari tawaran itu.
 *
 * Insiden Azzra Raditya (30 Okt–1 Nov 2026): bot menawarkan Family Room 222
 * 10–15 Nov, tamu menjawab "oke… bayar lunas besok Sabtu" lalu "saya ingin
 * bayar hari ini", tapi booking tidak pernah dibuat. Slot lama di
 * wa_booking_states (Single, 31 Okt–7 Nov) juga tidak boleh dipakai:
 * kamar + tanggal SELALU diambil dari teks tawaran terakhir.
 *
 * Harga tidak diambil dari teks tawaran; start_booking memakai tarif
 * kamar dan ringkasan/create_booking menghitung ulang dari kalender harga.
 */
type RoomTypeRow = { name: string };
import { parseAvailabilityDateRange } from "@/services/wa-autoreply/message-parsers";

const OFFER_RE =
  /\b(bantu\s+proses|kami\s+proses|saya\s+proses|proses(?:kan)?\s+(?:pemesanan|booking|pesanan)|langsung\s+(?:pesan|booking)|mau\s+(?:kami|saya)\s+(?:bantu\s+)?(?:bookingkan|pesankan))\b/i;

/** Bot bertanya apakah booking mau diproses (bukan sekadar info). */
export function isBookingOffer(botText: string): boolean {
  return OFFER_RE.test(botText) && /\?/.test(botText);
}

const NEGATION_RE =
  /\b(tidak|tdk|gak|ga|nggak|ngga|enggak|engga|belum|blm|batal|nanti\s+dulu|ntar\s+dulu|diskusi|dipikir|pikir[\s-]*pikir|tanya\s+dulu|cek\s+dulu|ganti|ubah|tapi)\b/i;

const SHORT_YES_RE =
  /^(?:iya|iyaa+|ya|yaa+|yap|yup|oke|okee*|ok|okay|baik|boleh|bisa|siap|sip|jadi|mau|lanjut|setuju|gas|deal)(?:[\s,!.]+(?:kak|ka|kk|min|mbak|mas|ya|deh|dong|aja|saja|boleh|jadi|lanjut|proses|silakan|silahkan|kak\s*ya))*[\s!.🙏👍]*$/iu;

const EXPLICIT_RE =
  /\b(?:(?:mau|ingin|pengen|pengin|bisa|tolong|silakan|silahkan)\s+(?:di\s*)?(?:proses|pesan|booking|book|ambil|bayar)|jadi\s+(?:ambil|pesan|booking|book)|(?:saya|kami|kita)\s+(?:ambil|pesan|booking|pilih)|ambil\s+(?:yg|yang)\s+\w+|bayar\s+(?:hari\s+ini|sekarang|lunas|dp|besok|nanti\s+(?:sabtu|minggu)|sabtu|minggu)|bayar\s+di\s+tempat|transfer\s+(?:hari\s+ini|sekarang|besok)|dibantu\s+(?:untuk\s+)?pembayaran)\b/i;

/** Pesan tamu menyetujui tawaran booking / menyatakan mau bayar. */
export function isOfferAcceptance(guestText: string): boolean {
  const t = guestText.trim();
  if (!t || t.length > 400) return false;
  if (/\?\s*$/.test(t) && !EXPLICIT_RE.test(t)) return false; // pertanyaan → biar AI menjawab
  if (NEGATION_RE.test(t) && !EXPLICIT_RE.test(t)) return false;
  if (/\b(tidak|gak|nggak|belum|batal)\s+(?:jadi|mau|bisa)\b/i.test(t)) return false;
  if (SHORT_YES_RE.test(t)) return true;
  if (EXPLICIT_RE.test(t)) return true;
  // "oke kak bagaimana kalo kita bayar lunas besok sabtu …"
  return /^(?:iya|ya|oke|ok|baik|siap|boleh|jadi)\b/i.test(t) && /\bbayar\b/i.test(t);
}

export interface AcceptedOffer {
  roomName: string;
  quantity: number;
  checkIn: string;
  checkOut: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

/** Ambil kamar (nama persis dari room_types) + tanggal dari teks tawaran bot. */
export function extractOfferDetails(
  botText: string,
  rooms: Pick<RoomTypeRow, "name">[],
  today: string,
): AcceptedOffer | null {
  const text = norm(botText);
  const hits = rooms
    .map((r) => ({ r, i: text.indexOf(norm(r.name)) }))
    .filter((h) => h.i >= 0)
    // Nama terpanjang dulu: "Grand Deluxe" mengalahkan "Deluxe".
    .sort((a, b) => b.r.name.length - a.r.name.length);
  const chosen = hits.filter(
    (h) => !hits.some((o) => o !== h && o.r.name.length > h.r.name.length && norm(o.r.name).includes(norm(h.r.name))),
  );
  const uniq = [...new Set(chosen.map((h) => h.r.name))];
  if (uniq.length !== 1) return null; // ambigu / tidak ada → biar AI yang tanya
  const dates = parseAvailabilityDateRange(botText, today);
  if (!dates || dates.checkIn < today || dates.checkOut <= dates.checkIn) return null;
  const qty = Number(botText.match(/\b(\d+)\s+kamar\b/i)?.[1] ?? 1);
  return { roomName: uniq[0], quantity: qty >= 1 && qty <= 5 ? qty : 1, checkIn: dates.checkIn, checkOut: dates.checkOut };
}

/**
 * Tawaran terakhir yang disetujui: pesan bot TERAKHIR sebelum pesan tamu
 * harus berupa tawaran booking, dan pesan tamu harus persetujuan. Kalau bot
 * tidak menyebut kamar + tanggal di tawaran itu, cari mundur di pesan bot
 * sebelumnya (maks. 4) yang membahas penawaran yang sama.
 */
export function findAcceptedOffer(
  messages: Array<{ direction: string; body?: string | null }>,
  rooms: Pick<RoomTypeRow, "name">[],
  today: string,
): AcceptedOffer | null {
  let i = messages.length - 1;
  const guestParts: string[] = [];
  while (i >= 0 && messages[i].direction === "in") guestParts.unshift(messages[i--].body ?? "");
  const guest = guestParts.join(" ").trim();
  if (!guest || !isOfferAcceptance(guest)) return null;
  const outs: string[] = [];
  while (i >= 0 && messages[i].direction === "out" && outs.length < 4) outs.push(messages[i--].body ?? "");
  // Tawaran terakhir boleh diikuti beberapa balasan bot, tapi minimal satu harus tawaran.
  const offerIdx = outs.findIndex((t) => isBookingOffer(t));
  if (offerIdx >= 0) {
    for (const t of outs.slice(offerIdx)) {
      const d = extractOfferDetails(t, rooms, today);
      if (d) return d;
    }
    return null;
  }
  // "saya ingin bayar hari ini" beberapa hari setelah tawaran (diselingi
  // obrolan lain): hanya untuk niat bayar/pesan yang EKSPLISIT, pakai tawaran
  // booking terbaru di riwayat.
  if (!EXPLICIT_RE.test(guest)) return null;
  for (let j = i; j >= 0; j--) {
    const m = messages[j];
    if (m.direction !== "out" || !isBookingOffer(m.body ?? "")) continue;
    return extractOfferDetails(m.body ?? "", rooms, today);
  }
  return null;
}
