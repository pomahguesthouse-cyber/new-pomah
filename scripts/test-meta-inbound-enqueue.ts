/**
 * Redelivery webhook Meta: pesan tersimpan tanpa antrian harus di-enqueue,
 * redelivery yang sudah mengantri atau sudah dibalas tidak boleh mengantri lagi.
 *
 * Tidak mengirim WhatsApp. Admin-nya palsu di memori.
 *
 * Skenario produksi (26 Sep 2026, "pagi"): request pertama menyimpan pesan lalu
 * terputus sebelum queueUpsert; gateway mengantar ulang delivery yang sama
 * dengan attempts masih 0 (isRetry=false).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assessInboundCoverage,
  decideInboundEnqueue,
  formatInboundSkipNote,
} from "../src/services/wa-inbound-enqueue";
import { handleMetaInboundMessage } from "../src/services/whatsapp-meta-inbox.service";

const PHONE = "6281234567890";
const THREAD = "thread-1";

type Row = Record<string, any>;

function makeHarness(options?: { failUpserts?: number }) {
  let failUpserts = options?.failUpserts ?? 0;
  const db = {
    messages: [] as Row[],
    queue: [] as Row[],
    threads: [] as Row[],
    trace: [] as string[],
    upserts: 0,
    ctx: {
      thread_id: THREAD,
      thread_phone: PHONE,
      canonical_phone: PHONE,
      auto_reply_enabled: true,
      smart_delay_config: null as Record<string, unknown> | null,
      wpp_token: "test-token",
    },
  };

  function rowsFor(table: string): Row[] {
    if (table === "whatsapp_messages") return db.messages;
    if (table === "wa_conversation_queue") return db.queue;
    if (table === "whatsapp_threads") return db.threads;
    throw new Error(`unexpected table ${table}`);
  }

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "update" = "select";
    let patch: Row | null = null;
    let lim = 1000;
    const api: any = {
      select() {
        return api;
      },
      update(next: Row) {
        mode = "update";
        patch = next;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((row) => vals.includes(row[col]));
        return api;
      },
      gte(col: string, val: unknown) {
        filters.push((row) => String(row[col]) >= String(val));
        return api;
      },
      or() {
        return api;
      },
      limit(n: number) {
        lim = n;
        return api;
      },
      then(onOk: (v: { data: unknown; error: null }) => unknown, onErr?: (e: unknown) => unknown) {
        const tableRows = rowsFor(table);
        if (mode === "update") {
          for (const row of tableRows) {
            if (filters.every((fn) => fn(row)) && patch) Object.assign(row, patch);
          }
          return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
        }
        const data = tableRows.filter((row) => filters.every((fn) => fn(row))).slice(0, lim);
        return Promise.resolve({ data, error: null }).then(onOk, onErr);
      },
    };
    return api;
  }

  const admin = {
    from,
    async rpc(name: string, args: Record<string, any> = {}) {
      if (name === "receive_whatsapp_message") {
        db.trace.push("save");
        const existing = db.messages.find((m) => m.wpp_id === args.p_wpp_id);
        if (existing) {
          return { data: [{ message_id: existing.id, is_duplicate: true }], error: null };
        }
        const id = `msg-${db.messages.length + 1}`;
        db.messages.push({
          id,
          thread_id: db.ctx.thread_id,
          body: args.p_body,
          direction: "in",
          sent_at: new Date().toISOString(),
          wpp_id: args.p_wpp_id,
          metadata: {},
        });
        return { data: [{ message_id: id, is_duplicate: false }], error: null };
      }
      if (name === "get_autoreply_context") {
        return { data: db.ctx, error: null };
      }
      if (name === "save_message_metadata") {
        db.trace.push("metadata");
        const msg = db.messages.find((m) => m.id === args.p_message_id);
        if (msg) msg.metadata = { ...(msg.metadata ?? {}), ...args.p_metadata };
        return { data: null, error: null };
      }
      if (name === "wa_queue_upsert") {
        db.trace.push("enqueue");
        if (failUpserts > 0) {
          failUpserts -= 1;
          return { data: null, error: { message: "connection reset" } };
        }
        db.upserts += 1;
        const pending = db.queue.find(
          (q) => q.phone === args.p_phone && (q.status === "pending" || q.status === "waiting"),
        );
        if (pending) {
          pending.last_message_id = args.p_message_id;
          pending.last_message_body = args.p_body;
          pending.message_count += 1;
          pending.status = "waiting";
          return {
            data: [{ entry_id: pending.id, sleep_ms: args.p_delay_ms, is_new_burst: false }],
            error: null,
          };
        }
        const id = `q-${db.queue.length + 1}`;
        db.queue.push({
          id,
          phone: args.p_phone,
          thread_id: args.p_thread_id,
          last_message_id: args.p_message_id,
          last_message_body: args.p_body,
          status: "pending",
          created_at: new Date().toISOString(),
          message_count: 1,
        });
        return {
          data: [{ entry_id: id, sleep_ms: args.p_delay_ms, is_new_burst: true }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  return { db, admin };
}

function inbound(id: string, body = "pagi") {
  return {
    value: { contacts: [{ profile: { name: "Tamu" } }] } as Record<string, unknown>,
    message: { id, from: PHONE, type: "text", text: { body } },
  };
}

async function withLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return lines;
}

function messageOf(db: ReturnType<typeof makeHarness>["db"], wppId: string) {
  const msg = db.messages.find((m) => m.wpp_id === wppId);
  assert.ok(msg, `pesan ${wppId} tersimpan`);
  return msg;
}

// ─── Keputusan murni (webhook dan safety-net memakai fungsi yang sama) ──────

assert.deepEqual(
  decideInboundEnqueue({
    queuedForMessage: false,
    activeQueueForThread: false,
    outboundAfter: false,
    autoReplyEnabled: true,
  }),
  { action: "enqueue" },
);
assert.equal(
  decideInboundEnqueue({
    queuedForMessage: true,
    activeQueueForThread: false,
    outboundAfter: false,
    autoReplyEnabled: true,
  }).action,
  "skip",
);
assert.deepEqual(
  decideInboundEnqueue({
    queuedForMessage: false,
    activeQueueForThread: false,
    outboundAfter: true,
    autoReplyEnabled: true,
  }),
  { action: "skip", reason: "duplicate_already_replied" },
);
assert.equal(
  (
    decideInboundEnqueue({
      queuedForMessage: false,
      activeQueueForThread: true,
      outboundAfter: false,
      autoReplyEnabled: true,
    }) as { reason: string }
  ).reason,
  "duplicate_active_queue",
);
assert.equal(
  (
    decideInboundEnqueue({
      queuedForMessage: true,
      activeQueueForThread: false,
      outboundAfter: false,
      autoReplyEnabled: false,
    }) as { reason: string }
  ).reason,
  "auto_reply_disabled",
);
assert.equal(formatInboundSkipNote([]), null);
assert.equal(
  formatInboundSkipNote(["duplicate_already_queued", "duplicate_already_queued", "auto_reply_disabled"]),
  "skip:duplicate_already_queued|auto_reply_disabled",
);

const inboxSrc = fs.readFileSync("src/services/whatsapp-meta-inbox.service.ts", "utf8");
assert.equal(
  inboxSrc.includes("duplicate && !isRetry"),
  false,
  "return diam pada duplikat non-retry adalah penyebab pesan tanpa antrian",
);
const recoverySrc = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.match(recoverySrc, /assessInboundCoverage/);
assert.match(recoverySrc, /stage: "recheck"/);

// ─── Request pertama terputus setelah simpan; redelivery mengantri ───────────

{
  const { db, admin } = makeHarness({ failUpserts: 1 });
  const { value, message } = inbound("wamid.PAGI");
  const logs = await withLogs(async () => {
    await assert.rejects(
      () => handleMetaInboundMessage(admin as never, value, message, false),
      /queueUpsert gagal/,
    );
  });
  assert.equal(db.messages.length, 1, "pesan tetap tersimpan");
  assert.equal(db.queue.length, 0, "antrian belum ada — request terputus");
  assert.equal(db.upserts, 0);
  assert.equal(messageOf(db, "wamid.PAGI").metadata.inbound_skip_reason, undefined);
  assert.ok(logs.some((line) => line.includes("connection reset")));

  const saved = messageOf(db, "wamid.PAGI");
  const before = await assessInboundCoverage(admin, {
    messageId: saved.id,
    threadId: saved.thread_id,
    sentAt: saved.sent_at,
    autoReplyEnabled: true,
  });
  assert.deepEqual(before, { action: "enqueue" }, "safety-net melihat pesan yang sama sebagai belum tertangani");

  const recoveredLogs = await withLogs(async () => {
    const recovered = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(recovered.enqueued, true);
    assert.equal(recovered.recoveredDuplicate, true);
    assert.equal(recovered.skipReason, null);
  });
  assert.equal(db.queue.length, 1);
  assert.equal(db.upserts, 1);
  assert.equal(db.queue[0].last_message_id, saved.id);
  assert.equal(db.queue[0].message_count, 1);
  const enqueueAt = db.trace.lastIndexOf("enqueue");
  const metadataAt = db.trace.lastIndexOf("metadata");
  assert.ok(enqueueAt >= 0 && metadataAt > enqueueAt, "metadata/OCR tidak boleh mendahului antrian");
  assert.equal(messageOf(db, "wamid.PAGI").metadata.intent_label, "Sapaan");
  assert.equal(messageOf(db, "wamid.PAGI").metadata.source, "whatsapp_meta");
  assert.ok(
    recoveredLogs.some((line) => line.includes('"event":"inbound_recovered"') && line.includes("duplicate_unqueued")),
  );
  assert.ok(recoveredLogs.every((line) => !line.includes(PHONE)), "log tidak boleh memuat nomor lengkap");

  const after = await assessInboundCoverage(admin, {
    messageId: saved.id,
    threadId: saved.thread_id,
    sentAt: saved.sent_at,
    autoReplyEnabled: true,
  });
  assert.deepEqual(after, { action: "skip", reason: "duplicate_already_queued" });

  const dupLogs = await withLogs(async () => {
    const again = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(again.enqueued, false);
    assert.equal(again.recoveredDuplicate, false);
    assert.equal(again.skipReason, "duplicate_already_queued");
  });
  assert.equal(db.upserts, 1, "redelivery yang sudah mengantri tidak membuat balasan kedua");
  assert.equal(db.queue.length, 1);
  assert.equal(db.queue[0].message_count, 1);
  assert.equal(messageOf(db, "wamid.PAGI").metadata.inbound_skip_reason, "duplicate_already_queued");
  assert.ok(
    dupLogs.some(
      (line) => line.includes('"event":"inbound_skipped"') && line.includes("duplicate_already_queued"),
    ),
  );
}

// ─── Sudah dibalas: tidak mengantri ulang ────────────────────────────────────

{
  const { db, admin } = makeHarness();
  const sentAt = "2026-09-24T16:55:00.000Z";
  db.messages.push({
    id: "msg-hallo",
    thread_id: THREAD,
    body: "Hallo kak",
    direction: "in",
    sent_at: sentAt,
    wpp_id: "wamid.HALLO",
    metadata: {},
  });
  db.messages.push({
    id: "msg-out",
    thread_id: THREAD,
    body: "Halo Kak, ada yang bisa dibantu?",
    direction: "out",
    sent_at: "2026-09-24T16:55:05.000Z",
    wpp_id: null,
    metadata: {},
  });
  const { value, message } = inbound("wamid.HALLO", "Hallo kak");
  const logs = await withLogs(async () => {
    const result = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(result.skipReason, "duplicate_already_replied");
    assert.equal(result.enqueued, false);
  });
  assert.equal(db.queue.length, 0);
  assert.equal(db.upserts, 0);
  assert.ok(logs.some((line) => line.includes("duplicate_already_replied")));
  const coverage = await assessInboundCoverage(admin, {
    messageId: "msg-hallo",
    threadId: THREAD,
    sentAt,
    autoReplyEnabled: true,
  });
  assert.deepEqual(coverage, { action: "skip", reason: "duplicate_already_replied" });
}

// ─── Antrian aktif untuk pesan ini (status sent tetap terhitung) ─────────────

{
  const { db, admin } = makeHarness();
  const sentAt = "2026-09-26T00:23:00.000Z";
  db.messages.push({
    id: "msg-sent",
    thread_id: THREAD,
    body: "pagi",
    direction: "in",
    sent_at: sentAt,
    wpp_id: "wamid.SENT",
    metadata: {},
  });
  db.queue.push({
    id: "q-sent",
    phone: PHONE,
    thread_id: THREAD,
    last_message_id: "msg-sent",
    status: "sent",
    created_at: sentAt,
    message_count: 1,
  });
  const { value, message } = inbound("wamid.SENT");
  await withLogs(async () => {
    const result = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(result.skipReason, "duplicate_already_queued");
  });
  assert.equal(db.upserts, 0);
  assert.equal(db.queue.length, 1);
}

// ─── Antrian aktif thread yang lebih baru menutup pesan; burst lama digabung ─

{
  const { db, admin } = makeHarness();
  const sentAt = "2026-09-26T00:23:00.000Z";
  db.messages.push({
    id: "msg-burst",
    thread_id: THREAD,
    body: "pagi",
    direction: "in",
    sent_at: sentAt,
    wpp_id: "wamid.BURST",
    metadata: {},
  });
  db.queue.push({
    id: "q-newer",
    phone: PHONE,
    thread_id: THREAD,
    last_message_id: "msg-other",
    status: "pending",
    created_at: "2026-09-26T00:23:02.000Z",
    message_count: 1,
  });
  const { value, message } = inbound("wamid.BURST");
  await withLogs(async () => {
    const blocked = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(blocked.skipReason, "duplicate_active_queue");
    db.queue[0].created_at = "2026-09-26T00:22:00.000Z";
    const merged = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(merged.enqueued, true);
    assert.equal(merged.recoveredDuplicate, true);
  });
  assert.equal(db.upserts, 1);
  assert.equal(db.queue.length, 1, "burst pending yang lebih lama digabung, bukan balasan kedua");
  assert.equal(db.queue[0].message_count, 2);
  assert.equal(db.queue[0].last_message_id, "msg-burst");
}

// ─── auto_reply mati: tersimpan, tercatat, tidak mengantri ───────────────────

{
  const { db, admin } = makeHarness();
  db.ctx.auto_reply_enabled = false;
  const { value, message } = inbound("wamid.OFF");
  const logs = await withLogs(async () => {
    const result = await handleMetaInboundMessage(admin as never, value, message, false);
    assert.equal(result.skipReason, "auto_reply_disabled");
    assert.equal(result.enqueued, false);
  });
  assert.equal(db.queue.length, 0);
  assert.equal(db.upserts, 0);
  assert.equal(messageOf(db, "wamid.OFF").metadata.inbound_skip_reason, "auto_reply_disabled");
  assert.equal(messageOf(db, "wamid.OFF").metadata.intent_label, "Sapaan");
  assert.ok(logs.some((line) => line.includes("auto_reply_disabled")));
  assert.ok(logs.every((line) => !line.includes(PHONE)));
}

{
  const { admin } = makeHarness();
  const logs = await withLogs(async () => {
    const result = await handleMetaInboundMessage(admin as never, {}, { type: "text", text: { body: "pagi" } }, false);
    assert.equal(result.skipReason, "missing_sender_or_id");
  });
  assert.ok(logs.some((line) => line.includes("missing_sender_or_id")));
}

console.log("test-meta-inbound-enqueue: ok");
