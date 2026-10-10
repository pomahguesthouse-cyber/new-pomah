/**
 * Alert WhatsApp booking baru untuk staf.
 *
 * Template Utility (disetujui Meta) supaya pesan tetap sampai di luar jendela
 * 24 jam. Parameter body, urut:
 *   {{1}} kode booking
 *   {{2}} nama tamu
 *   {{3}} kamar, mis. "2x Deluxe"
 *   {{4}} check-in
 *   {{5}} check-out
 *   {{6}} jumlah malam
 *   {{7}} total
 *   {{8}} DP / pembayaran
 *   {{9}} sisa
 *
 * Teks template di Meta (bahasa id, nama default `new_booking_alert`):
 *   Booking baru {{1}}
 *   Tamu: {{2}}
 *   Kamar: {{3}}
 *   Check-in: {{4}} | Check-out: {{5}} ({{6}} malam)
 *   Total: {{7}}
 *   DP/Pembayaran: {{8}}
 *   Sisa: {{9}}
 */
import { sanitizeTemplateParam } from "@/services/whatsapp-meta.service";

export const STAFF_BOOKING_TEMPLATE_NAME_DEFAULT = "new_booking_alert";
export const STAFF_BOOKING_TEMPLATE_LANG_DEFAULT = "id";

/** Batas tunggu di jalur booking. Sama dengan invoice (9 detik). */
export const STAFF_BOOKING_ALERT_TIMEOUT_MS = 9_000;

export const STAFF_ALERT_RECOVERY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const STAFF_ALERT_RECOVERY_MIN_AGE_MS = 2 * 60 * 1000;
/** 3 booking × retry WhatsApp tetap di bawah timeout pg_net 30 detik. */
export const STAFF_ALERT_RECOVERY_BATCH_LIMIT = 3;
export const STAFF_ALERT_MAX_ATTEMPTS = 3;

export const STAFF_ALERT_SUCCESS_STATUSES = ["sent", "delivered", "read"] as const;

export const STAFF_BOOKING_TEMPLATE_BODY =
  "Booking baru {{1}}\n" +
  "Tamu: {{2}}\n" +
  "Kamar: {{3}}\n" +
  "Check-in: {{4}} | Check-out: {{5}} ({{6}} malam)\n" +
  "Total: {{7}}\n" +
  "DP/Pembayaran: {{8}}\n" +
  "Sisa: {{9}}";

const WEEKDAY_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] as const;
const MONTH_SHORT_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;

const REENGAGEMENT_CODES = [131047, 131026, 470] as const;

export type StaffBookingSendMode = "template" | "text";

export interface StaffBookingTemplateConfig {
  name: string;
  lang: string;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Nama template dari env. Kosong eksplisit = tidak dikonfigurasi (teks bebas).
 * Tidak di-set sama sekali memakai default `new_booking_alert` / bahasa `id`.
 */
export function resolveStaffBookingTemplate(env: EnvLike = process.env): StaffBookingTemplateConfig | null {
  const rawName = env.WHATSAPP_STAFF_BOOKING_TEMPLATE_NAME;
  const name = (rawName === undefined ? STAFF_BOOKING_TEMPLATE_NAME_DEFAULT : rawName).trim();
  if (!name) return null;
  const rawLang = env.WHATSAPP_STAFF_BOOKING_TEMPLATE_LANG;
  const lang = (rawLang === undefined || rawLang.trim() === "" ? STAFF_BOOKING_TEMPLATE_LANG_DEFAULT : rawLang).trim();
  return { name, lang: lang || STAFF_BOOKING_TEMPLATE_LANG_DEFAULT };
}

/** Template terkonfigurasi → selalu template. Selain itu teks bebas. */
export function selectStaffBookingSendMode(env: EnvLike = process.env): StaffBookingSendMode {
  return resolveStaffBookingTemplate(env) ? "template" : "text";
}

export function staffAlertDedupeKey(bookingId: string, managerId: string): string {
  return `new_booking:${bookingId}:${managerId}`;
}

/** "Rp460.000" — tanpa spasi, pemisah ribuan titik. */
export function formatStaffRupiah(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = String(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}Rp${grouped}`;
}

/**
 * Tanggal kalender WIB: "Sab, 21 Nov 2026".
 * Kolom check-in/out adalah tanggal (bukan jam), jadi hari dihitung dari
 * tanggal itu sendiri — sama dengan kalender WIB.
 */
export function formatStaffDateWib(iso: string | null | undefined): string {
  const raw = String(iso ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "-";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "-";
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "-";
  return `${WEEKDAY_ID[dt.getUTCDay()]}, ${day} ${MONTH_SHORT_ID[month - 1]} ${year}`;
}

export function formatStaffNights(
  nights: number | null | undefined,
  checkIn?: string | null,
  checkOut?: string | null,
): string {
  const direct = Number(nights);
  if (nights != null && Number.isFinite(direct) && direct >= 0) return String(Math.round(direct));
  if (checkIn && checkOut) {
    const start = Date.parse(`${String(checkIn).slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${String(checkOut).slice(0, 10)}T00:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return String(Math.round((end - start) / 86_400_000));
    }
  }
  return "-";
}

