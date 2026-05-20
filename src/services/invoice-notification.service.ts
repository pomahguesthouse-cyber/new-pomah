import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { SupabaseClient } from "@supabase/supabase-js";
import { InvoiceDocument } from "@/admin/components/invoice-pdf";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { fmtDateID } from "@/lib/date";

export async function generateAndSendInvoiceNotification({
  supabase,
  bookingId,
  origin,
}: {
  supabase: SupabaseClient;
  bookingId: string;
  origin?: string;
}): Promise<{ ok: boolean; error: string | null }> {
  try {
    // 1. Fetch booking, guest, and property details in a single query
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
      return { ok: false, error: `Failed to fetch booking: ${bErr?.message || "Not found"}` };
    }

    const guest = booking.guests as any;
    const property = booking.properties as any;

    if (!guest || !guest.phone) {
      return { ok: false, error: "Guest has no phone number, skipping notification" };
    }

    if (!property || !property.fonnte_token) {
      return { ok: false, error: "Fonnte token not configured, skipping notification" };
    }

    // 2. Fetch booking rooms with their types
    const { data: bookingRooms, error: brErr } = await supabase
      .from("booking_rooms")
      .select(`
        id,
        room_id,
        nightly_rate,
        room_types (
          name
        ),
        rooms (
          number
        )
      `)
      .eq("booking_id", bookingId);

    if (brErr) {
      console.warn("[InvoiceNotification] Error fetching booking rooms:", brErr);
    }

    // Format the booking data specifically for the InvoiceDocument type
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
      booking_rooms: (bookingRooms || []).map((br: any) => ({
        id: br.id,
        room_id: br.room_id,
        nightly_rate: br.nightly_rate,
        room_types: br.room_types ? { name: br.room_types.name } : null,
        rooms: br.rooms ? { number: br.rooms.number } : null,
      })),
    };

    // 3. Resolve branding / settings for PDF
    const { data: branding } = await supabase
      .from("properties")
      .select("logo_url, invoice_logo_url")
      .limit(1)
      .maybeSingle();

    const logoUrl = (branding as any)?.invoice_logo_url || (branding as any)?.logo_url;
    const propertyName = property.name || "Pomah Guesthouse";

    // 4. Generate the PDF invoice buffer
    console.log(`[InvoiceNotification] Rendering PDF invoice for booking: ${bookingId}...`);
    const doc = React.createElement(InvoiceDocument, {
      booking: invoiceBookingData,
      propertyName,
      logoUrl,
    });
    const pdfBuffer = await renderToBuffer(doc as any);

    // 5. Upload PDF buffer to Supabase Storage
    const storagePath = `invoices/${bookingId}.pdf`;
    console.log(`[InvoiceNotification] Uploading PDF to storage path: ${storagePath}...`);
    const { error: uploadErr } = await supabase.storage
      .from("room-images")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      return { ok: false, error: `Failed to upload PDF invoice to storage: ${uploadErr.message}` };
    }

    // 6. Get the public URL of the uploaded PDF
    const { data: publicUrlData } = supabase.storage
      .from("room-images")
      .getPublicUrl(storagePath);
    const pdfPublicUrl = publicUrlData.publicUrl;
    console.log(`[InvoiceNotification] Uploaded PDF invoice successfully. Public URL: ${pdfPublicUrl}`);

    // 7. Normalize phone number
    let cleanedPhone = guest.phone.replace(/\D/g, "");
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = "62" + cleanedPhone.slice(1);
    }

    // 8. Construct Message Body (Caption)
    const roomTypeName = invoiceBookingData.booking_rooms?.[0]?.room_types?.name || "Kamar";
    const totalFormatted = `Rp ${Number(booking.total_amount || 0).toLocaleString("id-ID")}`;
    
    let bankDetails = "";
    if (property.payment_bank_name && property.payment_account_number) {
      bankDetails = `\n\nTransfer Pembayaran:\n🏦 Bank: ${property.payment_bank_name}\n💳 No. Rekening: ${property.payment_account_number}\n👤 Atas Nama: ${property.payment_account_holder || "-"}`;
    }

    // Resolve public invoice link as a fallback/additional link
    const domain = property.public_domain 
      ? (property.public_domain.startsWith("http") ? property.public_domain : `https://${property.public_domain}`) 
      : origin || "https://pomahguesthouse.com";
    const cleanDomain = domain.replace(/\/+$/, "");
    const webInvoiceUrl = `${cleanDomain}/book/confirmation/${bookingId}`;

    const messageBody = `Halo ${guest.full_name},

Terima kasih telah memesan kamar di ${propertyName}. Reservasi Anda telah berhasil dibuat.

Berikut ringkasan pemesanan Anda:
• Kode Booking: ${booking.reference_code || booking.id.slice(0, 8)}
• Tipe Kamar: ${roomTypeName}
• Check-in: ${fmtDateID(booking.check_in)}
• Check-out: ${fmtDateID(booking.check_out)}
• Total: ${totalFormatted}${bankDetails}

Terlampir adalah invoice PDF resmi untuk reservasi Anda. Anda juga dapat memantau status pembayaran dan detail lengkapnya kapan saja melalui tautan berikut:
${webInvoiceUrl}

Terima kasih.`;

    // 9. Send WhatsApp Message with PDF Attached
    console.log(`[InvoiceNotification] Sending WhatsApp PDF invoice to ${cleanedPhone}...`);
    const filename = `Invoice-${booking.reference_code || booking.id.slice(0, 8)}.pdf`;
    const { ok: sent, error: sendErr } = await sendWhatsAppMessage(
      property.fonnte_token,
      cleanedPhone,
      messageBody,
      pdfPublicUrl,
      filename,
    );

    if (!sent) {
      return { ok: false, error: `Fonnte send error: ${sendErr}` };
    }

    // 10. Log and register message in DB thread
    let { data: thread } = await supabase
      .from("whatsapp_threads")
      .select("id")
      .eq("phone", cleanedPhone)
      .maybeSingle();

    let threadId = thread?.id;

    if (!threadId) {
      const { data: newThread, error: tErr } = await supabase
        .from("whatsapp_threads")
        .insert({
          phone: cleanedPhone,
          display_name: guest.full_name,
          guest_id: guest.id,
          status: "open",
          unread_count: 0
        })
        .select("id")
        .single();
      
      if (!tErr && newThread) {
        threadId = newThread.id;
      }
    }

    if (threadId) {
      // Insert sent message record
      await supabase.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "out",
        body: messageBody,
        metadata: {
          agent: "System",
          is_automated: true,
          pdf_url: pdfPublicUrl,
          filename: filename
        }
      });

      // Update thread preview
      await supabase
        .from("whatsapp_threads")
        .update({
          last_message_preview: `[Dokumen: ${filename}] ${messageBody.slice(0, 100)}`,
          last_message_at: new Date().toISOString(),
        })
        .eq("id", threadId);
    }

    return { ok: true, error: null };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[InvoiceNotification] Unexpected error:", err);
    return { ok: false, error: errMsg };
  }
}
