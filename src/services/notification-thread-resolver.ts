import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = SupabaseClient<any>;

export interface NotificationThreadCandidate {
  id: string;
  phone?: string | null;
  canonical_phone?: string | null;
  external_chat_id?: string | null;
  lid_alias?: string | null;
  last_message_at?: string | null;
}

function normalizeIdentity(value: string | null | undefined): string {
  let digits = String(value ?? "").split("@", 1)[0].replace(/\D/g, "");
  if (digits.startsWith("620")) digits = "62" + digits.slice(3);
  else if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  else if (digits.startsWith("8")) digits = "62" + digits;
  return digits;
}

function identityScore(row: NotificationThreadCandidate, target: string): number {
  if (normalizeIdentity(row.canonical_phone) === target) return 400;
  if (normalizeIdentity(row.external_chat_id) === target) return 300;
  if (normalizeIdentity(row.lid_alias) === target) return 200;
  if (normalizeIdentity(row.phone) === target) return 100;
  return 0;
}

function activityTime(row: NotificationThreadCandidate): number {
  return Date.parse(row.last_message_at ?? "") || 0;
}

/**
 * Prefer the canonical/LID-aware conversation over a notification-only thread
 * whose only matching identity is the phone column.
 */
export function pickNotificationThread(
  candidates: NotificationThreadCandidate[],
  phone: string,
): NotificationThreadCandidate | null {
  const target = normalizeIdentity(phone);
  if (!target) return null;

  return (
    candidates
      .filter((row) => identityScore(row, target) > 0)
      .sort((a, b) => identityScore(b, target) - identityScore(a, target) || activityTime(b) - activityTime(a))[0] ??
    null
  );
}

/**
 * Resolve a WhatsApp thread using every persisted identity alias. This keeps
 * transactional booking messages in the same conversation as inbound LID chats.
 */
export async function findNotificationThreadId(
  supabase: AnyClient,
  phone: string,
): Promise<string | null> {
  const target = normalizeIdentity(phone);
  if (!target) return null;

  const suffixCandidates = [target, target + "@c.us", target + "@s.whatsapp.net"];
  const filter = [
    "phone.eq." + target,
    "canonical_phone.eq." + target,
    ...suffixCandidates.map((value) => "external_chat_id.eq." + value),
    ...suffixCandidates.map((value) => "lid_alias.eq." + value),
  ].join(",");

  const { data, error } = await (supabase as any)
    .from("whatsapp_threads")
    .select("id, phone, canonical_phone, external_chat_id, lid_alias, last_message_at")
    .or(filter)
    .limit(20);

  if (error) {
    console.warn("[NotificationThread] identity lookup failed:", error.message);
    return null;
  }

  return pickNotificationThread((data ?? []) as NotificationThreadCandidate[], target)?.id ?? null;
}
