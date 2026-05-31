/**
 * Tool: cc_payment_proof_to_admin
 *
 * Forwards a guest's payment-proof image (plus OCR + match summary) to the
 * super-admin via the existing `notifyPaymentProof` channel. Called by the
 * Finance Agent after `get_payment_proof_result`, regardless of match
 * status — admins want a paper trail of every transfer, not just clean
 * matches.
 *
 * Production: the WhatsApp webhook already fires `notifyPaymentProof` in
 * parallel with the agent. Dedupe via `notification_logs.dedupe_key`
 * (`payment_proof:{messageId}:{managerId}`) blocks the second send, so
 * calling this tool from the agent is a safe no-op when the webhook
 * already handled the same image.
 *
 * Simulator: no real super-admin send — returns a "simulated" payload
 * so the admin can verify the flow without spamming production
 * recipients.
 *
 * Source of truth for image + OCR:
 *   1. ctx.recentPaymentProofImageUrl + ctx.recentOcrResult (simulator)
 *   2. whatsapp_messages.metadata.attachment_url + ocr_result (production)
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

export const ccPaymentProofToAdmin: ToolHandler = async (
  _args: Record<string, unknown>,
  ctx:   ToolContext,
): Promise<string> => {
  if (!ctx.phone) {
    return JSON.stringify({
      ok: false,
      error: "Tidak ada nomor tamu untuk dijadikan referensi.",
    });
  }

  // ── Resolve image + OCR + messageId from the right source ─────────────
  let imageUrl: string | null = ctx.recentPaymentProofImageUrl ?? null;
  let messageId: string | null = ctx.idempotencyKey ?? null;
  let ocrResultPayload: any = ctx.recentOcrResult
    ? { ok: true, ocr: ctx.recentOcrResult.ocr, match: ctx.recentOcrResult.match }
    : null;
  let guestName: string | null = null;

  // Production fallback: read from the latest inbound WA message metadata.
  if (!imageUrl || !ocrResultPayload) {
    try {
      const { data: thread } = await (ctx.supabaseAdmin as any)
        .from("whatsapp_threads")
        .select("id, display_name")
        .eq("phone", ctx.phone)
        .maybeSingle();
      if (thread?.id) {
        guestName = (thread as any).display_name ?? null;
        const { data: msgs } = await (ctx.supabaseAdmin as any)
          .from("whatsapp_messages")
          .select("id, metadata, sent_at")
          .eq("thread_id", thread.id)
          .eq("direction", "in")
          .order("sent_at", { ascending: false })
          .limit(10);
        const withProof = (msgs as Array<{ id: string; metadata: any }> | null)?.find(
          (m) => m.metadata && (m.metadata.attachment_url || m.metadata.ocr_result),
        );
        if (withProof) {
          imageUrl = imageUrl ?? withProof.metadata?.attachment_url ?? null;
          messageId = messageId ?? withProof.id;
          if (!ocrResultPayload && withProof.metadata?.ocr_result) {
            ocrResultPayload = {
              ok: true,
              ocr: withProof.metadata.ocr_result,
              match: withProof.metadata.ocr_match ?? { status: "pending", booking_code: null, booking_amount: null, amount_diff: null },
            };
          }
        }
      }
    } catch (e) {
      console.warn("[cc_payment_proof_to_admin] DB lookup failed:", e);
    }
  }

  if (!imageUrl) {
    return JSON.stringify({
      ok: false,
      error: "Tidak menemukan gambar bukti transfer untuk di-CC.",
    });
  }

  // ── Simulator: skip the real send, return a stub. ──────────────────────
  if (ctx.isSimulator) {
    return JSON.stringify({
      ok: true,
      simulated: true,
      message: "(SIMULASI) Bukti transfer tidak benar-benar di-CC ke super admin.",
    });
  }

  // ── Production: dispatch via the existing manager-notifier. ────────────
  try {
    const { notifyPaymentProof } = await import("@/services/manager-notifier.service");
    await notifyPaymentProof(ctx.supabaseAdmin as any, {
      threadId:  null,
      phone:     ctx.phone,
      guestName,
      imageUrl,
      messageId: messageId ?? `agent:${ctx.phone}:${Date.now()}`,
      ocrResult: ocrResultPayload ?? undefined,
    });
    return JSON.stringify({
      ok: true,
      simulated: false,
      message: "Bukti transfer telah di-CC ke super admin.",
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: m });
  }
};
