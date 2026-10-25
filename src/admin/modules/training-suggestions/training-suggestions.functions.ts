import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  approvalBlockers,
  buildSuggestions,
  isStaffReply,
  type CaptureMessage,
} from "@/services/training-suggestions/capture";

/**
 * Usulan training dari balasan staf WhatsApp. Klien Supabase milik user →
 * RLS berlaku (baca/pindai: staf; setujui/tolak: admin). Tidak pernah
 * mengaktifkan data tanpa klik "Setujui".
 */

const SCAN_DAYS = 14;

/** Pindai balasan staf terbaru dan buat usulan pending baru (idempoten). */
export const scanStaffReplies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const since = new Date(Date.now() - SCAN_DAYS * 86400_000).toISOString();
    const { data: outs, error } = await db
      .from("whatsapp_messages")
      .select("id, thread_id, direction, body, sent_at, metadata")
      .eq("direction", "out")
      .gte("sent_at", since)
      .or("metadata->>source.eq.admin_inbox,metadata->>source.eq.whatsapp_native")
      .order("sent_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const staff = ((outs ?? []) as CaptureMessage[]).filter(isStaffReply);
    const threadIds = [...new Set(staff.map((m) => m.thread_id))].slice(0, 80);
    if (!threadIds.length) return { created: 0, scanned: 0 };

    const windowStart = new Date(Date.now() - (SCAN_DAYS + 1) * 86400_000).toISOString();
    const [msgs, threads] = await Promise.all([
      db
        .from("whatsapp_messages")
        .select("id, thread_id, direction, body, sent_at, metadata")
        .in("thread_id", threadIds)
        .gte("sent_at", windowStart)
        .order("sent_at", { ascending: true })
        .limit(5000),
      db.from("whatsapp_threads").select("id, display_name").in("id", threadIds),
    ]);
    if (msgs.error) throw msgs.error;
    if (threads.error) throw threads.error;
    const nameById = new Map<string, string | null>(
      (threads.data ?? []).map((t: { id: string; display_name: string | null }) => [t.id, t.display_name]),
    );
    const byThread = new Map<string, CaptureMessage[]>();
    for (const m of (msgs.data ?? []) as CaptureMessage[]) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const drafts = [...byThread.entries()].flatMap(([tid, arr]) => buildSuggestions(arr, nameById.get(tid)));
    if (!drafts.length) return { created: 0, scanned: staff.length };

    // Dedupe: pesan sumber yang sama atau pasangan tanya-jawab identik.
    const keys = [...new Set(drafts.map((d) => d.dedupe_key))];
    const { data: existing, error: e2 } = await db
      .from("chatbot_training_suggestions")
      .select("dedupe_key, source_message_id")
      .or(`dedupe_key.in.(${keys.map((k) => `"${k}"`).join(",")}),source_message_id.in.(${drafts.map((d) => d.source_message_id).join(",")})`);
    if (e2) throw e2;
    const seenKey = new Set((existing ?? []).map((r: any) => r.dedupe_key));
    const seenSrc = new Set((existing ?? []).map((r: any) => r.source_message_id));
    const fresh = drafts.filter((d) => {
      if (seenKey.has(d.dedupe_key) || seenSrc.has(d.source_message_id)) return false;
      seenKey.add(d.dedupe_key);
      return true;
    });
    if (!fresh.length) return { created: 0, scanned: staff.length };
    const { error: e3 } = await db
      .from("chatbot_training_suggestions")
      .upsert(fresh.map((d) => ({ ...d, status: "pending" })), { onConflict: "source_message_id", ignoreDuplicates: true });
    if (e3) throw e3;
    return { created: fresh.length, scanned: staff.length };
  });

export const listTrainingSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ status: z.enum(["pending", "approved", "rejected"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("chatbot_training_suggestions")
      .select("id, thread_id, guest_question, staff_answer, flags, status, created_at, reviewed_at, training_example_id")
      .eq("status", data.status)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { rows: (rows ?? []) as Array<{
      id: string;
      thread_id: string | null;
      guest_question: string;
      staff_answer: string;
      flags: string[];
      status: string;
      created_at: string;
      reviewed_at: string | null;
      training_example_id: string | null;
    }> };
  });

const reviewShape = z.object({
  id: z.string().uuid(),
  guestQuestion: z.string().trim().min(1).max(2000),
  staffAnswer: z.string().trim().min(1).max(4000),
});

export const approveTrainingSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => reviewShape.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const blockers = approvalBlockers(data.guestQuestion, data.staffAnswer);
    if (blockers.length) throw new Error(blockers.join(" "));
    const { data: row, error: e1 } = await db
      .from("chatbot_training_suggestions")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (e1) throw e1;
    if (!row) throw new Error("Usulan tidak ditemukan");
    if (row.status !== "pending") throw new Error("Usulan sudah ditinjau");

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const exampleId = `tr-staff-${data.id.slice(0, 8)}-${day}`;
    const { error: e2 } = await db.from("chatbot_training_examples").insert({
      id: exampleId,
      user_message: data.guestQuestion,
      ideal_assistant_response: data.staffAnswer,
      intent: "staff_reply",
      stage: "general",
      training_type: "staff_reply",
      language: "id-ID",
      is_active: true, // embedding diisi cron 5 menit
    });
    if (e2) throw e2;
    const { error: e3 } = await db
      .from("chatbot_training_suggestions")
      .update({
        status: "approved",
        guest_question: data.guestQuestion,
        staff_answer: data.staffAnswer,
        training_example_id: exampleId,
        reviewed_by: context.userId ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "pending");
    if (e3) throw e3;
    return { ok: true, exampleId };
  });

export const rejectTrainingSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db
      .from("chatbot_training_suggestions")
      .update({ status: "rejected", reviewed_by: context.userId ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) throw error;
    return { ok: true };
  });
