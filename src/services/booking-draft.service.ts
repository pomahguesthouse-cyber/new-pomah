/**
 * Draft booking — catatan sementara di Supabase SEBELUM write final.
 *
 * Alur: bot menyimpan data yang sudah dikonfirmasi tamu ke `booking_drafts`
 * (status 'draft'), baru memanggil create_booking. Sukses → 'completed' + kode
 * booking. Gagal → 'failed' + alasan; baris dibiarkan agar staf bisa
 * melanjutkan manual. Semua fungsi best-effort dan TIDAK PERNAH throw: bila
 * tabel belum dimigrasi atau DB putus, booking tetap diproses seperti biasa.
 *
 * Migrasi: supabase/migrations/20261002150000_booking_drafts.sql
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BookingDraftInput {
  /** Kunci stabil per isi pesanan (sama untuk percobaan ulang). */
  draftKey: string;
  phone: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  roomType?: string;
  quotedTotal?: number;
  payload: Record<string, unknown>;
}

export async function saveBookingDraft(db: any, input: BookingDraftInput): Promise<boolean> {
  try {
    const { error } = await db.from("booking_drafts").upsert(
      {
        idempotency_key: input.draftKey,
        phone: input.phone,
        guest_name: input.guestName ?? null,
        check_in: input.checkIn ?? null,
        check_out: input.checkOut ?? null,
        room_type: input.roomType ?? null,
        quoted_total: input.quotedTotal ?? null,
        payload: input.payload,
        status: "draft",
        booking_code: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "idempotency_key" },
    );
    if (error) {
      console.warn("[BookingDraft] simpan draft gagal (non-fatal):", error.message ?? error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[BookingDraft] simpan draft error (non-fatal):", e);
    return false;
  }
}

export async function markBookingDraft(
  db: any,
  draftKey: string,
  outcome: { status: "completed"; bookingCode: string } | { status: "failed"; error: string },
): Promise<boolean> {
  try {
    const patch =
      outcome.status === "completed"
        ? { status: "completed", booking_code: outcome.bookingCode, last_error: null }
        : { status: "failed", last_error: outcome.error.slice(0, 500) };
    const { error } = await db
      .from("booking_drafts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("idempotency_key", draftKey);
    if (error) {
      console.warn("[BookingDraft] tandai draft gagal (non-fatal):", error.message ?? error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[BookingDraft] tandai draft error (non-fatal):", e);
    return false;
  }
}
