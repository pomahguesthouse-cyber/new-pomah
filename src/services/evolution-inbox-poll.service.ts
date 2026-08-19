/**
 * Poller inbox Evolution API — jaring pengaman bila webhook tidak terkirim.
 *
 * Insiden 19 Agu 2026: setelah VPS di-setup ulang, instance Evolution tetap
 * "open" dan pesan tamu masuk ke gateway, tetapi event MESSAGES_UPSERT tidak
 * pernah sampai ke /api/evolution (webhook terdaftar & endpoint sehat, jadi
 * masalahnya di sisi pengirim event). Akibatnya chatbot diam total.
 *
 * Poller ini menarik pesan terbaru lewat `chat/findMessages`, lalu mengirim
 * ulang tiap pesan baru ke handler webhook milik aplikasi sendiri, sehingga
 * seluruh pipeline (dedup → simpan → antrian → balasan) tidak berubah.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE_URL = (process.env.EVOLUTION_BASE_URL ?? "").replace(/\/+$/, "");
const INSTANCE = process.env.EVOLUTION_INSTANCE ?? "";

/** Ambang aman: pesan lebih lama dari ini tidak pernah diproses ulang. */
const MAX_LOOKBACK_SECONDS = 15 * 60;
const FETCH_LIMIT = 30;

type PollResult = {
  ok: boolean;
  fetched: number;
  replayed: number;
  skipped: number;
  reason?: string;
};

function apiKey(): string {
  return process.env.EVOLUTION_API_KEY ?? "";
}

function webhookToken(): string {
  return process.env.EVOLUTION_WEBHOOK_TOKEN || process.env.WPP_WEBHOOK_TOKEN || "";
}

function recordsOf(payload: unknown): Array<Record<string, unknown>> {
  const anyPayload = payload as any;
  const records = anyPayload?.messages?.records ?? anyPayload?.records ?? anyPayload;
  return Array.isArray(records) ? (records as Array<Record<string, unknown>>) : [];
}

function timestampOf(record: Record<string, unknown>): number {
  const raw = (record as any).messageTimestamp;
  const num = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 0;
  return Number.isFinite(num) ? num : 0;
}

/** Cursor terakhir (epoch detik) supaya pesan yang sama tidak diputar dua kali. */
async function readCursor(): Promise<number> {
  const { data } = await (supabaseAdmin as any)
    .from("wa_wpp_sync_state")
    .select("last_cursor, last_synced_at")
    .eq("sync_type", "evolution_poll")
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cursor = Number(data?.last_cursor ?? 0);
  return Number.isFinite(cursor) ? cursor : 0;
}

async function writeCursor(cursor: number, stats: PollResult): Promise<void> {
  const nowIso = new Date().toISOString();
  await (supabaseAdmin as any).from("wa_wpp_sync_state").insert({
    sync_type: "evolution_poll",
    status: stats.ok ? "success" : "error",
    last_cursor: String(cursor),
    last_synced_at: nowIso,
    started_at: nowIso,
    finished_at: nowIso,
    imported_count: stats.replayed,
    skipped_count: stats.skipped,
    error_message: stats.reason ?? null,
    metadata: { fetched: stats.fetched },
  });

  // Simpan hanya jejak terbaru; tabel ini murni operasional.
  const { data: old } = await (supabaseAdmin as any)
    .from("wa_wpp_sync_state")
    .select("id")
    .eq("sync_type", "evolution_poll")
    .order("last_synced_at", { ascending: false })
    .range(50, 200);
  const ids = ((old ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 0) {
    await (supabaseAdmin as any).from("wa_wpp_sync_state").delete().in("id", ids);
  }
}

/**
 * Tarik pesan terbaru dari Evolution lalu putar ulang ke webhook internal.
 * `origin` dipakai supaya poller memakai handler webhook yang sama persis.
 */
export async function pollEvolutionInbox(origin: string): Promise<PollResult> {
  if (!BASE_URL || !INSTANCE) {
    return { ok: false, fetched: 0, replayed: 0, skipped: 0, reason: "evolution belum dikonfigurasi" };
  }
  const token = webhookToken();
  if (!token) {
    return { ok: false, fetched: 0, replayed: 0, skipped: 0, reason: "webhook token belum diset" };
  }

  let records: Array<Record<string, unknown>> = [];
  try {
    const res = await fetch(`${BASE_URL}/chat/findMessages/${encodeURIComponent(INSTANCE)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey() },
      body: JSON.stringify({ where: {}, limit: FETCH_LIMIT }),
    });
    if (!res.ok) {
      return {
        ok: false,
        fetched: 0,
        replayed: 0,
        skipped: 0,
        reason: `findMessages HTTP ${res.status}`,
      };
    }
    records = recordsOf(await res.json());
  } catch (e) {
    return { ok: false, fetched: 0, replayed: 0, skipped: 0, reason: `findMessages gagal: ${e}` };
  }

  const cursor = await readCursor();
  const floor = Math.max(cursor, Math.floor(Date.now() / 1000) - MAX_LOOKBACK_SECONDS);

  const fresh = records
    .filter((r) => timestampOf(r) > floor)
    .sort((a, b) => timestampOf(a) - timestampOf(b));

  let replayed = 0;
  for (const record of fresh) {
    try {
      const res = await fetch(`${origin}/api/evolution?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-evolution-replay": "poll" },
        body: JSON.stringify({
          event: "messages.upsert",
          instance: INSTANCE,
          data: record,
        }),
      });
      if (res.ok) replayed += 1;
      else console.warn(`[EvolutionPoll] replay HTTP ${res.status}`);
    } catch (e) {
      console.warn("[EvolutionPoll] replay gagal:", e);
    }
  }

  const maxTs = fresh.length > 0 ? timestampOf(fresh[fresh.length - 1]!) : cursor;
  const result: PollResult = {
    ok: true,
    fetched: records.length,
    replayed,
    skipped: records.length - fresh.length,
  };
  await writeCursor(Math.max(cursor, maxTs), result).catch((e) =>
    console.warn("[EvolutionPoll] simpan cursor gagal:", e),
  );

  if (replayed > 0) {
    console.warn(`[EvolutionPoll] ${replayed} pesan diputar ulang (webhook kemungkinan mati)`);
  }
  return result;
}
