/**
 * Cadangan polling API Moota bila webhook terlewat.
 * GET /api/v2/mutation, Bearer token, batas 15 hit/menit — 1 kali per cron cukup.
 * https://moota.gitbook.io/technical-docs/mutation
 * https://moota.gitbook.io/technical-docs/authentication
 */
import { MOOTA_API_BASE, parseMootaMutationList, type EnvLike } from "@/lib/moota";
import { ingestMootaMutations, type MutationMatchDeps } from "./bank-mutation-match";

export interface MootaPollResult {
  ok: boolean;
  reason?: string;
  fetched?: number;
  stored?: number;
  applied?: number;
  status?: number;
}

export async function pollMootaMutations(params: {
  supabase: any;
  env?: EnvLike;
  deps?: MutationMatchDeps;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<MootaPollResult> {
  const env = params.env ?? (process.env as EnvLike);
  const token = String(env.MOOTA_API_TOKEN ?? "").trim();
  if (!token) return { ok: true, reason: "no_token", fetched: 0 };

  const now = params.now ?? new Date();
  const start = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = new URL(`${MOOTA_API_BASE}/mutation`);
  url.searchParams.set("type", "CR");
  url.searchParams.set("start_date", fmt(start));
  url.searchParams.set("end_date", fmt(now));
  url.searchParams.set("per_page", "50");
  const bankId = String(env.MOOTA_BANK_ID ?? env.MOOTA_BANK_IDS ?? "").split(/[,\s]+/)[0];
  if (bankId) url.searchParams.set("bank", bankId);

  const fetchImpl = params.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 429) return { ok: false, reason: "rate_limited", status: 429 };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized", status: res.status };
  if (!res.ok) return { ok: false, reason: `http_${res.status}`, status: res.status };

  const json = await res.json().catch(() => null);
  const parsed = parseMootaMutationList(json);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const summary = await ingestMootaMutations({
    supabase: params.supabase,
    mutations: parsed.mutations,
    deps: { ...params.deps, env },
  });
  if (summary.missing) return { ok: false, reason: "not_migrated", fetched: parsed.mutations.length };
  return {
    ok: true,
    fetched: parsed.mutations.length,
    stored: summary.stored,
    applied: summary.applied,
  };
}
