/**
 * Kotak balasan admin: kirim optimistis, cegah dobel, rekonsiliasi client id.
 * Tidak memanggil jaringan.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAdminSendInput } from "../src/services/wa-outbound-attachment";
import {
  canRetryMessage,
  canSubmitReply,
  claimSend,
  createOutboxItem,
  markOutboxFailed,
  mergeOutboxMessages,
  reconcileOutbox,
  releaseSend,
  removeOutboxItem,
  retryPayloadFromMessage,
  sendFingerprint,
} from "../src/admin/modules/whatsapp/wa-composer-send";

const threadId = "11111111-1111-4111-8111-111111111111";
const clientA = "33333333-3333-4333-8333-333333333333";
const clientB = "44444444-4444-4444-8444-444444444444";

const parsed = parseAdminSendInput({
  threadId,
  body: "  Halo tamu  ",
  clientId: clientA,
});
assert.equal(parsed.body, "Halo tamu");
assert.equal(parsed.clientId, clientA);
assert.equal(parseAdminSendInput({ threadId, body: "Halo" }).clientId, undefined);
assert.throws(() => parseAdminSendInput({ threadId, body: "Halo", clientId: "bukan-uuid" }));

assert.equal(
  canSubmitReply({
    body: "  ",
    attachmentReady: false,
    attachmentBusy: false,
    metaWindowClosed: false,
  }),
  false,
);
assert.equal(
  canSubmitReply({
    body: "ok",
    attachmentReady: false,
    attachmentBusy: true,
    metaWindowClosed: false,
  }),
  false,
);
assert.equal(
  canSubmitReply({
    body: "ok",
    attachmentReady: false,
    attachmentBusy: false,
    metaWindowClosed: true,
  }),
  false,
);
assert.equal(
  canSubmitReply({
    body: "",
    attachmentReady: true,
    attachmentBusy: false,
    metaWindowClosed: false,
  }),
  true,
);

const inflight = new Set<string>();
const fingerprint = sendFingerprint(threadId, "  Hai ", null);
assert.equal(claimSend(inflight, fingerprint), true);
assert.equal(claimSend(inflight, sendFingerprint(threadId, "Hai", null)), false);
assert.equal(claimSend(inflight, sendFingerprint(threadId, "Hai", "lain")), true);
releaseSend(inflight, fingerprint);
assert.equal(claimSend(inflight, fingerprint), true);

const server = [
  {
    id: "server-1",
    direction: "out",
    body: "Halo",
    sent_at: "2026-10-01T00:00:00.000Z",
    metadata: { client_id: clientA, send_status: "sent" },
  },
];
const pending = createOutboxItem({
  clientId: clientB,
  threadId,
  body: "  Menyusul ",
  attachment: null,
  now: "2026-10-01T00:00:01.000Z",
});
const duplicate = createOutboxItem({
  clientId: clientA,
  threadId,
  body: "Halo",
  attachment: null,
  now: "2026-10-01T00:00:02.000Z",
});
const otherThread = createOutboxItem({
  clientId: "55555555-5555-4555-8555-555555555555",
  threadId: "66666666-6666-4666-8666-666666666666",
  body: "lain",
  attachment: null,
  now: "2026-10-01T00:00:03.000Z",
});

const merged = mergeOutboxMessages(server, [duplicate, pending, otherThread], threadId);
assert.equal(merged.length, 2);
assert.equal(merged[0], server[0]);
assert.equal(merged[1]?.id, `local:${clientB}`);
assert.equal((merged[1] as { body: string }).body, "Menyusul");
assert.equal((merged[1] as { metadata: { send_status: string } }).metadata.send_status, "sending");
assert.equal(mergeOutboxMessages(server, [duplicate], threadId), server);

const reconciled = reconcileOutbox([duplicate, pending], server);
assert.deepEqual(
  reconciled.map((item) => item.clientId),
  [clientB],
);
const untouched = [pending];
assert.equal(reconcileOutbox(untouched, []), untouched);

const failed = markOutboxFailed([pending], clientB, "jaringan");
assert.equal(failed[0]?.status, "failed");
assert.equal(failed[0]?.error, "jaringan");
assert.equal(markOutboxFailed(untouched, clientA, "x"), untouched);
assert.equal(removeOutboxItem(failed, clientB).length, 0);

assert.equal(
  canRetryMessage({ direction: "in", metadata: { send_status: "failed", is_manual_admin: true } }),
  false,
);
assert.equal(canRetryMessage({ direction: "out", metadata: { send_status: "failed" } }), false);
assert.equal(
  canRetryMessage({
    direction: "out",
    metadata: { send_status: "failed", is_manual_admin: true },
  }),
  true,
);
assert.equal(
  canRetryMessage({ direction: "out", metadata: { send_status: "sending", local_outbox: true } }),
  false,
);

const retried = retryPayloadFromMessage({
  body: "Hai",
  metadata: {
    storage_path: `${threadId}/22222222-2222-4222-8222-222222222222-foto.jpg`,
    file_name: "foto.jpg",
    mime_type: "image/jpeg",
    size: 1200,
    media_url: "blob:preview",
  },
});
assert.equal(retried?.body, "Hai");
assert.equal(retried?.attachment?.mime, "image/jpeg");
assert.equal(retried?.attachment?.previewUrl, "blob:preview");
assert.equal(retryPayloadFromMessage({ body: "   ", metadata: {} }), null);
assert.deepEqual(retryPayloadFromMessage({ body: "teks", metadata: { storage_path: "x" } }), {
  body: "teks",
  attachment: null,
});

const fnSrc = fs.readFileSync("src/admin/functions/whatsapp.functions.ts", "utf8");
const callAt = fnSrc.indexOf("const sendResult = await sendWhatsAppMessage");
assert.ok(callAt > 0);
const callBody = fnSrc.slice(callAt, fnSrc.indexOf(");", callAt));
assert.match(fnSrc, /isMetaConfigured\(\)/);
assert.match(callBody, /thread\.phone/);
assert.match(callBody, /caption/);
assert.doesNotMatch(callBody, /clientId|client_id/);
assert.match(fnSrc, /metadataBase\.client_id = data\.clientId/);

const composerSrc = fs.readFileSync("src/admin/modules/whatsapp/wa-reply-composer.tsx", "utf8");
assert.match(composerSrc, /onPointerDown/);
assert.match(composerSrc, /onMouseDown/);
assert.match(composerSrc, /preventDefault\(\)/);
assert.match(composerSrc, /touchAction:\s*"manipulation"/);
assert.match(composerSrc, /min-h-11/);
assert.doesNotMatch(composerSrc, /isPending/);
assert.match(composerSrc, /aria-disabled=\{!canSubmit\}/);
assert.doesNotMatch(composerSrc, /(?<!aria-)disabled=\{!canSubmit\}/);

const pageSrc = fs.readFileSync("src/admin/modules/whatsapp/whatsapp-page.tsx", "utf8");
assert.match(pageSrc, /startTransition/);
assert.match(pageSrc, /mergeOutboxMessages/);
assert.match(pageSrc, /claimSend/);
assert.doesNotMatch(pageSrc, /sendMut/);

const css = fs.readFileSync("src/styles.css", "utf8");
assert.match(css, /html\[data-kb-open="true"\] \.wa-composer-tools/);

console.log("test-wa-composer-send: OK");
