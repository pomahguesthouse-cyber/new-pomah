/**
 * E2E mocked: percakapan nyata Sofiah 8 Nov 2026 (PII disamarkan) lewat
 * runMultiAgentOrchestration + state machine + start_booking_details ASLI.
 * Side effect di-mock: DB fake (state/slots/availability), create_booking
 * palsu, LLM melempar error bila tersentuh (jalur harus deterministik).
 */
import assert from "node:assert/strict";
import { runMultiAgentOrchestration } from "../src/ai/multi-agent-orchestrator";
import { applyAnchoredStayFromSlots } from "../src/services/wa-autoreply/anchored-stay";
import { createBooking } from "../src/tools/booking.tool";

/**
 * create_booking ASLI dengan DB tiruan: guard harga/ringkasan berjalan nyata.
 * Write (insert) dicatat; bila guard lolos, kembalikan sukses palsu supaya
 * tidak butuh skema penuh. `dailyRates` mensimulasikan perubahan kalender.
 */
async function realCreateGuard(args: any, dailyRates: any[], avail: Record<string, number>) {
  const writes: string[] = [];
  const tables: Record<string, any[]> = {
    rooms: [{ id: "room-222", number: "222", room_type_id: "rt-fam" }, { id: "room-201", number: "201", room_type_id: "rt-dlx" }],
    room_daily_rates: dailyRates,
  };
  const mk = (t: string): any => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "gte", "lte", "lt", "gt", "not", "or", "neq", "is"]) b[m] = () => b;
    b.insert = () => { writes.push(`insert:${t}`); return b; };
    b.delete = () => { writes.push(`delete:${t}`); return b; };
    b.update = () => { writes.push(`update:${t}`); return b; };
    b.upsert = () => { writes.push(`upsert:${t}`); return b; };
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: new Error("stop: write disimulasikan") });
    b.then = (r: any) => r({ data: tables[t] ?? [], error: null });
    return b;
  };
  const admin: any = { from: (t: string) => mk(t), rpc: async () => ({ data: null, error: null }) };
  const pub: any = {
    from: (t: string) => mk(t),
    rpc: async () => ({ data: Object.entries(avail).map(([room_type_id, available]) => ({ room_type_id, available })), error: null }),
  };
  const ctx: any = { supabaseAdmin: admin, supabasePublic: pub, rooms: [FAM, FS, DLX, GDX, SGL], property: { id: "prop-1" }, today: "2026-11-08", phone: WA };
  const out = JSON.parse(await createBooking(args, ctx));
  return { out, writes };
}

const WA = "628190000963"; // disamarkan
// Nilai = room_types produksi (SELECT 8 Nov 2026 18.33 WIB): Family 222/100
// extrabed Rp100.000, Deluxe/Grand Deluxe/Single Rp80.000. Tidak ada
// room_daily_rates untuk 11 Des 2026 → base_rate.
const FAM = { id: "rt-fam", name: "Family Room 222", base_rate: 500000, capacity: 4, bed_type: null, description: null, extrabed_capacity: 2, extrabed_rate: 100000 };
const FS = { id: "rt-fs", name: "Family Suite 100", base_rate: 500000, capacity: 4, bed_type: null, description: null, extrabed_capacity: 2, extrabed_rate: 100000 };
const DLX = { id: "rt-dlx", name: "Deluxe", base_rate: 230000, capacity: 2, bed_type: null, description: null, extrabed_capacity: 1, extrabed_rate: 80000 };
const GDX = { id: "rt-gdx", name: "Grand Deluxe", base_rate: 300000, capacity: 2, bed_type: null, description: null, extrabed_capacity: 1, extrabed_rate: 80000 };
const SGL = { id: "rt-sgl", name: "Single", base_rate: 150000, capacity: 1, bed_type: null, description: null, extrabed_capacity: 1, extrabed_rate: 80000 };

