import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { SupabaseClient } from "@supabase/supabase-js";
import { InvoiceDocument } from "@/admin/components/invoice-pdf";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { fmtDateID } from "@/lib/date";

export interface InvoiceResult {
  ok: boolean;
  error: string | null;
  pdf_url: string | null;
  wa_sent: boolean;
}

/**
 * Generate (or regenerate) the invoice PDF for a booking, persist the record
 * in the `invoices` table, and optionally send it via WhatsApp.
 *
 * - PDF generation is always attempted regardless of Fonnte config.
 * - WhatsApp is sent only when a Fonnte token is configured; the function
 *   still returns ok=true if WA is skipped (wa_sent=false).
 * - Calling again after a payment update will overwrite the existing PDF
 *   in storage (upsert) and update the invoice row.
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
  /** Set true to regenerate+store the PDF without re-sending WhatsApp. */
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
        paid_amount,
        source,
        guests (
          id,
          full_name,
          phone,
          email
        ),
        properties (
          name,
          address,
          city,
          country,
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

    if (!guest?.phone) {
      return { ok: false, error: "Guest has no phone number, cannot send notification", pdf_url: null, wa_sent: false };
    }

    // ── 2. Fetch booking rooms ──────────────────────────────────────────
    const { data: bookingRooms, error: brErr } = await supabase
      .from("booking_rooms")
      .select(`id, room_id, nightly_rate, room_types(name), rooms(number)`)
      .eq("booking_id", bookingId);

    if (brErr) {
      console.warn("[InvoiceNotification] Error fetching booking rooms:", brErr);
    }

    // ── 3. Resolve branding ─────────────────────────────────────────────
    const { data: branding } = await supabase
      .from("properties")
      .select("logo_url, invoice_logo_url")
      .limit(1)
      .maybeSingle();

    const logoUrl = (branding as any)?.invoice_logo_url || (branding as any)?.logo_url || null;
    const propertyName = property?.name || "Pomah Guesthouse";

    // Build full address from properties.address / city / country (Fix 1)
    const addressParts = [property?.address, property?.city, property?.country].filter(Boolean);
    const propertyAddress = addressParts.length > 0 ? addressParts.join(", ") : null;

    // Support contact: prefer whatsapp_number, fall back to phone (Fix 1)
    const propertyPhone = property?.whatsapp_number || property?.phone || null;

    // Website: derive from public_domain (Fix 1)
    const rawDomain = property?.public_domain ?? origin ?? null;
    const propertyWebsite = rawDomain
      ? rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`
      : null;

    // ── 4. Build invoice data ───────────────────────────────────────────
    const invoiceBookingData = {
      id: booking.id,
      reference_code: booking.reference_code,
      check_in: booking.check_in,
      check_out: booking.check_out,
      total_amount: booking.total_amount,
      payment_status: booking.payment_status as any,
      paid_amount: booking.paid_amount,
      source: booking.source,
      guests: {
        full_name: guest.full_name,
        email: guest.email,
        phone: guest.phone,
      },
      booking_rooms: (bookingRooms ?? []).map((br: any) => ({
        id: br.id,
        room_id: br.room_id,
        nightly_rate: br.nightly_rate,
        room_types: br.room_types ? { name: br.room_types.name } : null,
        rooms: br.rooms ? { number: br.rooms.number } : null,
      })),
    };

    // ── 5. Render PDF ───────────────────────────────────────────────────
    console.log(`[InvoiceNotification] Rendering PDF for booking: ${bookingId}…`);
    const doc = React.createElement(InvoiceDocument, {
      booking: invoiceBookingData,
      propertyName,
      logoUrl,
      propertyAddress,
      propertyPhone,
      propertyWebsite,
    });
    const pdfBuffer = await renderToBuffer(doc as any);

    // ── 6. Upload PDF to Supabase Storage (upsert so regen works) ───────
    const storagePath = `invoices/${bookingId}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("room-images")
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (uploadErr) {
      return { ok: false, error: `Failed to upload PDF: ${uploadErr.message}`, pdf_url: null, wa_sent: false };
    }

    const { data: publicUrlData } = supabase.storage.from("room-images").getPublicUrl(storagePath);
    const pdfPublicUrl = publicUrlData.publicUrl;
    console.log(`[InvoiceNotification] PDF uploaded: ${pdfPublicUrl}`);

    // ── 7. Upsert invoices record (Fix 3) ───────────────────────────────
    const invoiceNumber = `INV-${booking.reference_code ?? booking.id.slice(0, 8)}`;
    const now = new Date().toISOString();
    await (supabase as any)
      .from("invoices")
      .upsert(
        {
          booking_id: bookingId,
          invoice_number: invoiceNumber,
          pdf_url: pdfPublicUrl,
          payment_status_snapshot: booking.payment_status ?? "unpaid",
          issued_at: now,
          regenerated_at: now,
        },
        { onConflict: "booking_id" },
      );

    // ── 8. WhatsApp send (Fix 4 — optional, skipped gracefully) ─────────
    let waSent = false;
    const fonnte_token = property?.fonnte_token;

    if (!skipWhatsApp && fonnte_token) {
      let cleanedPhone = guest.phone.replace(/\D/g, "");
      if (cleanedPhone.startsWith("0")) cleanedPhone = "62" + cleanedPhone.slice(1);

      const roomTypeName = invoiceBookingData.booking_rooms?.[0]?.room_types?.name ?? "Kamar";
      const totalFormatted = `Rp ${Number(booking.total_amount ?? 0).toLocaleString("id-ID")}`;

      let bankDetails = "";
      if (property.payment_bank_name && property.payment_account_number) {
        bankDetails = `\n\nTransfer Pembayaran:\n🏦 Bank: ${property.payment_bank_name}\n💳 No. Rekening: ${property.payment_account_number}\n👤 Atas Nama: ${property.payment_account_holder ?? "-"}`;
      }

      const cleanDomain = (propertyWebsite ?? "https://pomahguesthouse.com").replace(/\/+$/, "");
      const webInvoiceUrl = `${cleanDomain}/book/confirmation/${bookingId}`;

      const messageBody = `Halo ${guest.full_name},

Terima kasih telah memesan kamar di ${propertyName}. Reservasi Anda telah berhasil dibuat.

Berikut ringkasan pemesanan Anda:
• Kode Booking: ${booking.reference_code ?? booking.id.slice(0, 8)}
• Tipe Kamar: ${roomTypeName}
• Check-in: ${fmtDateID(booking.check_in)}
• Check-out: ${fmtDateID(booking.check_out)}
• Total: ${totalFormatted}${bankDetails}

Terlampir adalah invoice PDF resmi untuk reservasi Anda. Anda juga dapat memantau status pembayaran dan detail lengkapnya melalui tautan berikut:
${webInvoiceUrl}

Terima kasih.`;

      const filename = `Invoice-${booking.reference_code ?? booking.id.slice(0, 8)}.pdf`;
      console.log(`[InvoiceNotification] Sending WhatsApp to ${cleanedPhone}…`);
      const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
        fonnte_token,
        cleanedPhone,
        messageBody,
        pdfPublicUrl,
        filename,
      );

      if (sent) {
        waSent = true;

        // Update wa_sent_at on the invoice record
        await (supabase as any)
          .from("invoices")
          .update({ wa_sent_at: new Date().toISOString() })
          .eq("booking_id", bookingId);

        // Log to WhatsApp thread
        let { data: thread } = await supabase
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
            metadata: { agent: "System", is_automated: true, pdf_url: pdfPublicUrl, filename },
          });
          await supabase
            .from("whatsapp_threads")
            .update({
              last_message_preview: `[Dokumen: ${filename}] ${messageBody.slice(0, 100)}`,
              last_message_at: new Date().toISOString(),
            })
            .eq("id", threadId);
        }
      } else {
        console.warn(`[InvoiceNotification] WhatsApp send failed: ${sendErr}`);
      }
    } else if (!skipWhatsApp && !fonnte_token) {
      console.warn("[InvoiceNotification] Fonnte token not configured — PDF generated but WhatsApp skipped");
    }

    return { ok: true, error: null, pdf_url: pdfPublicUrl, wa_sent: waSent };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[InvoiceNotification] Unexpected error:", err);
    return { ok: false, error: errMsg, pdf_url: null, wa_sent: false };
  }
}
