/**
 * Utilitas Moota API v2: verifikasi webhook, parse mutasi, mode pencocokan.
 *
 * Sumber resmi:
 * - Signature: HMAC-SHA256(raw body, secret_token) hex, header `Signature`
 *   https://moota.co/tips-handling-webhook-dari-moota-jangan-langsung-proses-gunakan-async/
 *   https://www.postman.com/mootaapis/moota-s-public-workspace/collection/h596mge/moota-apis
 * - Payload webhook: array mutasi (account_number, date, description, amount, type CR/DB,
 *   balance, mutation_id, bank_id, …)
 * - API: GET https://app.moota.co/api/v2/mutation  Authorization: Bearer
 *   https://moota.gitbook.io/technical-docs/mutation
 * - Rate limit: 15 permintaan/menit (dokumentasi Postman)
 * - IP webhook yang disebut Moota: 103.236.201.178 (opsional, jangan fail-closed
 *   di belakang proxy jika IP sumber tidak sampai ke Worker)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { OFFICIAL_TRANSFER_ACCOUNT } from "@/lib/payment-account";

/** Samakan dengan TRANSFER_FEE_SURPLUS_TOLERANCE / RPC apply_payment_proof. */
const TRANSFER_FEE_SURPLUS_TOLERANCE = 6500;

export const MOOTA_DOCUMENTED_WEBHOOK_IP = "103.236.201.178";
export const MOOTA_API_BASE = "https://app.moota.co/api/v2";
export const DEFAULT_MUTATION_WINDOW_HOURS = 72;
export const DEFAULT_MUTATION_TIMEOUT_MINUTES = 120;

export type PaymentMatchMode = "proof_only" | "require_mutation";

export type MootaMutationType = "CR" | "DB";

export interface MootaMutation {
  mutation_id: string;
  account_number: string | null;
  date: string | null;
  description: string | null;
  amount: number;
  type: MootaMutationType;
  balance: number | null;
  bank_id: string | null;
  bank_type: string | null;
  raw: Record<string, unknown>;
}

export type EnvLike = Record<string, string | undefined>;

export function resolvePaymentMatchMode(env: EnvLike = process.env as EnvLike): PaymentMatchMode {
  const explicit = String(env.PAYMENT_MATCH_MODE ?? "").trim().toLowerCase();
  if (explicit === "proof_only" || explicit === "require_mutation") return explicit;
  const mootaActive = Boolean(String(env.MOOTA_WEBHOOK_SECRET ?? "").trim() || String(env.MOOTA_API_TOKEN ?? "").trim());
  return mootaActive ? "require_mutation" : "proof_only";
}

export function mutationWindowMs(env: EnvLike = process.env as EnvLike): number {
  const hours = Number(env.PAYMENT_MUTATION_WINDOW_HOURS ?? DEFAULT_MUTATION_WINDOW_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MUTATION_WINDOW_HOURS;
  return safe * 60 * 60 * 1000;
}

export function mutationTimeoutMs(env: EnvLike = process.env as EnvLike): number {
  const minutes = Number(env.PAYMENT_MUTATION_TIMEOUT_MINUTES ?? DEFAULT_MUTATION_TIMEOUT_MINUTES);
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MUTATION_TIMEOUT_MINUTES;
  return safe * 60 * 1000;
}

/** HMAC-SHA256 hex (sama dengan hash_hmac('sha256', $payload, $secret) di PHP). */
export function mootaSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyMootaSignature(rawBody: string, secret: string, header: string | null | undefined): boolean {
  const token = String(secret ?? "").trim();
  const gotRaw = String(header ?? "").trim();
  if (!token || !gotRaw) return false;
  const expected = mootaSignature(rawBody, token).toLowerCase();
  const got = gotRaw.replace(/^sha256=/i, "").toLowerCase();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function clientIpFromRequest(request: Request): string | null {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Whitelist IP hanya ditegakkan bila MOOTA_ENFORCE_IP=true (atau 1).
 * Default longgar karena Worker/Lovable sering melihat IP proxy, bukan 103.236.201.178.
 */
export function isMootaIpAllowed(ip: string | null, env: EnvLike = process.env as EnvLike): boolean {
  const enforce = /^(1|true|yes)$/i.test(String(env.MOOTA_ENFORCE_IP ?? "").trim());
  if (!enforce) return true;
  const raw = String(env.MOOTA_WEBHOOK_IP_ALLOWLIST ?? MOOTA_DOCUMENTED_WEBHOOK_IP).trim();
  const allowed = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return !!ip && allowed.includes(ip);
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function parseMootaAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/,/g, ""));
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

export function normalizeMutationType(value: unknown): MootaMutationType | null {
  const t = String(value ?? "").trim().toUpperCase();
  if (t === "CR" || t === "CREDIT") return "CR";
  if (t === "DB" || t === "DEBIT") return "DB";
  return null;
}

export function parseMootaMutation(input: unknown): MootaMutation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const mutationId = String(row.mutation_id ?? row.token ?? "").trim();
  if (!mutationId) return null;
  const type = normalizeMutationType(row.type);
  if (!type) return null;
  const amount = parseMootaAmount(row.amount);
  if (amount == null || amount < 0) return null;
  const bank = row.bank && typeof row.bank === "object" && !Array.isArray(row.bank)
    ? (row.bank as Record<string, unknown>)
    : null;
  return {
    mutation_id: mutationId,
    account_number: String(row.account_number ?? bank?.account_number ?? "").trim() || null,
    date: String(row.date ?? "").trim() || null,
    description: String(row.description ?? "").trim() || null,
    amount,
    type,
    balance: parseMootaAmount(row.balance),
    bank_id: String(row.bank_id ?? bank?.bank_id ?? bank?.token ?? "").trim() || null,
    bank_type: String(bank?.bank_type ?? row.bank_type ?? "").trim() || null,
    raw: row,
  };
}

/** Terima array resmi, atau { data: [] } dari API list. */
export function parseMootaMutationList(payload: unknown): { ok: true; mutations: MootaMutation[] } | { ok: false; reason: string } {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!list) return { ok: false, reason: "invalid_payload" };
  const mutations: MootaMutation[] = [];
  for (const item of list) {
    const parsed = parseMootaMutation(item);
    if (parsed) mutations.push(parsed);
  }
  return { ok: true, mutations };
}

