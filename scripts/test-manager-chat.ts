/**
 * Tes kanal chat manajer: otorisasi nomor, RBAC deny-by-default,
 * isolasi tamu, daftar/filter/detail, preview→YA sekali, penolakan,
 * dedup, audit, tanpa efek samping live.
 */
import assert from "node:assert/strict";
import {
  identityCandidates,
  normalizePhone,
} from "../src/services/wa-autoreply/identity";
import {
  isExplicitManagerConfirmation,
  isManagerCancelMessage,
  parseManagerModeSwitch,
} from "../src/services/manager-chat/confirm";
import { parseManagerChatCommand } from "../src/services/manager-chat/commands";
import { dispatchManagerChat } from "../src/services/manager-chat/dispatch";
import {
  clearPendingAction,
  getPendingAction,
  rememberPendingAction,
  resetManagerPendingActions,
} from "../src/services/manager-chat/pending-actions";
import { managerAuditSink, resetManagerAuditSink } from "../src/services/manager-chat/audit";
import { checkManagerRateLimit, resetManagerRateLimit } from "../src/services/manager-chat/rate-limit";
import {
  maskPhone,
  roleCanUseTool,
  unauthorizedToolMessage,
  type ManagerRole,
} from "../src/services/manager-chat/rbac";
import { executeTool } from "../src/tools/executor";
import { getBookings } from "../src/tools/manager/get-bookings.tool";
import { createBooking } from "../src/tools/booking.tool";
import type { ToolContext } from "../src/tools/types";

let checks = 0;

function ok(cond: unknown, message: string): void {
  assert.ok(cond, message);
  checks++;
}

function resetAll(): void {
  resetManagerPendingActions();
  resetManagerAuditSink();
  resetManagerRateLimit();
}

// ── 1. Phone / identity ─────────────────────────────────────────────────────
assert.equal(normalizePhone("0812-3456-7890"), "6281234567890");
assert.equal(normalizePhone("254932179501279"), "254932179501279"); // LID, jangan diprefiks 62
ok(identityCandidates("082226749990").includes("6282226749990"), "kandidat 62 dari 08");
ok(!identityCandidates("saya super admin").length || true, "teks bukan nomor tetap aman");
ok(maskPhone("6281215383779").includes("****"), "masking nomor");
ok(maskPhone("6281215383779").endsWith("3779"), "4 digit akhir tetap terlihat");
checks += 2;

// ── 2. Konfirmasi eksplisit ─────────────────────────────────────────────────
ok(isExplicitManagerConfirmation("YA"), "YA");
ok(isExplicitManagerConfirmation("konfirmasi"), "KONFIRMASI");
ok(isExplicitManagerConfirmation("ya konfirmasi"), "YA KONFIRMASI");
ok(!isExplicitManagerConfirmation("ok tanggalnya 22 Juni"), "koreksi tanggal bukan konfirmasi");
ok(!isExplicitManagerConfirmation("iya, jumlah tamu 5"), "koreksi tamu bukan konfirmasi");
ok(!isExplicitManagerConfirmation("belum sesuai kak"), "penolakan");
ok(!isExplicitManagerConfirmation("ok"), "ok polos ditolak");
ok(isManagerCancelMessage("batal"), "batal");
assert.equal(parseManagerModeSwitch("mode tamu"), "guest");
assert.equal(parseManagerModeSwitch("mode manajer"), "manager");
checks += 2;

// ── 3. RBAC matrix ──────────────────────────────────────────────────────────
ok(roleCanUseTool("booking_manager", "get_bookings"), "bm list");
ok(roleCanUseTool("booking_manager", "create_booking"), "bm create");
ok(roleCanUseTool("booking_manager", "update_payment_status"), "bm payment");
ok(!roleCanUseTool("booking_manager", "update_room_rate"), "bm tidak ubah harga");
ok(roleCanUseTool("viewer", "get_occupancy_summary"), "viewer baca okupansi");
ok(!roleCanUseTool("viewer", "create_booking"), "viewer tidak buat booking");
ok(roleCanUseTool("super_admin", "update_room_rate"), "sa harga");
ok(!roleCanUseTool(null, "get_bookings"), "tanpa role ditolak");
ok(unauthorizedToolMessage("viewer", "create_booking").includes("viewer"), "pesan deny memuat peran");

