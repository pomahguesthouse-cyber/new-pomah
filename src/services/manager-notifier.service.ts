/**
 * Manager Notifier Service.
 *
 * Bertugas mengirim notifikasi WhatsApp ke manager/super admin untuk
 * tiga jenis event operasional:
 *   1. Booking baru     → semua manager aktif
 *   2. Bukti transfer   → super admin saja
 *   3. Komplain tamu    → semua manager aktif
 *
 * Semua pengiriman dicatat ke `notification_logs` (status, attempts, error)
 * dengan `dedupe_key` unik untuk mencegah pengiriman ganda.
 *
 * Pemicu di hot-path memanggil fungsi-fungsi ini secara fire-and-forget
 * agar tidak memblokir alur utama (booking creation, webhook reply).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDateID } from "@/lib/date";
import { sendWhatsAppMessage } from "./whatsapp.service";

type Db = SupabaseClient<any, any, any>;

interface ManagerContact {
  id: string;
  name: string;
  phone: string;
  role: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getFonnteToken(db: Db): Promise<string | null> {
  const { data } = await db
    .from("properties")
    .select("fonnte_token")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.fonnte_token as string | null) ?? null;
}

async function getActiveManagers(db: Db, role?: string): Promise<ManagerContact[]> {
  let query = db
    .from("property_managers")
    .select("id, name, phone, role")
    .eq("is_active", true);
  if (role) query = query.eq("role", role);
  const { data, error } = await query;
  if (error) {
    console.error("[ManagerNotifier] Gagal memuat manager:", error.message);
    return [];
  }
  return (data ?? []) as ManagerContact[];
}

interface SendOptions {
  eventType: "new_booking" | "payment_proof" | "complaint";
  recipient: ManagerContact;
  message: string;
  fileUrl?: string;
  dedupeKey: string;
  relatedId?: string | null;
}

/**
 * Kirim pesan WhatsApp ke satu manager dengan retry sampai 3 kali
 * (backoff 1s/2s/4s). Idempotensi via `dedupe_key` unik pada
 * `notification_logs`.
 */
async function sendWithRetry(db: Db, fonnteToken: string, opts: SendOptions): Promise<void> {
  // Cegah duplikat: jika dedupe_key sudah ada dengan status sent, skip.
  const { data: existing } = await db
    .from("notification_logs")
    .select("id, status")
    .eq("dedupe_key", opts.dedupeKey)
    .maybeSingle();

  if (existing && (existing as any).status === "sent") {
    console.info(`[ManagerNotifier] Skip — sudah terkirim: ${opts.dedupeKey}`);
    return;
  }

  // Insert/upsert log row sebagai pending.
  let logId: string | null = (existing as any)?.id ?? null;
  if (!logId) {
    const { data: inserted, error: insErr } = await db
      .from("notification_logs")
      .insert({
        event_type: opts.eventType,
        recipient_phone: opts.recipient.phone,
        recipient_role: opts.recipient.role,
        message: opts.message,
        attachment_url: opts.fileUrl ?? null,
        status: "pending",
        attempts: 0,
        dedupe_key: opts.dedupeKey,
        related_id: opts.relatedId ?? null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      // Race condition pada unique key → ambil baris yang sudah ada.
      const { data: again } = await db
        .from("notification_logs")
        .select("id")
        .eq("dedupe_key", opts.dedupeKey)
        .maybeSingle();
      logId = (again as any)?.id ?? null;
      if (!logId) {
        console.error("[ManagerNotifier] Gagal insert log:", insErr?.message);
        return;
      }
    } else {
      logId = inserted.id as string;
    }
  }

  const delays = [0, 1000, 2000, 4000];
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (delays[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt - 1]));
    }
    const result = await sendWhatsAppMessage(
      fonnteToken,
      opts.recipient.phone,
      opts.message,
      opts.fileUrl,
    );

    if (result.ok) {
      await db
        .from("notification_logs")
        .update({
          status: "sent",
          attempts: attempt,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", logId);
      console.info(`[ManagerNotifier] Terkirim ke ${opts.recipient.phone} (attempt ${attempt})`);
      return;
    }
    lastError = result.error ?? "unknown error";
    console.warn(
      `[ManagerNotifier] Gagal kirim ke ${opts.recipient.phone} (attempt ${attempt}): ${lastError}`,
    );
  }

  await db
    .from("notification_logs")
    .update({ status: "failed", attempts: 3, error: lastError })
    .eq("id", logId);
}

function formatRupiah(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "Rp 0";
  return "Rp " + num.toLocaleString("id-ID");
}

function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "direct":
      return "Direct booking";
    case "ota":
      return "OTA import";
    case "manual":
      return "Admin booking";
    default:
      return source || "Direct booking";
  }
}

/* ------------------------------------------------------------------ */
/* 1. New Booking                                                     */
/* ------------------------------------------------------------------ */

