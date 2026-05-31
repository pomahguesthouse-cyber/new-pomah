import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

export const listComplaints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("guest_complaints")
      .select("id, guest_name, phone, thread_id, booking_id, category, message, confidence, status, notes, created_at, updated_at, resolved_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

export const updateComplaintStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(STATUS),
        notes: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { status: data.status };
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.status === "RESOLVED" || data.status === "CLOSED") {
      patch.resolved_at = new Date().toISOString();
    }
    const { error } = await (context.supabase as any)
      .from("guest_complaints")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
