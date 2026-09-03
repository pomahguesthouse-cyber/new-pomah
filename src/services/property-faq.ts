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
  /** Nama tamu lama terverifikasi dari tabel guests (bukan display name mentah). */
  guestName?: string;
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

/** Pertanyaan kamar mandi harus dijawab deterministik karena ini fakta bisnis tetap. */
const BATHROOM_TOPIC_RE =
  /\b(kamar\s*mandi|mandi(?:nya)?|toilet|wc|bathroom|bath\s*room|private\s*bathroom)\b/i;

/**
 * Pengunjung penjemput bukan tamu menginap. Jangan jadikan jumlah orang di
 * pesan seperti ini sebagai guest_count / adults / children booking.
 */
const VISITOR_PICKUP_TOPIC_RE =
  /\b(keluarga|teman|saudara|rombongan|orang tua|ortu).{0,80}\b(datang|dtg|jemput|menjemput|menunggu|nunggu|mampir|berkunjung)\b|\b(datang|dtg|jemput|menjemput|menunggu|nunggu|mampir|berkunjung).{0,80}\b(keluarga|teman|saudara|rombongan|orang tua|ortu)\b|\b(sebelum\s+check\s*[- ]?out|sebelum\s+checkout|make\s*up|makeup|menunggu\s+di\s+kamar)\b/i;

/**
 * Tamu berencana datang ke lokasi untuk survey/lihat kamar. Jangan dianggap
 * sekadar "terima kasih" atau penutup; balas dengan meminta estimasi jam.
 */
const VISIT_SURVEY_TOPIC_RE =
  /\b(?:nanti\s+)?(?:pagi|siang|sore|malam)?\s*(?:ini)?\s*(?:saya|kami|aku|kita)?\s*(?:akan|mau|ingin|rencana|kemungkinan)?\s*(?:ke|datang\s+ke|dtg\s+ke|menuju\s+ke)\s+(?:lokasi|penginapan|pomah|guesthouse|gh)\b|\b(?:survey|survei|lihat\s+kamar|cek\s+kamar|lihat\s+lokasi|cek\s+lokasi|mampir\s+ke\s+lokasi|datang\s+survey|datang\s+survei)\b/i;

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

// ─── Fakta bisnis tetap ──────────────────────────────────────────────────────
//
// Nilai-nilai di bawah HARUS sama dengan yang tertulis di prompt Front Office
// (`src/ai/agents/front-office.agent.ts`). Kalau salah satunya diubah tanpa
// yang lain, tamu bisa mendapat dua angka berbeda tergantung pesannya kebetulan
// kena fast-path atau tidak. `scripts/test-property-faq.ts` menjaga keduanya
// tetap sinkron dan akan gagal kalau angkanya berbeda.

/** Tarif early check-in / late check-out, per jam berjalan. */
export const EARLY_LATE_HOURLY_FEE_IDR = 25_000;

/** Tarif extra bed per malam — sama di semua channel booking. */
export const EXTRA_BED_RATE_IDR = 100_000;

/** Area properti, dipakai saat menjawab pertanyaan jarak. */
export const PROPERTY_AREA = "Sampangan, Semarang";

/**
 * Landmark yang jarak tempuhnya sudah diketahui pasti. Landmark DI LUAR daftar
 * ini sengaja tidak dijawab fast-path — mengarang angka jarak jauh lebih mahal
 * daripada satu panggilan AI.
 */
export const KNOWN_LANDMARKS: ReadonlyArray<{ re: RegExp; label: string; distance: string }> = [
  { re: /\bakpelni\b|\bpawiyatan\s+luhur\b/i, label: "AKPELNI", distance: "sekitar 5 menit berkendara — dekat sekali" },
  { re: /\bunnes\b|\bsekaran\b|\buniversitas\s+negeri\s+semarang\b/i, label: "UNNES Sekaran", distance: "sekitar 8 km, kurang lebih 10–15 menit berkendara" },
  { re: /\bsimpang\s*lima\b|\bpusat\s+kota\b/i, label: "Simpang Lima / pusat kota", distance: "sekitar 15–20 menit berkendara" },
  { re: /\buntag\b|\btujuh\s+belas\s+agustus\b|\bfakultas\s+hukum\b/i, label: "Fakultas Hukum UNTAG", distance: "sekitar 1,9 km, kurang lebih 5 menit berkendara" },
];