export async function notifyNewBooking(db: Db, bookingId: string): Promise<void> {
  try {
    const { data: booking, error } = await db
      .from("bookings")
      .select(
        "id, reference_code, check_in, check_out, nights, total_amount, source, guest_id, guests(full_name), booking_rooms(room_type_id, room_types(name))",
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (error || !booking) {
      console.error("[ManagerNotifier] Booking tidak ditemukan:", bookingId, error?.message);
      return;
    }

    const b = booking as any;
    const guestName = b.guests?.full_name ?? "Tamu";
    const roomName =
      b.booking_rooms?.[0]?.room_types?.name ?? "Kamar belum ditentukan";
    const message =
      "🏨 NEW BOOKING ALERT\n\n" +
      `Guest: ${guestName}\n` +
      `Room: ${roomName}\n` +
      `Check-in: ${fmtDateID(b.check_in)}\n` +
      `Check-out: ${fmtDateID(b.check_out)}\n` +
      `Nights: ${b.nights ?? "-"}\n` +
      `Total: ${formatRupiah(b.total_amount)}\n` +
      `Source: ${sourceLabel(b.source)}\n\n` +
      `Booking Code:\n${b.reference_code ?? b.id}\n\n` +
      "Please review in Manager Dashboard.";

    const token = await getFonnteToken(db);
    if (!token) {
      console.warn("[ManagerNotifier] Fonnte token tidak terkonfigurasi");
      return;
    }

    const managers = await getActiveManagers(db);
    if (managers.length === 0) {
      console.info("[ManagerNotifier] Belum ada manager aktif");
      return;
    }

    await Promise.all(
      managers.map((m) =>
        sendWithRetry(db, token, {
          eventType: "new_booking",
          recipient: m,
          message,
          dedupeKey: `new_booking:${b.id}:${m.id}`,
          relatedId: b.id,
        }),
      ),
    );
  } catch (e) {
    console.error("[ManagerNotifier] notifyNewBooking error:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Payment Proof                                                   */
/* ------------------------------------------------------------------ */

export interface PaymentProofInput {
  threadId: string | null;
  phone: string;
  guestName: string | null;
  imageUrl: string;
  messageId: string;
}

export async function notifyPaymentProof(
  db: Db,
  input: PaymentProofInput,
): Promise<void> {
  try {
    // Cari booking aktif terbaru untuk phone tsb (best effort).
    let bookingCode: string | null = null;
    let bookingId: string | null = null;
    if (input.phone) {
      const { data: guest } = await db
        .from("guests")
        .select("id")
        .eq("phone", input.phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (guest?.id) {
        const { data: bk } = await db
          .from("bookings")
          .select("id, reference_code")
          .eq("guest_id", (guest as any).id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (bk) {
          bookingCode = (bk as any).reference_code ?? null;
          bookingId = (bk as any).id ?? null;
        }
      }
    }

    const message =
      "💳 PAYMENT PROOF RECEIVED\n\n" +
      `Guest: ${input.guestName ?? input.phone}\n` +
      `Booking Code: ${bookingCode ?? "-"}\n\n` +
      "A payment proof has been uploaded and requires verification.\n\n" +
      `Attached:\n${input.imageUrl}`;

    const token = await getFonnteToken(db);
    if (!token) return;

    const superAdmins = await getActiveManagers(db, "super_admin");
    if (superAdmins.length === 0) {
      console.info("[ManagerNotifier] Tidak ada super admin aktif untuk payment proof");
      return;
    }

    await Promise.all(
      superAdmins.map((m) =>
        sendWithRetry(db, token, {
          eventType: "payment_proof",
          recipient: m,
          message,
          fileUrl: input.imageUrl,
          dedupeKey: `payment_proof:${input.messageId}:${m.id}`,
          relatedId: bookingId,
        }),
      ),
    );
  } catch (e) {
    console.error("[ManagerNotifier] notifyPaymentProof error:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Complaint                                                       */
/* ------------------------------------------------------------------ */

export async function notifyComplaint(db: Db, complaintId: string): Promise<void> {
  try {
    const { data: comp, error } = await db
      .from("guest_complaints")
      .select("id, guest_name, phone, category, message, created_at")
      .eq("id", complaintId)
      .maybeSingle();

    if (error || !comp) {
      console.error("[ManagerNotifier] Complaint tidak ditemukan:", complaintId);
      return;
    }

    const c = comp as any;
    const message =
      "🚨 GUEST COMPLAINT DETECTED\n\n" +
      `Guest:\n${c.guest_name ?? "Tamu"}\n\n` +
      `Phone:\n${c.phone}\n\n` +
      `Category:\n${c.category}\n\n` +
      `Message:\n"${c.message}"\n\n` +
      `Time:\n${new Date(c.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n` +
      "Please follow up immediately.";

    const token = await getFonnteToken(db);
    if (!token) return;

    const managers = await getActiveManagers(db);
    if (managers.length === 0) return;

    await Promise.all(
      managers.map((m) =>
        sendWithRetry(db, token, {
          eventType: "complaint",
          recipient: m,
          message,
          dedupeKey: `complaint:${c.id}:${m.id}`,
          relatedId: c.id,
        }),
      ),
    );
  } catch (e) {
    console.error("[ManagerNotifier] notifyComplaint error:", e);
  }
}
