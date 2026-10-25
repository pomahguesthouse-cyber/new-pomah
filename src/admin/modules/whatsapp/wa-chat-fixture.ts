/**
 * Pratinjau chat admin di localhost (DEV saja). Dipakai supaya layout inbox
 * bisa difoto tanpa sesi staf. Build produksi mengunci DEV ke false.
 */
export const WA_FIXTURE_THREAD_ID = "11111111-1111-4111-8111-111111111111";

export function isWaChatFixtureRequest(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get("waFixture") === "1") return true;
  return window.location.hash.includes("waFixture=1");
}

const now = Date.now();

function at(minutesAgo: number) {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

const MESSAGES = [
  ["in", "Halo, saya mau tanya kamar untuk akhir pekan ini.", 80],
  ["out", "Halo Sari, dengan senang hati. Untuk tanggal berapa dan berapa tamu?", 78],
  ["in", "Sabtu sampai Senin, 2 dewasa. Ada yang dekat taman?", 74],
  ["out", "Deluxe menghadap taman masih ada. Sarapan sudah termasuk.", 70],
  ["in", "Harganya berapa per malam?", 66],
  ["out", "IDR 750.000 per malam, sudah termasuk sarapan untuk dua orang.", 62],
  ["in", "Bisa late check-out sampai jam 2 siang?", 58],
  ["out", "Bisa, late check-out sampai pukul 14.00 tanpa biaya tambahan.", 54],
  ["in", "Ada parkir untuk satu mobil?", 50],
  ["out", "Ada. Parkir di area tamu, satu mobil per kamar.", 46],
  ["in", "Kalau anak 8 tahun, dihitung tamu juga?", 42],
  ["out", "Anak di bawah 10 tahun menginap di kasur yang ada, tanpa extra bed.", 38],
  ["in", "Baik, saya mau kamar Deluxe itu. Bisa dipegang dulu?", 34],
  ["out", "Bisa. Saya siapkan tautan pembayaran setelah nama tamu dikonfirmasi.", 30],
  ["in", "Nama saya Sari Wulandari. Tolong kabari kalau sudah siap.", 26],
  ["out", "Siap, Sari. Kamar Deluxe Sabtu–Senin saya tandai. Saya kirim tautannya sebentar lagi.", 4],
] as const;

const messages = MESSAGES.map(([direction, body, minutesAgo], index) => ({
  id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
  thread_id: WA_FIXTURE_THREAD_ID,
  direction,
  body,
  sent_at: at(minutesAgo),
  metadata: null,
}));

const thread = {
  id: WA_FIXTURE_THREAD_ID,
  phone: "6281234567890",
  display_name: "Sari Wulandari",
  last_message_preview: messages[messages.length - 1]?.body ?? "",
  last_message_at: messages[messages.length - 1]?.sent_at ?? at(1),
  unread_count: 0,
  pinned: false,
  status: "open",
  intent: "booking_inquiry",
  ai_auto: true,
  guest_id: null,
};

export function waChatFixtureThreads() {
  return {
    threads: [{ ...thread, awaiting_reply: false }],
    hasMore: false,
    unreadTotal: 0,
    counts: { all: 1, read: 1, unread: 0 },
  };
}

export function waChatFixtureThread() {
  return {
    thread,
    messages,
    guest: null,
    booking: null,
    hasMore: false,
    lastInboundAt: messages.filter((m) => m.direction === "in").at(-1)?.sent_at ?? at(26),
  };
}
