/**
 * Aturan quick-ack: balasan cepat dan sapaan tidak di-ack; lookup yang
 * lambat mendapat tepat satu ack, dan ack selesai sebelum balasan dikirim.
 *
 * Tidak mengirim WhatsApp. Timer disuntikkan.
 */
import assert from "node:assert/strict";
import {
  QUICK_ACK_SLOW_THRESHOLD_MS,
  quickAckDelayMs,
  shouldArmQuickAck,
} from "../src/services/wa-autoreply/runtime-policy";
import { createQuickAckGate } from "../src/services/wa-autoreply/quick-ack-gate";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

assert.equal(QUICK_ACK_SLOW_THRESHOLD_MS, 3_000);
assert.equal(quickAckDelayMs(0), 3_000);
assert.equal(quickAckDelayMs(1_200), 1_800);
assert.equal(quickAckDelayMs(3_000), 0);

assert.equal(shouldArmQuickAck("malam"), false, "sapaan malam");
assert.equal(shouldArmQuickAck("selamat malam kak"), false);
assert.equal(shouldArmQuickAck("halo kak"), false);
assert.equal(shouldArmQuickAck("makasih ya kak"), false);
assert.equal(shouldArmQuickAck("terima kasih"), false);
assert.equal(shouldArmQuickAck("ok"), false);
assert.equal(shouldArmQuickAck("ok kak"), false);
assert.equal(shouldArmQuickAck("iya dong"), false);
assert.equal(shouldArmQuickAck("apa kabar"), false);
assert.equal(shouldArmQuickAck("hehe"), false);
assert.equal(shouldArmQuickAck("😊"), false);

assert.equal(shouldArmQuickAck("ada kamar tanggal 12?"), true);
assert.equal(shouldArmQuickAck("berapa harga deluxe?"), true);
assert.equal(shouldArmQuickAck("mau booking 20-22 desember"), true);
assert.equal(shouldArmQuickAck("minta foto kamar family"), true);
assert.equal(shouldArmQuickAck("2 malam"), true);
assert.equal(shouldArmQuickAck("halo, ada kamar?"), true, "sapaan + ketersediaan tetap lookup");

type Harness = {
  events: string[];
  fire: () => void;
  gate: ReturnType<typeof createQuickAckGate<string>>;
  releasePrepare: () => void;
  releaseSend: () => void;
};

function harness(opts?: { prepareResult?: string | null }): Harness {
  const events: string[] = [];
  const prepareGate = deferred();
  const sendGate = deferred();
  let fire: () => void = () => {};
  const gate = createQuickAckGate({
    enabled: true,
    delayMs: QUICK_ACK_SLOW_THRESHOLD_MS,
    schedule: (fn, ms) => {
      assert.equal(ms, QUICK_ACK_SLOW_THRESHOLD_MS);
      fire = fn;
      return {
        cancel() {
          fire = () => {};
        },
      };
    },
    prepare: async (stillPending) => {
      events.push("prepare");
      await prepareGate.promise;
      if (!stillPending()) {
        events.push("prepare-aborted");
        return null;
      }
      events.push("prepare-ok");
      return opts?.prepareResult === undefined ? "ack-row" : opts.prepareResult;
    },
    send: async (claim) => {
      events.push(`ack-start:${claim}`);
      await sendGate.promise;
      events.push("ack-end");
    },
  });
  return {
    events,
    fire: () => fire(),
    gate,
    releasePrepare: () => prepareGate.resolve(),
    releaseSend: () => sendGate.resolve(),
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Balasan cepat: timer belum mengirim, lalu dibatalkan. Tidak ada ack.
{
  const h = harness();
  h.gate.noteAnswerReady();
  h.fire();
  h.releasePrepare();
  await flush();
  await h.gate.beforeReplySend();
  assert.deepEqual(h.events, [], "fast answer -> no ack");
}

// Sapaan tidak menjadwalkan gate sama sekali (shouldArm false). Gate mati
// tidak boleh mengirim walau timer-nya dipaksa.
{
  assert.equal(shouldArmQuickAck("malam"), false);
  let sends = 0;
  const gate = createQuickAckGate({
    enabled: false,
    delayMs: 0,
    prepare: async () => "row",
    send: async () => {
      sends += 1;
    },
  });
  gate.noteAnswerReady();
  await gate.beforeReplySend();
  assert.equal(sends, 0, "greeting -> no ack");
}

// Lookup lambat: tepat satu ack, dan balasan baru lanjut setelah ack selesai.
{
  const h = harness();
  h.fire();
  h.fire();
  h.releasePrepare();
  await flush();
  assert.deepEqual(h.events, ["prepare", "prepare-ok", "ack-start:ack-row"]);

  let replyStarted = false;
  const reply = h.gate.beforeReplySend().then(() => {
    replyStarted = true;
    h.events.push("reply-start");
  });
  await flush();
  assert.equal(replyStarted, false, "balasan tidak boleh menyalip ack yang sedang dikirim");
  h.releaseSend();
  await reply;
  assert.deepEqual(h.events, [
    "prepare",
    "prepare-ok",
    "ack-start:ack-row",
    "ack-end",
    "reply-start",
  ]);

  h.releasePrepare();
  h.releaseSend();
  await h.gate.beforeReplySend();
  assert.equal(
    h.events.filter((e) => e.startsWith("ack-start")).length,
    1,
    "slow tool-lookup -> exactly one ack",
  );
}

// Balasan mulai saat dedup ack masih berjalan: ack tidak boleh terkirim.
{
  const h = harness();
  h.fire();
  await flush();
  assert.deepEqual(h.events, ["prepare"]);
  await h.gate.beforeReplySend();
  h.releasePrepare();
  await flush();
  assert.deepEqual(h.events, ["prepare", "prepare-aborted"], "no ack after the reply has started");
  assert.equal(
    h.events.some((e) => e.startsWith("ack-start")),
    false,
  );
}

// Retry / safety-net: baris ack untuk entry yang sama sudah ada.
{
  const h = harness({ prepareResult: null });
  h.fire();
  h.releasePrepare();
  await flush();
  await h.gate.beforeReplySend();
  assert.deepEqual(h.events, ["prepare", "prepare-ok"]);
  assert.equal(
    h.events.some((e) => e.startsWith("ack-start")),
    false,
    "existing ack row -> no second send",
  );
}

console.log("✓ quick-ack: fast/greeting skip, slow lookup acks once before the reply");