export function allowedAccountNumbers(env: EnvLike = process.env as EnvLike): string[] {
  const configured = String(env.MOOTA_ACCOUNT_NUMBERS ?? env.MOOTA_ACCOUNT_NUMBER ?? "")
    .split(/[,\s]+/)
    .map(digits)
    .filter((d) => d.length >= 6);
  const official = digits(OFFICIAL_TRANSFER_ACCOUNT.accountNumber);
  const all = configured.length ? configured : official ? [official] : [];
  return [...new Set(all)];
}

export function isAllowedMootaAccount(accountNumber: string | null | undefined, env: EnvLike = process.env as EnvLike): boolean {
  const allowed = allowedAccountNumbers(env);
  if (!allowed.length) return true;
  const got = digits(accountNumber);
  return !!got && allowed.includes(got);
}

export function allowedBankIds(env: EnvLike = process.env as EnvLike): string[] {
  return String(env.MOOTA_BANK_IDS ?? env.MOOTA_BANK_ID ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedMootaBank(bankId: string | null | undefined, env: EnvLike = process.env as EnvLike): boolean {
  const allowed = allowedBankIds(env);
  if (!allowed.length) return true;
  const got = String(bankId ?? "").trim();
  return !!got && allowed.includes(got);
}

const BOOKING_CODE_RE = /\b(PG|PMH|PGS)[- ]?[A-Z0-9]{3,}\b/i;

export function extractBookingCodeFromText(text: string | null | undefined): string | null {
  const match = String(text ?? "").toUpperCase().match(BOOKING_CODE_RE);
  if (!match) return null;
  return match[0].replace(/\s+/g, "").replace(/^(PG|PMH|PGS)-?/, (_full, prefix: string) => `${prefix}-`);
}

/**
 * Mutasi (nominal diterima) vs tagihan yang akan dicatat.
 * Sama dengan RPC: lebih ≤ 6.500 boleh; kurang bayar ditolak.
 */
export function mutationCoversAmount(mutationAmount: number, expectedAmount: number): boolean {
  if (!(expectedAmount > 0) || !(mutationAmount > 0)) return false;
  const fee = Math.round(mutationAmount) - Math.round(expectedAmount);
  return fee >= 0 && fee <= TRANSFER_FEE_SURPLUS_TOLERANCE;
}

export function parseMutationDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoish = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = Date.parse(isoish);
  if (Number.isFinite(parsed)) return new Date(parsed);
  return null;
}

export function withinMutationWindow(
  mutationDate: Date | string | null | undefined,
  proofDate: Date | string | null | undefined,
  windowMs: number,
): boolean {
  const a = mutationDate instanceof Date ? mutationDate : parseMutationDate(String(mutationDate ?? ""));
  const b = proofDate instanceof Date ? proofDate : parseMutationDate(String(proofDate ?? ""));
  if (!a || !b) return true;
  return Math.abs(a.getTime() - b.getTime()) <= windowMs;
}

/** Rentang kalender "hari ini" di zona WIB (Asia/Jakarta). */
export function jakartaDayRange(now: Date = new Date()): { startIso: string; endIso: string; label: string; day: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(now);
  const start = new Date(`${day}T00:00:00+07:00`);
  const end = new Date(`${day}T24:00:00+07:00`);
  const label = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
  return { startIso: start.toISOString(), endIso: end.toISOString(), label, day };
}

export function mootaSignatureHeader(request: Request): string | null {
  return request.headers.get("Signature") ?? request.headers.get("signature") ?? request.headers.get("X-Signature");
}
