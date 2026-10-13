/** Reaction emoji WhatsApp: disimpan di pesan target, tidak memicu balasan/bubble. */
import assert from "node:assert/strict";
import {
  applyReaction,
  handleInboundReaction,
  isLegacyReactionBubble,
  isReactionMessage,
  summarizeReactions,
} from "../src/services/wa-reactions";
import { handleMetaInboundMessage } from "../src/services/whatsapp-meta-inbox.service";

// applyReaction: set, ganti, hapus, event terlambat
let map = applyReaction(null, "628111", "👍", "2026-10-13T10:00:00.000Z");
assert.deepEqual(map["628111"].emoji, "👍");
map = applyReaction(map, "628111", "❤️", "2026-10-13T10:01:00.000Z");
assert.equal(map["628111"].emoji, "❤️");
assert.equal(Object.keys(map).length, 1, "satu emoji terakhir per pengirim");
const stale = applyReaction(map, "628111", "😂", "2026-10-13T09:00:00.000Z");
assert.equal(stale["628111"].emoji, "❤️", "event lama tidak menimpa");
map = applyReaction(map, "628222", "❤️", "2026-10-13T10:02:00.000Z");
map = applyReaction(map, "628111", "", "2026-10-13T10:03:00.000Z");
assert.equal(map["628111"], undefined, "emoji kosong = dihapus");

// summarize
const pills = summarizeReactions({
  reactions: {
    a: { emoji: "❤️", at: "2026-10-13T10:02:00Z" },
    b: { emoji: "👍", at: "2026-10-13T10:01:00Z" },
    c: { emoji: "❤️", at: "2026-10-13T10:05:00Z" },
    d: { emoji: "", at: "x" },
  },
});
assert.deepEqual(pills, [
  { emoji: "👍", count: 1 },
  { emoji: "❤️", count: 2 },
]);
assert.deepEqual(summarizeReactions(null), []);
assert.deepEqual(summarizeReactions({ reactions: [] }), []);

assert.ok(isReactionMessage({ type: "reaction" }));
assert.ok(!isReactionMessage({ type: "text" }));
assert.ok(isLegacyReactionBubble({ body: "[Lampiran reaction]" }));
assert.ok(!isLegacyReactionBubble({ body: "halo" }));

// Fake admin
function fakeAdmin(opts: { rpcMissing?: boolean; outboundOnly?: boolean } = {}) {
  const calls: string[] = [];
  const updates: any[] = [];
  const rpcs: any[] = [];
  const msg = { id: "msg-1", metadata: { source: "x" }, body: "Halo kak", sent_at: "2026-10-13T10:00:05Z" };
  const q = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => ((filters[k] = v), b),
      in: () => b,
      gte: () => b,
      lte: () => b,
      or: () => b,
      limit: () => b,
      update: (v: unknown) => {
        updates.push({ table, v });
        return b;
      },
      then: (res: (v: unknown) => void) => {
        calls.push(table);
        if (table === "whatsapp_messages" && filters.wpp_id)
          return res({ data: opts.outboundOnly ? [] : [msg], error: null });
        if (table === "whatsapp_meta_outbound")
          return res({ data: [{ recipient: "628111", body: "Halo kak", created_at: "2026-10-13T10:00:00Z" }], error: null });
        if (table === "whatsapp_threads") return res({ data: [{ id: "t1" }], error: null });
        if (table === "whatsapp_messages") return res({ data: [msg], error: null });
        return res({ data: null, error: null });
      },
    };
    return b;
  };
  return {
    calls,
    updates,
    rpcs,
    from: q,
    rpc: async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      if (fn !== "apply_whatsapp_message_reaction") throw new Error(`rpc tak terduga: ${fn}`);
      return opts.rpcMissing ? { error: { code: "PGRST202", message: "function not found" } } : { data: true, error: null };
    },
  };
}

const reactionMsg = {
  from: "628111",
  id: "wamid.REACT",
  type: "reaction",
  timestamp: "1792130400",
  reaction: { message_id: "wamid.TARGET", emoji: "👍" },
};

(async () => {
  const a1 = fakeAdmin();
  const r1 = await handleInboundReaction(a1 as never, reactionMsg);
  assert.equal(r1.reason, "stored");
  assert.equal(a1.rpcs[0].args.p_message_id, "msg-1");
  assert.equal(a1.rpcs[0].args.p_emoji, "👍");

  // Migration belum dipasang → fallback update metadata, tidak crash
  const a2 = fakeAdmin({ rpcMissing: true });
  const r2 = await handleInboundReaction(a2 as never, reactionMsg);
  assert.equal(r2.reason, "stored");
  assert.equal(a2.updates[0].v.metadata.reactions["628111"].emoji, "👍");
  assert.equal(a2.updates[0].v.metadata.source, "x", "metadata lain dipertahankan");

  // Reaction ke balasan bot (wamid hanya di whatsapp_meta_outbound)
  const a3 = fakeAdmin({ outboundOnly: true });
  const r3 = await handleInboundReaction(a3 as never, reactionMsg);
  assert.equal(r3.reason, "stored");
  assert.ok(a3.calls.includes("whatsapp_meta_outbound"));

  // Lewat inbox: tidak simpan pesan baru, tidak antri balasan AI
  const a4 = fakeAdmin();
  const res = await handleMetaInboundMessage(a4 as never, {}, reactionMsg as never, false);
  assert.equal(res.enqueued, false);
  assert.equal(res.skipReason, null);
  assert.ok(!a4.rpcs.some((r) => r.fn === "receive_whatsapp_message"), "tidak membuat bubble");
  assert.ok(!a4.calls.includes("whatsapp_queue"), "tidak masuk antrian AI");

  const bad = await handleInboundReaction(fakeAdmin() as never, { from: "1", reaction: {} });
  assert.equal(bad.reason, "invalid");

  console.log("test-wa-reactions: OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
