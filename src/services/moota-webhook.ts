/**
 * Handler HTTP webhook Moota: verifikasi signature atas raw body, simpan
 * mutasi secara idempotent, lalu cocokkan (atau jadwalkan lewat waitUntil).
 */
import {
  clientIpFromRequest,
  isMootaIpAllowed,
  mootaSignatureHeader,
  parseMootaMutationList,
  verifyMootaSignature,
  type EnvLike,
} from "@/lib/moota";
import { ingestMootaMutations, type MutationMatchDeps } from "./bank-mutation-match";

export type WebhookHandleResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export async function handleMootaWebhookRequest(params: {
  rawBody: string;
  signature: string | null;
  ip: string | null;
  supabase: any;
  env?: EnvLike;
  deps?: MutationMatchDeps;
  /** Setelah persist, proses matching. Default: segera. */
  matchNow?: boolean;
}): Promise<WebhookHandleResult> {
  const env = params.env ?? (process.env as EnvLike);
  const secret = String(env.MOOTA_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    return { httpStatus: 503, body: { ok: false, reason: "not_configured" } };
  }
  if (!isMootaIpAllowed(params.ip, env)) {
    return { httpStatus: 401, body: { ok: false, reason: "ip_denied" } };
  }
  if (!verifyMootaSignature(params.rawBody, secret, params.signature)) {
    return { httpStatus: 401, body: { ok: false, reason: "invalid_signature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(params.rawBody);
  } catch {
    return { httpStatus: 400, body: { ok: false, reason: "invalid_json" } };
  }
  const parsed = parseMootaMutationList(payload);
  if (!parsed.ok) return { httpStatus: 400, body: { ok: false, reason: parsed.reason } };

  if (params.matchNow === false) {
    // Persist only — pemanggil menunda matching.
    let stored = 0;
    const { upsertBankMutation } = await import("./bank-mutation-match");
    for (const mutation of parsed.mutations) {
      const r = await upsertBankMutation(params.supabase, mutation);
      if ("error" in r) {
        if (r.missing) return { httpStatus: 503, body: { ok: false, reason: "not_migrated" } };
        return { httpStatus: 500, body: { ok: false, reason: r.error } };
      }
      if (r.inserted) stored++;
    }
    return { httpStatus: 200, body: { ok: true, received: parsed.mutations.length, stored } };
  }

  const summary = await ingestMootaMutations({
    supabase: params.supabase,
    mutations: parsed.mutations,
    deps: { ...params.deps, env },
  });
  if (summary.missing) return { httpStatus: 503, body: { ok: false, reason: "not_migrated", ...summary } };
  if (summary.errors && !summary.stored && summary.applied === 0) {
    return { httpStatus: 500, body: { ok: false, ...summary } };
  }
  return { httpStatus: 200, body: { ok: true, received: parsed.mutations.length, ...summary } };
}

export function readWebhookRequestMeta(request: Request): { signature: string | null; ip: string | null } {
  return { signature: mootaSignatureHeader(request), ip: clientIpFromRequest(request) };
}
