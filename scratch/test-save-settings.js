import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Parse .env manually
const envPath = path.resolve(".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const INTEGRATION_FIELDS = [
  "google_place_id",
  "google_places_api_key",
  "google_analytics_id",
  "google_tag_manager_id",
  "google_search_console",
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "payment_bank_name",
  "payment_account_number",
  "payment_account_holder",
  "hotel_policy",
];

async function main() {
  console.log("Fetching property row...");
  const { data: row, error } = await supabase
    .from("properties")
    .select(`id, ai_lab_config, ${INTEGRATION_FIELDS.join(", ")}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("❌ Failed to query properties:", error.message);
    return;
  }

  if (!row) {
    console.warn("⚠️ No property row found.");
    return;
  }

  console.log("✅ Successfully queried property row!");
  console.log("Property ID:", row.id);

  const aiLabCfg = row.ai_lab_config || {};
  console.log("Meta WhatsApp Config inside JSONB:");
  console.log("- Access Token:", aiLabCfg.meta_access_token ? "PRESENT (hidden)" : "MISSING");
  console.log("- Phone Number ID:", aiLabCfg.meta_phone_number_id || "MISSING");
  console.log("- Verify Token:", aiLabCfg.meta_verify_token || "MISSING");

  console.log("\nFull integrated fields returned to settings tab:");
  const settings = {
    id: row.id,
    meta_access_token: aiLabCfg.meta_access_token || null,
    meta_phone_number_id: aiLabCfg.meta_phone_number_id || null,
    meta_verify_token: aiLabCfg.meta_verify_token || null,
    google_place_id: row.google_place_id || null,
    google_places_api_key: row.google_places_api_key || null,
    google_analytics_id: row.google_analytics_id || null,
    google_tag_manager_id: row.google_tag_manager_id || null,
    google_search_console: row.google_search_console || null,
    ai_api_key: row.ai_api_key || null,
    ai_base_url: row.ai_base_url || null,
    ai_model: row.ai_model || null,
    payment_bank_name: row.payment_bank_name || null,
    payment_account_number: row.payment_account_number || null,
    payment_account_holder: row.payment_account_holder || null,
    hotel_policy: row.hotel_policy || null,
  };
  console.log(JSON.stringify(settings, null, 2));
}

main();
