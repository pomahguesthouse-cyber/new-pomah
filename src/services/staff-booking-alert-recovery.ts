import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyNewBooking } from "@/services/manager-notifier.service";
import {
  STAFF_ALERT_RECOVERY_BATCH_LIMIT,
  STAFF_ALERT_RECOVERY_LOOKBACK_MS,
  STAFF_ALERT_RECOVERY_MIN_AGE_MS,
  selectStaffAlertRecoveryTargets,
  type StaffAlertRecoveryBooking,
  type StaffAlertRecoveryLog,
  type StaffAlertRecoveryManager,
} from "@/services/staff-booking-alert";

/**
 * Jaring pengaman alert WhatsApp booking baru ke staf.
 *
 * Jalur admin/website/bot dulu menitipkan notifyNewBooking ke waitUntil.
 * Worker memutus pekerjaan itu, jadi tidak ada baris log, atau baris
 * `pending` dengan 0 attempt. Cron ini mengirim untuk booking non-batal
 * berusia 2 menit–24 jam yang pengelola aktifnya belum punya log
 * sent/delivered/read, dan mengulang baris pending 0 attempt.
 * Dedupe `new_booking:<booking>:<manager>` tetap di notifyNewBooking.
 */

export interface StaffAlertRecoveryResult {
  ok: boolean;
  checked: number;
  eligible: number;
  invoked: number;
  failed: number;
  error?: string;
}

interface RecoveryQuery {
  select(columns: string): RecoveryFilter;
}

interface RecoveryFilter extends PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}> {
  neq(column: string, value: string): RecoveryFilter;
  gte(column: string, value: string): RecoveryFilter;
  lte(column: string, value: string): RecoveryFilter;
  eq(column: string, value: string): RecoveryFilter;
  in(column: string, values: string[]): RecoveryFilter;
  order(column: string, options: { ascending: boolean }): RecoveryFilter;
  limit(count: number): RecoveryFilter;
}

interface RecoveryDb {
  from(table: string): RecoveryQuery;
}

type Notify = (db: SupabaseClient, bookingId: string) => Promise<void>;

export async function recoverStaffBookingAlerts(
  supabase: RecoveryDb,
  deps?: {
    now?: () => number;
    notify?: Notify;
    limit?: number;
  },
): Promise<StaffAlertRecoveryResult> {
  const now = deps?.now?.() ?? Date.now();
  const limit = deps?.limit ?? STAFF_ALERT_RECOVERY_BATCH_LIMIT;
  const notify = deps?.notify ?? (notifyNewBooking as Notify);
  const windowStart = new Date(now - STAFF_ALERT_RECOVERY_LOOKBACK_MS).toISOString();
  const windowEnd = new Date(now - STAFF_ALERT_RECOVERY_MIN_AGE_MS).toISOString();

  const bookingsResult = await supabase
    .from("bookings")
    .select("id, status, created_at")
    .neq("status", "cancelled")
    .gte("created_at", windowStart)
    .lte("created_at", windowEnd)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (bookingsResult.error) {
    console.error("[recover-staff-booking-alerts] bookings query failed:", bookingsResult.error.message);
    return { ok: false, checked: 0, eligible: 0, invoked: 0, failed: 0, error: bookingsResult.error.message };
  }

  const bookings = (bookingsResult.data ?? []) as StaffAlertRecoveryBooking[];
  const managersResult = await supabase
    .from("property_managers")
    .select("id, name, phone, role, is_active, is_muted");
  if (managersResult.error) {
    console.error("[recover-staff-booking-alerts] managers query failed:", managersResult.error.message);
    return { ok: false, checked: bookings.length, eligible: 0, invoked: 0, failed: 0, error: managersResult.error.message };
  }
  const managers = (managersResult.data ?? []) as StaffAlertRecoveryManager[];

  let logs: StaffAlertRecoveryLog[] = [];
  const bookingIds = bookings.map((row) => row.id).filter(Boolean);
  if (bookingIds.length > 0) {
    const logsResult = await supabase
      .from("notification_logs")
      .select("dedupe_key, status, attempts, channel, event_type, related_id")
      .eq("event_type", "new_booking")
      .in("related_id", bookingIds);
    if (logsResult.error) {
      console.error("[recover-staff-booking-alerts] logs query failed:", logsResult.error.message);
      return {
        ok: false,
        checked: bookings.length,
        eligible: 0,
        invoked: 0,
        failed: 0,
        error: logsResult.error.message,
      };
    }
    logs = (logsResult.data ?? []) as StaffAlertRecoveryLog[];
  }

  const targets = selectStaffAlertRecoveryTargets({ bookings, managers, logs, now });
  const eligibleIds = [...new Set(targets.map((target) => target.bookingId))];
  let invoked = 0;
  let failed = 0;
  for (const bookingId of eligibleIds) {
    try {
      await notify(supabase as unknown as SupabaseClient, bookingId);
      invoked += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[recover-staff-booking-alerts] notify threw for ${bookingId.slice(0, 8)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (eligibleIds.length > 0) {
    console.info(
      `[recover-staff-booking-alerts] checked=${bookings.length} eligible=${eligibleIds.length} targets=${targets.length} invoked=${invoked} failed=${failed}`,
    );
  }

  return { ok: true, checked: bookings.length, eligible: eligibleIds.length, invoked, failed };
}
