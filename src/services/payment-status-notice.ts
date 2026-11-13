/**
 * Pemberitahuan status pembayaran ke tamu SETELAH staf/manajer memverifikasi
 * pembayaran (kasus Sofiah PG-EC83T, 8 Nov 2026: OCR "matched_full" 19.10 WIB,
 * staf menandai lunas 19.11, tapi snapshot invoice tetap "unpaid" dan tamu
 * tidak menerima pemberitahuan otomatis).
 *
 * Kebijakan (tidak diubah): hasil OCR bukti transfer BUKAN bukti dana masuk.
 * Status hanya berubah lewat jalur terverifikasi (admin / manajer). Modul ini
 * hanya memberi tahu tamu setelah perubahan itu TERSIMPAN di DB.
 *
 * - Dikirim hanya untuk transisi ke `partial` atau `paid` yang benar-benar
 *   baru (status atau nominal tercatat berubah).
 * - LUNAS hanya bila paid_amount ≥ total_amount; selain itu ditulis
 *   "pembayaran sebagian" dengan sisa tagihan.
 * - Sekali per (booking, status, nominal): dicek dari pesan keluar yang sudah
 *   tercatat (metadata.notice_key) sebelum kirim.
 * - Tanpa detail rekening/kredensial pembayaran.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGuestWhatsApp } from "./guest-whatsapp.service";
import { resolveOrCreateNotificationThread } from "./invoice-notification.service";
import { toMetaRecipient } from "./whatsapp-meta.service";

export type PaymentStatusValue = "unpaid" | "partial" | "paid" | string | null | undefined;

export interface PaymentNoticeDeps {
  send?: (phone: string, body: string) => Promise<{ ok: boolean; error?: string | null; channel?: string | null }>;
  resolveThread?: typeof resolveOrCreateNotificationThread;
  /** Jeda staf per-thread (dipakai jalur otomatis). */
  isPaused?: (bookingId: string) => Promise<boolean>;
}

