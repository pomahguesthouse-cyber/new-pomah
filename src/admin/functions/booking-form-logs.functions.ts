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
  metadata: Record<string, unknown> | null;
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
