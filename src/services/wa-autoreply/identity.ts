import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PropertyManagerIdentity = {
  id: string;
  name: string;
  role: string;
  phone: string;
};

/** Normalize an Indonesian phone number to digits-only with a 62 prefix. */
export function normalizePhone(raw: string): string {
  let phone = String(raw ?? "").replace(/\D/g, "");
  if (phone.startsWith("620")) phone = `62${phone.slice(3)}`;
  else if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith("8")) phone = `62${phone}`;
  return phone;
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

/**
 * Resolve an active property manager by WhatsApp phone.
 * Tolerates common Indonesian phone-number formats.
 */
export async function resolveManagerByPhone(
  phone: string,
): Promise<PropertyManagerIdentity | null> {
  const needle = normalizePhone(phone);
  if (!needle) return null;

  // Supabase query builders are thenables in the edge runtime. Do not chain
  // `.catch()` directly; inspect the standard `{ data, error }` response.
  const { data, error } = await (supabaseAdmin as any)
    .from("property_managers")
    .select("id, name, role, phone, is_active");

  if (error) {
    console.error("[Autoreply] Error fetching managers:", error);

    if (error.code === "PGRST106" || String(error.message).includes("is_active")) {
      const fallback = await (supabaseAdmin as any)
        .from("property_managers")
        .select("id, name, role, phone");

      if (!fallback.error && fallback.data) {
        for (const manager of fallback.data) {
          if (manager.phone && normalizePhone(manager.phone) === needle) {
            return manager as PropertyManagerIdentity;
          }
        }
      }
    }
  }

  for (const manager of (data ?? []) as any[]) {
    const isActive = manager.is_active !== false;
    if (isActive && manager.phone && normalizePhone(manager.phone) === needle) {
      return manager as PropertyManagerIdentity;
    }
  }

  return null;
}

/** Return true when a manager temporarily uses the guest booking flow. */
export async function isManagerInGuestMode(phone: string): Promise<boolean> {
  const needle = normalizePhone(phone);
  if (!needle) return false;

  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("manager_test_modes")
      .select("guest_mode")
      .eq("phone", needle)
      .maybeSingle();

    if (error) return false;
    return Boolean(data?.guest_mode);
  } catch {
    return false;
  }
}