interface RoomTypeRef {
  name?: string | null;
}

export interface StaffBookingRoomRow {
  room_types?: RoomTypeRef | RoomTypeRef[] | null;
}

/** "2x Deluxe". Awalan "2x " di nama tipe tidak digandakan. */
export function formatStaffRoomLabel(count: number, rawName: string): string {
  const stripped = rawName.trim().replace(/^\d+\s*x\s+/i, "").trim();
  const name = stripped || "Kamar";
  const qty = Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
  return `${qty}x ${name}`;
}

export function formatStaffRooms(bookingRooms: StaffBookingRoomRow[] | null | undefined): string {
  const counts = new Map<string, number>();
  for (const row of bookingRooms ?? []) {
    const roomType = Array.isArray(row?.room_types) ? row.room_types[0] : row?.room_types;
    const raw = String(roomType?.name ?? "").trim();
    const base = raw.replace(/^\d+\s*x\s+/i, "").trim() || "Kamar";
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  if (counts.size === 0) return "-";
  return Array.from(counts.entries())
    .map(([name, count]) => formatStaffRoomLabel(count, name))
    .join(", ");
}

export interface StaffPaymentInput {
  totalAmount?: number | null;
  paidAmount?: number | null;
  nights?: number | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  /** Nominal yang sudah tercatat. Dipakai bila ada; `paidAmount` tetap dihormati. */
  payments?: Array<{ amount?: number | null; status?: string | null }> | null;
}

const VOID_PAYMENT = new Set(["failed", "void", "cancelled", "canceled", "refunded"]);

export function resolveStaffPaidAmount(input: StaffPaymentInput): number {
  const field = Number(input.paidAmount);
  const fromField = Number.isFinite(field) ? Math.max(0, field) : 0;
  let fromPayments: number | null = null;
  if (input.payments && input.payments.length > 0) {
    let sum = 0;
    let any = false;
    for (const row of input.payments) {
      const status = String(row.status ?? "paid").toLowerCase();
      if (VOID_PAYMENT.has(status)) continue;
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      sum += amount;
      any = true;
    }
    if (any) fromPayments = Math.max(0, sum);
  }
  let paid = fromPayments == null ? fromField : Math.max(fromField, fromPayments);
  const total = Number(input.totalAmount);
  const status = String(input.paymentStatus ?? "").toLowerCase();
  if (status === "paid" && paid <= 0 && Number.isFinite(total) && total > 0) paid = total;
  return paid;
}

function isExplicitTransfer(method: string): boolean {
  return method === "transfer" || method === "bank_transfer" || method === "bank";
}

function isMarkedPayAtCheckin(method: string): boolean {
  if (!method) return false;
  if (method === "onsite" || method === "cash" || method === "pay_at_checkin" || method === "bayar_di_tempat") {
    return true;
  }
  return /tempat|check-?in|onsite|cash/.test(method);
}

/**
 * Baris DP/pembayaran, satu kalimat pendek.
 * 1 malam + belum bayar = "Bayar di tempat" bila data menandai kebijakan itu
 * (malam < 2 dan bukan transfer). 2+ malam yang belum lunas DP 50% menyebut
 * nominal DP hanya bila totalnya ada.
 */
export function formatStaffPaymentLine(input: StaffPaymentInput): string {
  const totalRaw = Number(input.totalAmount);
  const total = Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : 0;
  const paid = resolveStaffPaidAmount(input);
  const nightsRaw = Number(input.nights);
  const nights = Number.isFinite(nightsRaw) ? nightsRaw : 0;
  const method = String(input.paymentMethod ?? "").trim().toLowerCase();
  const status = String(input.paymentStatus ?? "").toLowerCase();

  // 1 malam tanpa transfer = bayar di tempat (kebijakan, atau method onsite/cash).
  // Method lain yang eksplisit (bukan kosong) tetap "Belum bayar".
  if (paid <= 0 && nights > 0 && nights < 2 && !isExplicitTransfer(method)) {
    if (isMarkedPayAtCheckin(method) || method === "") return "Bayar di tempat";
  }

  if (paid <= 0 && nights >= 2 && total > 0) {
    return `DP 50% ${formatStaffRupiah(Math.round(total * 0.5))} belum dibayar`;
  }

  if (paid <= 0) return "Belum bayar";

  if (status === "paid" || (total > 0 && paid >= total - 0.5)) return formatStaffRupiah(paid);

  if (nights >= 2 && total > 0) {
    const dp = Math.round(total * 0.5);
    if (paid < dp - 0.5) {
      return `${formatStaffRupiah(paid)} (DP 50% ${formatStaffRupiah(dp)} belum lunas)`;
    }
  }
  return formatStaffRupiah(paid);
}

export function formatStaffRemaining(totalAmount: number | null | undefined, paidAmount: number): string {
  const totalRaw = Number(totalAmount);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  return formatStaffRupiah(Math.max(0, total - paidAmount));
}

export interface StaffBookingAlertInput extends StaffPaymentInput {
  referenceCode?: string | null;
  bookingId?: string | null;
  guestName?: string | null;
  rooms?: StaffBookingRoomRow[] | null;
  roomSummary?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
}

export interface StaffBookingAlertContent {
  params: string[];
  message: string;
}

function param(value: string): string {
  return sanitizeTemplateParam(value);
}

/** Parameter template + teks bebas (Total, DP/Pembayaran, Sisa; tanpa sumber). */
export function buildStaffBookingAlert(input: StaffBookingAlertInput): StaffBookingAlertContent {
  const code = param(String(input.referenceCode ?? input.bookingId ?? "").trim());
  const guest = param(String(input.guestName ?? "").trim());
  const rooms = param(input.roomSummary?.trim() || formatStaffRooms(input.rooms));
  const checkIn = param(formatStaffDateWib(input.checkIn));
  const checkOut = param(formatStaffDateWib(input.checkOut));
  const nights = param(formatStaffNights(input.nights, input.checkIn, input.checkOut));
  const paid = resolveStaffPaidAmount(input);
  const total = param(formatStaffRupiah(Number.isFinite(Number(input.totalAmount)) ? Number(input.totalAmount) : 0));
  const payment = param(formatStaffPaymentLine({ ...input, paidAmount: paid, payments: null }));
  const remaining = param(formatStaffRemaining(input.totalAmount, paid));
  const params = [code, guest, rooms, checkIn, checkOut, nights, total, payment, remaining];
  const message =
    "🏨 NEW BOOKING ALERT\n\n" +
    `Guest: ${guest}\n` +
    `Room: ${rooms}\n` +
    `Check-in: ${checkIn}\n` +
    `Check-out: ${checkOut}\n` +
    `Nights: ${nights}\n` +
    `Total: ${total}\n` +
    `DP/Pembayaran: ${payment}\n` +
    `Sisa: ${remaining}\n\n` +
    `Booking Code:\n${code}\n\n` +
    "Please review in Manager Dashboard.";
  return { params, message };
}

/** Pending 0 attempt yang sudah lewat dari kirim yang terputus. */
export function isCutOffPendingLog(
  row: { status?: string | null; attempts?: number | null; created_at?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!row || row.status !== "pending") return false;
  const attempts = Number(row.attempts);
  const count = Number.isFinite(attempts) ? attempts : 0;
  if (count !== 0) return false;
  const created = Date.parse(row.created_at ?? "");
  if (!Number.isFinite(created)) return true;
  return now - created >= STAFF_ALERT_RECOVERY_MIN_AGE_MS;
}

export interface StaffAlertRecoveryManager {
  id: string;
  phone?: string | null;
  is_active?: boolean | null;
  /** Sengaja tidak dipakai. Lihat TODO di getActiveManagers. */
  is_muted?: boolean | null;
}

export interface StaffAlertRecoveryLog {
  dedupe_key?: string | null;
  status?: string | null;
  attempts?: number | null;
  channel?: string | null;
}

export interface StaffAlertRecoveryBooking {
  id: string;
  status?: string | null;
  created_at: string;
}

export interface StaffAlertRecoveryTarget {
  bookingId: string;
  managerId: string;
  reason: "missing" | "pending_zero";
}

function inRecoveryWindow(createdAt: string, now: number): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const earliest = now - STAFF_ALERT_RECOVERY_LOOKBACK_MS;
  const latest = now - STAFF_ALERT_RECOVERY_MIN_AGE_MS;
  return created >= earliest && created <= latest;
}