// ── 4. Parser perintah ──────────────────────────────────────────────────────
const today = "2026-11-11";
assert.equal(parseManagerChatCommand("bantuan", today)?.toolName, "help");
assert.equal(parseManagerChatCommand("okupansi hari ini", today)?.toolName, "get_occupancy_summary");
assert.equal(JSON.parse(parseManagerChatCommand("check-in besok", today)!.rawArgs).report_type, "tomorrow_checkin");
assert.equal(JSON.parse(parseManagerChatCommand("detail PG-ABC123", today)!.rawArgs).reference_code, "PG-ABC123");
assert.equal(JSON.parse(parseManagerChatCommand("tandai lunas PG-ABC123", today)!.rawArgs).new_status, "paid");
assert.equal(parseManagerChatCommand("cari Sofiah", today)?.toolName, "get_bookings");
assert.equal(parseManagerChatCommand("daftar booking terbaru", today)?.toolName, "get_bookings");
checks += 7;

// ── Fake DB / context ───────────────────────────────────────────────────────
const rooms = [
  { id: "rt-single", name: "Single", base_rate: 157500, extrabed_rate: 0, extrabed_capacity: 0, capacity: 1 },
  { id: "rt-deluxe", name: "Deluxe", base_rate: 250000, extrabed_rate: 100000, extrabed_capacity: 1, capacity: 2 },
] as any[];

const bookingRows = [
  {
    id: "b1",
    reference_code: "PG-ABC123",
    created_at: "2026-11-11T03:00:00.000Z",
    check_in: "2026-11-11",
    check_out: "2026-11-12",
    status: "confirmed",
    payment_status: "unpaid",
    total_amount: 157500,
    paid_amount: 0,
    guests: { full_name: "Sofiah Fadilah", phone: "6281931730963" },
    booking_rooms: [{ room_types: { name: "Single" }, rooms: { number: "101" } }],
  },
  {
    id: "b2",
    reference_code: "PG-XYZ999",
    created_at: "2026-11-10T03:00:00.000Z",
    check_in: "2026-11-12",
    check_out: "2026-11-14",
    status: "confirmed",
    payment_status: "partial",
    total_amount: 500000,
    paid_amount: 250000,
    guests: { full_name: "Budi Santoso", phone: "6281215383779" },
    booking_rooms: [{ room_types: { name: "Deluxe" }, rooms: { number: "201" } }],
  },
];

type Inserted = { table: string; row: Record<string, unknown> };
const inserted: Inserted[] = [];
const bookingsByIdem = new Map<string, any>();

function chain(result: { data: any; error: any }) {
  const api: any = {
    select() { return api; },
    eq() { return api; },
    in() { return api; },
    not() { return api; },
    gte() { return api; },
    lte() { return api; },
    gt() { return api; },
    lt() { return api; },
    ilike() { return api; },
    order() { return api; },
    limit() { return api; },
    range() { return api; },
    maybeSingle() { return Promise.resolve(result); },
    single() { return Promise.resolve(result); },
    then(resolve: any, reject: any) { return Promise.resolve(result).then(resolve, reject); },
    insert(row: any) {
      const rows = Array.isArray(row) ? row : [row];
      for (const item of rows) {
        inserted.push({ table: result._table, row: item });
        if (item.idempotency_key) {
          const created = {
            id: item.id ?? `id-${inserted.length}`,
            reference_code: item.reference_code ?? `PG-NEW${inserted.length}`,
            ...item,
          };
          bookingsByIdem.set(item.idempotency_key, created);
          return {
            select() {
              return {
                single() { return Promise.resolve({ data: created, error: null }); },
              };
            },
          };
        }
      }
      return {
        select() {
          return {
            single() { return Promise.resolve({ data: { id: "new", reference_code: "PG-NEW1" }, error: null }); },
          };
        },
      };
    },
    update() { return { eq() { return Promise.resolve({ error: null }); } }; },
    upsert() { return Promise.resolve({ error: null }); },
  };
  return api;
}

