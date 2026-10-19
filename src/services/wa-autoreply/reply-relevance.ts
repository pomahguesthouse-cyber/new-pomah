/**
 * Jangan kirim info yang tidak ditanya / pertanyaan lama tamu.
 *
 * Insiden (laporan Sania):
 * - Azaaa 16 Okt 17:06 — balasan AI berisi pertanyaan tamu sendiri dari 13 Okt
 *   ("Kalau boleh tahu, ke UNNES berapa menit ya Kak? ...").
 * - Ika PG-GDWES 17 Okt 19:13 — tamu menagih jawaban soal dapur ("Ditunggu ya
 *   kk"), bot mengirim daftar harga + tanya tanggal menginap.
 */

type Msg = { direction: string; body: string; sent_at?: string };

/** Jeda percakapan yang dianggap sesi baru untuk riwayat LLM. */
export const HISTORY_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * Potong riwayat pada jeda panjang terakhir supaya LLM tidak menjawab ulang
 * topik hari-hari sebelumnya. Ringkasan chat & booking aktif tetap membawa fakta.
 */
export function trimHistoryAtGap<T extends Msg>(messages: T[], gapMs = HISTORY_GAP_MS): T[] {
  let cut = 0;
  for (let i = 1; i < messages.length; i++) {
    const a = Date.parse(messages[i - 1].sent_at ?? "");
    const b = Date.parse(messages[i].sent_at ?? "");
    if (Number.isFinite(a) && Number.isFinite(b) && b - a > gapMs) cut = i;
  }
  return cut > 0 ? messages.slice(cut) : messages;
}

const tokens = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

const STOP = new Set([
  "kak", "kakak", "yang", "dan", "untuk", "dari", "ini", "itu", "apa", "ada", "boleh", "kalau", "tau", "tahu",
  "berapa", "lalu", "juga", "saya", "kami", "mau", "nya", "dengan", "atau", "sudah", "bisa", "terdekat",
  "pomah", "guesthouse", "homestay", "penginapan", "hotel", "sini",
]);

function overlap(a: string[], b: Set<string>): number {
  if (a.length === 0) return 0;
  return a.filter((w) => b.has(w)).length / a.length;
}

/**
 * Hapus kalimat tanya di balasan bot yang menyalin pertanyaan tamu sendiri
 * dari riwayat (bot seolah bertanya balik pertanyaan tamu).
 */
export function stripEchoedGuestQuestions(reply: string, priorInbound: string[]): string {
  const guestQs = priorInbound.filter((m) => /\?/.test(m) || /\b(berapa|apa|dimana|di mana|kapan|bagaimana|gimana)\b/i.test(m));
  if (guestQs.length === 0) return reply;
  const guestTokenSets = guestQs.map((q) => new Set(tokens(q)));
  const paragraphs = reply.split(/\n{2,}/);
  const kept = paragraphs.map((para) => {
    const sentences = para.split(/(?<=[?])\s+/);
    const filtered = sentences.filter((s) => {
      if (!s.includes("?")) return true;
      // Hanya pertanyaan "wh" (berapa/apa/dimana…) — konfirmasi seperti
      // "untuk tanggal 20 ya Kak?" tidak disentuh.
      if (!/\b(berapa|apa|dimana|di mana|kapan|bagaimana|gimana|mana)\b/i.test(s)) return true;
      const t = tokens(s);
      if (t.length < 2) return true;
      return !guestTokenSets.some((set) => overlap(t, set) >= 0.7);
    });
    return filtered.join(" ").trim();
  });
  const out = kept.filter(Boolean).join("\n\n").trim();
  return out || reply;
}

const PRICE_LINE_RE = /^\s*(?:[•\-*]|\d+[.)])\s*[^:\n]{2,40}:\s*Rp\s?[\d.]+/i;
const PRICE_INTRO_RE = /\b(daftar harga|harga kamar|tarif kamar|price ?list|pricelist)\b/i;
const PRICE_INTENT_RE =
  /\b(harga|harganya|tarif|price|pricelist|rate|biaya|berapa|budget|murah|mahal|diskon|promo|kamar|room|tipe|type|kosong|tersedia|available|nginep|menginap|booking|pesan)\b/i;

/** Hapus daftar harga yang tidak diminta di burst pesan tamu. */
export function stripUnrequestedPriceList(reply: string, inboundBurst: string): string {
  if (PRICE_INTENT_RE.test(inboundBurst)) return reply;
  const lines = reply.split("\n");
  const priceIdx = lines.map((l, i) => (PRICE_LINE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (priceIdx.length < 3) return reply;
  const drop = new Set(priceIdx);
  // kalimat pengantar daftar harga tepat di atas blok
  for (let i = priceIdx[0] - 1; i >= 0 && i >= priceIdx[0] - 2; i--) {
    if (PRICE_INTRO_RE.test(lines[i])) drop.add(i);
    else if (lines[i].trim()) break;
  }
  const out = lines
    .filter((_, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || reply;
}
