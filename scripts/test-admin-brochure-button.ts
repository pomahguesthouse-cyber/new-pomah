import assert from "node:assert/strict";
import {
  adminBrochureLinkText,
  adminBrochureMetadata,
  canSendBrochure,
} from "../src/admin/modules/whatsapp/wa-brochure-send";
import { BROCHURE_CAPTION } from "../src/services/wa-media-dedup";

assert.equal(canSendBrochure({ hasThread: true, metaWindowClosed: false, sending: false }), true);
assert.equal(canSendBrochure({ hasThread: true, metaWindowClosed: true, sending: false }), false);
assert.equal(canSendBrochure({ hasThread: true, metaWindowClosed: false, sending: true }), false);
assert.equal(canSendBrochure({ hasThread: false, metaWindowClosed: false, sending: false }), false);

const url = "https://x.supabase.co/storage/v1/object/public/brosur/b.pdf";
assert.ok(adminBrochureLinkText(url).includes(url));
const doc = adminBrochureMetadata({ fileName: "Brosur Pomah Guesthouse.pdf", url, delivery: "document" });
assert.equal(doc.source, "admin_brochure");
assert.equal(doc.is_manual_admin, true);
assert.equal(doc.media_type, "document");
assert.equal(doc.mime_type, "application/pdf");
const link = adminBrochureMetadata({ fileName: "x", url, delivery: "link" });
assert.equal(link.media_type, undefined);
assert.equal(link.brochure_link, url);
assert.ok(BROCHURE_CAPTION.length > 0);
console.log("admin brochure button: ok");
