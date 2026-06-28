/**
 * Single source of truth for intent categories.
 *
 * Dipakai bersama oleh:
 *   - `intent-classifier.ts`  → menentukan kategori admin-only & bobot default
 *   - `intent-rules-view.tsx` (admin UI) → daftar dropdown & referensi bobot
 *
 * Sebelumnya UI hanya mengenal 8 kategori sementara classifier punya 21,
 * sehingga aturan untuk 13 kategori tak bisa dibuat dari UI. Modul ini
 * menyatukan keduanya agar tidak pernah lagi melenceng.
 */

import type { IntentCategory } from "@/ai/agents/types";

export interface IntentCategoryMeta {
  key:           IntentCategory;
  /** Label dwi-bahasa untuk dropdown admin. */
  label:         string;
  /** Hanya cocok saat mode admin/managerial (perintah staf). */
  adminOnly?:    boolean;
  /** Bobot default — referensi "tangga bobot" yang dipakai aturan statis. */
  defaultWeight: number;
}

/**
 * Urut menurun berdasarkan bobot default supaya "tangga bobot" terbaca jelas
 * di UI (perintah admin paling tinggi → sapaan paling rendah).
 */
export const INTENT_CATEGORIES: IntentCategoryMeta[] = [
  // ── Perintah admin (bobot 20 — hampir selalu menang, hanya saat mode admin)
  { key: "list_bookings",   label: "List Bookings (Daftar Booking) — admin",   adminOnly: true, defaultWeight: 20 },
  { key: "booking_detail",  label: "Booking Detail (Detail Booking) — admin",  adminOnly: true, defaultWeight: 20 },
  { key: "payment_update",  label: "Payment Update (Update Bayar) — admin",    adminOnly: true, defaultWeight: 20 },
  { key: "room_block",      label: "Room Block (Blokir Kamar) — admin",        adminOnly: true, defaultWeight: 20 },
  { key: "send_to_manager", label: "Send to Manager (Teruskan ke Owner) — admin", adminOnly: true, defaultWeight: 20 },

  // ── Eskalasi
  { key: "complaint", label: "Complaint (Komplain)", defaultWeight: 10 },

  // ── Layanan & kerusakan
  { key: "maintenance",    label: "Maintenance (Kerusakan)",     defaultWeight: 8 },
  { key: "customer-care",  label: "Customer Care (Layanan Kamar)", defaultWeight: 8 },

  // ── Finance
  { key: "payment",                 label: "Payment (Pembayaran)",                  defaultWeight: 7 },
  { key: "payment_policy_question", label: "Payment Policy (Kebijakan Bayar/DP)",   defaultWeight: 7 },
  { key: "bank_account_request",    label: "Bank Account (Minta Rekening)",         defaultWeight: 7 },
  { key: "invoice_request",         label: "Invoice (Minta Invoice/Kwitansi)",      defaultWeight: 7 },

  // ── Niat spesifik
  { key: "pricing_inquiry",    label: "Pricing Inquiry (Tanya Harga)",      defaultWeight: 6 },
  { key: "availability_check", label: "Availability Check (Cek Ketersediaan)", defaultWeight: 6 },
  { key: "booking_start",      label: "Booking Start (Mulai Pesan)",        defaultWeight: 6 },

  // ── Niat umum
  { key: "booking_inquiry",              label: "Booking Inquiry (Tanya Pesan)",          defaultWeight: 5 },
  { key: "guest_count_input",            label: "Guest Count (Jumlah Tamu)",              defaultWeight: 5 },
  { key: "room_detail_question",         label: "Room Detail (Fasilitas Kamar)",          defaultWeight: 5 },
  { key: "checkin_policy_question",      label: "Check-in Policy (Jam Check-in)",         defaultWeight: 5 },
  { key: "early_arrival_guest_question", label: "Early Arrival (Datang Awal/Titip Koper)", defaultWeight: 5 },

  // ── Sapaan (paling lemah)
  { key: "greeting", label: "Greeting (Sapaan)", defaultWeight: 3 },
];

/** Kategori yang hanya boleh cocok saat mode admin/managerial. */
export const ADMIN_INTENT_CATEGORIES: IntentCategory[] = INTENT_CATEGORIES
  .filter((c) => c.adminOnly)
  .map((c) => c.key);

const META_BY_KEY = new Map<string, IntentCategoryMeta>(
  INTENT_CATEGORIES.map((c) => [c.key, c]),
);

export function getIntentCategoryLabel(key: string): string {
  return META_BY_KEY.get(key)?.label ?? key;
}

export function isAdminIntentCategory(key: string): boolean {
  return META_BY_KEY.get(key)?.adminOnly === true;
}