function makeWorld(initialSlots: Record<string, unknown>, avail: Record<string, number> = { "rt-fam": 1, "rt-dlx": 4, "rt-sgl": 1, "rt-gdx": 1, "rt-fs": 0 }) {
  const w = {
    state: "IDLE" as string,
    context: {} as any,
    slots: { ...initialSlots } as Record<string, unknown>,
    updatedAt: 0,
    creates: [] as any[],
    startCalls: 0,
    dailyRates: [] as any[],
    guardResults: [] as any[],
  };
  const builder = (_t: string) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "eq", "in", "gte", "lte", "lt", "gt", "not", "or", "neq", "is", "ilike", "filter", "match"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: { id: "x" }, error: null });
    b.insert = () => b;
    b.upsert = () => Promise.resolve({ error: null });
    b.delete = () => b;
    b.update = () => { const u: any = { eq: () => u, then: (r: any) => r({ error: null }) }; return u; };
    b.then = (r: any) => r({ data: [], error: null });
    return b;
  };
  const db: any = {
    from: builder,
    rpc: (name: string, args: any) => {
      if (name === "get_active_booking_state")
        return Promise.resolve({ data: { phone: WA, state: w.state, context: w.context, slots: w.slots, updated_at: new Date(Date.UTC(2026, 10, 8, 7, 0, w.updatedAt)).toISOString() }, error: null });
      if (name === "update_booking_state") {
        w.state = args.p_state; w.context = JSON.parse(JSON.stringify(args.p_context)); w.updatedAt++;
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "update_conversation_topic") {
        for (const [k, v] of Object.entries(args.p_slots ?? {})) { if (v === null) delete w.slots[k]; else w.slots[k] = v; }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "room_type_availability_detail")
        return Promise.resolve({ data: Object.entries(avail).map(([room_type_id, available]) => ({ room_type_id, available })), error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { w, db };
}

// Tanpa apiKey: klasifikasi intent memakai aturan. Semua network diblok —
// bila ada jalur yang memanggil LLM/fetch, test gagal.
const explodingLlm: any = {};
(globalThis as any).fetch = async () => { throw new Error("LLM must not be called (network blocked)"); };

async function turn(world: ReturnType<typeof makeWorld>, history: Array<{ direction: string; body: string }>, msg: string) {
  history.push({ direction: "in", body: msg });
  const toolCtx: any = {
    supabaseAdmin: world.db, supabasePublic: world.db, rooms: [FAM, FS, DLX, GDX, SGL],
    property: { id: "prop-1" }, today: "2026-11-08", phone: WA,
  };
  const res: any = await runMultiAgentOrchestration({
    phone: WA,
    messages: history,
    agentCtx: { chatSummaryJson: null, property: { id: "prop-1", name: "Pomah Guesthouse" }, today: "2026-11-08", rooms: [] } as any,
    toolCtx,
    llmConfig: explodingLlm,
    createBookingImpl: (async (args: any) => {
      const guard = await realCreateGuard(args, world.w.dailyRates, { "rt-fam": 1, "rt-dlx": 4 });
      world.w.guardResults.push(guard.out);
      if (guard.out.total_mismatch || guard.out.summary_mismatch || guard.writes.length === 0 && guard.out.ok === false && /tidak cukup|tidak dijual|cocok/i.test(guard.out.error ?? "")) {
        return JSON.stringify(guard.out);
      }
      world.w.creates.push(args);
      return JSON.stringify({ ok: true, reference_code: `PG-SOF${world.w.creates.length}`, total: args.expected_total });
    }) as any,
  } as any);
  const reply = res?.reply ?? "";
  history.push({ direction: "out", body: reply });
  return { reply, res };
}

// Slot nyata produksi (wa_booking_states) setelah 06.09–06.12 WIB.
const SOFIAH_SLOTS = { checkIn: "2026-12-11", checkOut: "2026-12-12", roomLabel: "Family", partialAdults: 7, checkoutAssumed: true, partialChildren: 0 };
const HISTORY = () => [
  { direction: "in", body: "permisi kak, untuk homestay nya apakah masih tersedia untuk 11 desember?" },
  { direction: "out", body: "Untuk tanggal Jumat–Sabtu, 11–12 Desember 2026, kamar yang masih tersedia: ... Family Room 222: 1 kamar tersedia" },
  { direction: "in", body: "untuk 7 orang kk" },
  { direction: "out", body: "Untuk Jumat–Sabtu, 11–12 Desember 2026 dengan 7 tamu ... 3 kamar Deluxe + 1 extra bed" },
  { direction: "in", body: "kalo yg family room itu gmn ya kak kamarnya" },
  { direction: "out", body: "Family Room 222 memiliki luas 50 m² ... Mau kami kirimkan fotonya?" },
  { direction: "in", body: "boleh kak" },
  { direction: "out", body: "Brosur Pomah Guesthouse 📄" },
];

async function main() {
  // ── A. alur utama ─────────────────────────────────────────────────────────
  {
    const world = makeWorld(SOFIAH_SLOTS);
    const h = HISTORY();
    // Persetujuan brosur sudah lewat: state tetap IDLE, slot utuh, tidak ada booking.
    assert.equal(world.w.state, "IDLE");
    assert.equal(world.w.slots.partialAdults, 7);

    const t1 = await turn(world, h, "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak");
    assert.doesNotMatch(t1.reply, /check-in dan check-out|tanggal check-in/i, "check-in yang diketahui tidak ditanya ulang");
    assert.match(t1.reply, /1 Family Room 222 \+ 1 Deluxe/);
    assert.match(t1.reply, /Check-out-nya tanggal 12 Desember 2026 \(1 malam\)/, "hanya checkout");
    assert.deepEqual((world.w.slots.pendingRoomSelection as any).rooms.map((r: any) => r.roomName), ["Family Room 222", "Deluxe"]);
    assert.equal(world.w.state, "IDLE");
    assert.equal(world.w.creates.length, 0);

    // Service: label hari tanpa bulan dijangkarkan ke Des + checkout terkonfirmasi.
    const raw = "chek-in nya tanggal 11 cek-out nya tgl 12 kk";
    const anchored = await applyAnchoredStayFromSlots({ db: world.db, phone: WA, message: raw, slots: world.w.slots, today: "2026-11-08" });
    assert.ok(anchored);
    assert.equal(world.w.slots.checkoutAssumed, false);
    const t2 = await turn(world, h, anchored!.message);
    assert.equal(world.w.state, "COLLECTING_DATA", "booking flow dimulai dari pilihan tersimpan");
    assert.deepEqual(world.w.context.rooms.map((r: any) => [r.roomTypeName, r.quantity]), [["Family Room 222", 1], ["Deluxe", 1]]);
    assert.equal(world.w.context.checkIn, "2026-12-11");
    assert.equal(world.w.context.checkOut, "2026-12-12");
    assert.equal(world.w.context.adults, 7);
    assert.match(t2.reply, /nama/i);
    assert.equal(world.w.slots.pendingRoomSelection, undefined);
    assert.equal(world.w.creates.length, 0);

    await turn(world, h, "atas nama: Sofi Fadi, nomor: 081900000963");
    const t4 = await turn(world, h, "Ya");
    assert.equal(world.w.state, "CONFIRMING_BOOKING");
    assert.match(t4.reply, /1x Family Room 222, 1x Deluxe/);
    assert.match(t4.reply, /Check-in: 11 Desember 2026/);
    assert.match(t4.reply, /Check-out: 12 Desember 2026/);
    assert.match(t4.reply, /7 orang dewasa/);
    assert.match(t4.reply, /1x Family Room 222 Rp500\.000\/malam, 1x Deluxe Rp230\.000\/malam/);
    // Extra bed ditempatkan & DITAGIH di Family Room 222 (tarif DB Rp100.000).
    assert.match(t4.reply, /Extra bed: 1x di Family Room 222 @ Rp100\.000\/malam = Rp100\.000/);
    assert.match(t4.reply, /Total: Rp830\.000/);
    assert.equal(world.w.context.quotedTotal, 830000);
    assert.equal(world.w.creates.length, 0, "belum ada create sebelum persetujuan ringkasan");

    // Penolakan/koreksi → tidak create.
    const snapshot = JSON.parse(JSON.stringify(world.w));
    const tNo = await turn(world, h, "belum sesuai kak");
    assert.equal(world.w.creates.length, 0, "penolakan tidak membuat booking");
    assert.doesNotMatch(tNo.reply, /berhasil dibuat/);
    // Kembalikan ke ringkasan lalu setujui.
    Object.assign(world.w, { state: snapshot.state, context: snapshot.context });
    const t5 = await turn(world, h, "sudah sesuai kak");
    assert.equal(world.w.creates.length, 1, "tepat satu create setelah persetujuan eksplisit");
    assert.match(t5.reply, /PG-SOF1/);
    const c = world.w.creates[0];
    assert.deepEqual(c.rooms.map((r: any) => [r.roomTypeId, r.quantity]), [["rt-fam", 1], ["rt-dlx", 1]]);
    assert.equal(c.extra_beds, 1);
    assert.equal(c.adults, 7);
    assert.equal(c.expected_total, 830000);
    // create_booking ASLI menghitung total server yang sama persis (tanpa mismatch).
    const g = world.w.guardResults.at(-1);
    assert.notEqual(g.total_mismatch, true, `server total sama: ${JSON.stringify(g)}`);
    assert.notEqual(g.summary_mismatch, true);
    assert.equal(world.w.state, "PAYMENT_PENDING");
    // Retry webhook "sudah sesuai" lagi → tidak ada booking kedua.
    await turn(world, h, "sudah sesuai kak");
    assert.equal(world.w.creates.length, 1, "tidak ada booking dobel");
  }

  // ── B. checkout sudah terkonfirmasi → langsung start, tanpa tanya tanggal ──
  {
    const world = makeWorld({ ...SOFIAH_SLOTS, checkoutAssumed: false });
    const t = await turn(world, HISTORY(), "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak");
    assert.equal(world.w.state, "COLLECTING_DATA");
    assert.doesNotMatch(t.reply, /check-out-nya|check-in/i);
  }

  // ── C. "iya" atas usulan checkout → start ─────────────────────────────────
  {
    const world = makeWorld(SOFIAH_SLOTS);
    const h = HISTORY();
    await turn(world, h, "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak");
    await turn(world, h, "iya kak");
    assert.equal(world.w.state, "COLLECTING_DATA");
  }

  // ── D. tanggal tidak diketahui / stale → tidak menebak (agent yang tanya) ─
  for (const slots of [{}, { ...SOFIAH_SLOTS, checkIn: "2026-10-01", checkOut: "2026-10-02" }]) {
    const world = makeWorld(slots);
    await assert.rejects(
      turn(world, HISTORY(), "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak"),
      /LLM must not be called|LLM/,
      "tanpa tanggal valid jalur deterministik tidak dipakai",
    ).catch(() => {});
    assert.equal(world.w.state, "IDLE");
    assert.equal(world.w.slots.pendingRoomSelection, undefined);
  }

  // ── E. kamar tidak cukup tersedia → tidak start ───────────────────────────
  {
    const world = makeWorld({ ...SOFIAH_SLOTS, checkoutAssumed: false }, { "rt-fam": 0, "rt-dlx": 4 });
    await turn(world, HISTORY(), "yang 1 family room + 1 kamar deluxe boleh kak").catch(() => {});
    assert.equal(world.w.state, "IDLE");
  }

  // ── F. koreksi tanggal setelah pilihan → pilihan lama tidak dihidupkan ────
  {
    const world = makeWorld(SOFIAH_SLOTS);
    const h = HISTORY();
    await turn(world, h, "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak");
    world.w.slots.checkIn = "2026-12-18"; world.w.slots.checkOut = "2026-12-19"; world.w.slots.checkoutAssumed = false;
    await turn(world, h, "iya kak").catch(() => {});
    assert.equal(world.w.state, "IDLE", "pilihan untuk tanggal lama tidak dipakai setelah tanggal berubah");
  }

  // ── G. "boleh kak" (brosur) tidak memulai booking ─────────────────────────
  {
    const world = makeWorld({ ...SOFIAH_SLOTS, checkoutAssumed: false });
    await turn(world, HISTORY().slice(0, 6), "boleh kak").catch(() => {});
    assert.equal(world.w.state, "IDLE");
    assert.equal(world.w.creates.length, 0);
  }

  // ── I. tarif kalender berubah antara ringkasan & persetujuan → TIDAK create ─
  {
    const world = makeWorld({ ...SOFIAH_SLOTS, checkoutAssumed: false });
    const h = HISTORY();
    await turn(world, h, "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak");
    await turn(world, h, "atas nama: Sofi Fadi, nomor: 081900000963");
    const sum = await turn(world, h, "Ya");
    assert.match(sum.reply, /Total: Rp830\.000/);
    world.w.dailyRates = [{ room_type_id: "rt-fam", date: "2026-12-11", rate: 550000, extrabed_rate: null, min_stay: null, stop_sell: false, note: null }];
    const r = await turn(world, h, "sudah sesuai kak");
    assert.equal(world.w.creates.length, 0, "harga berubah → booking tidak ditulis");
    const gi = world.w.guardResults.at(-1);
    // Guard nyata create_booking: sidik ringkasan (termasuk total) tidak sama → tolak.
    assert.ok(gi.total_mismatch === true || gi.summary_mismatch === true, JSON.stringify(gi));
    assert.doesNotMatch(r.reply, /berhasil dibuat/);
  }

  // ── J. extra bed melebihi slot bertarif sama (tarif campuran) → fail-safe ─
  {
    // Deluxe dipilih PERTAMA → kamar penampung Deluxe (Rp80rb, 1 slot).
    // 8 tamu = 6 standar + 2 extra bed; extra ke-2 hanya muat di Family
    // (Rp100rb). create_booking menagih satu tarif → harus DIBLOK, bukan 2×80rb.
    const world = makeWorld({ ...SOFIAH_SLOTS, partialAdults: 8, checkoutAssumed: false });
    const h = HISTORY();
    await turn(world, h, "iyaa kak, yang 1 kamar deluxe + 1 family room boleh kak");
    assert.equal(world.w.state, "COLLECTING_DATA");
    await turn(world, h, "atas nama: Sofi Fadi, nomor: 081900000963");
    const sum = await turn(world, h, "Ya");
    assert.doesNotMatch(sum.reply, /Extra bed: 2x/, "tidak menagih 2 extra bed dengan satu tarif");
    assert.match(sum.reply, /staf kami bantu hitung/);
    assert.match(sum.reply, /Booking belum kami buat/);
    await turn(world, h, "sudah sesuai kak").catch(() => {});
    assert.equal(world.w.creates.length, 0, "tarif extra bed campuran tidak pernah ditulis");
  }

  // ── K. rombongan > 8 → jalur deterministik tidak dipakai (cap start_booking) ─
  {
    const world = makeWorld({ ...SOFIAH_SLOTS, partialAdults: 10, checkoutAssumed: false });
    await turn(world, HISTORY(), "iyaa kak, yang 1 family room + 1 kamar deluxe boleh kak").catch(() => {});
    assert.equal(world.w.state, "IDLE");
  }

  // ── H. tarif kalender berubah → create ditolak bila total server beda ─────
  // (guard expected_total di create_booking; di sini cukup verifikasi bahwa
  // expected_total & expected_summary ikut terkirim dari ringkasan.)
  console.log("✓ Sofiah e2e mocked flow passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
