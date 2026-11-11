/**
 * Audit log aksi manajer di kanal WhatsApp.
 *
 * Menulis ke `manager_chat_audit` bila tabelnya sudah ada (lihat
 * supabase/manual/20261111_manager_chat_audit.sql). Jika tabel belum
 * diterapkan, pencatatan tetap ada di sink memori untuk tes / proses
 * berjalan, tanpa menggagalkan aksi.
 */

import type { ManagerRole } from "./rbac";
import { maskPhone } from "./rbac";

export interface ManagerAuditRecord {
  at: string;
  actor_phone: string;
  actor_phone_masked: string;
  actor_role: ManagerRole | null;
  actor_id?: string | null;
  tool_name: string;
  command?: string | null;
  args_summary?: Record<string, unknown> | null;
  before_summary?: Record<string, unknown> | null;
  after_summary?: Record<string, unknown> | null;
  result: "ok" | "denied" | "error" | "needs_confirmation" | "rate_limited";
  error?: string | null;
  idempotency_key?: string | null;
}

/** Sink in-memory — dikosongkan di tes. Tidak untuk produksi jangka panjang. */
export const managerAuditSink: ManagerAuditRecord[] = [];

export function resetManagerAuditSink(): void {
  managerAuditSink.length = 0;
}

function safeText(value: unknown, max = 240): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function summarizeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (args[key] !== undefined) out[key] = args[key];
    }
    return out;
  };
  switch (toolName) {
    case "create_booking":
      return pick("full_name", "check_in", "check_out", "room_type", "rooms", "adults", "extra_beds");
    case "get_bookings":
      return pick("report_type", "search", "reference_code", "date", "date_from", "date_to", "status", "payment_status", "limit", "offset");
    case "update_payment_status":
      return pick("reference_code", "new_status");
    case "update_booking_status":
      return pick("reference_code", "status");
    case "delete_booking":
      return pick("reference_code", "guest_name", "mode");
    case "send_invoice":
    case "send_brochure_to_guest":
    case "reply_to_guest":
      return {
        ...pick("reference_code", "send_to_guest"),
        guest_phone: args.guest_phone ? maskPhone(args.guest_phone) : undefined,
      };
    case "update_room_rate":
    case "set_daily_room_rate":
    case "delete_daily_room_rate":
      return pick("room_type", "base_rate", "extrabed_rate", "from_date", "to_date", "rate");
    default:
      return { keys: Object.keys(args).slice(0, 12) };
  }
}

export async function logManagerAction(
  db: { from: (table: string) => any } | null | undefined,
  input: Omit<ManagerAuditRecord, "at" | "actor_phone_masked"> & { actor_phone: string },
): Promise<ManagerAuditRecord> {
  const record: ManagerAuditRecord = {
    ...input,
    at: new Date().toISOString(),
    actor_phone_masked: maskPhone(input.actor_phone),
    command: safeText(input.command, 280),
    error: safeText(input.error, 400),
  };
  managerAuditSink.push(record);

  if (!db) return record;
  try {
    const { error } = await db.from("manager_chat_audit").insert({
      actor_phone: record.actor_phone,
      actor_role: record.actor_role,
      actor_id: record.actor_id ?? null,
      tool_name: record.tool_name,
      command: record.command ?? null,
      args_summary: record.args_summary ?? null,
      before_summary: record.before_summary ?? null,
      after_summary: record.after_summary ?? null,
      result: record.result,
      error: record.error ?? null,
      idempotency_key: record.idempotency_key ?? null,
    });
    if (error && !isMissingTable(error)) {
      console.warn("[manager-chat] audit insert failed:", error.message ?? error);
    }
  } catch (err) {
    if (!isMissingTable(err)) {
      console.warn("[manager-chat] audit insert threw:", err);
    }
  }
  return record;
}

function isMissingTable(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error
    ? String((error as any).message)
    : String(error ?? "");
  return code === "42P01" || /manager_chat_audit/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}
