/** Tool untuk membaca data form booking yang sudah disubmit. */

import { getSubmittedBookingForm } from "@/services/booking-form.service";
import type { ToolContext, ToolHandler } from "./types";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export const getBookingFormSubmission: ToolHandler = async (args, ctx: ToolContext) => {
  const token = text(args.token);
  if (!token) return JSON.stringify({ ok: false, error: "Token form wajib diisi." });

  const row = await getSubmittedBookingForm(ctx.supabaseAdmin, token);
  if (!row) return JSON.stringify({ ok: false, error: "Data form belum ditemukan atau belum disubmit." });

  if (ctx.phone && normalizePhone(ctx.phone) !== normalizePhone(row.phone)) {
    return JSON.stringify({ ok: false, error: "Token form tidak cocok dengan nomor WhatsApp percakapan ini." });
  }

  return JSON.stringify({
    ok: true,
    token: row.token,
    phone: row.phone,
    submitted_at: row.submitted_at,
    prefill_data: row.prefill_data,
    submitted_data: row.submitted_data,
  });
};