/**
 * Booking non-batal, 2 menit–24 jam, ke pengelola aktif yang belum punya
 * baris sent/delivered/read. Pending 0 attempt ikut dicoba lagi.
 * Kunci dedupe tetap `new_booking:<booking>:<manager>`.
 */
export function selectStaffAlertRecoveryTargets(input: {
  bookings: StaffAlertRecoveryBooking[];
  managers: StaffAlertRecoveryManager[];
  logs: StaffAlertRecoveryLog[];
  now?: number;
}): StaffAlertRecoveryTarget[] {
  const now = input.now ?? Date.now();
  const managers = input.managers.filter((manager) => manager.is_active !== false && String(manager.phone ?? "").trim());
  const targets: StaffAlertRecoveryTarget[] = [];
  for (const booking of input.bookings) {
    if (String(booking.status ?? "") === "cancelled") continue;
    if (!inRecoveryWindow(booking.created_at, now)) continue;
    for (const manager of managers) {
      const key = staffAlertDedupeKey(booking.id, manager.id);
      const log = input.logs.find((row) => {
        if (row.dedupe_key !== key) return false;
        return !row.channel || row.channel === "wa";
      });
      if (!log) {
        targets.push({ bookingId: booking.id, managerId: manager.id, reason: "missing" });
        continue;
      }
      const status = String(log.status ?? "");
      if ((STAFF_ALERT_SUCCESS_STATUSES as readonly string[]).includes(status)) continue;
      const attempts = Number(log.attempts);
      const count = Number.isFinite(attempts) ? attempts : 0;
      if (count >= STAFF_ALERT_MAX_ATTEMPTS) continue;
      if (status === "failed") continue;
      if (status === "pending" && count === 0) {
        targets.push({ bookingId: booking.id, managerId: manager.id, reason: "pending_zero" });
      }
    }
  }
  return targets;
}

function asCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Kode 131047 / 131026 / 470 di payload status Meta, bila ada. */
export function findReengagementCode(errors: unknown): number | null {
  let found: number | null = null;
  const visit = (value: unknown, depth: number) => {
    if (found != null || depth > 8 || value == null) return;
    if (typeof value === "string") {
      for (const code of REENGAGEMENT_CODES) {
        if (new RegExp(`\\b${code}\\b`).test(value)) {
          found = code;
          return;
        }
      }
      return;
    }
    if (typeof value === "number") {
      if ((REENGAGEMENT_CODES as readonly number[]).includes(value)) found = value;
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "code" || key === "error_code" || key === "error_subcode") {
        const code = asCode(child);
        if (code != null && (REENGAGEMENT_CODES as readonly number[]).includes(code)) {
          found = code;
          return;
        }
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(errors, 0);
  return found;
}

export function formatMetaDeliveryFailure(errors: unknown): string {
  const code = findReengagementCode(errors);
  if (code != null) return `Meta ${code}: di luar jendela 24 jam`;
  let title = "";
  const visit = (value: unknown, depth: number) => {
    if (title || depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ["title", "message", "details"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        title = record[key].trim();
        return;
      }
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(errors, 0);
  if (title) return `Meta gagal: ${title}`.slice(0, 300);
  return "Meta melaporkan gagal kirim";
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export function decideNotificationLogStatusUpdate(
  row: { status?: string | null },
  incoming: { status: string; errors?: unknown },
): { status: string; error: string | null } | null {
  const next = incoming.status;
  if (next !== "sent" && next !== "delivered" && next !== "read" && next !== "failed") return null;
  const currentRank = STATUS_RANK[String(row.status ?? "")] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;
  if (nextRank <= currentRank) return null;
  if (next === "failed") return { status: "failed", error: formatMetaDeliveryFailure(incoming.errors) };
  return { status: next, error: null };
}

interface NotificationLogStatusRow {
  id: string;
  status: string;
  event_type?: string | null;
}

interface NotificationLogWriter {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{
        data: NotificationLogStatusRow[] | null;
        error: { message: string } | null;
      }>;
    };
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Samakan `notification_logs` dengan status webhook Meta, dicocokkan lewat wamid
 * (`provider_message_id`). Tidak menurunkan sent → delivered → read.
 * Gagal 131047/131026/470 menulis alasan di kolom error.
 */
export async function applyNotificationLogDeliveryStatus(
  db: NotificationLogWriter,
  input: { wamid: string; status: string; errors?: unknown },
): Promise<{ updated: number }> {
  const wamid = input.wamid.trim();
  if (!wamid) return { updated: 0 };
  const { data, error } = await db
    .from("notification_logs")
    .select("id, status, event_type")
    .eq("provider_message_id", wamid);
  if (error) throw new Error(error.message);
  let updated = 0;
  for (const row of data ?? []) {
    const decision = decideNotificationLogStatusUpdate(row, input);
    if (!decision) continue;
    const { error: updateError } = await db
      .from("notification_logs")
      .update({ status: decision.status, error: decision.error })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    updated += 1;
  }
  return { updated };
}
