import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BACKFILL_ROW_LIMIT,
  buildCorrectionEmbeddingText,
  buildCuratedEmbeddingText,
  buildLogEmbeddingText,
  buildSessionEmbeddingText,
  effectiveLogAnswer,
  embedInline,
  isEmptyCorrectedTranscript,
  selectBackfillBatch,
  selectSopReindexBatch,
  SESSION_IDEAL_MAX_CHARS,
  sopNeedsReindex,
  sopReindexMode,
  type BackfillCandidate,
  type SopIndexSnapshot,
} from "../src/services/training-embedding";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const curated = buildCuratedEmbeddingText("  Ada kamar? ", " Ada, Deluxe kosong. ");
assert.equal(curated, "Tamu: Ada kamar?\nAsisten: Ada, Deluxe kosong.");

assert.equal(
  effectiveLogAnswer("  Balasan yang benar  ", "jawaban model"),
  "Balasan yang benar",
);
assert.equal(effectiveLogAnswer("  ", "jawaban model"), "jawaban model");
assert.equal(
  buildLogEmbeddingText("harga?", effectiveLogAnswer("pakai koreksi", "model")),
  "Tamu: harga?\nAsisten: pakai koreksi",
);

const correction = buildCorrectionEmbeddingText("mau booking", "maaf penuh", "Deluxe masih ada");
assert.match(correction, /^Tamu: mau booking\n/);
assert.match(correction, /Jawaban salah yang pernah terjadi: maaf penuh/);
assert.match(correction, /Jawaban benar: Deluxe masih ada$/);
assert.doesNotMatch(
  buildCorrectionEmbeddingText("halo", "", "oke"),
  /Jawaban salah/,
);

const transcript = [
  { direction: "in", body: "Harga kost?" },
  { direction: "out", body: "Paket bulanan tersedia." },
];
const transcriptText = JSON.stringify(transcript);
const sessionText = buildSessionEmbeddingText({
  conversationSummary: "Tamu tanya harga bulanan",
  title: "Sesi A",
  correctedTranscript: transcript,
});
const ideal = `Tamu tanya harga bulanan\n\nTranscript terkoreksi:\n${transcriptText}`.slice(0, SESSION_IDEAL_MAX_CHARS);
assert.equal(sessionText, `Tamu: Tamu tanya harga bulanan\nAsisten: ${ideal}`);

const titleOnly = buildSessionEmbeddingText({
  conversationSummary: "  ",
  title: "Judul sesi",
  correctedTranscript: transcript,
});
assert.equal(
  titleOnly,
  `Tamu: Judul sesi\nAsisten: ${transcriptText.slice(0, SESSION_IDEAL_MAX_CHARS)}`,
);

assert.equal(buildSessionEmbeddingText({ correctedTranscript: [] }), "");
assert.equal(buildSessionEmbeddingText({ correctedTranscript: "[]" }), "");
assert.equal(isEmptyCorrectedTranscript(null), true);

const longSummary = "r".repeat(20);
const longTranscript = "x".repeat(SESSION_IDEAL_MAX_CHARS + 80);
const longText = buildSessionEmbeddingText({
  conversationSummary: longSummary,
  correctedTranscript: longTranscript,
});
const longIdeal = `${longSummary}\n\nTranscript terkoreksi:\n${longTranscript}`.slice(0, SESSION_IDEAL_MAX_CHARS);
assert.equal(longText, `Tamu: ${longSummary}\nAsisten: ${longIdeal}`);
assert.ok(longIdeal.length <= SESSION_IDEAL_MAX_CHARS);

const candidates: BackfillCandidate[] = [
  { source: "log", id: "b", createdAt: "2026-08-02T00:00:00.000Z" },
  { source: "curated", id: "a", createdAt: "2026-07-01T00:00:00.000Z" },
  { source: "session", id: "", createdAt: "2026-01-01T00:00:00.000Z" },
  { source: "correction", id: "c", createdAt: "2026-07-01T00:00:00.000Z" },
  { source: "session", id: "d", createdAt: "not-a-date" },
];
for (let index = 0; index < 30; index += 1) {
  candidates.push({
    source: "log",
    id: `row-${index.toString().padStart(2, "0")}`,
    createdAt: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  });
}
const batch = selectBackfillBatch(candidates);
assert.equal(batch.length, BACKFILL_ROW_LIMIT);
assert.equal(batch[0]?.id, "a");
assert.equal(batch[1]?.id, "c");
assert.ok(batch.every((row) => row.id.trim().length > 0));
const times = batch.map((row) => Date.parse(row.createdAt));
assert.ok(times.every((time) => Number.isFinite(time)));
assert.deepEqual(times, [...times].sort((left, right) => left - right));
assert.equal(batch.some((row) => row.id === "d"), false);

const undated = selectBackfillBatch([
  { source: "log", id: "late", createdAt: "not-a-date" },
  { source: "curated", id: "early", createdAt: "2026-01-01T00:00:00.000Z" },
], 2);
assert.deepEqual(undated.map((row) => row.id), ["early", "late"]);

function sop(partial: Partial<SopIndexSnapshot> & Pick<SopIndexSnapshot, "id">): SopIndexSnapshot {
  return {
    content: "Kebijakan sewa bulanan",
    docCategory: "knowledge",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: null,
    chunkCount: 0,
    nullEmbeddingChunkCount: 0,
    newestChunkAt: null,
    ...partial,
  };
}

