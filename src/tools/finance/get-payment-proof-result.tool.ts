/**
 * Tool: get_payment_proof_result
 *
 * Returns the Vision OCR result for the most recent payment-proof image the
 * guest sent. Two sources, in order:
 *   1. `ctx.recentOcrResult` — populated by the AI Lab simulator when an
 *      admin uploads an image (so we don't depend on DB writes).
 *   2. `whatsapp_messages.metadata.ocr_result` — populated by the production
 *      webhook's fire-and-forget `analyzePaymentProof` call. Read from the
 *      newest inbound message for this phone that has an attachment.
 *
 * Race condition: in production, OCR runs in parallel with the agent's
 * autoreply queue. If the agent calls this tool before the Vision LLM
 * finishes, no OCR data exists yet → return status="pending" so the agent
 * can fall back to a generic acknowledgement.
 */

import { formatRupiahOcr } from "@/services/payment-proof.service";
import type { ToolContext, ToolHandler } from "@/tools/types";

interface OcrShape {
  bank_pengirim:    string | null;
  bank_tujuan:      string | null;
  nominal:          number | null;
  tanggal:          string | null;
  nama_pengirim:    string | null;
  nomor_referensi:  string | null;
  raw_text?:        string;
}

interface MatchShape {
  status:         string;
  booking_code:   string | null;
  booking_amount: number | null;
  amount_diff:    number | null;
}

function shape(ocr: OcrShape, match: MatchShape) {
  return {
    ok: true,
    ocr: {
      nominal:           ocr.nominal,
      nominal_tampil:    formatRupiahOcr(ocr.nominal),
      bank_pengirim:     ocr.bank_pengirim,
      bank_tujuan:       ocr.bank_tujuan,
      tanggal:           ocr.tanggal,
      nama_pengirim:     ocr.nama_pengirim,
      nomor_referensi:   ocr.nomor_referensi,
    },
    match: {
      status:                match.status,
      booking_code:          match.booking_code,
      booking_amount:        match.booking_amount,
      booking_amount_tampil: formatRupiahOcr(match.booking_amount),
      amount_diff:           match.amount_diff,
      amount_diff_tampil:    match.amount_diff != null ? formatRupiahOcr(match.amount_diff) : null,
    },
  };
}

export const getPaymentProofResult: ToolHandler = async (
  _args: Record<string, unknown>,
  ctx:   ToolContext,
): Promise<string> => {
  // Source 1: simulator-injected
  if (ctx.recentOcrResult) {
    const ocr = ctx.recentOcrResult.ocr as unknown as OcrShape;
    const match = ctx.recentOcrResult.match as unknown as MatchShape;
    return JSON.stringify(shape(ocr, match));
  }

  // Source 2: DB lookup (production)
  if (!ctx.phone) {
    return JSON.stringify({
      ok: false,
      status: "no_phone",
      message: "Tidak ada nomor tamu untuk mencari bukti transfer.",
    });
  }

  try {
    const { data: thread } = await (ctx.supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id")
      .eq("phone", ctx.phone)
      .maybeSingle();
    if (!thread?.id) {
      return JSON.stringify({
        ok: false,
        status: "no_thread",
        message: "Belum ada thread WhatsApp untuk nomor ini.",
      });
    }

    const { data: msg } = await (ctx.supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("metadata, sent_at")
      .eq("thread_id", thread.id)
      .eq("direction", "in")
      .order("sent_at", { ascending: false })
      .limit(10);

    if (!msg || msg.length === 0) {
      return JSON.stringify({
        ok: false,
        status: "no_messages",
        message: "Tidak ada pesan masuk yang ditemukan.",
      });
    }

    const withOcr = (msg as Array<{ metadata: Record<string, unknown> | null }>)
      .find((m) => m.metadata && (m.metadata as any).ocr_result);
    if (!withOcr) {
      // Maybe an attachment exists but OCR hasn't finished yet.
      const withAttachment = (msg as Array<{ metadata: Record<string, unknown> | null }>)
        .find((m) => m.metadata && (m.metadata as any).attachment_url);
      if (withAttachment) {
        return JSON.stringify({
          ok: false,
          status: "pending",
          message: "Bukti transfer terdeteksi, OCR masih diproses.",
        });
      }
      return JSON.stringify({
        ok: false,
        status: "no_proof",
        message: "Belum ada bukti transfer yang dikirim oleh tamu.",
      });
    }

    const meta = withOcr.metadata as any;
    return JSON.stringify(shape(meta.ocr_result, meta.ocr_match));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, status: "error", message: m });
  }
};
