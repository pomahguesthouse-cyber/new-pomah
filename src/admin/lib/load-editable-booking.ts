import { supabase } from "@/integrations/supabase/client";
import type { EditableBooking } from "@/admin/components/edit-booking-dialog";

// Same columns as the Bookings page, so the full edit dialog gets every field.
const FULL_SELECT =
  "id, reference_code, check_in, check_out, created_at, status, source, total_amount, adults, children, payment_status, paid_amount, internal_notes, special_requests, guests(id, full_name, email, phone, country), booking_rooms(id, room_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(id, name), rooms(id, number))";
const BASE_SELECT =
  "id, check_in, check_out, created_at, status, source, total_amount, adults, children, special_requests, guests(id, full_name, email, phone), booking_rooms(id, room_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(id, name), rooms(id, number))";

/** Read-only fetch of one booking in the shape EditBookingDialog expects. */
export async function loadEditableBooking(id: string): Promise<EditableBooking> {
  const full = await supabase.from("bookings").select(FULL_SELECT).eq("id", id).maybeSingle();
  let row: unknown = full.data;
  if (full.error) {
    if ((full.error as { code?: string }).code !== "42703") throw new Error(full.error.message);
    const base = await supabase.from("bookings").select(BASE_SELECT).eq("id", id).maybeSingle();
    if (base.error) throw new Error(base.error.message);
    row = base.data;
  }
  if (!row) throw new Error("Booking tidak ditemukan");
  return row as EditableBooking;
}
