import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = SupabaseClient<any>;

export interface GuestResolutionInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  source?: string;
  preferredGuestId?: string | null;
}

export interface ResolvedGuest {
  id: string;
  created: boolean;
}

export function normalizeGuestPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

function guestPatch(input: GuestResolutionInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    full_name: input.fullName.trim(),
    last_seen_at: new Date().toISOString(),
  };
  const email = input.email?.trim();
  const phone = input.phone?.trim();
  const country = input.country?.trim();
  if (email) patch.email = email;
  if (phone) patch.phone = phone;
  if (country) patch.country = country;
  if (input.source) patch.source = input.source;
  return patch;
}

async function findActiveGuestByPhone(
  client: AnyClient,
  normalizedPhone: string,
): Promise<{ id: string } | null> {
  const { data, error } = await (client as any)
    .from("guests")
    .select("id")
    .eq("phone_normalized", normalizedPhone)
    .is("merged_into", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? { id: String(data.id) } : null;
}

/**
 * Resolve one canonical active guest per normalized phone.
 *
 * The lookup happens before insert for the common path. A 23505 retry handles
 * concurrent requests that both miss the lookup and race on the partial unique
 * index ux_guests_phone_normalized_active.
 */
export async function resolveOrCreateGuest(
  client: AnyClient,
  input: GuestResolutionInput,
): Promise<ResolvedGuest> {
  const normalizedPhone = normalizeGuestPhone(input.phone);
  const patch = guestPatch(input);

  if (normalizedPhone) {
    const existing = await findActiveGuestByPhone(client, normalizedPhone);
    if (existing) {
      const { error } = await (client as any).from("guests").update(patch).eq("id", existing.id);
      if (error) throw error;
      return { id: existing.id, created: false };
    }
  }

  if (input.preferredGuestId) {
    const { error } = await (client as any)
      .from("guests")
      .update(patch)
      .eq("id", input.preferredGuestId);
    if (!error) return { id: input.preferredGuestId, created: false };

    if ((error as any)?.code !== "23505" || !normalizedPhone) throw error;
    const winner = await findActiveGuestByPhone(client, normalizedPhone);
    if (!winner) throw error;
    const { error: updateError } = await (client as any)
      .from("guests")
      .update(patch)
      .eq("id", winner.id);
    if (updateError) throw updateError;
    return { id: winner.id, created: false };
  }

  const insertRow = {
    ...patch,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    country: input.country?.trim() || null,
    source: input.source ?? "booking",
  };
  const { data, error } = await (client as any)
    .from("guests")
    .insert(insertRow)
    .select("id")
    .single();

  if (!error && data?.id) return { id: String(data.id), created: true };
  if ((error as any)?.code !== "23505" || !normalizedPhone) {
    throw error ?? new Error("Gagal menyimpan data tamu");
  }

  // Another request created the canonical guest after our initial lookup.
  const winner = await findActiveGuestByPhone(client, normalizedPhone);
  if (!winner) throw error;
  const { error: updateError } = await (client as any)
    .from("guests")
    .update(patch)
    .eq("id", winner.id);
  if (updateError) throw updateError;
  return { id: winner.id, created: false };
}
