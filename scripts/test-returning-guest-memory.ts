import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPropertyFaqReply } from "../src/services/property-faq";

const returningGreeting = buildPropertyFaqReply({
  message: "halo",
  property: { name: "Pomah Guesthouse" },
  guestName: "Budi Santoso",
  mode: "early",
});
assert.ok(returningGreeting);
assert.equal(returningGreeting.intent, "greeting");
assert.match(returningGreeting.reply, /^Halo Kak Budi,/);

const numericPlaceholder = buildPropertyFaqReply({
  message: "halo",
  property: { name: "Pomah Guesthouse" },
  guestName: "6281338969133",
  mode: "early",
});
assert.ok(numericPlaceholder);
assert.match(numericPlaceholder.reply, /^Halo Kak,/);
assert.doesNotMatch(numericPlaceholder.reply, /6281338969133/);

const anonymousGreeting = buildPropertyFaqReply({
  message: "halo",
  property: { name: "Pomah Guesthouse" },
  mode: "early",
});
assert.ok(anonymousGreeting);
assert.match(anonymousGreeting.reply, /^Halo Kak,/);

const serviceSource = fs.readFileSync("src/services/wa-autoreply.service.ts", "utf8");
assert.match(serviceSource, /const rawGuestProfile = c\.guest_profile/);
assert.match(serviceSource, /Number\(guestProfile\?\.total_bookings/);
assert.match(serviceSource, /guestName: returningGuestName/);
assert.match(serviceSource, /guestProfile,/);

const orchestratorSource = fs.readFileSync("src/ai/multi-agent-orchestrator.ts", "utf8");
assert.match(orchestratorSource, /PROFIL TAMU TERVERIFIKASI DARI DATABASE/);
assert.match(orchestratorSource, /Nama tamu:/);
assert.match(orchestratorSource, /jangan minta ulang/i);

const migrationSource = fs.readFileSync(
  "supabase/migrations/20260719160000_restore_returning_guest_memory.sql",
  "utf8",
);
for (const required of [
  "get_returning_guest_profile",
  "get_guest_structured_memory",
  "v_effective_summary_json",
  "'guest_profile'",
  "'guest_memory'",
  "v_send_target",
  "v_ai_paused_until",
  "trg_booking_sync_guest_memory",
  "sync_guest_memory_from_booking",
]) {
  assert.ok(migrationSource.includes(required), `migration missing: ${required}`);
}

console.log("✓ Returning guest memory regressions passed");
