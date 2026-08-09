/**
 * Keputusan follow-up untuk form booking sekali pakai.
 *
 * Masalah yang ditutup: `generate_booking_form` mengirim tautan ber-TTL 30
 * menit lalu memindahkan state ke AWAITING_FORM_SUBMISSION. Bila tamu tidak
 * submit DAN tidak mengirim pesan lagi, tidak ada jalur yang berjalan — token
 * mati diam-diam, state menggantung, percakapan berhenti tanpa kesimpulan.
 * Fallback yang sudah ada di `booking-machine` bersifat reaktif: hanya jalan
 * kalau tamu kebetulan mengirim pesan lagi.
 *
 * Modul ini sengaja MURNI (tanpa IO) supaya seluruh invarian anti balasan
 * bertentangan bisa diuji tanpa database — lihat
 * `scripts/test-booking-form-followup.ts`. Sisi IO-nya ada di
 * `routes/api.cron.booking-form-followup.ts`.
 */

/** Umur token sebelum nudge dikirim. TTL token 30 menit → nudge di menit 10. */
export const NUDGE_AFTER_MS = 10 * 60_000;

/**
 * Sisa waktu minimum saat nudge dikirim. Tanpa ambang ini, token yang
 * tersangkut (mis. cron sempat mati 25 menit) akan menerima nudge "masih aktif
 * 2 menit lagi" yang langsung disusul pesan kedaluwarsa — dua pesan beruntun
 * yang saling bertentangan. Bila sisa waktu di bawah ambang, lewati nudge dan
 * biarkan fase EXPIRE yang bicara.
 */
export const NUDGE_MIN_REMAINING_MS = 5 * 60_000;

export interface FollowupTokenRow {
  id: string;
  token: string;
  phone: string;
  thread_id: string | null;
  expires_at: string;
  created_at: string;
  reminder_sent_at: string | null;
}

export interface FollowupStateRow {
  state: string;
  /** Token yang sedang ditunggu bot, dari `wa_booking_states.context.formToken`. */
  formToken?: string;
}

export interface FollowupInput {
  tokens: FollowupTokenRow[];
  /** State booking per nomor. Absen = tidak ada state aktif. */
  stateByPhone: Map<string, FollowupStateRow>;
  /** Nomor yang sedang di-handoff ke manusia atau diproses worker antrian. */
  blockedPhones: Set<string>;
  nowMs: number;
}

export interface FollowupExpiry {
  row: FollowupTokenRow;
  /** Kembalikan state ke COLLECTING_DATA (bot memang masih menunggu token ini). */
  resetState: boolean;
  /** Kirim pesan "lanjut di chat" ke tamu. */
  notify: boolean;
}

export interface FollowupPlan {
  nudge: FollowupTokenRow[];
  expire: FollowupExpiry[];
}

/**
 * Follow-up hanya sah bila bot memang masih menunggu token INI. Kalau state
 * sudah pindah (tamu lanjut via chat, form sudah submit) atau tamu sempat
 * men-generate form baru, token lama tidak boleh lagi memicu pesan apa pun —
 * inilah yang mencegah balasan bertentangan dengan giliran bot terakhir.
 */
function awaitingThisToken(input: FollowupInput, row: FollowupTokenRow): boolean {
  const st = input.stateByPhone.get(row.phone);
  return st?.state === "AWAITING_FORM_SUBMISSION" && st.formToken === row.token;
}

/**
 * Tentukan token mana yang perlu di-nudge dan mana yang perlu ditutup.
 *
 * Input HANYA berisi token berstatus `pending`; pemanggil bertanggung jawab
 * memfilternya. Klaim atomik (agar satu token = maksimum satu nudge dan satu
 * pesan kedaluwarsa) dilakukan di sisi IO lewat conditional update.
 */
export function planBookingFormFollowup(input: FollowupInput): FollowupPlan {
  const plan: FollowupPlan = { nudge: [], expire: [] };

  for (const row of input.tokens) {
    const expiresMs = new Date(row.expires_at).getTime();
    const isExpired = Number.isFinite(expiresMs) ? expiresMs <= input.nowMs : true;

    if (isExpired) {
      // Token mati SELALU ditutup — tanpa syarat blocked/state — supaya tidak
      // terus terambil di eksekusi berikutnya. Yang bersyarat hanyalah reset
      // state dan pengiriman pesannya.
      const resetState = awaitingThisToken(input, row);
      plan.expire.push({
        row,
        resetState,
        notify: resetState && !input.blockedPhones.has(row.phone),
      });
      continue;
    }

    if (row.reminder_sent_at !== null) continue;
    if (input.nowMs - new Date(row.created_at).getTime() < NUDGE_AFTER_MS) continue;
    if (expiresMs - input.nowMs < NUDGE_MIN_REMAINING_MS) continue;
    if (input.blockedPhones.has(row.phone)) continue;
    if (!awaitingThisToken(input, row)) continue;

    plan.nudge.push(row);
  }

  return plan;
}

/**
 * Pengingat di menit ke-10. Nadanya hangat dan TIDAK menyalahkan tamu, serta
 * selalu menawarkan jalur chat — banyak tamu berhenti justru karena enggan
 * meninggalkan WhatsApp.
 */
export function buildNudgeMessage(row: FollowupTokenRow, baseUrl: string, nowMs: number): string {
  const remainingMin = Math.max(1, Math.round((new Date(row.expires_at).getTime() - nowMs) / 60_000));
  const url = `${baseUrl.replace(/\/+$/, "")}/booking/form/${row.token}`;
  return (
    "Halo Kak, formulir pemesanannya belum masuk nih 🙏 " +
    "Apakah ada kendala saat membuka linknya? Kalau lebih nyaman, " +
    "saya bisa bantu isikan datanya langsung di chat ini — balas pesan ini saja.\n\n" +
    `Kalau mau lanjut lewat formulir, linknya masih aktif sekitar ${remainingMin} menit lagi:\n${url}`
  );
}

/**
 * Kalimat fallback kedaluwarsa. WAJIB sama persis dengan cabang `tokenExpired`
 * di `ai/state-machine/booking-machine.ts` — dua jalur berbeda (proaktif lewat
 * cron ini, reaktif lewat pesan tamu) tidak boleh menghasilkan dua kalimat
 * berbeda untuk situasi yang sama.
 */
export const FORM_EXPIRY_MESSAGE =
  "Mohon maaf Kak, link formulir booking tadi sudah kedaluwarsa (berlaku 30 menit). " +
  "Tidak apa-apa — saya bantu lanjutkan pengisian langsung di chat ini ya. " +
  "Data yang sudah ada (kamar & tanggal) masih tersimpan. " +
  "Mohon ketikkan nama lengkap Kakak untuk melanjutkan:";
