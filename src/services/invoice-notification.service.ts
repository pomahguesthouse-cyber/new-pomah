import { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { fmtDateID } from "@/lib/date";

export interface InvoiceResult {
  ok: boolean;
  error: string | null;
  /** Public confirmation-page URL where the guest can view/download the invoice. */
  pdf_url: string | null;
  wa_sent: boolean;
}

/**
 * Notify the guest about their invoice via WhatsApp using a LINK approach.
 *
 * Why a link instead of a server-rendered PDF attachment:
 * the app runs on Cloudflare Workers, where `@react-pdf/renderer`'s
 * `renderToBuffer` is unreliable — it can throw or produce a Supabase Storage
 * object that never persists (surfacing later as a 404). When that URL was
 * handed to Fonnte as an attachment, Fonnte rejected the whole request and the
 * guest received NOTHING. Instead we send the public confirmation page
 * (`/book/confirmation/{id}`), which renders and downloads the invoice
 * client-side (browser react-pdf) and always works.
 *
 * - The message is sent only when a Fonnte token is configured; the function
 *   still returns ok=true if WA is skipped (wa_sent=false).
 * - `skipWhatsApp` keeps the `invoices` record in sync (e.g. after a payment
 *   update) without re-messaging the guest.
 */
export async function generateAndSendInvoiceNotification({
  supabase,
  bookingId,
  origin,
  skipWhatsApp = false,
}: {
  supabase: SupabaseClient;
  bookingId: string;
  origin?: string;
  /** Set true to refresh the invoice record without re-sending WhatsApp. */
  skipWhatsApp?: boolean;
}): Promise<InvoiceResult> {
  try {
    // ── 1. Fetch booking, guest, and property ───────────────────────────
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(`
        id,
        reference_code,
        check_in,
        check_out,
        total_amount,
        payment_status,
        guests (
          id,
          full_name,
          phone,
          email
        ),
        properties (
          name,
          phone,
          whatsapp_number,
          public_domain,
          fonnte_token,
          payment_bank_name,
          payment_account_number,
          payment_account_holder
        )
      `)
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) {
      return { ok: false, error: `Failed to fetch booking: ${bErr?.message ?? "Not found"}`, pdf_url: null, wa_sent: false };
    }

    const guest = booking.guests as any;
    const property = booking.properties as any;

    if (!skipWhatsApp && !guest?.phone) {
      return { ok: false, error: "Guest has no phone number, cannot send notification", pdf_url: null, wa_sent: false };
    }

    // ── 2. Resolve the room type name (for the message summary) ─────────
    const { data: bookingRooms, error: brErr } = await supabase
      .from("booking_rooms")
      .select(`room_types(name)`)
      .eq("booking_id", bookingId);

    if (brErr) {
      console.warn("[InvoiceNotification] Error fetching booking rooms:", brErr);
    }
    const roomTypeName = (bookingRooms as any)?.[0]?.room_types?.name ?? "Kamar";

    // ── 3. Build the public invoice (confirmation page) link ────────────
    const rawDomain = property?.public_domain ?? origin ?? null;
    const propertyWebsite = rawDomain
      ? rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`
      : null;
    const cleanDomain = (propertyWebsite ?? "https://pomahguesthouse.com").replace(/\/+$/, "");
    // Use the human-friendly booking code in the URL when available.
    const invoiceRef = booking.reference_code ?? bookingId;
    const invoiceUrl = `${cleanDomain}/book/confirmation/${encodeURIComponent(invoiceRef)}`;
    const propertyName = property?.name || "Pomah Guesthouse";

    // ── 4. Upsert invoices record (keeps admin/reporting in sync) ───────
    const invoiceNumber = `INV-${booking.reference_code ?? booking.id.slice(0, 8)}`;
    const now = new Date().toISOString();
    await (supabase as any)
      .from("invoices")
      .upsert(
        {
          booking_id: bookingId,
          invoice_number: invoiceNumber,
          pdf_url: invoiceUrl,
          payment_status_snapshot: booking.payment_status ?? "unpaid",
          issued_at: now,
          regenerated_at: now,
        },
        { onConflict: "booking_id" },
      );

    // ── 5. WhatsApp send (optional, skipped gracefully) ─────────────────
    let waSent = false;
    const fonnte_token = property?.fonnte_token;

    if (skipWhatsApp) {
      return { ok: true, error: null, pdf_url: invoiceUrl, wa_sent: false };
    }

    if (!fonnte_token) {
      console.warn("[InvoiceNotification] Fonnte token not configured — WhatsApp skipped");
      return { ok: true, error: null, pdf_url: invoiceUrl, wa_sent: false };
    }

    let cleanedPhone = guest.phone.replace(/\D/g, "");
    if (cleanedPhone.startsWith("0")) cleanedPhone = "62" + cleanedPhone.slice(1);

    const totalFormatted = `Rp ${Number(booking.total_amount ?? 0).toLocaleString("id-ID")}`;

    let bankDetails = "";
    if (property.payment_bank_name && property.payment_account_number) {
      bankDetails = `\n\nTransfer Pembayaran:\n🏦 Bank: ${property.payment_bank_name}\n💳 No. Rekening: ${property.payment_account_number}\n👤 Atas Nama: ${property.payment_account_holder ?? "-"}`;
    }

    const messageBody = `Halo ${guest.full_name},

Terima kasih telah memesan kamar di ${propertyName}. Reservasi Anda telah berhasil dibuat.

Berikut ringkasan pemesanan Anda:
• Kode Booking: ${booking.reference_code ?? booking.id.slice(0, 8)}
• Tipe Kamar: ${roomTypeName}
• Check-in: ${fmtDateID(booking.check_in)}
• Check-out: ${fmtDateID(booking.check_out)}
• Total: ${totalFormatted}${bankDetails}

Untuk melihat dan mengunduh invoice resmi serta memantau status pembayaran, silakan buka tautan berikut:
${invoiceUrl}

Terima kasih.`;

    console.log(`[InvoiceNotification] Sending invoice link via WhatsApp to ${cleanedPhone}…`);
    const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
      fonnte_token,
      cleanedPhone,
      messageBody,
    );

    if (sent) {
      waSent = true;

      await (supabase as any)
        .from("invoices")
        .update({ wa_sent_at: new Date().toISOString() })
        .eq("booking_id", bookingId);

      // Log to WhatsApp thread
      const { data: thread } = await supabase
        .from("whatsapp_threads")
        .select("id")
        .eq("phone", cleanedPhone)
        .maybeSingle();

      let threadId = thread?.id;
      if (!threadId) {
        const { data: newThread } = await supabase
          .from("whatsapp_threads")
          .insert({ phone: cleanedPhone, display_name: guest.full_name, guest_id: guest.id, status: "open", unread_count: 0 })
          .select("id")
          .single();
        threadId = newThread?.id;
      }

      if (threadId) {
        await supabase.from("whatsapp_messages").insert({
          thread_id: threadId,
          direction: "out",
          body: messageBody,
          metadata: { agent: "System", is_automated: true, invoice_url: invoiceUrl },
        });
        await supabase
          .from("whatsapp_threads")
          .update({
            last_message_preview: messageBody.slice(0, 100),
            last_message_at: new Date().toISOString(),
          })
          .eq("id", threadId);
      }
    } else {
      console.warn(`[InvoiceNotification] WhatsApp send failed: ${sendErr}`);
    }

    return { ok: true, error: null, pdf_url: invoiceUrl, wa_sent: waSent };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[InvoiceNotification] Unexpected error:", err);
    return { ok: false, error: errMsg, pdf_url: null, wa_sent: false };
  }
}