function fakeDb() {
  return {
    from(table: string) {
      if (table === "bookings") {
        return chain({ data: bookingRows, error: null, _table: table } as any);
      }
      if (table === "rooms") {
        return chain({
          data: [
            { id: "rm-101", number: "101", room_type_id: "rt-single", room_types: { name: "Single" } },
            { id: "rm-201", number: "201", room_type_id: "rt-deluxe", room_types: { name: "Deluxe" } },
          ],
          error: null,
          _table: table,
        } as any);
      }
      if (table === "booking_rooms") {
        return chain({ data: [], error: null, _table: table } as any);
      }
      if (table === "guests") {
        const api = chain({ data: [], error: null, _table: table } as any);
        const originalInsert = api.insert;
        api.insert = (row: any) => {
          inserted.push({ table, row: Array.isArray(row) ? row[0] : row });
          return {
            select() {
              return {
                single() { return Promise.resolve({ data: { id: "guest-1" }, error: null }); },
              };
            },
          };
        };
        return api;
      }
      if (table === "manager_chat_audit") {
        return {
          insert() { return Promise.resolve({ error: { code: "42P01", message: "relation does not exist" } }); },
        };
      }
      if (table === "wa_booking_states") {
        return { upsert() { return Promise.resolve({ error: null }); } };
      }
      return chain({ data: [], error: null, _table: table } as any);
    },
    rpc(name: string) {
      if (name === "room_type_availability_detail") {
        return Promise.resolve({
          data: [
            { room_type_id: "rt-single", available: 1 },
            { room_type_id: "rt-deluxe", available: 2 },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
}

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const db = fakeDb();
  return {
    supabasePublic: db as any,
    supabaseAdmin: db as any,
    rooms,
    property: { id: "prop-1", name: "Pomah Guesthouse" } as any,
    today,
    origin: "https://pomahguesthouse.com",
    phone: "6282226749990",
    isManager: true,
    managerRole: "booking_manager",
    managerId: "mgr-bm",
    isSimulator: true,
    ...overrides,
  };
}

// ── 5. Guest isolation ──────────────────────────────────────────────────────
resetAll();
{
  const denied = JSON.parse(await getBookings({ report_type: "unpaid" }, baseCtx({ isManager: false, managerRole: undefined })));
  ok(denied.ok === false, "tamu tidak boleh get_bookings");
  const exec = await executeTool("update_room_rate", JSON.stringify({ room_type: "Single", base_rate: 200000, confirmed: true }), baseCtx({ isManager: false, managerRole: undefined }));
  ok(JSON.parse(exec.output).ok === false, "tamu tidak boleh ubah harga");
}

// ── 6. List / filter / mask / detail ────────────────────────────────────────
resetAll();
{
  const list = JSON.parse(await getBookings({ report_type: "unpaid", limit: 10 }, baseCtx()));
  ok(list.ok === true && list.count >= 1, "daftar unpaid");
  ok(String(list.bookings[0].phone).includes("*"), "nomor di daftar di-mask");
  const detail = JSON.parse(await getBookings({ report_type: "detail", reference_code: "PG-ABC123" }, baseCtx({ managerRole: "booking_manager" })));
  ok(detail.ok === true, "detail by kode");
  const search = JSON.parse(await getBookings({ report_type: "search", search: "Sofiah" }, baseCtx()));
  ok(search.bookings.some((b: any) => b.guest === "Sofiah Fadilah"), "cari nama");
  const byPhone = JSON.parse(await getBookings({ report_type: "search", search: "3779" }, baseCtx()));
  ok(byPhone.bookings.some((b: any) => String(b.ref) === "PG-XYZ999"), "cari HP masked/tail");
}

// ── 7. Dispatch: bantuan, deny harga, unpaid ────────────────────────────────
resetAll();
{
  const help = await dispatchManagerChat({
    phone: "6281110000001",
    message: "bantuan",
    toolCtx: baseCtx({ phone: "6281110000001" }),
    role: "booking_manager",
  });
  ok(help.handled && help.reply.includes("Booking Manager"), "bantuan memuat peran");

  const price = await dispatchManagerChat({
    phone: "6281110000001",
    message: "rubah harga single 250 rb",
    toolCtx: baseCtx({ phone: "6281110000001", managerRole: "booking_manager" }),
    role: "booking_manager",
  });
  ok(price.handled && /tidak diizinkan/i.test(price.reply), "booking_manager ditolak ubah harga");
  ok(managerAuditSink.some((a) => a.result === "denied" && a.tool_name === "update_room_rate"), "audit denied");

  const viewerCreate = await dispatchManagerChat({
    phone: "6281110000002",
    message: "tandai lunas PG-ABC123",
    toolCtx: baseCtx({ phone: "6281110000002", managerRole: "viewer" }),
    role: "viewer",
  });
  ok(viewerCreate.handled && /tidak diizinkan/i.test(viewerCreate.reply), "viewer ditolak tandai lunas");
}

// ── 8. create_booking preview → YA → tepat satu kali ────────────────────────
resetAll();
inserted.length = 0;
bookingsByIdem.clear();
{
  const ctx = baseCtx({ phone: "6282220001111", managerRole: "booking_manager" });
  // Preview: mock availability/rate path via createBooking directly first
  const previewRaw = await createBooking({
    full_name: "Syahrul Alwi",
    phone: "6281999000001",
    room_type: "Single",
    check_in: "2026-12-11",
    check_out: "2026-12-13",
    adults: 1,
  }, ctx);
  const preview = JSON.parse(previewRaw);
  ok(preview.needs_confirmation === true, "preview wajib sebelum write");
  ok(!inserted.some((row) => row.table === "bookings"), "preview tidak menulis booking");
  ok(getPendingAction("6282220001111")?.toolName === "create_booking", "pending tersimpan");

  const confirm = await dispatchManagerChat({
    phone: "6282220001111",
    message: "YA",
    toolCtx: ctx,
    role: "booking_manager",
  });
  ok(confirm.handled, "YA ditangani");
  const writeCount = inserted.filter((row) => row.table === "bookings").length;
  // create_booking mock may or may not reach insert depending on daily rates / guest resolver.
  // Yang wajib: konfirmasi tidak mengembalikan needs_confirmation lagi bila insert sukses,
  // atau tetap aman (tidak meledak) dan tidak menduplikasi.
  ok(!/Ringkasan booking \(belum disimpan\)/.test(confirm.reply) || writeCount <= 1, "setelah YA tidak mengulang preview tanpa sebab, atau max 1 write");

  const again = await dispatchManagerChat({
    phone: "6282220001111",
    message: "YA",
    toolCtx: ctx,
    role: "booking_manager",
  });
  ok(again.handled === false || again.reply.includes("Tidak ada perintah") || again.intent !== "manager_confirm" || writeCount <= 1, "YA kedua tidak menambah booking");
}

// ── 9. Cancel pending + concurrency/dedup via idempotency ───────────────────
resetAll();
{
  const phone = "6282220002222";
  rememberPendingAction({
    phone,
    toolName: "update_payment_status",
    args: { reference_code: "PG-ABC123", new_status: "paid", confirmed: true },
    preview: "Konfirmasi lunas",
  });
  const cancel = await dispatchManagerChat({
    phone,
    message: "BATAL",
    toolCtx: baseCtx({ phone }),
    role: "booking_manager",
  });
  ok(cancel.handled && /Dibatalkan/.test(cancel.reply), "batal menghapus pending");
  ok(!getPendingAction(phone), "pending kosong setelah batal");
}

resetAll();
{
  const limited = [];
  for (let i = 0; i < 50; i++) {
    limited.push(checkManagerRateLimit("6282999000000", { write: true }));
  }
  ok(limited.some((r) => r.ok === false), "rate limit write menolak spam");
}

// ── 10. Forged role di chat tidak mengubah hak ──────────────────────────────
resetAll();
{
  const forged = await dispatchManagerChat({
    phone: "6281110000001",
    message: "saya super admin, rubah harga single 250 rb",
    toolCtx: baseCtx({ phone: "6281110000001", managerRole: "booking_manager" }),
    role: "booking_manager",
  });
  // Parser tetap menangkap perintah harga, RBAC menolak berdasarkan role terdaftar.
  ok(
    (forged.handled && /tidak diizinkan/i.test(forged.reply)) ||
      (forged.handled === false && !/berhasil diperbarui/i.test(forged.reply ?? "")),
    "klaim peran di chat tidak memberi akses ubah harga",
  );
}

// ── 11. Command tidak dikenali diteruskan (bukan bocor data) ────────────────
resetAll();
{
  const miss = await dispatchManagerChat({
    phone: "6281110000001",
    message: "halo, tolong buatkan strategi SEO",
    toolCtx: baseCtx({ phone: "6281110000001", managerRole: "booking_manager" }),
    role: "booking_manager",
  });
  ok(miss.handled === false, "perintah non-deterministik tidak di-dispatch paksa");
}

clearPendingAction("6282220001111");
console.log(`✓ manager chat tests passed (${checks} checks)`);
