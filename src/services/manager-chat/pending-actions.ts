/**
 * Aksi write manajer yang menunggu konfirmasi eksplisit YA/KONFIRMASI.
 * In-memory + (opsional) tabel `manager_chat_pending` setelah SQL manual
 * diterapkan. TTL 15 menit.
 */

import { createHash } from "node:crypto";

export const PENDING_TTL_MS = 15 * 60 * 1000;

export interface PendingManagerAction {
  phone: string;
  toolName: string;
  args: Record<string, unknown>;
  preview: string;
  createdAt: number;
  fingerprint: string;
  writeIdempotencyKey: string;
  command?: string;
}

export interface LastManagerListQuery {
  phone: string;
  toolName: string;
  args: Record<string, unknown>;
  updatedAt: number;
}

const pendingByPhone = new Map<string, PendingManagerAction>();
const lastListByPhone = new Map<string, LastManagerListQuery>();

export function resetManagerPendingActions(): void {
  pendingByPhone.clear();
  lastListByPhone.clear();
}

export function fingerprintAction(toolName: string, args: Record<string, unknown>): string {
  const { confirmed, ...rest } = args ?? {};
  return createHash("sha256").update(`${toolName}:${JSON.stringify(rest)}`).digest("hex").slice(0, 24);
}

export function rememberPendingAction(action: Omit<PendingManagerAction, "createdAt" | "fingerprint" | "writeIdempotencyKey"> & {
  fingerprint?: string;
  writeIdempotencyKey?: string;
  createdAt?: number;
}): PendingManagerAction {
  const fingerprint = action.fingerprint ?? fingerprintAction(action.toolName, action.args);
  const stored: PendingManagerAction = {
    ...action,
    createdAt: action.createdAt ?? Date.now(),
    fingerprint,
    writeIdempotencyKey: action.writeIdempotencyKey ?? `mgr:${action.phone}:${fingerprint}`,
  };
  pendingByPhone.set(action.phone, stored);
  return stored;
}

export function getPendingAction(phone: string, now = Date.now()): PendingManagerAction | null {
  const stored = pendingByPhone.get(phone);
  if (!stored) return null;
  if (now - stored.createdAt > PENDING_TTL_MS) {
    pendingByPhone.delete(phone);
    return null;
  }
  return stored;
}

export function clearPendingAction(phone: string): void {
  pendingByPhone.delete(phone);
}

export function rememberLastListQuery(query: LastManagerListQuery): void {
  lastListByPhone.set(query.phone, query);
}

export function getLastListQuery(phone: string, now = Date.now()): LastManagerListQuery | null {
  const stored = lastListByPhone.get(phone);
  if (!stored) return null;
  if (now - stored.updatedAt > PENDING_TTL_MS) {
    lastListByPhone.delete(phone);
    return null;
  }
  return stored;
}
