import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Semua insert whatsapp_messages dari kode menulis from_me sesuai direction.
const files = [
  "src/tools/manager/reply-to-guest.tool.ts",
  "src/services/invoice-notification.service.ts",
  "src/services/wa-autoreply/takeover-commands.ts",
  "src/admin/functions/whatsapp.functions.ts",
  "src/repositories/message.repository.ts",
];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const inserts = [...src.matchAll(/insert\(\{\s*\n\s*thread_id[^\n]*\n\s*direction:\s*"(in|out)",\s*\n\s*from_me:\s*(true|false),/g)];
  const all = [...src.matchAll(/insert\(\{\s*\n\s*thread_id[^\n]*\n\s*direction:\s*"(in|out)"/g)];
  assert.equal(inserts.length, all.length, `${f}: setiap insert harus mengisi from_me`);
  for (const m of inserts) assert.equal(m[2], m[1] === "out" ? "true" : "false", f);
}

// Trigger DB menjamin from_me & last_message_at untuk penulis RPC/edge function.
const mig = readFileSync("supabase/migrations/20261019110000_wa_messages_from_me_last_message_at.sql", "utf8");
assert.match(mig, /NEW\.from_me := \(NEW\.direction = 'out'\)/);
assert.match(mig, /SET last_message_at = v_at/);
assert.match(mig, /last_message_at < v_at/);

console.log("✓ whatsapp_messages.from_me & last_message_at terisi untuk semua penulis");
