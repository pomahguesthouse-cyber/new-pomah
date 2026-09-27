/**
 * Public settings must never carry credentials.
 * Fails if toPublicSettings() leaves a secret-like key or a Google API key.
 */
import assert from "node:assert/strict";
import {
  assertNoSecretSettings,
  findSecretPaths,
  toPublicSettings,
} from "../src/public/lib/public-settings";

const googleKey = `${String.fromCharCode(65, 73, 122, 97)}SyTESTKEYVALUENOTREAL000000000`;

const leakedRow = {
  id: "prop-1",
  name: "Pomah Guesthouse",
  tagline: "Boutique stay",
  description: "Near UNNES",
  address: "Jl. Dewi Sartika IV No. 71",
  city: "Semarang",
  country: "Indonesia",
  email: "info@pomahguesthouse.com",
  phone: "+628000000000",
  whatsapp_number: "6285190986169",
  logo_url: "https://example.com/logo.png",
  hotel_policy: "Tidak boleh merokok di dalam kamar",
  homepage_config: { seo: { metaTitle: "Pomah" }, gemini_api_key: googleKey },
  explore_config: {
    destinations: [
      {
        name: "Lawang Sewu",
        nearby_distance: "6.8 km (16 menit)",
        google_place_id: "ChIJ2431LD-KcC4RacYnynZhOS4",
      },
    ],
    gemini_api_key: googleKey,
  },
  currency: "IDR",
  timezone: "Asia/Jakarta",
  instagram_url: "https://instagram.com/pomahguesthouse",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  // Credentials and internal columns that must not survive the allowlist.
  gemini_api_key: googleKey,
  serper_api_key: "serper-test-key",
  tavily_api_key: "tavily-test-key",
  telegram_bot_token: "0000:telegram-test",
  telegram_webhook_secret: "webhook-test-secret",
  telegram_bot_username: "pomah_bot",
  ai_api_key: "ai-test-key",
  ai_base_url: "https://ai.internal",
  ai_model: "internal-model",
  ai_lab_config: { tools: { note: "internal" } },
  google_places_api_key: googleKey,
  wpp_token: "wpp-test-token",
  smart_delay_config: { enabled: true, shortMs: 1500 },
  payment_bank_name: "Test Bank",
  payment_account_number: "0000000000",
  payment_account_holder: "Test Holder",
  competitor_hotels: ["Other Hotel"],
  booking_form_enabled: true,
  service_role_key: "service-role-test",
};

const rawPaths = findSecretPaths(leakedRow);
assert.ok(rawPaths.some((path) => path.endsWith("gemini_api_key")), "detector sees gemini_api_key");
assert.ok(rawPaths.some((path) => path.endsWith("serper_api_key")));
assert.ok(rawPaths.some((path) => path.endsWith("tavily_api_key")));
assert.ok(rawPaths.some((path) => path.endsWith("telegram_bot_token")));
assert.ok(rawPaths.some((path) => path.endsWith("telegram_webhook_secret")));
assert.ok(rawPaths.some((path) => path.endsWith("wpp_token")));
assert.ok(rawPaths.some((path) => path.endsWith("payment_account_number")));
assert.ok(rawPaths.some((path) => path.includes("explore_config.gemini_api_key")));

const publicSettings = toPublicSettings(leakedRow);
assert.ok(publicSettings);
assert.equal(findSecretPaths(publicSettings).length, 0);
assertNoSecretSettings(publicSettings);

assert.equal(publicSettings.name, "Pomah Guesthouse");
assert.equal(publicSettings.whatsapp_number, "6285190986169");
assert.equal(publicSettings.hotel_policy, "Tidak boleh merokok di dalam kamar");
assert.equal(publicSettings.address, "Jl. Dewi Sartika IV No. 71");

const explore = publicSettings.explore_config as {
  gemini_api_key?: string;
  destinations: { nearby_distance: string; google_place_id: string }[];
};
assert.equal(explore.gemini_api_key, undefined);
assert.equal(explore.destinations[0].nearby_distance, "6.8 km (16 menit)");
assert.equal(explore.destinations[0].google_place_id, "ChIJ2431LD-KcC4RacYnynZhOS4");

const home = publicSettings.homepage_config as { seo: { metaTitle: string }; gemini_api_key?: string };
assert.equal(home.seo.metaTitle, "Pomah");
assert.equal(home.gemini_api_key, undefined);

for (const forbidden of [
  "gemini_api_key",
  "serper_api_key",
  "tavily_api_key",
  "telegram_bot_token",
  "telegram_webhook_secret",
  "telegram_bot_username",
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "ai_lab_config",
  "google_places_api_key",
  "wpp_token",
  "smart_delay_config",
  "payment_bank_name",
  "payment_account_number",
  "payment_account_holder",
  "competitor_hotels",
  "booking_form_enabled",
  "service_role_key",
]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(publicSettings, forbidden),
    false,
    `${forbidden} must not be a public field`,
  );
}

const serialized = JSON.stringify(publicSettings);
assert.equal(serialized.includes(googleKey), false);
assert.equal(serialized.includes("serper-test-key"), false);
assert.equal(serialized.includes("tavily-test-key"), false);
assert.equal(serialized.includes("webhook-test-secret"), false);
assert.equal(serialized.includes("wpp-test-token"), false);
assert.equal(serialized.includes("0000000000"), false);

// A credential pasted into an otherwise public string is redacted.
const embedded = toPublicSettings({
  description: `call us, key=${googleKey}`,
  explore_config: { destinations: [{ image: `https://maps.example/photo?key=${googleKey}&photo_reference=abc` }] },
});
assert.ok(embedded);
assert.equal(String(embedded.description).includes(googleKey), false);
assert.equal(JSON.stringify(embedded.explore_config).includes(googleKey), false);
assert.equal(JSON.stringify(embedded.explore_config).includes("photo_reference=abc"), true);
assertNoSecretSettings(embedded);

assert.equal(toPublicSettings(null), null);
assert.equal(toPublicSettings("not-a-row"), null);

console.log("public settings guard ok");
