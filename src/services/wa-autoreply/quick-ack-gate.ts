/**
 * Gerbang quick-ack: timer yang bisa dibatalkan, plus klaim atomik tepat
 * sebelum kirim Meta.
 *
 * Jawaban yang siap sebelum ambang membatalkan timer. Kalau kirim ack sudah
 * diklaim, balasan akhir menunggu promise kirim itu selesai — ack tidak boleh
 * menyusul jawaban. Paling banyak satu klaim per gate (satu attempt). Dedup
 * lintas retry / safety-net tetap di `prepare` (baris is_ack per queue entry).
 */

export type QuickAckTimer = { cancel: () => void };

export type QuickAckGate = {
  /** Jawaban sudah ada. Batalkan timer kalau Meta ack belum diklaim. */
  noteAnswerReady: () => void;
  /**
   * Panggil segera sebelum kirim balasan ke tamu.
   * Ack yang belum diklaim dibatalkan; ack yang sudah masuk Meta ditunggu
   * sampai selesai.
   */
  beforeReplySend: () => Promise<void>;
};

type Phase = "idle" | "armed" | "preparing" | "sending" | "sent" | "cancelled";

function defaultSchedule(fn: () => void, ms: number): QuickAckTimer {
  const id = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(id) };
}

export function createQuickAckGate<T>(opts: {
  enabled: boolean;
  delayMs: number;
  prepare: (stillPending: () => boolean) => Promise<T | null>;
  send: (claim: T) => Promise<void>;
  schedule?: (fn: () => void, ms: number) => QuickAckTimer;
}): QuickAckGate {
  if (!opts.enabled) {
    return {
      noteAnswerReady() {},
      async beforeReplySend() {},
    };
  }

  const schedule = opts.schedule ?? defaultSchedule;
  let phase: Phase = "armed";
  let sendPromise: Promise<void> | null = null;
  let timer: QuickAckTimer | null = null;

  const cancelIfUnclaimed = () => {
    if (phase !== "armed" && phase !== "preparing") return;
    phase = "cancelled";
    timer?.cancel();
    timer = null;
  };

  const onFire = async () => {
    if (phase !== "armed") return;
    phase = "preparing";
    let claim: T | null = null;
    try {
      claim = await opts.prepare(() => phase === "preparing");
    } catch {
      if (phase === "preparing") phase = "cancelled";
      return;
    }
    if (claim == null || phase !== "preparing") {
      if (phase === "preparing") phase = "cancelled";
      return;
    }
    // Klaim sinkron, tanpa await, tepat sebelum Meta send dimulai.
    phase = "sending";
    sendPromise = opts.send(claim).then(
      () => {
        phase = "sent";
      },
      () => {
        phase = "sent";
      },
    );
    await sendPromise;
  };

  timer = schedule(() => {
    void onFire();
  }, Math.max(0, opts.delayMs));

  return {
    noteAnswerReady: cancelIfUnclaimed,
    async beforeReplySend() {
      if (phase === "sending" && sendPromise) {
        try {
          await sendPromise;
        } catch {
          // Kegagalan ack tidak boleh menahan balasan.
        }
        return;
      }
      cancelIfUnclaimed();
    },
  };
}
