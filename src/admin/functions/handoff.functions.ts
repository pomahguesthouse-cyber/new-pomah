/**
 * Server functions untuk modul Handoff Tickets.
 * Admin dapat melihat tiket yang dibuat dari frustration-detector dan
 * mengeksekusi quick actions: approve / adjust / cancel / resolve.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS_VALUES = ["open", "approved", "adjusted", "cancelled", "resolved"] as const;
export type HandoffStatus = (typeof STATUS_VALUES)[number];

export interface HandoffTicket {
  id: string;
  phone: string;
  thread_id: string | null;
  booking_code: string | null;
  booking_summary: string;
  booking_context: Record<string, unknown> | null;
  frustration_kind: string;
  frustration_score: number;
  trigger_message: string;
  status: HandoffStatus;
  assigned_to: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const listInput = z
  .object({
    status: z.enum(["all", ...STATUS_VALUES]).optional().default("all"),
    limit: z.number().int().min(1).max(200).optional().default(100),
  })
  .optional()
  .default({});

export const listHandoffTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (k: string, v: string) => any;
          order: (k: string, o: { ascending: boolean }) => any;
          limit: (n: number) => any;
        };
      };
    };
    let query = (supabase as any)
      .from("handoff_tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") {
      query = query.eq("status", data.status);
    }
    const { data: rows, error } = await query;
    if (error) throw error;
    return { tickets: (rows ?? []) as HandoffTicket[] };
  });

const updateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUS_VALUES),
  resolutionNote: z.string().max(2000).optional(),
});

export const updateHandoffTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    const update: Record<string, unknown> = {
      status: data.status,
      assigned_to: context.userId,
    };
    if (data.resolutionNote !== undefined) {
      update.resolution_note = data.resolutionNote;
    }
    const { data: row, error } = await (context.supabase as any)
      .from("handoff_tickets")
      .update(update)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    return { ticket: row as HandoffTicket };
  });
