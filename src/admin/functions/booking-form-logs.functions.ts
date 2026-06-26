/**
 * Server functions untuk audit log pengiriman tautan form booking via WhatsApp.
 * Setiap kali tool `generate_booking_form` membuat tautan, log dibuat dengan
 * status `pending`. Setelah pesan WA terkirim/gagal, status diperbarui oleh
 * `wa-autoreply.service.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS_VALUES = ["pending", "sent", "failed", "superseded"] as const;
export type BookingFormSendStatus = (typeof STATUS_VALUES)[number];

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface BookingFormSendLog {
  id: string;
  token: string;
  phone: string;
  thread_id: string | null;
  property_id: string | null;
  booking_id: string | null;
  room_type_name: string | null;
  check_in: string | null;
  check_out: string | null;
  url: string;
  status: BookingFormSendStatus;
  failure_reason: string | null;
  attempts: number;
  sent_at: string | null;
  metadata: Record<string, JsonValue> | null;
  created_at: string;
  updated_at: string;
}

const listInput = z
  .object({
    status: z.enum(["all", ...STATUS_VALUES]).optional().default("all"),
    phone: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(500).optional().default(100),
  })
  .optional()
  .default({});

export const listBookingFormSendLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (context.supabase as any)
      .from("booking_form_send_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.phone) query = query.ilike("phone", `%${data.phone}%`);
    const { data: rows, error } = await query;
    if (error) throw error;
    return { logs: (rows ?? []) as BookingFormSendLog[] };
  });

/**
 * Kirim ulang tautan form booking untuk log yang gagal/superseded.
 * Membuat token baru (TTL fresh 30 menit), mengirim pesan WA via Fonnte
 * memakai kredensial properti, lalu mencatat log baru status `sent`/`failed`.
 */
const resendInput = z.object({ logId: z.string().uuid() });

export const resendBookingFormLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => resendInput.parse(d))
  .handler(async ({ data, context }) => {
    // Otorisasi: hanya admin/manager yang boleh memicu pengiriman ulang.
    const { data: isAdmin } = await (context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    }).rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) {
      throw new Error("Hanya admin yang dapat mengirim ulang tautan form.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;

    const { data: log, error: logErr } = await admin
      .from("booking_form_send_logs")
      .select("*")
      .eq("id", data.logId)
      .maybeSingle();
    if (logErr || !log) throw new Error("Log tidak ditemukan.");

    // Resolusi kredensial Fonnte + base URL dari properti terkait.
    let fonnteToken: string | null = null;
    let baseUrl = "https://pomahguesthouse.com";
    let propertyName = "Pomah Guesthouse";
    if (log.property_id) {
      const { data: prop } = await admin
        .from("properties")
        .select("name, fonnte_token, public_domain")
        .eq("id", log.property_id)
        .maybeSingle();
      if (prop) {
        fonnteToken = (prop.fonnte_token as string | null) ?? null;
        propertyName = (prop.name as string | undefined) ?? propertyName;
        const domain = prop.public_domain as string | undefined;
        if (domain) baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
      }
    }
    if (!fonnteToken) {
      throw new Error("Properti belum mempunyai token Fonnte aktif.");
    }

    // Buat token baru memakai prefill yang sama dengan log lama.
    const { createBookingFormToken } = await import("@/services/booking-form.service");
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const { token, url, expiresAt } = await createBookingFormToken({
      supabaseAdmin: admin,
      phone: log.phone,
      threadId: log.thread_id ?? null,
      propertyId: log.property_id ?? null,
      prefill: {
        roomTypeName: log.room_type_name ?? null,
        checkIn: log.check_in ?? null,
        checkOut: log.check_out ?? null,
        guestCount:
          typeof meta.guest_count === "number" ? (meta.guest_count as number) : null,
        rooms: typeof meta.rooms === "number" ? (meta.rooms as number) : null,
      },
      baseUrl: baseUrl.replace(/\/+$/, ""),
    });

    // Susun pesan dengan nada Pomah, sebutkan ini pengiriman ulang.
    const ttlMinutes = Math.max(
      1,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
    );
    const contextLines: string[] = [];
    if (log.room_type_name) contextLines.push(`• Kamar: ${log.room_type_name}`);
    if (log.check_in && log.check_out)
      contextLines.push(`• Tanggal: ${log.check_in} → ${log.check_out}`);
    const ctxBlock = contextLines.length ? `\n${contextLines.join("\n")}\n` : "";
    const message =
      `Halo Kak 🙏 Berikut tautan baru untuk melengkapi data pemesanan di ${propertyName}:` +
      `\n\n${url}\n` +
      ctxBlock +
      `\nTautan berlaku ${ttlMinutes} menit. Terima kasih! 🏡✨`;

    // Catat baris pending baru sebelum kirim agar audit konsisten bila gagal.
    const { data: newLog, error: insErr } = await admin
      .from("booking_form_send_logs")
      .insert({
        token,
        phone: log.phone,
        thread_id: log.thread_id,
        property_id: log.property_id,
        booking_id: log.booking_id,
        room_type_name: log.room_type_name,
        check_in: log.check_in,
        check_out: log.check_out,
        url,
        status: "pending",
        metadata: { ...meta, expires_at: expiresAt, resent_from: log.id },
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`Gagal mencatat log baru: ${insErr.message}`);

    const { sendWhatsAppMessage } = await import("@/services/whatsapp.service");
    const result = await sendWhatsAppMessage(fonnteToken, log.phone, message);

    const patch: Record<string, unknown> = {
      status: result.ok ? "sent" : "failed",
      attempts: 1,
      failure_reason: result.ok ? null : result.error ?? "unknown",
    };
    if (result.ok) patch.sent_at = new Date().toISOString();
    await admin.from("booking_form_send_logs").update(patch).eq("id", newLog.id);

    return {
      ok: result.ok,
      newLogId: newLog.id as string,
      url,
      error: result.ok ? null : result.error ?? "Gagal mengirim WhatsApp.",
    };
  });
