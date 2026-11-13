/**
 * RBAC kanal chat manajer — deny-by-default.
 *
 * Role diambil HANYA dari baris aktif `property_managers` (atau alias
 * identitas yang merujuk ke baris itu). Klaim di isi chat ("saya admin")
 * tidak pernah dipercaya.
 *
 * Role di schema: super_admin, booking_manager, viewer.
 * Tidak ada role finance terpisah — hak pembayaran diberikan ke
 * super_admin dan booking_manager.
 */

export const MANAGER_ROLES = ["super_admin", "booking_manager", "viewer"] as const;
export type ManagerRole = (typeof MANAGER_ROLES)[number];

export function isManagerRole(value: unknown): value is ManagerRole {
  return typeof value === "string" && (MANAGER_ROLES as readonly string[]).includes(value);
}

export function normalizeManagerRole(value: unknown): ManagerRole | null {
  return isManagerRole(value) ? value : null;
}

/** Hak akses per tool. Tool yang tidak terdaftar ditolak di kanal manajer. */
export const MANAGER_TOOL_ROLES: Record<string, readonly ManagerRole[]> = {
  // Baca
  get_bookings: ["super_admin", "booking_manager", "viewer"],
  get_occupancy_summary: ["super_admin", "booking_manager", "viewer"],
  check_room_availability: ["super_admin", "booking_manager", "viewer"],
  get_room_specifications: ["super_admin", "booking_manager", "viewer"],
  get_daily_room_rates: ["super_admin", "booking_manager", "viewer"],
  get_payment_info: ["super_admin", "booking_manager", "viewer"],
  list_bank_mutations: ["super_admin", "booking_manager", "viewer"],
  list_room_rates: ["super_admin", "booking_manager", "viewer"],

  // Operasi booking
  create_booking: ["super_admin", "booking_manager"],
  update_booking_status: ["super_admin", "booking_manager"],
  reschedule_booking: ["super_admin", "booking_manager"],
  change_booking_room: ["super_admin", "booking_manager"],
  set_extra_bed: ["super_admin", "booking_manager"],
  delete_booking: ["super_admin", "booking_manager"],
  block_room: ["super_admin", "booking_manager"],
  unblock_room: ["super_admin", "booking_manager"],

  // Pembayaran & pesan ke tamu (bukan role baru; memakai role existing)
  update_payment_status: ["super_admin", "booking_manager"],
  send_invoice: ["super_admin", "booking_manager"],
  send_brochure_to_guest: ["super_admin", "booking_manager"],
  reply_to_guest: ["super_admin", "booking_manager"],

  // Perubahan harga sistem: super_admin saja
  update_room_rate: ["super_admin"],
  set_daily_room_rate: ["super_admin"],
  delete_daily_room_rate: ["super_admin"],

  // Konten / SEO
  send_to_manager: ["super_admin"],
  discover_semarang_content: ["super_admin"],
  upsert_explore_item: ["super_admin"],
  list_explore_items: ["super_admin", "booking_manager", "viewer"],
  publish_explore_item: ["super_admin"],
  publish_explore_items_by_category: ["super_admin"],
  generate_explore_image: ["super_admin"],
  discover_property_reviews: ["super_admin"],
  save_custom_google_reviews: ["super_admin"],
  restore_custom_google_reviews: ["super_admin"],
  check_keyword_ranking: ["super_admin"],
  list_tracked_keywords: ["super_admin", "viewer", "booking_manager"],
  audit_page_seo: ["super_admin"],
  scrape_competitor_prices: ["super_admin"],
};

const WRITE_TOOLS = new Set([
  "create_booking",
  "update_booking_status",
  "reschedule_booking",
  "change_booking_room",
  "set_extra_bed",
  "delete_booking",
  "block_room",
  "unblock_room",
  "update_payment_status",
  "send_invoice",
  "send_brochure_to_guest",
  "reply_to_guest",
  "update_room_rate",
  "set_daily_room_rate",
  "delete_daily_room_rate",
  "upsert_explore_item",
  "publish_explore_item",
  "publish_explore_items_by_category",
  "generate_explore_image",
  "save_custom_google_reviews",
  "restore_custom_google_reviews",
  "send_to_manager",
]);

export function isManagerWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function roleCanUseTool(role: ManagerRole | null | undefined, toolName: string): boolean {
  if (!role) return false;
  const allowed = MANAGER_TOOL_ROLES[toolName];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function roleCanHardDelete(role: ManagerRole | null | undefined): boolean {
  return role === "super_admin";
}

export function roleCanSeeFullPhone(role: ManagerRole | null | undefined): boolean {
  return role === "super_admin" || role === "booking_manager";
}

export function unauthorizedToolMessage(role: ManagerRole | null | undefined, toolName: string): string {
  const label = role ?? "tidak dikenal";
  return `Peran ${label} tidak diizinkan menjalankan perintah ini (${toolName}).`;
}

/** Masking nomor: 62812****3779. Kosong/pendek dikembalikan apa adanya. */
export function maskPhone(phone: unknown): string {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return raw;
  const visibleHead = digits.slice(0, Math.min(4, digits.length - 4));
  const visibleTail = digits.slice(-4);
  return `${visibleHead}${"*".repeat(Math.max(4, digits.length - visibleHead.length - 4))}${visibleTail}`;
}

export function presentPhone(
  phone: unknown,
  role: ManagerRole | null | undefined,
  opts?: { forceMask?: boolean },
): string {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  if (opts?.forceMask || !roleCanSeeFullPhone(role)) return maskPhone(raw);
  return raw;
}