const idr = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/**
 * Pesan yang juga menanyakan ketersediaan/harga adalah pesan gabungan. Cabang
 * FAQ satu-topik hanya akan menjawab separuhnya lalu menelan sisanya — lebih
 * baik biarkan AI menjawab utuh. (Cabang OTA dikecualikan: "di Agoda lebih
 * murah?" memang pertanyaan harga, dan jawabannya sudah baku.)
 */
const AVAILABILITY_OR_PRICE_RE =
  /\b(tersedia|available|kosong|masih\s+ada|cek\s+(?:kamar|ketersediaan)|harga|tarif|rate|bookingkan|book\s*kan)\b/i;

const OTA_RE = /\b(traveloka|agoda|booking\.?com|tiket\.?com|trip\.?com|airbnb|ota)\b/i;
const EXTRA_BED_RE = /\b(extra\s*bed|ekstra\s*bed|kasur\s+tambahan|bed\s+tambahan)\b/i;
const BREAKFAST_RE = /\b(sarapan|breakfast|makan\s+pagi)(?:nya)?\b/i;
const DISTANCE_INTENT_RE = /\b(dekat|deket|jauh|jarak|berapa\s*(?:menit|km|kilo|jauh)|akses|menuju)\b/i;
const BOOKING_METHOD_RE =
  /\b(cara\s+(?:booking|pesan|order|reservasi)|gimana\s+(?:cara\s+)?(?:booking|pesan)|bagaimana\s+cara\s+(?:booking|pesan)|booking\s+(?:online|lewat\s+wa|via\s+wa|dari\s+sini|di\s*sini)|pesan\s+online|harus\s+(?:datang|ke\s+(?:tempat|lokasi))|datang\s+ke\s+tempat)\b/i;
const DAY_USE_RE =
  /\b(day\s*use|dayuse|transit|sewa\s+per\s*jam|per\s*jam(?:an)?|hitungan\s+jam|istirahat\s+(?:sebentar|siang)|sampai\s+siang\s+(?:saja|aja)|beberapa\s+jam\s+(?:saja|aja))\b/i;

/** Pertanyaan tentang MASUK LEBIH AWAL / KELUAR LEBIH SORE, bukan jam standar. */
const EARLY_CHECKIN_RE =
  /\b(early\s*check\s*[- ]?in|check\s*[- ]?in\s+(?:lebih\s+)?(?:awal|pagi|cepat)|masuk\s+(?:kamar\s+)?lebih\s+(?:awal|pagi)|datang\s+lebih\s+(?:awal|pagi))\b/i;
const LATE_CHECKOUT_RE =
  /\b(late\s*check\s*[- ]?out|check\s*[- ]?out\s+(?:lebih\s+)?(?:siang|sore|lambat|telat)|keluar\s+lebih\s+(?:siang|sore)|perpanjang\s+(?:jam|waktu))\b/i;

/**
 * Ambil jam dari pesan tamu. `direction` dipakai untuk membaca angka yang
 * ambigu: "check-out jam 5" hampir pasti 17.00, "check-in jam 9" hampir pasti
 * 09.00. Tanpa konteks itu tebakannya tidak aman, jadi arahnya wajib diberikan.
 */
