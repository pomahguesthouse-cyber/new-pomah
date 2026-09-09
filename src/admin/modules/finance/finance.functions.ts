import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Laporan keuangan gaya hotel:
 *  - Pendapatan basis akrual (room revenue diakui per malam menginap)
 *  - Pendapatan basis kas (uang yang benar-benar diterima, dari paid_amount)
 *  - Pengeluaran per kategori
 *  - Laba/rugi, piutang (AR), dan statistik kamar (okupansi, ADR, RevPAR)
 */

export const EXPENSE_CATEGORIES = [
  "gaji-karyawan",
  "listrik-air",
  "internet-telepon",
  "linen-laundry",
  "amenities-kamar",
  "kebersihan",
  "perbaikan-perawatan",
  "pemasaran-iklan",
  "komisi-ota",
  "pajak-retribusi",
  "sewa",
  "konsumsi-sarapan",
  "perlengkapan-kantor",
  "lain-lain",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const expenseInputSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1).max(60),
  description: z.string().max(500).nullish(),
  vendor: z.string().max(200).nullish(),
  amount: z.number().min(0),
  payment_method: z.string().max(60).nullish(),
  receipt_url: z.string().max(1000).nullish(),
  notes: z.string().max(1000).nullish(),
});

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function nightsOf(checkIn: string, checkOut: string): number {
  const ci = new Date(`${checkIn}T00:00:00Z`).getTime();
  const co = new Date(`${checkOut}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((co - ci) / 86_400_000));
}

/** Laporan lengkap untuk satu periode. */
export const getFinanceReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => rangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { from, to } = data;

    // Booking yang berpotensi menyentuh periode: check_out > from dan check_in <= to
    const [bookingsRes, roomsRes, expensesRes] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, reference_code, check_in, check_out, nights, nightly_rate, total_amount, paid_amount, status, source, payment_status, created_at, guests(full_name)",
        )
        .lte("check_in", to)
        .gt("check_out", from)
        .neq("status", "cancelled"),
      supabase.from("rooms").select("id"),
      supabase
        .from("expenses")
        .select("id, expense_date, category, description, vendor, amount, payment_method")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false }),
    ]);

    const bookings = bookingsRes.data ?? [];
    const totalRooms = Math.max(1, roomsRes.data?.length ?? 1);
    const expenses = expensesRes.data ?? [];
    const dates = daysBetween(from, to);
    const periodDays = dates.length;

    // ── Akrual: alokasi per malam ────────────────────────────────────────────
    const dailyRevenue = new Map<string, number>();
    const dailyRoomNights = new Map<string, number>();
    for (const d of dates) {
      dailyRevenue.set(d, 0);
      dailyRoomNights.set(d, 0);
    }

    let accrualRevenue = 0;
    let roomNightsSold = 0;

    for (const b of bookings) {
      const nights = b.nights && b.nights > 0 ? b.nights : nightsOf(b.check_in, b.check_out);
      const perNight = Number(b.total_amount ?? 0) / nights;
      for (const d of daysBetween(b.check_in, b.check_out)) {
        if (d === b.check_out) continue; // malam terakhir tidak dihitung
        if (!dailyRevenue.has(d)) continue;
        dailyRevenue.set(d, (dailyRevenue.get(d) ?? 0) + perNight);
        dailyRoomNights.set(d, (dailyRoomNights.get(d) ?? 0) + 1);
        accrualRevenue += perNight;
        roomNightsSold += 1;
      }
    }

    // ── Kas: uang diterima, diakui pada tanggal booking dibuat ───────────────
    let cashRevenue = 0;
    for (const b of bookings) {
      const createdDate = String(b.created_at ?? "").slice(0, 10);
      if (createdDate >= from && createdDate <= to) {
        cashRevenue += Number(b.paid_amount ?? 0);
      }
    }

    // ── Pengeluaran ──────────────────────────────────────────────────────────
    const expenseByCategory: Record<string, number> = {};
    let totalExpense = 0;
    const dailyExpense = new Map<string, number>();
    for (const d of dates) dailyExpense.set(d, 0);
    for (const e of expenses) {
      const amount = Number(e.amount ?? 0);
      totalExpense += amount;
      expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + amount;
      dailyExpense.set(e.expense_date, (dailyExpense.get(e.expense_date) ?? 0) + amount);
    }

    // ── Piutang / pembayaran ─────────────────────────────────────────────────
    let totalBilled = 0;
    let totalPaid = 0;
    const receivables: Array<{
      reference_code: string | null;
      guest_name: string;
      check_in: string;
      check_out: string;
      total: number;
      paid: number;
      outstanding: number;
      payment_status: string;
    }> = [];

    for (const b of bookings) {
      const total = Number(b.total_amount ?? 0);
      const paid = Number(b.paid_amount ?? 0);
      totalBilled += total;
      totalPaid += paid;
      const outstanding = Math.max(0, total - paid);
      if (outstanding > 0) {
        receivables.push({
          reference_code: b.reference_code ?? null,
          guest_name:
            (b.guests as { full_name?: string | null } | null)?.full_name ?? "Tanpa nama",
          check_in: b.check_in,
          check_out: b.check_out,
          total,
          paid,
          outstanding,
          payment_status: String(b.payment_status ?? "unpaid"),
        });
      }
    }
    receivables.sort((a, b) => b.outstanding - a.outstanding);

    // ── Statistik kamar ──────────────────────────────────────────────────────
    const availableRoomNights = totalRooms * periodDays;
    const occupancy = availableRoomNights ? (roomNightsSold / availableRoomNights) * 100 : 0;
    const adr = roomNightsSold ? accrualRevenue / roomNightsSold : 0;
    const revpar = availableRoomNights ? accrualRevenue / availableRoomNights : 0;

    const series = dates.map((d) => ({
      date: d,
      revenue: Math.round(dailyRevenue.get(d) ?? 0),
      expense: Math.round(dailyExpense.get(d) ?? 0),
      roomNights: dailyRoomNights.get(d) ?? 0,
    }));

    const sourceMix: Record<string, number> = {};
    for (const b of bookings) {
      const key = String(b.source ?? "direct");
      sourceMix[key] = (sourceMix[key] ?? 0) + 1;
    }

    return {
      period: { from, to, days: periodDays },
      revenue: {
        accrual: Math.round(accrualRevenue),
        cash: Math.round(cashRevenue),
      },
      expense: {
        total: Math.round(totalExpense),
        byCategory: Object.fromEntries(
          Object.entries(expenseByCategory).map(([k, v]) => [k, Math.round(v)]),
        ),
      },
      profit: {
        accrual: Math.round(accrualRevenue - totalExpense),
        cash: Math.round(cashRevenue - totalExpense),
        marginAccrual: accrualRevenue
          ? Math.round(((accrualRevenue - totalExpense) / accrualRevenue) * 1000) / 10
          : 0,
      },
      stats: {
        totalRooms,
        roomNightsSold,
        availableRoomNights,
        occupancy: Math.round(occupancy * 10) / 10,
        adr: Math.round(adr),
        revpar: Math.round(revpar),
        bookings: bookings.length,
      },
      payments: {
        billed: Math.round(totalBilled),
        paid: Math.round(totalPaid),
        outstanding: Math.round(Math.max(0, totalBilled - totalPaid)),
      },
      receivables: receivables.slice(0, 50),
      expenses,
      series,
      sourceMix,
    };
  });

/** Daftar pengeluaran untuk tabel admin. */
export const listExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => rangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", data.from)
      .lte("expense_date", data.to)
      .order("expense_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => expenseInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("expenses")
      .insert({ ...data, created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => expenseInputSchema.extend({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("expenses")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Impor massal dari file CSV/Excel yang sudah di-parse di sisi browser. */
export const importExpenses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rows: z.array(expenseInputSchema).min(1).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const payload = data.rows.map((r) => ({ ...r, created_by: context.userId }));
    const { data: rows, error } = await context.supabase
      .from("expenses")
      .insert(payload)
      .select("id");
    if (error) throw new Error(error.message);
    return { inserted: rows?.length ?? 0 };
  });
