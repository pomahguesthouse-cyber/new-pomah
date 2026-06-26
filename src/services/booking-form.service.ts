/**
 * Layanan form booking temporer.
 *
 * Alur: chatbot men-generate token via `createBookingFormToken`, kirim URL ke
 * tamu, tamu mengisi form, lalu POST endpoint memanggil `submitBookingForm`
 * yang menyimpan data + enqueue pesan sintetis `[FORM_SUBMITTED:<token>]`
 * untuk chatbot agar mengirim ringkasan booking secara otomatis.
 */

import { randomBytes } from "crypto";

export interface BookingFormPrefill {
  roomTypeId?: string | null;
  roomTypeName?: string | null;
  checkIn?: string | null; // YYYY-MM-DD
  checkOut?: string | null;
  guestCount?: number | null;
  rooms?: number | null;
}

export interface BookingFormSubmission {
  fullName: string;
  email: string | null;
  guestCount: number;
  rooms: number;
  extrabed: number;
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  notes: string | null;
}

export interface BookingFormRow {
  id: string;
  token: string;
  phone: string;
  thread_id: string | null;
  property_id: string | null;
  prefill_data: BookingFormPrefill;
  submitted_data: BookingFormSubmission | null;
  status: "pending" | "submitted" | "expired" | "cancelled";
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
}

const FORM_TOKEN_BYTES = 24; // 32 char base64url
const FORM_TTL_MINUTES = 30;

/**
 * Buat token form baru dengan data prefill dari hasil percakapan chatbot.
 * Mengembalikan token + URL form yang siap dikirim ke tamu.
 */
export async function createBookingFormToken(params: {
  supabaseAdmin: { from: (table: string) => any };
  phone: string;
  threadId?: string | null;
  propertyId?: string | null;
  prefill?: BookingFormPrefill;
  baseUrl: string; // mis. https://pomahguesthouse.com
}): Promise<{ token: string; url: string; expiresAt: string }> {
  const token = randomBytes(FORM_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + FORM_TTL_MINUTES * 60_000).toISOString();

  const { error } = await params.supabaseAdmin
    .from("booking_form_tokens")
    .insert({
      token,
      phone: params.phone,
      thread_id: params.threadId ?? null,
      property_id: params.propertyId ?? null,
      prefill_data: params.prefill ?? {},
      status: "pending",
      expires_at: expiresAt,
    });

  if (error) {
    throw new Error(`Gagal membuat token form: ${error.message}`);
  }

  const url = `${params.baseUrl.replace(/\/$/, "")}/booking/form/${token}`;
  return { token, url, expiresAt };
}

/**
 * Ambil baris form berdasarkan token. Return null jika tidak ditemukan,
 * expired, atau sudah submitted.
 */
export async function getBookingFormByToken(
  supabase: { from: (table: string) => any },
  token: string,
): Promise<BookingFormRow | null> {
  const { data, error } = await supabase
    .from("booking_form_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  return data as BookingFormRow;
}

/**
 * Validasi token: pending dan belum expired.
 */
export function isFormTokenUsable(row: BookingFormRow): boolean {
  if (row.status !== "pending") return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

/**
 * Simpan submission, tandai status submitted, lalu enqueue pesan sintetis
 * ke wa_conversation_queue agar chatbot mengirim ringkasan booking +
 * meminta konfirmasi "Ya/Lanjut" sesuai gating invoice yang sudah ada.
 */
export async function submitBookingForm(params: {
  supabaseAdmin: { from: (table: string) => any };
  token: string;
  submission: BookingFormSubmission;
}): Promise<{ ok: boolean; error?: string }> {
  const row = await getBookingFormByToken(params.supabaseAdmin, params.token);
  if (!row) return { ok: false, error: "Token tidak ditemukan" };
  if (!isFormTokenUsable(row)) {
    return { ok: false, error: row.status === "submitted" ? "Form sudah dikirim" : "Form sudah kedaluwarsa" };
  }

  const submittedAt = new Date().toISOString();
  const { error: updErr } = await params.supabaseAdmin
    .from("booking_form_tokens")
    .update({
      submitted_data: params.submission,
      status: "submitted",
      submitted_at: submittedAt,
    })
    .eq("id", row.id)
    .eq("status", "pending"); // atomic claim

  if (updErr) {
    return { ok: false, error: `Gagal menyimpan: ${updErr.message}` };
  }

  // Enqueue pesan sintetis untuk chatbot worker. Body diawali marker khusus
  // (`[FORM_SUBMITTED:<token>]`) yang dideteksi oleh executeAutoreplyForPhone
  // agar membangun ringkasan dari submitted_data tanpa memanggil AI.
  try {
    const body = `[FORM_SUBMITTED:${row.token}]`;
    const { saveInboundMessage } = await import("@/repositories/message.repository");
    const { messageId, error: saveErr } = await saveInboundMessage(
      params.supabaseAdmin as any,
      { phone: row.phone, name: params.submission.fullName, body },
    );
    if (saveErr || !messageId) {
      console.warn("[BookingForm] saveInboundMessage gagal:", saveErr?.message);
    } else {
      // Pastikan thread_id terisi — fallback lookup via phone bila token tidak
      // menyimpannya saat create.
      let threadId = row.thread_id;
      if (!threadId) {
        const { data: t } = await (params.supabaseAdmin as any)
          .from("whatsapp_threads")
          .select("id")
          .eq("phone", row.phone)
          .maybeSingle();
        threadId = (t?.id as string | undefined) ?? null;
      }
      if (threadId) {
        const { queueUpsert } = await import("@/services/queue.service");
        await queueUpsert(params.supabaseAdmin as any, {
          phone: row.phone,
          threadId,
          messageId,
          body,
          delayMs: 0,
          maxWaitMs: 5_000,
        });
      }
    }
  } catch (e) {
    // Tidak fatal — admin bisa retry manual. Tamu sudah lihat halaman done.
    console.warn("[BookingForm] enqueue synthetic message gagal:", e);
  }

  return { ok: true };
}