assert.equal(sopReindexMode(sop({ id: "empty-chunks" })), "full");
assert.equal(sopNeedsReindex(sop({ id: "empty-chunks" })), true);
assert.equal(
  sopReindexMode(sop({
    id: "null-vector",
    chunkCount: 2,
    nullEmbeddingChunkCount: 1,
    newestChunkAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  })),
  "missing",
);
assert.equal(
  sopReindexMode(sop({
    id: "stale",
    chunkCount: 2,
    nullEmbeddingChunkCount: 1,
    newestChunkAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })),
  "full",
);
assert.equal(
  sopReindexMode(sop({
    id: "ready",
    chunkCount: 2,
    newestChunkAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  })),
  null,
);
assert.equal(sopReindexMode(sop({ id: "brosur", docCategory: "brosur", chunkCount: 0 })), null);
assert.equal(sopReindexMode(sop({ id: "blank", content: "  ", chunkCount: 0 })), null);
assert.equal(sopReindexMode(sop({ id: "unknown", chunkCount: -1 })), null);
assert.equal(
  sopReindexMode(sop({
    id: "no-stamp",
    chunkCount: 3,
    updatedAt: null,
    newestChunkAt: "2026-08-01T00:00:00.000Z",
  })),
  null,
);

const sopBatch = selectSopReindexBatch([
  sop({ id: "newer", createdAt: "2026-09-01T00:00:00.000Z" }),
  sop({ id: "older", createdAt: "2026-06-01T00:00:00.000Z" }),
  sop({ id: "middle", createdAt: "2026-07-01T00:00:00.000Z" }),
  sop({ id: "done", chunkCount: 1, newestChunkAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }),
], 2);
assert.deepEqual(sopBatch.map((doc) => doc.id), ["older", "middle"]);

const embedded = await embedInline("ok", async () => true, 200);
assert.equal(embedded, true);

let threw = false;
try {
  const failed = await embedInline("boom", async () => {
    throw new Error("gateway down");
  }, 200);
  assert.equal(failed, false);
} catch {
  threw = true;
}
assert.equal(threw, false);

let sawAbort = false;
const timedOut = await embedInline(
  "slow",
  (signal) => new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), 1_000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      sawAbort = true;
      resolve(false);
    });
  }),
  30,
);
assert.equal(timedOut, false);
assert.equal(sawAbort, true);

const curatedSrc = read("../src/admin/functions/chatbot-training.functions.ts");
assert.doesNotMatch(curatedSrc, /void embedCuratedRows/);
assert.match(curatedSrc, /await embedCuratedInline/);
assert.match(curatedSrc, /embedInline\(/);

const liveSrc = read("../src/admin/modules/training/wa-correction-live-session.functions.ts");
assert.match(liveSrc, /await embedSessionInline/);

const sessionSrc = read("../src/admin/modules/training/wa-correction.functions.ts");
assert.match(sessionSrc, /embedWaCorrectionSession/);
assert.match(sessionSrc, /await embedInline/);

const sopSrc = read("../src/admin/modules/ai-lab/sop.functions.ts");
assert.doesNotMatch(sopSrc, /Background chunk error/);
assert.match(sopSrc, /await indexSopDocumentInline/);
assert.match(sopSrc, /embedInline\(/);

const logSrc = read("../src/admin/modules/training/training.functions.ts");
assert.match(logSrc, /await embedInline/);
assert.match(logSrc, /clearEmbedding/);

const retrievalSrc = read("../src/services/training-retrieval.service.ts");
assert.match(retrievalSrc, /logRetrievalSearch\("match_chatbot_training_examples"/);
assert.match(retrievalSrc, /logRetrievalSearch\("match_training_examples"/);
assert.match(retrievalSrc, /logRetrievalSearch\("match_wa_correction_ideal_examples"/);
assert.match(retrievalSrc, /logRetrievalSearch\("match_bad_training_examples"/);
assert.match(retrievalSrc, /logRetrievalSearch\("match_wa_correction_examples"/);
assert.match(retrievalSrc, /console\.error\(`\[TrainingRAG\]/);

const cron = read("../src/routes/api.cron.backfill-training-embeddings.ts");
assert.match(cron, /runTrainingEmbeddingBackfill/);
assert.match(cron, /\/api\/cron\/backfill-training-embeddings/);
assert.match(cron, /checked: result\.checked/);
assert.match(cron, /embedded: result\.embedded/);
assert.match(cron, /failed: result\.failed/);

const sql = read("../supabase/migrations/20261010183000_cron_backfill_training_embeddings.sql");
assert.match(sql, /cron\.schedule\(\s*'backfill-training-embeddings'/);
assert.match(sql, /\*\/5 \* \* \* \*/);
assert.match(sql, /https:\/\/pomahguesthouse\.com\/api\/cron\/backfill-training-embeddings/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS embedding_updated_at/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS updated_at/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.has_pgvector_extension/);
assert.match(sql, /FROM pg_extension/);
assert.match(sql, /extname = 'vector'/);

const health = read("../src/routes/api.public.health-check.ts");
assert.doesNotMatch(health, /RPC missing/);
assert.match(health, /has_pgvector_extension/);
assert.match(health, /sop_chunks/);
assert.match(health, /pgvector column readable/);

const page = read("../src/admin/modules/training/training-page.tsx");
assert.match(page, /Indeks ulang sekarang/);
assert.match(page, /aktif \/ \{source\.indexed\} sudah terindeks/);
assert.match(page, /min-\[700px\]:grid-cols-2/);
assert.match(page, /w-full shrink-0 sm:w-auto/);

const routeTree = read("../src/routeTree.gen.ts");
assert.match(routeTree, /api\.cron\.backfill-training-embeddings/);
assert.match(routeTree, /\/api\/cron\/backfill-training-embeddings/);

const pkg = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
assert.match(pkg.scripts["test:wa-refactor"], /test:training-embeddings/);

console.log("training embedding backfill tests passed");