export function parseRequestedHour(text: string, direction: "in" | "out"): number | null {
  const m = /\b(?:jam|pukul)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const suffix = (m[3] ?? "").toLowerCase();

  if (suffix === "pagi") {
    if (hour === 12) hour = 0;
  } else if (suffix === "siang" || suffix === "sore" || suffix === "malam") {
    if (hour < 12) hour += 12;
  } else if (hour <= 12) {
    // Tanpa keterangan waktu: pakai arah pertanyaan untuk membaca angkanya.
    if (direction === "out" && hour < 12) hour += 12;
  }
  return hour >= 0 && hour <= 23 ? hour : null;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildPropertyFaqReply(input: PropertyFaqInput): PropertyFaqReply | null {
  const raw = input.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 260) return null;
  if (COMPLAINT_SIGNAL_RE.test(raw)) return null;

  // Guard khusus: keluarga/teman yang datang menjemput atau menunggu sebentar
  // sebelum check-out adalah PENGUNJUNG, bukan penambahan tamu menginap.
  // Jangan rekomendasikan upgrade kamar hanya karena ada angka jumlah orang.
  if (VISITOR_PICKUP_TOPIC_RE.test(raw)) {
    return {
      reply:
        "Tidak apa-apa Kak, kalau keluarga hanya datang menjemput atau menunggu sebentar sebelum check-out, itu tidak dihitung sebagai tambahan tamu menginap.\n\n" +
        "Silakan saja, yang penting tetap menjaga kenyamanan dan tidak menginap di kamar ya Kak 🙏",
      intent: "visitor_pickup_policy",
    };
  }

  // Guard khusus: tamu mau datang ke lokasi/survey. Ini harus ditangani sebelum
  // thanks/penutup karena pesan sering berisi "terima kasih" di ujung kalimat.
  if (VISIT_SURVEY_TOPIC_RE.test(raw)) {
    return {
      reply: "Baik Kak, kami tunggu ya. Rencana jam berapa Kak?",
      intent: "visit_survey_plan",
    };
  }

  // Guard khusus: FAQ_BLOCK_RE memuat kata "kamar", jadi pertanyaan kamar mandi
  // harus ditangani sebelum early block. Ini mencegah LLM/SOP lama menjawab
  // keliru seperti kamar mandi terpisah untuk Single.
  if (BATHROOM_TOPIC_RE.test(raw)) {
    const mentionedRooms = findMentionedRooms(raw, input.rooms ?? []);
    const hasSingle = /\bsingle\b/i.test(raw) || mentionedRooms.some((r) => /single/i.test(String(r.name ?? "")));
    return {
      reply: hasSingle
        ? "Betul Kak, kamar Single juga sudah memiliki kamar mandi di dalam kamar. Semua tipe kamar Pomah Guesthouse menggunakan kamar mandi dalam."
        : "Betul Kak, semua kamar di Pomah Guesthouse sudah memiliki kamar mandi di dalam kamar.",
      intent: "faq_private_bathroom",
    };
  }

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
  const verifiedFirstName = (() => {
    // CATATAN: backslash di sini HARUS tunggal. Versi sebelumnya menulis
    // `/^\\d+$/`, `/\\s+/`, dan `/[^\\p{L}'-]/gu` — di dalam literal regex,
    // `\\d` berarti "backslash lalu huruf d", bukan digit. Akibatnya nomor HP
    // lolos filter, nama tidak pernah terpecah per kata, dan filter karakter
    // membuang SELURUH huruf sehingga `verifiedFirstName` selalu kosong —
    // sapaan personal untuk tamu lama tidak pernah muncul.
    const value = String(input.guestName ?? "").trim();
    if (!value || /^\d+$/.test(value)) return "";
    const first = value.split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
    return first.length >= 2 ? first : "";
  })();
  const rooms = input.rooms ?? [];

  const core = raw.replace(LEAD_INTERJECTION_RE, "");

  // — Greeting murni —
  if (GREET_RE.test(core) || GREET_RE.test(raw)) {
    return {
      reply:
        `Halo Kak${verifiedFirstName ? ` ${verifiedFirstName}` : ""}, terima kasih sudah menghubungi ${propertyName} 🙏\n` +
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

  // — Early check-in / late check-out — tarifnya kebijakan tetap, jadi jawab
  //   langsung lengkap dengan hitungannya. Prompt Front Office menyuruh hal
  //   yang sama; menjawabnya di sini menghemat satu giliran AI penuh DAN
  //   menghilangkan peluang model mengarang angka.
  if (!DATE_SIGNAL_RE.test(raw)) {
    const wantsEarly = EARLY_CHECKIN_RE.test(raw);
    const wantsLate = LATE_CHECKOUT_RE.test(raw);
    if (wantsEarly !== wantsLate) {
      const direction = wantsEarly ? "in" : "out";
      const standard = Number((wantsEarly ? checkInTime : checkOutTime).slice(0, 2));
      const hour = parseRequestedHour(raw, direction);
      const hours =
        hour === null || !Number.isFinite(standard)
          ? null
          : wantsEarly
            ? standard - hour
            : hour - standard;

      const head = wantsEarly
        ? `${opener}Untuk early check-in (masuk sebelum pukul ${checkInTime})`
        : `${opener}Untuk late check-out (keluar setelah pukul ${checkOutTime})`;
      const rate = `dikenakan biaya tambahan ${idr(EARLY_LATE_HOURLY_FEE_IDR)} per jam berjalan`;
      const calc =
        hours !== null && hours > 0
          ? `.\nKalau dari pukul ${String(hour).padStart(2, "0")}.00, jadinya ${idr(EARLY_LATE_HOURLY_FEE_IDR)} × ${hours} jam = ${idr(EARLY_LATE_HOURLY_FEE_IDR * hours)}`
          : "";
      return {
        reply:
          `${head} ${rate}${calc}, Kak.\n` +
          `Ketersediaannya menyesuaikan kondisi kamar hari itu ya 🙏`,
        intent: "early_late_checkin_policy",
      };
    }
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
        `Early check-in / late check-out dikenakan ${idr(EARLY_LATE_HOURLY_FEE_IDR)} per jam berjalan, ` +
        `menyesuaikan ketersediaan kamar ya Kak 🙏`,
      intent: "policy_question",
    };
  }

  // — Sarapan — kebijakan tetap, jawab jujur dan langsung.
  if (BREAKFAST_RE.test(raw) && !AVAILABILITY_OR_PRICE_RE.test(raw)) {
    return {
      reply:
        `${opener}Mohon maaf Kak, saat ini kami belum menyediakan sarapan. ` +
        `Tapi lokasi kami dekat dengan banyak pilihan kuliner enak, jadi gampang cari makan pagi 🙏`,
      intent: "faq_breakfast",
    };
  }

  // — Jarak ke landmark yang jaraknya sudah pasti —
  // Landmark di luar daftar sengaja dilewatkan ke AI: mengarang angka jarak
  // jauh lebih mahal daripada satu panggilan LLM.
  const landmark = KNOWN_LANDMARKS.find((l) => l.re.test(raw));
  if (landmark && DISTANCE_INTENT_RE.test(raw) && !AVAILABILITY_OR_PRICE_RE.test(raw)) {
    const lines = [`${opener}Dari ${landmark.label}, ${propertyName} ${landmark.distance}, Kak.`];
    if (address) lines.push(`Alamat kami: 📍 ${address}`);
    return { reply: lines.join("\n"), intent: "faq_distance" };
  }

  // — Pertanyaan OTA (rate parity & extra bed) —
  if (OTA_RE.test(raw)) {
    if (EXTRA_BED_RE.test(raw)) {
      return {
        reply:
          `${opener}Extra bed tetap tersedia apapun channel bookingnya, Kak — properti dan tarif extra bed ` +
          `(${idr(EXTRA_BED_RATE_IDR)}/malam) sama saja.\n` +
          `Kalau booking lewat OTA, konfirmasikan kebutuhan extra bed ke kami setelah reservasi selesai ya, nanti kami siapkan.`,
        intent: "faq_ota_extra_bed",
      };
    }
    return {
      reply:
        `${opener}Kami memang terdaftar di beberapa OTA, tapi harga booking langsung via WhatsApp ini biasanya ` +
        `sama atau lebih hemat karena tidak ada biaya layanan OTA, Kak.\n` +
        `Kami juga bisa lebih fleksibel soal jam check-in/out kalau memang tersedia. Mau saya bantu cek tanggalnya?`,
      intent: "faq_ota",
    };
  }

  // — Cara / metode booking — (bukan permintaan booking itu sendiri) —
  if (
    BOOKING_METHOD_RE.test(raw) &&
    !DATE_SIGNAL_RE.test(raw) &&
    !AVAILABILITY_OR_PRICE_RE.test(raw) &&
    findMentionedRooms(raw, rooms).length === 0
  ) {
    return {
      reply:
        `${opener}Booking bisa langsung via WhatsApp ini Kak, tidak perlu datang ke tempat. ` +
        `Setelah data lengkap dan DP masuk, kamar langsung kami amankan dan invoice otomatis dikirim ke sini juga.\n\n` +
        `Mau saya bantu cek tanggalnya sekarang, Kak?`,
      intent: "faq_booking_method",
    };
  }

  // — Istirahat singkat / day-use — tawarkan solusinya, bukan penolakan.
  if (DAY_USE_RE.test(raw) && !AVAILABILITY_OR_PRICE_RE.test(raw)) {
    return {
      reply:
        `${opener}Bisa Kak — Kakak check-in sekarang dan check-out standar besok pukul ${checkOutTime}, ` +
        `jadi tetap bisa istirahat sampai siang.\n` +
        `Untuk saat ini kami memang melayani menginap minimal 1 malam ya Kak, belum ada sewa per jam 🙏`,
      intent: "faq_day_use",
    };
  }

  // — WiFi — (satu-baris → batas panjang O5)
  if (raw.length <= ONE_LINER_MAX_LEN && /\b(wifi|wi-fi|internet)(?:nya)?\b/i.test(raw)) {
    return { reply: "Iya Kak, tersedia WiFi untuk tamu.", intent: "faq_wifi" };
  }

  // — Parkir — (satu-baris → batas panjang O5)
  if (raw.length <= ONE_LINER_MAX_LEN && /\b(parkir(?:an)?|parking|mobil|motor)(?:nya)?\b/i.test(raw)) {
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
