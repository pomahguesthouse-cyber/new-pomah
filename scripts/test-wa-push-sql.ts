import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Guest WhatsApp push (20260930140000_wa_inbound_push_hardening.sql).
 * 1. Static checks always run.
 * 2. Behavioural checks run against an in-memory Postgres when
 *    @electric-sql/pglite is installed (not a repo dependency; skipped otherwise):
 *      npm i --no-save @electric-sql/pglite
 */
const file = new URL(
  "../supabase/migrations/20260930140000_wa_inbound_push_hardening.sql",
  import.meta.url,
);
const sql = readFileSync(file, "utf8");

// ── static ───────────────────────────────────────────────────────────────────
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.staff_push_seen/);
assert.match(sql, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
assert.match(sql, /direction IS DISTINCT FROM 'in'/);
assert.match(sql, /COALESCE\(NEW\.from_me, false\)/);
assert.match(sql, /COALESCE\(NEW\.ai_draft, false\)/);
assert.match(sql, /\(sync\|history\|backfill\|mirror\|import\)/);
assert.match(sql, /char_length\(v\) > 100/);
assert.match(sql, /'\/admin\/whatsapp\?thread=' \|\| NEW\.thread_id::text/);
assert.match(sql, /interval '30 seconds'/);
assert.doesNotMatch(sql, /webhook_secret\s*=\s*'/, "no secrets in migration");
assert.doesNotMatch(sql, /DROP TABLE|DROP FUNCTION/i, "migration must not drop objects");
for (const label of ["[Foto]", "[Dokumen]", "[Video]", "[Audio]", "[Stiker]", "[Lokasi]"]) {
  assert.ok(sql.includes(label), `label ${label}`);
}

// Route contract: the tap URL must be openable by the native handler.
const route = readFileSync(new URL("../src/routes/admin/whatsapp.tsx", import.meta.url), "utf8");
assert.match(route, /search\.thread/);
assert.match(route, /initialThreadId=\{thread \?\? null\}/);
const nativeAdmin = readFileSync(new URL("../src/lib/native-admin.ts", import.meta.url), "utf8");
assert.match(nativeAdmin, /url\.startsWith\("\/admin"\)/);

console.log("wa push sql static ok");

// ── behavioural (optional) ───────────────────────────────────────────────────
type Db = {
  exec: (q: string) => Promise<unknown>;
  query: (q: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
};
let PGlite: (new () => Db) | null = null;
try {
  const name = "@electric-sql/pglite";
  PGlite = ((await import(name)) as { PGlite: new () => Db }).PGlite;
} catch {
  console.log("pglite not installed; skipping behavioural checks");
}

if (PGlite) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table whatsapp_threads(id uuid primary key default gen_random_uuid(), display_name text, phone text);
    create table whatsapp_messages(id uuid primary key default gen_random_uuid(), thread_id uuid, direction text, body text,
      ai_draft boolean default false, sent_at timestamptz default now(), metadata jsonb, wpp_id text,
      source text default 'webhook', external_message_id text, from_me boolean);
    create table pushed(payload jsonb, at timestamptz default clock_timestamp());
    create function public.enqueue_staff_push(p jsonb) returns void language sql as $$ insert into pushed(payload) values (p) $$;
  `);
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run

  const th = async (name: string | null, phone: string) =>
    (
      await db.query(
        "insert into whatsapp_threads(display_name,phone) values ($1,$2) returning id",
        [name, phone],
      )
    ).rows[0]!.id as string;
  const t1 = await th("Budi", "62811");
  const t2 = await th(null, "62822");
  const ins = async (o: Record<string, unknown>) => {
    const row = { thread_id: t1, direction: "in", body: "hi", ...o };
    const k = Object.keys(row);
    await db.query(
      `insert into whatsapp_messages(${k.join(",")}) values (${k.map((_, i) => `$${i + 1}`).join(",")})`,
      k.map((x) => (row as Record<string, unknown>)[x]),
    );
  };
  const count = async () =>
    (await db.query("select count(*)::int c from pushed")).rows[0]!.c as number;
  const last = async () =>
    (await db.query("select payload from pushed order by at desc limit 1")).rows[0]
      ?.payload as Record<string, string>;
  const reset = () => db.exec("delete from staff_push_throttle");

  await ins({ wpp_id: "A1", body: "Halo kak, ada kamar kosong besok?" });
  assert.equal(await count(), 1, "first inbound message pushes (throttle does not drop it)");
  let p = await last();
  assert.equal(p.body, "Budi: Halo kak, ada kamar kosong besok?");
  assert.equal(p.url, `/admin/whatsapp?thread=${t1}`);
  assert.ok(p.url!.startsWith("/admin"));

  await ins({ wpp_id: "A2" });
  assert.equal(await count(), 1, "second message inside 30s is throttled");
  await reset();
  await ins({ wpp_id: "A1" });
  assert.equal(await count(), 1, "duplicate wpp_id after the throttle window does not push");
  await ins({ wpp_id: null, external_message_id: "E1" });
  assert.equal(await count(), 2);
  await reset();
  await ins({ wpp_id: null, external_message_id: "E1" });
  assert.equal(await count(), 2, "duplicate external_message_id does not push");

  await reset();
  await ins({ direction: "out", wpp_id: "O1" });
  await ins({ from_me: true, wpp_id: "F1" });
  await ins({ ai_draft: true, wpp_id: "D1" });
  for (const s of ["wppconnect_sync", "sync", "history", "backfill", "mirror"]) {
    await ins({ source: s, wpp_id: `S-${s}` });
  }
  await ins({ wpp_id: "sim-628-1-2" });
  await ins({ body: "[FORM_SUBMITTED:abc]", wpp_id: null });
  await ins({ sent_at: new Date(Date.now() - 3600e3).toISOString(), wpp_id: "OLD" });
  assert.equal(
    await count(),
    2,
    "outbound/from_me/ai_draft/sync/simulator/form/old rows never push",
  );

  const preview = async (b: string, m: unknown = null) =>
    (
      await db.query("select public.wa_push_preview($1,$2::jsonb) v", [
        b,
        m ? JSON.stringify(m) : null,
      ])
    ).rows[0]!.v as string;
  const cases: Array<[string, unknown, string]> = [
    ["[Lampiran document]", null, "[Dokumen]"],
    ["[Lampiran documentMessage]", null, "[Dokumen]"],
    ["[Lampiran application/pdf]", null, "[Dokumen]"],
    ["[Lampiran image]", null, "[Foto]"],
    ["[Lampiran imageMessage]", null, "[Foto]"],
    ["[Tamu mengirim lampiran bukti transfer pembayaran]", null, "[Foto]"],
    ["[Lampiran video]", null, "[Video]"],
    ["[Lampiran audio]", null, "[Audio]"],
    ["[Lampiran stickerMessage]", null, "[Stiker]"],
    ["[Lampiran location]", null, "[Lokasi]"],
    ["", { media_type: "image" }, "[Foto]"],
    ["", { media_type: "document" }, "[Dokumen]"],
    ["a\n\n b   c", null, "a b c"],
  ];
  for (const [b, m, exp] of cases)
    assert.equal(await preview(b, m), exp, `preview ${JSON.stringify(b)}`);
  assert.equal([...(await preview("x".repeat(300)))].length, 100, "long text is trimmed to 100");

  await reset();
  await ins({ thread_id: t2, wpp_id: "P1", body: "[Lampiran document]" });
  p = await last();
  assert.equal(p.body, "62822: [Dokumen]", "phone number is the name fallback");
  console.log("wa push sql behavioural ok");
}
