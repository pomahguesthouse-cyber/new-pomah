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
  biaya_admin:      number | null;
  total_dibayar:    number | null;
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
      biaya_admin:       ocr.biaya_admin,
      biaya_admin_tampil: ocr.biaya_admin != null ? formatRupiahOcr(ocr.biaya_admin) : null,
      total_dibayar:     ocr.total_dibayar,
      total_dibayar_tampil: ocr.total_dibayar != null ? formatRupiahOcr(ocr.total_dibayar) : null,
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

    // OCR runs fire-and-forget in the production webhook, in PARALLEL with the
    // autoreply queue that eventually invokes this tool. If we read once and
    // the Vision LLM hasn't finished, we'd return "pending" and the agent would
    // never reach match.status="matched" → invoice never marked LUNAS on this
    // turn. So poll (bounded) until the OCR metadata lands. Budget stays under
    // the 15s per-tool timeout in the executor.
    const POLL_DEADLINE_MS = 4_000;
    const POLL_INTERVAL_MS = 1_000;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + POLL_DEADLINE_MS;

    type MetaRow = { id: string; metadata: Record<string, unknown> | null };
    const hasProofSignal = (md: Record<string, unknown> | null): boolean =>
      !!md &&
      !!(
        (md as any).attachment_url ||
        (md as any).media_url ||
        (md as any).attachment ||
        (md as any).evolution_message ||
        (md as any).intent === "payment_proof" ||
        (md as any).pipeline === "payment_proof_ocr"
      );

    let sawProof = false;
    let proofRow: MetaRow | null = null;

    for (;;) {
      const { data: msg } = await (ctx.supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id, metadata, sent_at")
        .eq("thread_id", thread.id)
        .eq("direction", "in")
        .order("sent_at", { ascending: false })
        .limit(10);

      const rows = (msg ?? []) as MetaRow[];

      const withOcr = rows.find((m) => m.metadata && (m.metadata as any).ocr_result);
      if (withOcr) {
        const meta = withOcr.metadata as any;
        return JSON.stringify(shape(meta.ocr_result, meta.ocr_match));
      }

      // Detect a proof image still being OCR'd. Note: Evolution API sometimes
      // delivers media without a public URL, so also trust the intent/pipeline
      // tags the webhook writes for payment-proof images.
      const candidate = rows.find((m) => hasProofSignal(m.metadata));
      if (candidate) {
        sawProof = true;
        proofRow = candidate;
      } else if (!sawProof) {
        // No proof image anywhere — don't burn the timeout budget waiting.
        return JSON.stringify({
          ok: false,
          status: "no_proof",
          message: "Belum ada bukti transfer yang dikirim oleh tamu.",
        });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }

    // OCR latar belakang webhook belum menghasilkan apa pun (tugas `waitUntil`
    // bisa mati sebelum selesai). Jalankan OCR SEKARANG, langsung di dalam tool,
    // memakai record Evolution yang tersimpan di metadata pesan.
    if (proofRow) {
      const md = (proofRow.metadata ?? {}) as any;
      try {
        const { fetchWaMediaDataUri } = await import("@/services/whatsapp.service");
        const { analyzePaymentProof } = await import("@/services/payment-proof.service");

        let imageSource: string | null = null;
        if (md.evolution_message) {
          imageSource = await fetchWaMediaDataUri("", md.evolution_message);
        }
        const publicUrl = md.attachment_url ?? md.media_url ?? md.attachment?.url ?? null;
        if (!imageSource && publicUrl && !/mmg\.whatsapp\.net/i.test(String(publicUrl))) {
          imageSource = String(publicUrl);
        }

        if (imageSource) {
          const result = await analyzePaymentProof(
            ctx.supabaseAdmin as any,
            imageSource,
            ctx.phone,
            proofRow.id,
          );
          if (result?.ok) {
            return JSON.stringify(
              shape(result.ocr as unknown as OcrShape, result.match as unknown as MatchShape),
            );
          }
        }
      } catch (e) {
        console.warn("[PaymentProofTool] OCR inline gagal:", e);
      }
    }

    return JSON.stringify({
      ok: false,
      status: sawProof ? "pending" : "no_proof",
      message: sawProof
        ? "Bukti transfer terdeteksi tapi belum bisa dibaca otomatis. Minta tamu mengirim ulang bukti transfer atau teruskan ke admin."
        : "Belum ada bukti transfer yang dikirim oleh tamu.",
    });

  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, status: "error", message: m });
  }
};
