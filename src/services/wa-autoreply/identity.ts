import { normalizePhone } from "@/lib/phone";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isManagerRole, type ManagerRole } from "@/services/manager-chat/rbac";

export type PropertyManagerIdentity = {
  id: string;
  name: string;
  role: string;
  phone: string;
  is_active?: boolean;
};

export type ManagerChannel =
  | { kind: "manager"; manager: PropertyManagerIdentity }
  | { kind: "guest_mode"; manager: PropertyManagerIdentity }
  | { kind: "guest" };

/** Normalize an Indonesian phone number to digits-only with a 62 prefix.
 *  Implementasi di `@/lib/phone` (modul murni, aman untuk browser).
 */
export { normalizePhone };

export function identityCandidates(raw: string): string[] {
  const original = String(raw ?? "").trim();
  const digits = original.replace(/\D/g, "");
  const normalized = normalizePhone(original);
  const out = new Set<string>();
  if (original) out.add(original);
  if (digits) out.add(digits);
  if (normalized) out.add(normalized);
  if (normalized.startsWith("62") && normalized.length >= 10) {
    out.add(`0${normalized.slice(2)}`);
    out.add(normalized.slice(2));
  }
  return [...out].filter(Boolean);
}

export function isConfiguredAdminPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  return (process.env.ADMIN_PHONE_NUMBERS || "")
    .split(",")
    .map((candidate) => normalizePhone(candidate))
    .filter(Boolean)
    .includes(normalized);
}

function asManager(row: any): PropertyManagerIdentity | null {
  if (!row?.id || !row?.phone) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? "Manager"),
    role: isManagerRole(row.role) ? row.role : String(row.role ?? ""),
    phone: String(row.phone),
    is_active: row.is_active !== false,
  };
}

function matchManagerPhone(managerPhone: string, candidates: Set<string>): boolean {
  if (candidates.has(managerPhone)) return true;
  const normalized = normalizePhone(managerPhone);
  return candidates.has(normalized) || candidates.has(managerPhone.replace(/\D/g, ""));
}

/**
 * Resolve an active property manager by WhatsApp phone or identity alias.
 * Tidak percaya klaim role di chat, dan tidak percaya kolom role di alias
 * saja — selalu harus ada baris aktif di property_managers.
 */
export async function resolveManagerByPhone(
  phone: string,
): Promise<PropertyManagerIdentity | null> {
  const candidates = identityCandidates(phone);
  if (candidates.length === 0) return null;
  const candidateSet = new Set(candidates);

  const pickActive = (rows: any[] | null | undefined): PropertyManagerIdentity | null => {
    for (const row of rows ?? []) {
      const manager = asManager(row);
      if (!manager) continue;
      const isActive = row.is_active !== false;
      if (isActive && matchManagerPhone(manager.phone, candidateSet)) return manager;
    }
    return null;
  };

  const { data, error } = await (supabaseAdmin as any)
    .from("property_managers")
    .select("id, name, role, phone, is_active");

  if (error) {
    console.error("[Autoreply] Error fetching managers:", error);

    if (error.code === "PGRST106" || String(error.message).includes("is_active")) {
      const fallback = await (supabaseAdmin as any)
        .from("property_managers")
        .select("id, name, role, phone");

      if (!fallback.error) {
        const found = pickActive(fallback.data);
        if (found) return found;
      }
    }
  } else {
    const found = pickActive(data);
    if (found) return found;
  }

  // Alias LID/JID → nomor kanonis, lalu cocokkan ke property_managers.
  // Role di tabel alias TIDAK dipakai sebagai otorisasi.
  try {
    const { data: aliases, error: aliasErr } = await (supabaseAdmin as any)
      .from("wa_identity_aliases")
      .select("canonical_phone, alias_value, is_active")
      .in("alias_value", candidates)
      .limit(10);
    if (aliasErr || !aliases?.length) return null;

    const canonicals = new Set<string>();
    for (const alias of aliases) {
      if (alias.is_active === false) continue;
      const canonical = String(alias.canonical_phone ?? "").trim();
      if (canonical) {
        for (const value of identityCandidates(canonical)) canonicals.add(value);
      }
    }
    if (canonicals.size === 0) return null;

    const rows = ((data ?? []) as any[]).length
      ? data
      : (await (supabaseAdmin as any).from("property_managers").select("id, name, role, phone, is_active")).data;

    for (const row of rows ?? []) {
      const manager = asManager(row);
      if (!manager || row.is_active === false) continue;
      if (matchManagerPhone(manager.phone, canonicals)) return manager;
    }
  } catch (err) {
    console.warn("[Autoreply] identity alias lookup failed:", err);
  }

  return null;
}

/** Return true when a manager temporarily uses the guest booking flow. */
export async function isManagerInGuestMode(phone: string): Promise<boolean> {
  const needles = identityCandidates(phone);
  if (needles.length === 0) return false;

  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("manager_test_modes")
      .select("guest_mode, phone")
      .in("phone", needles)
      .limit(5);

    if (error) {
      // Fallback for older clients that only query a single phone.
      const needle = normalizePhone(phone);
      const single = await (supabaseAdmin as any)
        .from("manager_test_modes")
        .select("guest_mode")
        .eq("phone", needle)
        .maybeSingle();
      if (single.error) return false;
      return Boolean(single.data?.guest_mode);
    }
    return (data ?? []).some((row: any) => Boolean(row?.guest_mode));
  } catch {
    return false;
  }
}

export async function setManagerGuestMode(phone: string, guestMode: boolean): Promise<void> {
  const needle = normalizePhone(phone);
  if (!needle) return;
  await (supabaseAdmin as any)
    .from("manager_test_modes")
    .upsert({ phone: needle, guest_mode: guestMode, updated_at: new Date().toISOString() }, { onConflict: "phone" });
}

/**
 * Tentukan kanal: manajer aktif, manajer dalam mode tamu, atau tamu biasa.
 * Nomor tidak terdaftar / nonaktif jatuh ke guest tanpa bocoran data internal.
 */
export async function resolveManagerChannel(phone: string): Promise<ManagerChannel> {
  const manager = await resolveManagerByPhone(phone);
  if (!manager) return { kind: "guest" };
  const guestMode = await isManagerInGuestMode(phone) || await isManagerInGuestMode(manager.phone);
  if (guestMode) return { kind: "guest_mode", manager };
  return { kind: "manager", manager };
}

export function managerRoleOf(manager: PropertyManagerIdentity | null | undefined): ManagerRole | null {
  return manager && isManagerRole(manager.role) ? manager.role : null;
}
