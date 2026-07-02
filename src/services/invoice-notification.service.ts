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
      .select(
        `
        id,
        reference_code,
        check_in,
        check_out,
        total_amount,
        payment_status,
        paid_amount,
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
      `,
      )
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) {
      return {
        ok: false,
        error: `Failed to fetch booking: ${bErr?.message ?? "Not found"}`,
        pdf_url: null,
        wa_sent: false,
      };
    }

    const guest = booking.guests as any;
    const property = booking.properties as any;

    if (!skipWhatsApp && !guest?.phone) {
      return { ok: false, error: "Guest has no phone number, cannot send notification", pdf_url: null, wa_sent: false };
    }

    // ── 2. Resolve the room type name (for the message summary) ─────────
    const { data: bookingRooms, error: brErr } = await supabase
      .from("booking_rooms")
      .select(`extra_bed_count, extra_bed_rate, room_types(name)`)
      .eq("booking_id", bookingId);

    if (brErr) {
      console.warn("[InvoiceNotification] Error fetching booking rooms:", brErr);
    }
    const roomCounts = new Map<string, number>();
    let totalExtraBed = 0;
    for (const br of ((bookingRooms as any[]) ?? [])) {
      const name = br?.room_types?.name ?? "Kamar";
      roomCounts.set(name, (roomCounts.get(name) ?? 0) + 1);
      totalExtraBed += Number(br?.extra_bed_count ?? 0);
    }
    const roomTypeName = roomCounts.size
      ? Array.from(roomCounts.entries()).map(([name, count]) => `${name} × ${count} kamar`).join(", ")
      : "Kamar";
    const extraBedLine = totalExtraBed > 0 ? `\n• Extra Bed: ${totalExtraBed}` : "";

    // ── 3. Build the public invoice (confirmation page) link ────────────
    const rawDomain = property?.public_domain ?? origin ?? null;
    const propertyWebsite = rawDomain ? (rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`) : null;
    const cleanDomain = (propertyWebsite ?? "https://pomahguesthouse.com").replace(/\/+$/, "");
    // Use the human-friendly booking code in the URL when available.
    const invoiceRef = booking.reference_code ?? bookingId;
    const invoiceUrl = `${cleanDomain}/book/confirmation/${encodeURIComponent(invoiceRef)}`;
    const propertyName = property?.name || "Pomah Guesthouse";

    // ── 4. Upsert invoices record (keeps admin/reporting in sync) ───────
    const invoiceNumber = `INV-${booking.reference_code ?? booking.id.slice(0, 8)}`;
    const now = new Date().toISOString();
    const { error: invoiceErr } = await (supabase as any).from("invoices").upsert(
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
    if (invoiceErr) {
      return {
        ok: false,
        error: `Failed to upsert invoice: ${invoiceErr.message}`,
        pdf_url: invoiceUrl,
        wa_sent: false,
      };
    }

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
    const paidAmount = Number((booking as any).paid_amount ?? 0);
    const paymentStatus: string = (booking as any).payment_status ?? "unpaid";
    const isDP = paymentStatus === "partial" && paidAmount > 0;
    const remainingAmount = Math.max(0, Number(booking.total_amount ?? 0) - paidAmount);

    let bankDetails = "";
    if (property.payment_bank_name && property.payment_account_number) {
      bankDetails = `\n\nTransfer Pembayaran:\n🏦 Bank: ${property.payment_bank_name}\n💳 No. Rekening: ${property.payment_account_number}\n👤 Atas Nama: ${property.payment_account_holder ?? "-"}`;
    }

    let paymentLines = "";
    if (isDP) {
      paymentLines =
        `• Status Pembayaran: SUDAH DP 🔄\n` +
        `• DP Dibayar: Rp ${paidAmount.toLocaleString("id-ID")}\n` +
        `• Sisa Pelunasan: Rp ${remainingAmount.toLocaleString("id-ID")}` +
        bankDetails;
    } else if (paymentStatus === "paid") {
      paymentLines = `• Status Pembayaran: LUNAS ✅`;
    } else {
      paymentLines = `• Status Pembayaran: Belum dibayar` + bankDetails;
    }

    const messageBody = `Halo ${guest.full_name},

Terima kasih telah memesan kamar di ${propertyName}. Reservasi Anda telah berhasil dibuat.

Berikut ringkasan pemesanan Anda:
• Kode Booking: ${booking.reference_code ?? booking.id.slice(0, 8)}
• Tipe Kamar: ${roomTypeName}
• Check-in: ${fmtDateID(booking.check_in)}
• Check-out: ${fmtDateID(booking.check_out)}
• Total: ${totalFormatted}
${paymentLines}

Untuk melihat dan mengunduh invoice resmi serta memantau status pembayaran, silakan buka tautan berikut:
${invoiceUrl}

Terima kasih.`;

    // ── Atomic claim ────────────────────────────────────────────────────
    // Idempotency key = invoices.booking_id. Set wa_sent_at HANYA jika
    // masih NULL. Kalau worker/retry lain sudah klaim (baris terupdate <1),
    // skip Fonnte total supaya tamu tidak menerima invoice WhatsApp dobel
    // dari payment-webhook retry, manual resend, atau cron yang tumpang
    // tindih.
    const claimAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("invoices")
      .update({ wa_sent_at: claimAt })
      .eq("booking_id", bookingId)
      .is("wa_sent_at", null)
      .select("id");
    if (claimErr) {
      console.warn(`[InvoiceNotification] Atomic claim failed: ${claimErr.message}`);
    }
    const claimWon = Array.isArray(claimed) && claimed.length > 0;
    if (!claimWon) {
      console.info(`[InvoiceNotification] Skip — invoice WA sudah dikirim untuk booking ${bookingId.slice(0, 8)}`);
      return { ok: true, error: null, pdf_url: invoiceUrl, wa_sent: false };
    }

    console.log(`[InvoiceNotification] Sending invoice link via WhatsApp to ${cleanedPhone}…`);
    const { ok: sent, error: sendErr } = await sendWhatsAppMessage(fonnte_token, cleanedPhone, messageBody);

    if (sent) {
      waSent = true;
      // wa_sent_at sudah di-set saat claim — tidak perlu update lagi.

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
          .insert({
            phone: cleanedPhone,
            display_name: guest.full_name,
            guest_id: guest.id,
            status: "open",
            unread_count: 0,
          })
          .select("id")
          .single();
        threadId = newThread?.id;
      }

      if (threadId) {
        await supabase.from("whatsapp_messages").insert({
          thread_id: threadId,
          direction: "out",
          body: messageBody,
          // Tag metadata pipeline-standar supaya invoice muncul di
          // /admin/routing-debug (sebelumnya invoice tidak terlacak karena
          // hanya menulis `agent: "System"` yang tidak dibaca aggregator).
          metadata: {
            agent: "System",
            is_automated: true,
            invoice_url: invoiceUrl,
            intent: "invoice_send",
            agent_key: "finance",
            tools_used: ["invoice-notification"],
            routing_confidence: 1,
            fast_path: true,
            pipeline: "invoice_notification",
          },
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
      // Release claim — kirim gagal, biarkan retry berikutnya mencoba lagi.
      try {
        await (supabase as any)
          .from("invoices")
          .update({ wa_sent_at: null })
          .eq("booking_id", bookingId)
          .eq("wa_sent_at", claimAt);
      } catch {
        /* non-fatal */
      }
      return { ok: false, error: sendErr ?? "WhatsApp send failed", pdf_url: invoiceUrl, wa_sent: false };
    }

    return { ok: true, error: null, pdf_url: invoiceUrl, wa_sent: waSent };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[InvoiceNotification] Unexpected error:", err);
    return { ok: false, error: errMsg, pdf_url: null, wa_sent: false };
  }
}