export type PaymentNoticeOutcome =
  | { status: "sent"; noticeKey: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function paymentNoticeKey(bookingId: string, status: string, paid: number): string {
  return `${bookingId}:${status}:${Math.round(paid)}`;
}

/** Teks pemberitahuan (murni). */
export function buildPaymentStatusNotice(p: {
  guestName?: string | null;
  referenceCode: string;
  status: "partial" | "paid";
  paidAmount: number;
  totalAmount: number;
  invoiceUrl: string;
  /** Nominal pembayaran ini (bukan kumulatif). */
  appliedAmount?: number | null;
  /** true = dicatat otomatis dari bukti transfer (belum cek mutasi bank). */
  autoRecorded?: boolean;
  /** true = dana sudah cocok dengan mutasi rekening (Moota). */
  verifiedByMutation?: boolean;
}): string {
  const remaining = Math.max(0, p.totalAmount - p.paidAmount);
  const hello = p.guestName?.trim() ? `Halo Kak ${p.guestName.trim()},` : "Halo Kak,";
  if (p.verifiedByMutation) {
    // Jatuh ke teks terverifikasi di bawah.
  } else if (p.autoRecorded) {
    const status = p.status === "paid" ? "*LUNAS*" : "*DIBAYAR SEBAGIAN (DP)*";
    const applied = p.appliedAmount && p.appliedAmount > 0 ? `• Pembayaran ini: ${rp(p.appliedAmount)}\n` : "";
    return (
      `${hello}\n\nBukti transfer untuk booking ${p.referenceCode} sudah kami terima dan pembayaran sudah dicatat. ` +
      `Status invoice sekarang: ${status}.\n\n` +
      applied +
      `• Total tagihan: ${rp(p.totalAmount)}\n• Total dibayar: ${rp(p.paidAmount)}\n• Sisa: ${rp(remaining)}\n\n` +
      (p.status === "paid" ? "" : `Sisa pembayaran bisa dilunasi sebelum atau saat check-in.\n`) +
      `Invoice terbaru: ${p.invoiceUrl}\n\nTerima kasih 🙏`
    );
  }
  if (p.status === "paid") {
    return (
      `${hello}\n\nPembayaran untuk booking ${p.referenceCode} sudah kami terima dan terverifikasi. ` +
      `Status invoice sekarang: *LUNAS*.\n\n` +
      `• Total tagihan: ${rp(p.totalAmount)}\n• Sudah dibayar: ${rp(p.paidAmount)}\n• Sisa: Rp0\n\n` +
      `Invoice terbaru: ${p.invoiceUrl}\n\nTerima kasih 🙏`
    );
  }
  return (
    `${hello}\n\nPembayaran untuk booking ${p.referenceCode} sudah kami terima dan terverifikasi. ` +
    `Status invoice sekarang: *DIBAYAR SEBAGIAN (DP)*.\n\n` +
    `• Total tagihan: ${rp(p.totalAmount)}\n• Sudah dibayar: ${rp(p.paidAmount)}\n• Sisa: ${rp(remaining)}\n\n` +
    `Sisa pembayaran bisa dilunasi sebelum atau saat check-in.\n` +
    `Invoice terbaru: ${p.invoiceUrl}\n\nTerima kasih 🙏`
  );
}

/**
 * Kirim pemberitahuan bila status pembayaran booking (yang SUDAH tersimpan)
 * berubah dari `before`. Tidak pernah melempar.
 */
export async function notifyPaymentStatusChange(params: {
  supabase: SupabaseClient;
  bookingId: string;
  before: { payment_status: PaymentStatusValue; paid_amount: number | null | undefined };
  deps?: PaymentNoticeDeps;
  appliedAmount?: number;
  autoRecorded?: boolean;
  verifiedByMutation?: boolean;
  /** true bila dedup sudah dijamin klaim atomik (payment_applications). */
  skipDedup?: boolean;
}): Promise<PaymentNoticeOutcome> {
  const db = params.supabase as any;
  const send = params.deps?.send ?? sendGuestWhatsApp;
  const resolveThread = params.deps?.resolveThread ?? resolveOrCreateNotificationThread;
  try {
    const { data: b, error } = await db
      .from("bookings")
      .select("id, reference_code, status, payment_status, paid_amount, total_amount, guests ( id, full_name, phone ), properties ( public_domain )")
      .eq("id", params.bookingId)
      .single();
    if (error || !b) return { status: "failed", reason: error?.message ?? "booking tidak ditemukan" };
    const status = String(b.payment_status ?? "unpaid");
    const paid = Number(b.paid_amount ?? 0);
    const total = Number(b.total_amount ?? 0);
    if (String(b.status ?? "") === "cancelled") return { status: "skipped", reason: "booking batal" };
    if (status !== "paid" && status !== "partial") return { status: "skipped", reason: `status ${status}` };
    const prevStatus = String(params.before.payment_status ?? "unpaid");
    const prevPaid = Number(params.before.paid_amount ?? 0);
    if (prevStatus === status && Math.round(prevPaid) === Math.round(paid)) {
      return { status: "skipped", reason: "tidak ada perubahan" };
    }
    if (paid <= 0) return { status: "skipped", reason: "nominal dibayar 0" };
    // LUNAS hanya bila nominal tercatat menutup total; selain itu kabarkan sebagian.
    const effective: "paid" | "partial" = status === "paid" && paid >= total ? "paid" : "partial";
    if (status === "paid" && effective === "partial") {
      return { status: "skipped", reason: "status lunas tetapi nominal < total — perlu dicek staf" };
    }
    const guest = b.guests as { id?: string; full_name?: string; phone?: string } | null;
    const phone = toMetaRecipient(String(guest?.phone ?? ""));
    if (!/^\d{8,15}$/.test(phone)) return { status: "skipped", reason: "nomor tamu tidak valid" };

    const noticeKey = paymentNoticeKey(b.id, effective, paid);
    const threadId = await resolveThread({
      supabase: params.supabase,
      phone,
      displayName: guest?.full_name ?? null,
      guestId: guest?.id ?? null,
      provider: null,
    } as any);
    // Klaim atomik (payment_status_notices) bila migrasi sudah ada; jalur
    // otomatis memakai klaim payment_applications (skipDedup).
    let claimToken: string | null = null;
    let atomic = false;
    if (!params.skipDedup) {
      const { data: tok, error: claimErr } =
        typeof db.rpc === "function"
          ? await db.rpc("claim_payment_status_notice", { p_notice_key: noticeKey, p_booking_id: b.id })
          : { data: null, error: { message: "rpc unavailable" } };
      if (!claimErr) {
        atomic = true;
        if (!tok) return { status: "skipped", reason: "sudah pernah dikirim" };
        claimToken = String(tok);
      } else if (threadId) {
        // Fallback lama (non-atomik) bila RPC belum dimigrasi.
        const { data: dup } = await db
          .from("whatsapp_messages")
          .select("id")
          .eq("thread_id", threadId)
          .eq("direction", "out")
          .contains("metadata", { notice_key: noticeKey })
          .limit(1);
        if ((dup ?? []).length > 0) return { status: "skipped", reason: "sudah pernah dikirim" };
      }
    }
    const finish = async (ok: boolean, err?: string | null) => {
      if (atomic && claimToken) {
        await db.rpc("finish_payment_status_notice", {
          p_notice_key: noticeKey, p_claim_token: claimToken, p_ok: ok, p_error: err ?? null,
        });
      }
    };

    const domain = String((b.properties as any)?.public_domain ?? "pomahguesthouse.com");
    const base = (domain.startsWith("http") ? domain : `https://${domain}`).replace(/\/+$/, "");
    const body = buildPaymentStatusNotice({
      guestName: guest?.full_name,
      referenceCode: String(b.reference_code ?? b.id.slice(0, 8)),
      status: effective,
      paidAmount: paid,
      totalAmount: total,
      appliedAmount: params.appliedAmount,
      autoRecorded: params.autoRecorded,
      verifiedByMutation: params.verifiedByMutation,
      invoiceUrl: `${base}/book/confirmation/${encodeURIComponent(String(b.reference_code ?? b.id))}`,
    });
    const res = await send(phone, body);
    if (!res.ok) {
      await finish(false, res.error ?? "kirim WhatsApp gagal");
      return { status: "failed", reason: res.error ?? "kirim WhatsApp gagal" };
    }
    await finish(true);
    if (threadId) {
      await db.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "out",
        from_me: true,
        body,
        metadata: {
          agent: "System",
          is_automated: true,
          intent: "payment_status_update",
          agent_key: "finance",
          pipeline: "payment_status_notice",
          tools_used: ["payment-status-notice"],
          notice_key: noticeKey,
          booking_id: b.id,
          payment_status: effective,
        },
      });
    }
    return { status: "sent", noticeKey };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}
